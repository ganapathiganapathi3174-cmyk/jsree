import {
  runOCR,
  extractPaymentData,
  matchAmount,
  matchUPIWithRecovery,
  isWithinTimeWindow,
  dateTimeEntryToDate,
  isDemoScreenshot,
  runAdditionalOCRPasses,
  runAmountRecoveryOCR,
  runDeepAmountRecovery,
  verifyAmountWithCurrencyRecovery,
  normalizeUPI,
  matchReceiverName,
  normalizeName,
} from './ocrService.js';
import {
  PAYMENT_TIME_WINDOW_MINUTES,
  MIN_OCR_CONFIDENCE_APPROVE,
  TIMEZONE,
} from '../config/paymentConfig.js';
import { supabase } from '../db/supabase.js';

// ─────────────────────────────────────────────────────────────
// Strict automatic verification engine (payments AND top-ups).
//
// DECISION RULE — binary for the strong identity/amount gates, with a
// single manual-review branch for the SECONDARY recipient-name check:
//   approved      = upiMatch && amountMatch && dateValid && utrPresent
//                   && transactionStatusOk && ocrConfident
//                   && allFieldConfidenceHigh
//                   && (name gate disabled OR receiver name matches)
//   manual_review = a strong gate passed but the recipient-name evidence is
//                   missing/unreadable, or no receiver name is configured
//                   (fail safe — never auto-approve blindly)
//   rejected      = any strong gate fails, or a name IS present but does not
//                   match the configured recipient
//
// The name gate is ACTIVE only when a receiver name is supplied
// (receiverName !== undefined). Direct engine callers/tests that omit it keep
// the original binary behaviour. Production callers always pass the resolved
// receiver name (possibly ''), so an unconfigured name fails safe.
//
// APPROVE conditions (ALL must pass):
//   1. Receiver UPI matches expected
//   2. Transaction amount exactly matches expected amount
//   3. Transaction timestamp within ±30 min of the SERVER-SIDE upload time
//      (complete timestamp required — a date-only reading fails the window)
//   4. Payment status explicitly indicates success/completed/paid
//   5. A valid UTR/reference ID is detected
//   6. OCR confidence >= MIN_OCR_CONFIDENCE_APPROVE
//   7. All field-level confidences are "high"
//   8. (when enabled) the detected recipient name matches the configured name
//
// REJECT conditions (ANY triggers rejection):
//   - Wrong UPI
//   - Wrong amount
//   - Date/time outside the ±30-minute window (older than 30 min OR more than
//     30 min in the future) — including date-only / missing timestamps
//   - Missing or non-success transaction status
//   - Missing UTR
//   - Low OCR confidence
//   - Any field confidence below "high"
//   - Recipient name present but different from the configured name
//   - Duplicate UTR (handled by reserveApprovedUtr)
// ─────────────────────────────────────────────────────────────
export function decidePaymentVerification({
  upiMatch, amountMatch, dateValid, utrPresent,
  transactionStatusOk, ocrConfidence,
  receiverName, nameMatch, nameFound, nameConfigured,
}) {
  // Gate 1: UPI must match
  if (upiMatch !== true) return { decision: 'rejected', reason: 'UPI_MISMATCH' };

  // Gate 2: Amount must match
  if (amountMatch !== true) return { decision: 'rejected', reason: 'AMOUNT_MISMATCH' };

  // Gate 3: Date/time must be within the ±30-minute freshness window
  if (dateValid !== true) return { decision: 'rejected', reason: 'INVALID_PAYMENT_DATE' };

  // Gate 4: Transaction status must explicitly indicate success
  if (transactionStatusOk !== true) return { decision: 'rejected', reason: 'TRANSACTION_FAILED' };

  // Gate 5: UTR must be present
  if (utrPresent !== true) return { decision: 'rejected', reason: 'MISSING_UTR' };

  // Gate 6: OCR confidence must meet the approval floor.
  // Undefined confidence fails closed — never silently bypass the gate.
  const confident = ocrConfidence !== undefined && ocrConfidence >= MIN_OCR_CONFIDENCE_APPROVE;
  if (!confident) return { decision: 'rejected', reason: 'LOW_OCR_CONFIDENCE' };

  // Gate 7 (SECONDARY): recipient name. Only evaluated when a receiver name
  // is supplied. Undefined => disabled (direct engine callers / legacy tests).
  if (receiverName !== undefined) {
    if (nameConfigured !== true) {
      // No trusted payee name configured — fail safe, do not auto-approve.
      return { decision: 'manual_review', reason: 'RECEIVER_NAME_NOT_CONFIGURED' };
    }
    if (nameMatch !== true) {
      if (nameFound === true) {
        // A payee name was read and it is a DIFFERENT person — hard reject.
        return { decision: 'rejected', reason: 'RECEIVER_NAME_MISMATCH' };
      }
      // No name could be read from the screenshot — needs human review.
      return { decision: 'manual_review', reason: 'RECEIVER_NAME_UNREADABLE' };
    }
  }

  // All gates passed — approve.
  return { decision: 'approved', reason: null };
}

