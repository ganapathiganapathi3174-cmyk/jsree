import {
  runOCR,
  extractPaymentData,
  matchAmount,
  matchUPIWithRecovery,
  isWithinTimeWindow,
  isSameIstDay,
  dateTimeEntryToDate,
  isDemoScreenshot,
  runAdditionalOCRPasses,
  normalizeUPI,
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
// DECISION RULE — binary only:
//   approved = upiMatch && amountMatch && dateValid && utrPresent
//              && transactionStatusOk && ocrConfident && allFieldConfidenceHigh
//   rejected = everything else
//
// There is NO manual_review path.  Every uncertainty is a rejection.
//
// APPROVE conditions (ALL must pass):
//   1. Receiver UPI matches expected
//   2. Transaction amount exactly matches expected amount
//   3. Transaction date is server current date
//   4. Transaction time is server time → server time + 30 min
//   5. Payment status explicitly indicates success/completed/paid
//   6. A valid UTR/reference ID is detected
//   7. OCR confidence >= MIN_OCR_CONFIDENCE_APPROVE
//   8. All field-level confidences are "high"
//
// REJECT conditions (ANY triggers rejection):
//   - Wrong UPI
//   - Wrong amount
//   - Date/time outside forward window
//   - Missing or non-success transaction status
//   - Missing UTR
//   - Low OCR confidence
//   - Any field confidence below "high"
//   - Duplicate UTR (handled by reserveApprovedUtr)
// ─────────────────────────────────────────────────────────────
export function decidePaymentVerification({
  upiMatch, amountMatch, dateValid, utrPresent,
  transactionStatusOk, ocrConfidence,
}) {
  // Gate 1: UPI must match
  if (upiMatch !== true) return { decision: 'rejected', reason: 'UPI_MISMATCH' };

  // Gate 2: Amount must match
  if (amountMatch !== true) return { decision: 'rejected', reason: 'AMOUNT_MISMATCH' };

  // Gate 3: Date/time must be within forward window
  if (dateValid !== true) return { decision: 'rejected', reason: 'INVALID_PAYMENT_DATE' };

  // Gate 4: Transaction status must explicitly indicate success
  if (transactionStatusOk !== true) return { decision: 'rejected', reason: 'TRANSACTION_FAILED' };

  // Gate 5: UTR must be present
  if (utrPresent !== true) return { decision: 'rejected', reason: 'MISSING_UTR' };

  // Gate 6: OCR confidence must meet the approval floor
  const confident = ocrConfidence === undefined || ocrConfidence >= MIN_OCR_CONFIDENCE_APPROVE;
  if (!confident) return { decision: 'rejected', reason: 'LOW_OCR_CONFIDENCE' };

  // All gates passed — approve.
  return { decision: 'approved', reason: null };
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
export async function runScreenshotVerification({ imageBuffer, screenshotUrl, expectedAmount, receiverUpi, now }) {
  let buffer = imageBuffer;
  let ocrText = '';
  let ocrConfidence = 0;
  let extractedAmounts = [];
  let recoveredFromBands = false;
  let extractedUPIs = [];
  let extractedUTRs = [];
  let extractedDates = [];
  let extractedDateTimes = [];
  let transactionStatus = null;
  let ocrPassInfo = { primaryConfidence: 0, additionalPassesRun: 0, additionalPassConfidences: [], candidatesFromPasses: { amounts: [], upis: [], utrs: [] } };

  try {
    if (!buffer && screenshotUrl) {
      const resp = await fetch(screenshotUrl);
      if (!resp.ok) throw new Error('Failed to fetch screenshot');
      buffer = Buffer.from(await resp.arrayBuffer());
    }

    // ── Primary OCR pass ──
    const ocr = await runOCR(buffer);
    ocrText = ocr.text;
    ocrConfidence = ocr.confidence;
    ocrPassInfo.primaryConfidence = ocrConfidence;

    const primaryExtracted = extractPaymentData(ocrText);
    extractedAmounts = primaryExtracted.amounts;
    extractedUPIs = primaryExtracted.upis;
    extractedUTRs = primaryExtracted.utrs;
    extractedDates = primaryExtracted.dates;
    extractedDateTimes = primaryExtracted.dateTimes;
    transactionStatus = primaryExtracted.transactionStatus;

    // ── Additional OCR passes (upscaled + thresholded) ──
    // Run when primary pass is missing key data to improve recall.
    try {
      const additionalPasses = await runAdditionalOCRPasses(buffer);
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
    throw { message: 'OCR processing failed', code: 'OCR_FAILED', details: ocrErr.message };
  }

  if (!ocrText || ocrText.trim().length < 5) {
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
        utr: { passed: false, detected: null },
        transactionDate: { passed: false, detected: null, timezone: TIMEZONE },
        transactionStatus: { passed: false, detected: null },
        duplicate: { passed: true, utr: null },
      },
      detected: { amount: null, utr: null, upi: null, date: null, dateTimeMs: null, status: null },
      fieldConfidence: {
        amount: { confidence: 'none', reason: 'Demo screenshot detected' },
        receiverUpi: { confidence: 'none', reason: 'Demo screenshot detected' },
        utr: { confidence: 'none', reason: 'Demo screenshot detected' },
        transactionDate: { confidence: 'none', reason: 'Demo screenshot detected' },
        transactionStatus: { confidence: 'none', reason: 'Demo screenshot detected' },
      },
    };
    return { verificationResult: demoResult, verificationTime, utr: null };
  }

  // Full-page OCR may have dropped a large-font amount line (common on UPI
  // receipts). Purely a recovery pass for the RECORD: the recovered tokens
  // go into checks.amount / detected.amount for admin display. Amount never
  // feeds the approval/rejection decision anymore, so failed recovery simply
  // leaves the extracted-amount record empty — nothing to reject on.
  let amountMatch = matchAmount(extractedAmounts, expectedAmount);
  if (!amountMatch) {
    try {
      const recovered = await runAmountRecoveryOCR(buffer);
      const merged = [...new Set([...extractedAmounts, ...recovered])];
      if (matchAmount(merged, expectedAmount)) {
        amountMatch = true;
        recoveredFromBands = true;
        extractedAmounts = merged;
      }
    } catch (e) { /* recovery is best-effort; keep original result */ }
  }

  const upiResult = matchUPIWithRecovery(extractedUPIs, receiverUpi);
  const upiMatch = upiResult.match;
  const utr = extractedUTRs.length > 0 ? extractedUTRs[0]?.replace(/\s+/g, '').trim() || null : null;

  // Time-aware date resolution: prefer a receipt line that carries an exact
  // time ("19/08/2026, 7:39 AM"); fall back to a date-only reading.
  const timeEntry = extractedDateTimes.find(e => e.hasTime) || null;
  const anyEntry = extractedDateTimes[0] || null;
  const dateEntry = timeEntry || anyEntry;
  const date = dateEntry ? dateTimeEntryToDate(dateEntry) : (extractedDates[0] || null);

  const windowMinutes = PAYMENT_TIME_WINDOW_MINUTES;
  // Same-IST-day + symmetric freshness window:
  //   - transaction must be on the SERVER's current date (Asia/Kolkata)
  //   - transaction time within [serverNow - 30 min, serverNow + 30 min]
  // A real payment always happens shortly BEFORE the screenshot is uploaded,
  // so requiring transaction >= serverNow rejected every genuine receipt.
  // Replays (previous day) and stale screenshots (>30 min old) still reject.
  const dateValid =
    !!date &&
    isSameIstDay(date, verificationTime) &&
    isWithinTimeWindow(date, verificationTime, windowMinutes);
  const hasTimeComponent = !!(timeEntry || anyEntry)?.hasTime;

  // Transaction status must explicitly indicate success.
  // null (not detected), "failed", "pending", "processing" all → false.
  const transactionStatusOk = transactionStatus?.status === 'success';

  // UTR must be present.
  const utrPresent = !!utr;

  // Strict field confidence gate: ALL required fields must have "high"
  // confidence.  Medium/low/none on any field → reject.
  const detectedUpi = extractedUPIs.length > 0 ? extractedUPIs.join(', ') : null;

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
  };

  const allFieldsHighConfidence =
    fieldConfidence.amount.confidence === 'high' &&
    fieldConfidence.receiverUpi.confidence === 'high' &&
    fieldConfidence.utr.confidence === 'high' &&
    fieldConfidence.transactionDate.confidence === 'high' &&
    fieldConfidence.transactionStatus.confidence === 'high';

  const { decision, reason } = decidePaymentVerification({
    upiMatch, amountMatch, dateValid, utrPresent,
    transactionStatusOk, ocrConfidence,
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
    date: detectedDate,
    dateTimeMs: date && hasTimeComponent ? date.getTime() : null,
    status: transactionStatus ? transactionStatus.matched : null,
  };

  return {
    verificationResult: {
      ocrConfidence,
      recoveredFromBands,
      extractedAmounts,
      extractedUPIs,
      extractedUTRs,
      extractedDates: extractedDates.map(d => d.toISOString()),
      extractedDateTimes: extractedDateTimes.map(e => ({ ...e, raw: undefined })),
      amountMatch,
      upiMatch,
      utr: utr || null,
      dateValid,
      hasTimeComponent,
      transactionStatus,
      decision: effectiveDecision,
      reason: effectiveReason,
      checks,
      detected,
      fieldConfidence,
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