export function requireExternalPaymentConfirmation(verificationResult) {
  if (verificationResult?.decision !== 'approved') return verificationResult;

  return {
    ...verificationResult,
    ocrDecision: 'approved',
    decision: 'manual_review',
    reason: 'EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED',
  };
}

// ─────────────────────────────────────────────────────────────
// Runs OCR on a screenshot and produces the verification result.
//
// Throws OCR_FAILED / OCR_UNREADABLE when the screenshot cannot be
// processed (caller keeps the record in a retryable state). On success
// returns { verificationResult, verificationTime, utr }. The result is
// structured ({ decision, reason, checks, detected, ... }) for admin
// debugging; decision/reason remain the primary contract.
// ─────────────────────────────────────────────────────────────
export async function runScreenshotVerification({ imageBuffer, screenshotUrl, expectedAmount, receiverUpi, receiverName, now, referenceId = null, referenceType = null }) {
  // Server-side upload/receipt time — captured BEFORE the OCR run starts.
  // The ±30-minute freshness window is measured from this instant (spec:
  // "within ±30 min of the SERVER-SIDE upload time"). Capturing it after OCR
  // would erode the window by the OCR duration (30-75 s in production), so a
  // payment made 29:45 before upload could be rejected as >30 min old.
  const receivedAt = now instanceof Date ? now : new Date();
  const ocrStart = Date.now();

  let buffer = imageBuffer;
  let ocrText = '';
  let ocrConfidence = 0;
  let extractedAmounts = [];
  let recoveredFromBands = false;
  let extractedUPIs = [];
  let extractedUTRs = [];
  let extractedDates = [];
  let extractedDateTimes = [];
  let extractedReceiverNames = [];
  let transactionStatus = null;
  let ocrPassInfo = { primaryConfidence: 0, additionalPassesRun: 0, additionalPassConfidences: [], candidatesFromPasses: { amounts: [], upis: [], utrs: [] } };
  // Timing variables for structured logging
  let primaryMs = 0;
  let additionalMs = 0;
  let stripRecoveryMs = 0;
  let deepRecoveryMs = 0;
  let currencyRecoveryMs = 0;

  try {
    if (!buffer && screenshotUrl) {
      const resp = await fetch(screenshotUrl);
      if (!resp.ok) throw new Error('Failed to fetch screenshot');
      buffer = Buffer.from(await resp.arrayBuffer());
    }

    // ── Primary OCR pass ──
    const primaryStart = Date.now();
    const ocr = await runOCR(buffer);
    primaryMs = Date.now() - primaryStart;
    console.log('[VERIFICATION TIMING]', JSON.stringify({
      reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
      phase: 'primary_ocr',
      durationMs: primaryMs,
      confidence: ocr.confidence,
    }));
    ocrText = ocr.text;
    ocrConfidence = ocr.confidence;
    ocrPassInfo.primaryConfidence = ocrConfidence;

    const primaryExtracted = extractPaymentData(ocrText);
    extractedAmounts = primaryExtracted.amounts;
    extractedUPIs = primaryExtracted.upis;
    extractedUTRs = primaryExtracted.utrs;
    extractedDates = primaryExtracted.dates;
    extractedDateTimes = primaryExtracted.dateTimes;
    extractedReceiverNames = primaryExtracted.receiverNames || [];
    transactionStatus = primaryExtracted.transactionStatus;

    // ── Additional OCR passes (upscaled + thresholded) ──
    // Run when primary pass is missing key data to improve recall.
    try {
      const additionalStart = Date.now();
      const additionalPasses = await runAdditionalOCRPasses(buffer);
      additionalMs = Date.now() - additionalStart;
      console.log('[VERIFICATION TIMING]', JSON.stringify({
        reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
        phase: 'additional_ocr',
        durationMs: additionalMs,
        passesRun: additionalPasses.length,
        confidences: additionalPasses.map(p => p.confidence),
      }));
      ocrPassInfo.additionalPassesRun = additionalPasses.length;
      ocrPassInfo.additionalPassConfidences = additionalPasses.map(p => p.confidence);

      for (const pass of additionalPasses) {
        const passExtracted = extractPaymentData(pass.text);
        // Merge candidates (union)
        for (const a of passExtracted.amounts) {
          if (!extractedAmounts.includes(a)) extractedAmounts.push(a);
        }
        for (const u of passExtracted.upis) {
          const normalized = normalizeUPI(u);
          if (!extractedUPIs.some(e => normalizeUPI(e) === normalized)) {
            extractedUPIs.push(u);
          }
        }
        for (const u of passExtracted.utrs) {
          if (!extractedUTRs.includes(u)) extractedUTRs.push(u);
        }
        for (const dt of passExtracted.dateTimes) {
          const key = `${dt.day}-${dt.month}-${dt.year}-${dt.hour}-${dt.minute}`;
          if (!extractedDateTimes.some(e => `${e.day}-${e.month}-${e.year}-${e.hour}-${e.minute}` === key)) {
            extractedDateTimes.push(dt);
          }
        }
        for (const n of passExtracted.receiverNames || []) {
          if (!extractedReceiverNames.includes(n)) extractedReceiverNames.push(n);
        }
        if (!transactionStatus && passExtracted.transactionStatus) {
          transactionStatus = passExtracted.transactionStatus;
        }
        // Check all passes for demo markers
        if (isDemoScreenshot(pass.text)) {
          ocrText = pass.text;
        }
      }
      ocrPassInfo.candidatesFromPasses = { amounts: extractedAmounts, upis: extractedUPIs, utrs: extractedUTRs };
    } catch (e) { /* additional passes are best-effort */ }

  } catch (ocrErr) {
    console.log('[VERIFICATION DEBUG]', JSON.stringify({
      reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
      receivedAt: receivedAt.toISOString(),
      ocrMs: Date.now() - ocrStart,
      decision: 'inconclusive',
      reason: 'OCR_FAILED',
      detail: ocrErr.message,
    }));
    throw { message: 'OCR processing failed', code: 'OCR_FAILED', details: ocrErr.message };
  }

  if (!ocrText || ocrText.trim().length < 5) {
    console.log('[VERIFICATION DEBUG]', JSON.stringify({
      reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
      receivedAt: receivedAt.toISOString(),
      ocrMs: Date.now() - ocrStart,
      decision: 'inconclusive',
      reason: 'OCR_UNREADABLE',
    }));
    throw { message: 'OCR could not read the screenshot', code: 'OCR_UNREADABLE' };
  }

  // Deterministic clock for tests; production uses the real server clock.
  const verificationTime = now instanceof Date ? now : new Date();

  // Screenshot authenticity: reject obvious demo/test/sample screenshots.
  const isDemo = isDemoScreenshot(ocrText);
  if (isDemo) {
    const demoResult = {
      ocrConfidence,
      recoveredFromBands: false,
      extractedAmounts,
      extractedUPIs,
      extractedUTRs,
      extractedDates: [],
      extractedDateTimes: [],
      extractedReceiverNames: [],
      amountMatch: false,
      upiMatch: false,
      utr: null,
      dateValid: false,
      hasTimeComponent: false,
      transactionStatus: null,
      decision: 'rejected',
      reason: 'DEMO_SCREENSHOT',
      checks: {
        amount: { passed: false, expected: expectedAmount, detected: null },
        receiverUpi: { passed: false, expected: receiverUpi, detected: null },
        receiverName: { passed: false, expected: (typeof receiverName === 'string' ? receiverName : null), detected: null },
        utr: { passed: false, detected: null },
        transactionDate: { passed: false, detected: null, timezone: TIMEZONE },
        transactionStatus: { passed: false, detected: null },
        duplicate: { passed: true, utr: null },
      },
      detected: { amount: null, utr: null, upi: null, receiverNames: [], date: null, dateTimeMs: null, status: null },
      fieldConfidence: {
        amount: { confidence: 'none', reason: 'Demo screenshot detected' },
        receiverUpi: { confidence: 'none', reason: 'Demo screenshot detected' },
        receiverName: { confidence: 'none', reason: 'Demo screenshot detected' },
        utr: { confidence: 'none', reason: 'Demo screenshot detected' },
        transactionDate: { confidence: 'none', reason: 'Demo screenshot detected' },
        transactionStatus: { confidence: 'none', reason: 'Demo screenshot detected' },
      },
    };
    console.log('[VERIFICATION DEBUG]', JSON.stringify({
      reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
      receivedAt: receivedAt.toISOString(),
      verificationTime: verificationTime.toISOString(),
      ocrMs: Date.now() - ocrStart,
      reason: 'DEMO_SCREENSHOT',
      decision: 'rejected',
    }));
    return { verificationResult: demoResult, verificationTime, utr: null };
  }

  // ── UPI match is resolved BEFORE amount recovery ──
  // decidePaymentVerification() evaluates Gate 1 (UPI) before Gate 2 (amount),
  // so a UPI mismatch is already terminal: no amount candidate discovered later
  // can change the decision or its reason. The three amount-recovery stages cost
  // up to 125 extra OCR calls (~40s), so they are skipped when the outcome is
  // already fixed. UPI matching never reads amount data, so this reorder is a
  // no-op for the UPI-pass path — recovery still runs there exactly as before.
  const upiResult = matchUPIWithRecovery(extractedUPIs, receiverUpi);
  const upiMatch = upiResult.match;
  // When UPI already failed, recovery is skipped and these fields keep their
  // primary-pass values (checks.amount / extractedAmounts / fieldConfidence)
  // — diagnostics only; decision and reason are unaffected.
  const skipAmountRecovery = upiMatch !== true;

  // Full-page OCR may have dropped a large-font amount line (common on UPI
  // receipts). This recovery DOES feed the decision: amountMatch is Gate 2 of
  // decidePaymentVerification() and also drives fieldConfidence.amount, which
  // the allFieldsHighConfidence gate enforces. Recovery only runs when the
  // outcome is still in play (Gate 1 passed).
  let amountMatch = matchAmount(extractedAmounts, expectedAmount);

  if (!amountMatch && !skipAmountRecovery) {
    try {
      const stripStart = Date.now();
      const recovered = await runAmountRecoveryOCR(buffer);
      stripRecoveryMs = Date.now() - stripStart;
      console.log('[VERIFICATION TIMING]', JSON.stringify({
        reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
        phase: 'strip_recovery_ocr',
        durationMs: stripRecoveryMs,
        candidatesFound: recovered.length,
      }));
      const merged = [...new Set([...extractedAmounts, ...recovered])];
      if (matchAmount(merged, expectedAmount)) {
        amountMatch = true;
        recoveredFromBands = true;
        extractedAmounts = merged;
      }
    } catch (e) { /* recovery is best-effort; keep original result */ }
  }

  if (!amountMatch && !skipAmountRecovery) {
    try {
      const deepStart = Date.now();
      const deepRecovered = await runDeepAmountRecovery(buffer);
      deepRecoveryMs = Date.now() - deepStart;
      console.log('[VERIFICATION TIMING]', JSON.stringify({
        reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
        phase: 'deep_recovery_ocr',
        durationMs: deepRecoveryMs,
        candidatesFound: deepRecovered.length,
      }));
      const merged = [...new Set([...extractedAmounts, ...deepRecovered])];
      if (matchAmount(merged, expectedAmount)) {
        amountMatch = true;
        recoveredFromBands = true;
        extractedAmounts = merged;
      }
    } catch (e) { /* deep recovery is best-effort */ }
  }

  // ── Currency-symbol corruption recovery ──
  // When all OCR passes extract a candidate like "2120" but the expected
  // amount is 120, Tesseract may have misread the ₹ symbol as "2".
  // This step runs targeted region-specific OCR with multiple preprocessing
  // strategies to recover evidence of the correct amount from the image.
  // It ONLY accepts when a preprocessing strategy produces the exact expected
  // amount — no numeric heuristics, no string inference.
  if (!amountMatch && !skipAmountRecovery) {
    try {
      const currencyStart = Date.now();
      const currencyResult = await verifyAmountWithCurrencyRecovery(buffer, expectedAmount);
      currencyRecoveryMs = Date.now() - currencyStart;
      console.log('[VERIFICATION TIMING]', JSON.stringify({
        reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
        phase: 'currency_recovery_ocr',
        durationMs: currencyRecoveryMs,
        verified: currencyResult.verified,
        method: currencyResult.method,
      }));
      if (currencyResult.verified) {
        amountMatch = true;
        recoveredFromBands = true;
        if (!extractedAmounts.includes(expectedAmount)) {
          extractedAmounts.push(expectedAmount);
        }
      }
    } catch (e) { /* currency recovery is best-effort */ }
  }

  const utr = extractedUTRs.length > 0 ? extractedUTRs[0]?.replace(/\s+/g, '').trim() || null : null;

  // Time-aware date resolution: prefer a receipt line that carries an exact
  // time ("19/08/2026, 7:39 AM"); fall back to a date-only reading.
  const timeEntry = extractedDateTimes.find(e => e.hasTime) || null;
  const anyEntry = extractedDateTimes[0] || null;
  const dateEntry = timeEntry || anyEntry;
  const date = dateEntry ? dateTimeEntryToDate(dateEntry) : (extractedDates[0] || null);

  const windowMinutes = PAYMENT_TIME_WINDOW_MINUTES;
  // Symmetric freshness window measured from the SERVER-SIDE upload instant:
  //   transaction time within [uploadTime - 30 min, uploadTime + 30 min]
  // A real payment always happens shortly BEFORE the screenshot is uploaded,
  // so requiring transaction >= serverNow rejected every genuine receipt.
  //
  // NOTE: this is intentionally ONLY the ±30-minute window. An extra
  // "same IST calendar day" condition used to be ANDed in here, which
  // rejected genuine payments that straddle midnight (paid 23:50 IST,
  // uploaded 00:10 IST — a 20-minute-old payment inside the window).
  // It is redundant for replay protection: a receipt from an earlier day is
  // always more than 30 minutes old, so the window alone excludes it, and the
  // payment-request expiry gate (expires_at = createdAt + 30 min) independently
  // blocks stale requests on both flows.
  const dateValid = !!date && isWithinTimeWindow(date, receivedAt, windowMinutes);
  const hasTimeComponent = !!(timeEntry || anyEntry)?.hasTime;

  // Transaction status must explicitly indicate success.
  // null (not detected), "failed", "pending", "processing" all → false.
  const transactionStatusOk = transactionStatus?.status === 'success';

  // UTR must be present.
  const utrPresent = !!utr;

  // Strict field confidence gate: ALL required fields must have "high"
  // confidence.  Medium/low/none on any field → reject.
  const detectedUpi = extractedUPIs.length > 0 ? extractedUPIs.join(', ') : null;

  // ── Recipient-name gate (SECONDARY identity check) ──
  // Active only when the caller supplies a receiver name. Direct engine
  // callers (tests) omit it and keep the original binary behaviour.
  const nameActive = receiverName !== undefined;
  const nameConfigured = nameActive && normalizeName(receiverName) !== null;
  const nameResult = nameActive ? matchReceiverName(extractedReceiverNames, receiverName) : null;
  const nameMatch = nameActive ? nameResult.match === true : true;
  const nameFound = nameActive ? nameResult.candidates.length > 0 : false;
  const detectedReceiverNames = extractedReceiverNames.length > 0 ? extractedReceiverNames.join(', ') : null;

  const fieldConfidence = {
    amount: {
      confidence: amountMatch ? 'high' : (extractedAmounts.length > 0 ? 'low' : 'none'),
      reason: amountMatch
        ? 'Extracted amount matches expected'
        : (extractedAmounts.length > 0
          ? `Extracted ${extractedAmounts.join(', ')} does not match expected ${expectedAmount}`
          : 'No amount found in screenshot'),
    },
    receiverUpi: {
      confidence: upiMatch ? 'high' : (extractedUPIs.length > 0 ? 'low' : 'none'),
      reason: upiMatch
        ? 'Receiver UPI matches expected'
        : (extractedUPIs.length > 0
          ? `Found ${detectedUpi} does not match expected ${receiverUpi}`
          : 'No UPI found in screenshot'),
    },
    utr: {
      confidence: utr ? 'high' : 'none',
      reason: utr ? `UTR found: ${utr}` : 'No UTR found in screenshot',
    },
    transactionDate: {
      confidence: hasTimeComponent ? 'high' : (date ? 'medium' : 'none'),
      reason: dateValid
        ? 'Date/time within forward window'
        : (date
          ? 'Date found but outside valid window or missing time component'
          : 'No valid transaction date found'),
    },
    transactionStatus: {
      confidence: transactionStatusOk ? 'high' : (transactionStatus ? 'low' : 'none'),
      reason: transactionStatusOk
        ? 'Status detected: success'
        : (transactionStatus
          ? `Status detected: ${transactionStatus.status} (not successful)`
          : 'No transaction status detected in screenshot'),
    },
    receiverName: nameActive
      ? {
        confidence: !nameConfigured ? 'none' : nameMatch ? 'high' : (nameFound ? 'low' : 'none'),
        reason: !nameConfigured
          ? 'No receiver name configured — manual review required'
          : nameMatch
            ? 'Detected receiver name matches configured payee'
            : (nameFound
              ? `Detected ${detectedReceiverNames} does not match configured receiver name`
              : 'No receiver name found in screenshot'),
      }
      : { confidence: 'high', reason: 'Receiver name check not enabled' },
  };

  const allFieldsHighConfidence =
    fieldConfidence.amount.confidence === 'high' &&
    fieldConfidence.receiverUpi.confidence === 'high' &&
    fieldConfidence.utr.confidence === 'high' &&
    fieldConfidence.transactionDate.confidence === 'high' &&
    fieldConfidence.transactionStatus.confidence === 'high' &&
    (!nameActive || fieldConfidence.receiverName.confidence === 'high');

  const { decision, reason } = decidePaymentVerification({
    upiMatch, amountMatch, dateValid, utrPresent,
    transactionStatusOk, ocrConfidence,
    receiverName, nameMatch, nameFound, nameConfigured,
  });

  // Enforce field confidence gate: even if the decision engine says approved,
  // reject if any field confidence is below "high".
  let effectiveDecision = decision;
  let effectiveReason = reason;
  if (effectiveDecision === 'approved' && !allFieldsHighConfidence) {
    effectiveDecision = 'rejected';
    effectiveReason = 'LOW_FIELD_CONFIDENCE';
  }

  const detectedAmount = amountMatch ? expectedAmount : (extractedAmounts[0] ?? null);
  const detectedDate = dateEntry ? dateEntry.raw : (date ? date.toISOString() : null);

  const checks = {
    amount: { passed: amountMatch, expected: expectedAmount, detected: detectedAmount },
    receiverUpi: { passed: upiMatch, expected: receiverUpi, detected: detectedUpi },
    receiverName: {
      passed: nameActive ? nameMatch : true,
      enabled: nameActive,
      expected: typeof receiverName === 'string' ? (receiverName || null) : null,
      detected: detectedReceiverNames,
    },
    utr: { passed: utrPresent, detected: utr || null },
    transactionDate: { passed: dateValid, detected: detectedDate, timezone: TIMEZONE },
    transactionStatus: {
      passed: transactionStatusOk,
      detected: transactionStatus ? transactionStatus.matched : null,
    },
    duplicate: { passed: true, utr: null },
  };

  const detected = {
    amount: detectedAmount,
    utr: utr || null,
    upi: detectedUpi,
    receiverNames: extractedReceiverNames,
    date: detectedDate,
    dateTimeMs: date && hasTimeComponent ? date.getTime() : null,
    status: transactionStatus ? transactionStatus.matched : null,
  };

  // One structured line per verification request — every gate, its inputs and
  // the final decision. This is the audit trail used to explain WHY a
  // screenshot was approved or rejected (register payments AND top-ups).
  // Contains no secrets, tokens or credentials.
  const totalMs = Date.now() - ocrStart;
  console.log('[VERIFICATION DEBUG]', JSON.stringify({
    reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
    receivedAt: receivedAt.toISOString(),
    verificationTime: verificationTime.toISOString(),
    ocrMs: totalMs,
    timingBreakdown: {
      primaryOcrMs: ocrPassInfo.primaryConfidence > 0 ? 'measured_above' : 0,
      additionalOcrMs: 'measured_above',
      stripRecoveryMs,
      deepRecoveryMs,
      currencyRecoveryMs,
      totalMs,
    },
    transactionDateTime: date ? date.toISOString() : null,
    differenceMinutes: date ? Number(((receivedAt.getTime() - date.getTime()) / 60000).toFixed(2)) : null,
    windowMinutes,
    upiExpected: receiverUpi,
    upiDetected: detectedUpi,
    upiMatch,
    upiMethod: upiResult.method,
    amountExpected: expectedAmount,
    amountDetected: detectedAmount,
    amountMatch,
    utr: utr || null,
    utrPresent,
    transactionDateTimeValid: dateValid,
    hasTimeComponent,
    transactionStatus: transactionStatus ? transactionStatus.status : null,
    ocrConfidence,
    receiverNameExpected: typeof receiverName === 'string' ? (receiverName || null) : null,
    receiverNamesDetected: extractedReceiverNames,
    receiverNameMatch: nameActive ? nameMatch : null,
    receiverNameMethod: nameResult ? nameResult.method : null,
    fieldConfidence: {
      amount: fieldConfidence.amount.confidence,
      receiverUpi: fieldConfidence.receiverUpi.confidence,
      receiverName: fieldConfidence.receiverName.confidence,
      utr: fieldConfidence.utr.confidence,
      transactionDate: fieldConfidence.transactionDate.confidence,
      transactionStatus: fieldConfidence.transactionStatus.confidence,
    },
    decision: effectiveDecision,
    reason: effectiveReason,
  }));

  return {
    verificationResult: {
      ocrConfidence,
      recoveredFromBands,
      extractedAmounts,
      extractedUPIs,
      extractedUTRs,
      extractedDates: extractedDates.map(d => d.toISOString()),
      extractedDateTimes: extractedDateTimes.map(e => ({ ...e, raw: undefined })),
      extractedReceiverNames,
      amountMatch,
      upiMatch,
      nameMatch: nameActive ? nameMatch : null,
      nameFound,
      nameConfigured,
      utr: utr || null,
      dateValid,
      hasTimeComponent,
      transactionStatus,
      decision: effectiveDecision,
      reason: effectiveReason,
      checks,
      detected,
      fieldConfidence,
      nameDiagnostics: {
        enabled: nameActive,
        expected: typeof receiverName === 'string' ? (receiverName || null) : null,
        candidates: extractedReceiverNames,
        matchMethod: nameResult ? nameResult.method : null,
        matched: nameResult ? nameResult.matched : null,
      },
      upiDiagnostics: {
        originalCandidates: upiResult.originalCandidates || [],
        normalizedCandidates: upiResult.allCandidates || [],
        matchMethod: upiResult.method,
        matchConfidence: upiResult.confidence,
        matchedCandidate: upiResult.candidate,
        expectedUpi: receiverUpi,
      },
      ocrPassInfo,
    },
    verificationTime,
    utr,
  };
}

// ─────────────────────────────────────────────────────────────
// Approved-UTR duplicate protection (shared by payments AND top-ups).
//
// Only PREVIOUSLY APPROVED records live in approved_utrs, so a UTR that
// appears on a rejected/pending/failed/cancelled record can never block a
// future approval. Missing/empty UTRs are skipped entirely.
// ─────────────────────────────────────────────────────────────
export function normalizeUtr(utr) {
  if (!utr) return null;
  const normalized = String(utr).replace(/\s+/g, '').trim().toUpperCase();
  return normalized || null;
}

// Atomically records an approved UTR. Race-safe: the UNIQUE(utr) constraint
// (migration 007) guarantees that only ONE caller can reserve a given UTR —
// concurrent same-UTR submissions see a 23505 and are told "duplicate".
// Never a SELECT-then-INSERT.
//
// Returns:
//   { reserved: true,  duplicate: false, utr }  -> caller owns the UTR now
//   { reserved: false, duplicate: true,  utr }  -> already APPROVED elsewhere
//   { reserved: false, duplicate: false, utr: null } -> no UTR to reserve
export async function reserveApprovedUtr(utr, referenceType, referenceId) {
  const normalized = normalizeUtr(utr);
  if (!normalized) return { reserved: false, duplicate: false, utr: null };

  const { data, error } = await supabase
    .from('approved_utrs')
    .insert({ utr: normalized, reference_type: referenceType, reference_id: referenceId })
    .select('utr')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') return { reserved: false, duplicate: true, utr: normalized };
    throw { message: 'Failed to record approved UTR', code: 'UTR_RESERVE_FAILED' };
  }
  return { reserved: true, duplicate: false, utr: normalized, id: data?.id || null };
}

// Removes a reservation made for a specific record (used to compensate when
// approval fails AFTER the UTR was reserved, so the UTR can be retried).
export async function releaseApprovedUtr(utr, referenceType, referenceId) {
  const normalized = normalizeUtr(utr);
  if (!normalized) return;
  await supabase
    .from('approved_utrs')
    .delete()
    .eq('utr', normalized)
    .eq('reference_id', referenceId);
}