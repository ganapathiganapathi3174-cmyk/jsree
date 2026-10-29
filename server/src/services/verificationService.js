import {
  runOCR,
  extractPaymentData,
  matchAmount,
  matchUPIWithRecovery,
  isWithinPaymentWindow,
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
  OCR_VERIFICATION_BUDGET_MS,
  OCR_AMOUNT_RECOVERY_BUDGET_MS,
  OCR_RECOVERY_STAGE_BUDGET_MS,
} from '../config/paymentConfig.js';
import { istCalendarDayDiff } from '../utils/paymentNormalize.js';
import { supabase } from '../db/supabase.js';

// ─────────────────────────────────────────────────────────────
// Strict automatic verification engine (payments AND top-ups).
//
// ONE decision engine for BOTH flows: the register payment path
// (paymentService.verifyPayment) and the top-up path
// (topupService.uploadAndVerifyTopupProof) both call
// runScreenshotVerification() below, which resolves every rule and hands
// the outcome to decidePaymentVerification(). There is no second,
// flow-specific rule set.
//
// THE FOUR PAYMENT RULES
//
//   Rule A — EXACT AMOUNT
//     The OCR-extracted transaction amount must equal the amount the
//     SERVER resolved for the authenticated user's plan / top-up. A
//     confidently read amount that differs is an AMOUNT_MISMATCH. An
//     amount that could not be read at all (or was ambiguous) is
//     INCONCLUSIVE, not wrong, and routes to manual_review.
//
//   Rule B — RECEIVER NAME
//     The payee name read from the screenshot must match the configured
//     receiver name (admin-configurable, DB/env backed). Case, whitespace
//     and punctuation differences are normalized away. A partial read
//     ("JAYARAJ" for "JAYARAJ ALAGAR") is incomplete evidence and routes
//     to manual_review; a complete but different name is rejected.
//
//   Rule C — TRANSACTION DATE
//     The transaction date must fall on the current calendar day in the
//     configured India timezone (Asia/Kolkata). The single documented
//     exception is the midnight straddle (paid 23:5x IST, uploaded shortly
//     after midnight IST), which stays valid because the payment is still
//     inside the freshness window.
//
//   Rule D — TRANSACTION TIME / 30-MINUTE WINDOW
//     0 <= uploadReferenceTime - transactionTime <= 30 minutes, where
//     uploadReferenceTime is the SERVER-generated upload/verification
//     start time, captured ONCE per attempt and reused by every stage.
//
// DECISION RULE — binary for the strong identity/amount gates, with
//   manual_review branches for every INCONCLUSIVE (unreadable/ambiguous)
//   input and for the SECONDARY recipient-name check:
//   approved      = upiMatch && amountMatch && dateValid && utrPresent
//                   && transactionStatusOk && ocrConfident
//                   && allFieldConfidenceHigh
//                   && (name gate disabled OR receiver name matches)
//   manual_review = an input could not be read with confidence, or the
//                   recipient-name evidence is missing/partial, or no
//                   receiver name is configured (fail safe)
//   rejected      = any strong gate fails on CONFIDENT evidence, or a
//                   complete receiver name IS present but does not match
//
// The name gate is ACTIVE only when a receiver name is supplied
// (receiverName !== undefined). Direct engine callers/tests that omit it keep
// the original binary behaviour. Production callers always pass the resolved
// receiver name (possibly ''), so an unconfigured name fails safe.
//
// APPROVE conditions (ALL must pass):
//   1. Receiver UPI matches expected
//   2. Transaction amount exactly matches expected amount
//   3. Transaction timestamp within the 30-minute window of the SERVER-SIDE
//      upload time AND on the current India calendar date
//      (complete timestamp required — a date-only reading fails)
//   4. Payment status explicitly indicates success/completed/paid
//   5. A valid UTR/reference ID is detected
//   6. OCR confidence >= MIN_OCR_CONFIDENCE_APPROVE
//   7. All field-level confidences are "high"
//   8. (when enabled) the detected recipient name matches the configured name
//
// REJECT conditions (ANY triggers rejection):
//   - Wrong UPI
//   - Wrong amount (confidently read, different value)
//   - Transaction outside the 30-minute window (older than 30 min OR in the
//     future) or on a different calendar date
//   - Missing or non-success transaction status
//   - Missing UTR
//   - Low OCR confidence
//   - Any field confidence below "high"
//   - Recipient name present but different from the configured name
//   - Duplicate UTR (handled by reserveApprovedUtr)
//
// MANUAL-REVIEW conditions (inconclusive — never auto-approved):
//   - Amount could not be read at all
//   - Transaction date could not be read at all
//   - Transaction date read, but the time component is missing
//   - Recipient name could not be read, or was read only partially
//   - No receiver name is configured
// ─────────────────────────────────────────────────────────────
export function decidePaymentVerification({
  upiMatch, amountMatch, dateValid, utrPresent,
  transactionStatusOk, ocrConfidence,
  receiverName, nameMatch, nameFound, nameConfigured,
  // Optional refinements. `undefined` keeps the legacy behaviour (a hard
  // rejection) so direct engine callers and older tests are unaffected;
  // `false` means "the field could NOT be read" and fails closed into
  // manual_review.
  amountDetected,
  dateDetected,
  timeDetected,
  namePartial,
}) {
  // Gate 1: UPI must match
  if (upiMatch !== true) return { decision: 'rejected', reason: 'UPI_MISMATCH' };

  // Gate 2 (Rule A): Amount must match the server-resolved expected amount.
  if (amountMatch !== true) {
    // No amount could be read at all — the screenshot is inconclusive,
    // not wrong. Fail closed into manual review instead of accusing the
    // user of paying the wrong amount.
    if (amountDetected === false) return { decision: 'manual_review', reason: 'AMOUNT_NOT_DETECTED' };
    return { decision: 'rejected', reason: 'AMOUNT_MISMATCH' };
  }

  // Gate 3 (Rules C + D): The transaction timestamp must be inside the
  // 30-minute freshness window AND on the current India calendar date.
  if (dateValid !== true) {
    if (dateDetected === false) return { decision: 'manual_review', reason: 'PAYMENT_DATE_NOT_DETECTED' };
    if (timeDetected === false) return { decision: 'manual_review', reason: 'PAYMENT_TIME_NOT_DETECTED' };
    return { decision: 'rejected', reason: 'INVALID_PAYMENT_DATE' };
  }

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
      if (namePartial === true) {
        // The payee name was read only partially ("JAYARAJ" for
        // "JAYARAJ ALAGAR") — incomplete evidence, needs a human.
        return { decision: 'manual_review', reason: 'RECEIVER_NAME_INCOMPLETE' };
      }
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
    // Public outcome contract: an engine-approved screenshot that still
    // needs provider/human confirmation is PENDING_VERIFICATION — never an
    // approval, never a rejection.
    status: 'PENDING_VERIFICATION',
    reason: 'EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED',
  };
}

// ─────────────────────────────────────────────────────────────
// Runs OCR on a screenshot and produces the verification result.
//
// Throws OCR_FAILED / OCR_UNREADABLE / OCR_TIMEOUT when the screenshot
// cannot be processed (caller keeps the record in a retryable state). On
// success returns { verificationResult, verificationTime, utr }. The result is
// structured ({ decision, reason, checks, detected, ... }) for admin
// debugging; decision/reason remain the primary contract.
//
// TIME BUDGET
// One attempt gets at most `budgetMs` (default OCR_VERIFICATION_BUDGET_MS)
// of wall-clock time for ALL OCR work: the primary pass, the additional
// passes and the three amount-recovery stages. The deadline is computed
// ONCE and passed down, so a slow screenshot is abandoned deterministically
// with OCR_TIMEOUT instead of running until the HTTP request times out.
// An OCR timeout is INCONCLUSIVE — it can never be read as an approval.
//
// The amount-recovery stages additionally run under `recoveryBudget`
// (default OCR_AMOUNT_RECOVERY_BUDGET_MS, the targeted phase) and
// `stageBudget` (default OCR_RECOVERY_STAGE_BUDGET_MS, per stage). A stage
// that exhausts its budget stops and keeps the evidence it already read; the
// decision then follows the normal rules (an unreadable amount → manual
// review).
// ─────────────────────────────────────────────────────────────
export async function runScreenshotVerification({
  imageBuffer,
  screenshotUrl,
  expectedAmount,
  receiverUpi,
  receiverName,
  now,
  referenceId = null,
  referenceType = null,
  budgetMs = OCR_VERIFICATION_BUDGET_MS,
  recoveryBudget,
  stageBudget,
}) {
  // Server-side upload/receipt time — captured BEFORE the OCR run starts.
  // The 30-minute freshness window (Rule D) is measured from this instant
  // (spec: "within 30 min of the SERVER-SIDE upload time"). Capturing it
  // after OCR would erode the window by the OCR duration (30-75 s in
  // production), so a payment made 29:45 before upload could be rejected as
  // >30 min old. It is captured EXACTLY ONCE and reused by every stage —
  // OCR retries, image preprocessing and recovery passes never reset it.
  const receivedAt = now instanceof Date ? now : new Date();
  const ocrStart = Date.now();
  // ONE deadline for the whole attempt (all OCR stages share it).
  const deadline = ocrStart + (Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : OCR_VERIFICATION_BUDGET_MS);

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
    const ocr = await runOCR(buffer, { deadline });
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
    // Skipped when the primary pass already extracted EVERY required field
    // (amount, UPI, UTR, date+time, success status, payee name) — the two
    // extra full-page OCR runs then add no recall, only ~2× latency.
    const primaryHasTimeEntry = extractedDateTimes.some(e => e.hasTime);
    const primaryComplete =
      extractedAmounts.length > 0 &&
      extractedUPIs.length > 0 &&
      extractedUTRs.length > 0 &&
      primaryHasTimeEntry &&
      transactionStatus?.status === 'success' &&
      extractedReceiverNames.length > 0;
    if (primaryComplete) {
      console.log('[VERIFICATION TIMING]', JSON.stringify({
        reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
        phase: 'additional_ocr',
        durationMs: 0,
        skipped: true,
        reason: 'primary_pass_complete',
      }));
    } else {
    try {
      const additionalStart = Date.now();
      const additionalPasses = await runAdditionalOCRPasses(buffer, { deadline });
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
    } catch (e) {
      // A budget expiry is NOT "best-effort" — it aborts the attempt.
      if (e?.code === 'OCR_TIMEOUT') throw e;
      /* additional passes are best-effort */
    }
    }

  } catch (ocrErr) {
    // An OCR timeout is INCONCLUSIVE, not a failure of the payment: it can
    // never be read as an approval. It is surfaced with its own code so the
    // caller can keep the record RESUBMITTABLE and tell the user to retry.
    if (ocrErr?.code === 'OCR_TIMEOUT') {
      console.log('[VERIFICATION DEBUG]', JSON.stringify({
        reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
        receivedAt: receivedAt.toISOString(),
        ocrMs: Date.now() - ocrStart,
        decision: 'inconclusive',
        reason: 'OCR_TIMEOUT',
      }));
      throw { message: 'Screenshot verification exceeded its time budget', code: 'OCR_TIMEOUT', details: ocrErr.message };
    }
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
      amountDetected: false,
      upiMatch: false,
      utr: null,
      dateValid: false,
      dateDetected: false,
      timeDetected: false,
      hasTimeComponent: false,
      timeWithinWindow: false,
      dateOnExpectedDay: false,
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

  // ─────────────────────────────────────────────────────────────
  // AMOUNT-RECOVERY BUDGETS
  //
  // `deadline` is the shared OVERALL deadline for the whole attempt (primary
  // pass + additional passes + every recovery stage). The recovery stages
  // additionally get:
  //
  //   recoveryBudgetMs — wall-clock budget for the TARGETED recovery phase
  //     (top-region probe → deep region → currency region).
  //   stageBudgetMs    — cap for a SINGLE recovery stage, so one pathological
  //     stage cannot consume the whole recovery budget.
  //
  // Defaults are sized from the measured per-stage latency (see
  // config/paymentConfig.js and scripts/audit-recovery-stages.mjs): they leave
  // ~30% headroom over the worst measured stage under load, so no proven
  // recovery stage is truncated on a busy host.
  //
  // A stage that runs out of its SOFT budget stops and returns the evidence it
  // already collected (partial results are kept — "an amount was read" is
  // different from "no amount could be read"). Only the shared overall
  // deadline aborts the attempt with OCR_TIMEOUT (→ HTTP 504, retryable,
  // never an approval).
  // ─────────────────────────────────────────────────────────────
  const recoveryBudgetMs = Number.isFinite(recoveryBudget) && recoveryBudget > 0
    ? recoveryBudget
    : OCR_AMOUNT_RECOVERY_BUDGET_MS;
  const stageBudgetMs = Number.isFinite(stageBudget) && stageBudget > 0
    ? stageBudget
    : OCR_RECOVERY_STAGE_BUDGET_MS;
  const recoveryStart = Date.now();
  const recoveryDeadline = Math.min(deadline, recoveryStart + recoveryBudgetMs);
  const recoveryStagesRun = [];
  let recoveryBudgetExhausted = false;

  // Runs one recovery stage under the tightest applicable limit.
  //   hard deadline → the shared overall deadline → OCR_TIMEOUT (504)
  //   soft deadline → the stage / recovery budget → stop, keep partial results
  // The soft deadline is only used when it is strictly EARLIER than the hard
  // one, so a stage can never soft-stop past the overall deadline.
  const runRecoveryStage = async (name, fn) => {
    const stageStart = Date.now();
    const soft = Math.min(recoveryDeadline, stageStart + stageBudgetMs);
    const softDeadline = soft < deadline ? soft : null;
    try {
      const value = await fn(softDeadline);
      const exhausted = softDeadline != null && Date.now() >= softDeadline;
      if (exhausted) recoveryBudgetExhausted = true;
      recoveryStagesRun.push({ stage: name, exhausted });
      return value;
    } catch (e) {
      // OCR_TIMEOUT here means the HARD deadline was reached → the whole
      // attempt is inconclusive and must surface as a retryable timeout.
      if (e?.code === 'OCR_TIMEOUT') throw e;
      recoveryStagesRun.push({ stage: name, error: e?.code || 'stage_error' });
      return null;
    }
  };

  // Full-page OCR may have dropped a large-font amount line (common on UPI
  // receipts). This recovery DOES feed the decision: amountMatch is Gate 2 of
  // decidePaymentVerification() and also drives fieldConfidence.amount, which
  // the allFieldsHighConfidence gate enforces. Recovery only runs when the
  // outcome is still in play (Gate 1 passed).
  //
  // STAGE ORDER IS CHEAPEST-FIRST (this is the latency fix):
  //   1. top-region probe   (~8 jobs, top 45% of the image)
  //   2. deep region strategies (~31 jobs, top 45%, 7 preprocessing variants)
  //   3. currency region strategies (~28 jobs, top 45%, 12 variants)
  //   4. full-height strip scan (~60 jobs, EVERY band of the image)
  //
  // The full-height scan used to run FIRST, so a receipt whose large-font
  // amount sits in the top 45% (the common Google Pay layout) paid for all
  // ~60 full-height jobs before the deep/currency stages — which are the
  // ones that actually recover that amount — ever ran. Reordering keeps the
  // SAME evidence and the SAME decision, but the expensive scan is now only
  // reached when the amount is genuinely unreadable in the top region.
  let amountMatch = matchAmount(extractedAmounts, expectedAmount);

  // Merges a recovery stage's candidates into the detected set. The
  // candidates are ALWAYS recorded, even when they do not match: "an amount
  // was read and it is wrong" (AMOUNT_MISMATCH) is a different outcome from
  // "no amount could be read" (manual review).
  const mergeAmountCandidates = (candidates) => {
    const merged = [...new Set([...extractedAmounts, ...candidates])];
    const matched = matchAmount(merged, expectedAmount);
    if (matched) {
      amountMatch = true;
      recoveredFromBands = true;
    }
    extractedAmounts = merged;
    return matched;
  };

  if (!amountMatch && !skipAmountRecovery) {
    const stageStart = Date.now();
    const recovered = await runRecoveryStage('probe', (softDeadline) =>
      runAmountRecoveryOCR(buffer, expectedAmount, { deadline, softDeadline, scan: 'probe' }));
    stripRecoveryMs = Date.now() - stageStart;
    console.log('[VERIFICATION TIMING]', JSON.stringify({
      reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
      phase: 'strip_probe_ocr',
      durationMs: stripRecoveryMs,
      candidatesFound: recovered ? recovered.length : 0,
    }));
    mergeAmountCandidates(recovered || []);
  }

  if (!amountMatch && !skipAmountRecovery) {
    const stageStart = Date.now();
    const deepRecovered = await runRecoveryStage('deep', (softDeadline) =>
      runDeepAmountRecovery(buffer, expectedAmount, { deadline, softDeadline }));
    deepRecoveryMs = Date.now() - stageStart;
    console.log('[VERIFICATION TIMING]', JSON.stringify({
      reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
      phase: 'deep_recovery_ocr',
      durationMs: deepRecoveryMs,
      candidatesFound: deepRecovered ? deepRecovered.length : 0,
    }));
    mergeAmountCandidates(deepRecovered || []);
  }

  // ── Currency-symbol corruption recovery ──
  // When all OCR passes extract a candidate like "2120" but the expected
  // amount is 120, Tesseract may have misread the ₹ symbol as "2".
  // This step runs targeted region-specific OCR with multiple preprocessing
  // strategies to recover evidence of the correct amount from the image.
  // It ONLY accepts when a preprocessing strategy produces the exact expected
  // amount — no numeric heuristics, no string inference.
  if (!amountMatch && !skipAmountRecovery) {
    const stageStart = Date.now();
    const currencyResult = await runRecoveryStage('currency', (softDeadline) =>
      verifyAmountWithCurrencyRecovery(buffer, expectedAmount, { deadline, softDeadline }));
    currencyRecoveryMs = Date.now() - stageStart;
    const verified = currencyResult?.verified === true;
    console.log('[VERIFICATION TIMING]', JSON.stringify({
      reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
      phase: 'currency_recovery_ocr',
      durationMs: currencyRecoveryMs,
      verified,
      method: currencyResult?.method || 'none',
    }));
    if (verified) {
      amountMatch = true;
      recoveredFromBands = true;
      if (!extractedAmounts.includes(expectedAmount)) {
        extractedAmounts.push(expectedAmount);
      }
    }
  }

  // ── Full-height strip scan (LAST resort) ──
  // Reached only when the amount is still unreadable in the top region.
  // This is the most expensive stage (~60 OCR jobs over every band of the
  // image) and it is skipped entirely whenever a cheaper stage already
  // recovered the amount.
  //
  // It is ALSO skipped when the targeted recovery budget ran out AND nothing
  // could be read at all: the targeted stages are the ones proven to recover
  // a corrupted amount (7 of 8 measured variants, vs 0 of 8 for the currency
  // stage), and an unreadable amount is already routed to manual_review /
  // AMOUNT_NOT_DETECTED by the decision engine — so the sweep would only
  // spend time on an outcome that is decided. When a WRONG amount was read,
  // the sweep still runs (inside its own budget) so the decision stays
  // exactly what it is today.
  const amountUnreadable = extractedAmounts.length === 0;
  const targetedBudgetSpent = recoveryBudgetExhausted || Date.now() >= recoveryDeadline;
  const skipFullScan = targetedBudgetSpent && amountUnreadable;
  if (!amountMatch && !skipAmountRecovery && !skipFullScan) {
    const stageStart = Date.now();
    const fullRecovered = await runRecoveryStage('full_scan', (softDeadline) =>
      runAmountRecoveryOCR(buffer, expectedAmount, { deadline, softDeadline, scan: 'full' }));
    stripRecoveryMs += Date.now() - stageStart;
    console.log('[VERIFICATION TIMING]', JSON.stringify({
      reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
      phase: 'strip_full_scan_ocr',
      durationMs: Date.now() - stageStart,
      candidatesFound: fullRecovered ? fullRecovered.length : 0,
    }));
    mergeAmountCandidates(fullRecovered || []);
  } else if (skipFullScan) {
    console.log('[VERIFICATION TIMING]', JSON.stringify({
      reference: referenceId ? `${referenceType || 'unknown'}:${referenceId}` : null,
      phase: 'strip_full_scan_ocr',
      durationMs: 0,
      skipped: true,
      reason: 'recovery_budget_exhausted',
    }));
  }

  const utr = extractedUTRs.length > 0 ? extractedUTRs[0]?.replace(/\s+/g, '').trim() || null : null;

  // Time-aware date resolution: prefer a receipt line that carries an exact
  // time ("19/08/2026, 7:39 AM"); fall back to a date-only reading.
  const timeEntry = extractedDateTimes.find(e => e.hasTime) || null;
  const anyEntry = extractedDateTimes[0] || null;
  const dateEntry = timeEntry || anyEntry;
  const date = dateEntry ? dateTimeEntryToDate(dateEntry) : (extractedDates[0] || null);

  const windowMinutes = PAYMENT_TIME_WINDOW_MINUTES;

  // ── Rule D: freshness window, measured from the SERVER-SIDE upload instant ──
  //   0 <= uploadReferenceTime - transactionTime <= windowMinutes
  // The window is FORWARD-ONLY: a real payment always happens BEFORE the
  // screenshot is uploaded, so a transaction timestamp in the future is
  // invalid (clock skew / tampered receipt). The reference instant
  // (receivedAt) is captured ONCE, before any OCR ran, and is NOT reset by
  // OCR retries, image preprocessing or the recovery stages.
  const timeWithinWindow = isWithinPaymentWindow(date, receivedAt, windowMinutes);

  // ── Rule C: the transaction must fall on the current India calendar day ──
  // Compared in the configured application timezone (Asia/Kolkata), never the
  // server machine's local timezone.
  //
  // The ONLY documented exception is the midnight straddle: a payment made
  // just before midnight IST and uploaded just after still lands inside the
  // 30-minute window, so it is accepted even though its calendar day is the
  // previous one. A receipt from any earlier day is always more than the
  // window old and is excluded by the window check as well.
  const calendarDayDiff = date ? istCalendarDayDiff(date, receivedAt) : null;
  const sameCalendarDay = calendarDayDiff === 0;
  const midnightStraddle = calendarDayDiff === -1 && timeWithinWindow;
  const dateOnExpectedDay = sameCalendarDay || midnightStraddle;

  const dateValid = !!date && dateOnExpectedDay && timeWithinWindow;
  const hasTimeComponent = !!(timeEntry || anyEntry)?.hasTime;

  // Detection flags: distinguish "read and wrong" from "could not be read".
  // A missing/ambiguous value is INCONCLUSIVE and must never be auto-approved.
  const amountDetected = extractedAmounts.length > 0;
  const dateDetected = !!date;
  const timeDetected = hasTimeComponent;

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
  // A candidate that is only a PART of the configured name ("JAYARAJ" for
  // "JAYARAJ ALAGAR") is incomplete evidence → manual review, never approve.
  const namePartial = nameActive ? nameResult.partial === true : false;
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
        ? 'Transaction date/time inside the 30-minute window on the current India date'
        : (date
          ? (hasTimeComponent
            ? 'Date found but outside the 30-minute window or not on the current India date'
            : 'Date found but the time component is missing')
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
        confidence: !nameConfigured ? 'none' : nameMatch ? 'high' : (namePartial ? 'medium' : (nameFound ? 'low' : 'none')),
        reason: !nameConfigured
          ? 'No receiver name configured — manual review required'
          : nameMatch
            ? 'Detected receiver name matches configured payee'
            : (namePartial
              ? `Detected ${detectedReceiverNames} is only part of the configured receiver name — manual review required`
              : (nameFound
                ? `Detected ${detectedReceiverNames} does not match configured receiver name`
                : 'No receiver name found in screenshot')),
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
    amountDetected, dateDetected, timeDetected, namePartial,
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
    amount: {
      passed: amountMatch,
      expected: expectedAmount,
      detected: detectedAmount,
      detectedAny: amountDetected,
      // True when the amount could not be read because a recovery stage ran
      // out of its budget (the evidence read so far is still reported in
      // `detected`). The decision for an unreadable amount is manual_review.
      recoveryBudgetExhausted: recoveryBudgetExhausted || skipFullScan,
    },
    receiverUpi: { passed: upiMatch, expected: receiverUpi, detected: detectedUpi },
    receiverName: {
      passed: nameActive ? nameMatch : true,
      enabled: nameActive,
      expected: typeof receiverName === 'string' ? (receiverName || null) : null,
      detected: detectedReceiverNames,
      partial: namePartial,
    },
    utr: { passed: utrPresent, detected: utr || null },
    transactionDate: {
      passed: dateValid,
      detected: detectedDate,
      timezone: TIMEZONE,
      // Rule C — the transaction must be on the current India calendar day.
      onExpectedCalendarDay: dateOnExpectedDay,
      sameCalendarDay,
      midnightStraddle,
      calendarDayDiff,
      // Rule D — 0 <= uploadReference - transactionTime <= window.
      timeWithinWindow,
      hasTimeComponent,
      windowMinutes,
    },
    transactionStatus: {
      passed: transactionStatusOk,
      detected: transactionStatus ? transactionStatus.matched : null,
    },
    duplicate: { passed: true, utr: null },
  };

  const detected = {
    amount: detectedAmount,
    amountAnyDetected: amountDetected,
    utr: utr || null,
    upi: detectedUpi,
    receiverNames: extractedReceiverNames,
    date: detectedDate,
    dateTimeMs: date && hasTimeComponent ? date.getTime() : null,
    calendarDay: date ? (istCalendarDayDiff(date, receivedAt) === 0 ? 'same' : 'different') : null,
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
    uploadReferenceTime: receivedAt.toISOString(),
    timeWithinWindow,
    dateOnExpectedCalendarDay: dateOnExpectedDay,
    sameCalendarDay,
    midnightStraddle,
    calendarDayDiff,
    upiExpected: receiverUpi,
    upiDetected: detectedUpi,
    upiMatch,
    upiMethod: upiResult.method,
    amountExpected: expectedAmount,
    amountDetected: detectedAmount,
    amountAnyDetected: amountDetected,
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
    recoveryBudgetExhausted: recoveryBudgetExhausted || skipFullScan,
    recoveryStages: recoveryStagesRun,
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
      amountDetected,
      upiMatch,
      nameMatch: nameActive ? nameMatch : null,
      nameFound,
      namePartial,
      nameConfigured,
      utr: utr || null,
      dateValid,
      dateDetected,
      timeDetected,
      hasTimeComponent,
      timeWithinWindow,
      dateOnExpectedDay,
      uploadReferenceTime: receivedAt.toISOString(),
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
        partial: nameResult ? nameResult.partial === true : null,
      },
      upiDiagnostics: {
        originalCandidates: upiResult.originalCandidates || [],
        normalizedCandidates: upiResult.allCandidates || [],
        matchMethod: upiResult.method,
        matchConfidence: upiResult.confidence,
        matchedCandidate: upiResult.candidate,
        expectedUpi: receiverUpi,
      },
      // Recovery-budget diagnostics — why an amount was (not) recovered.
      // `budgetExhausted` is true when a recovery stage ran out of its budget
      // and the (expensive) full-height sweep was therefore skipped; the
      // decision in that case is the normal one for an unreadable amount
      // (manual_review / AMOUNT_NOT_DETECTED).
      recovery: {
        budgetExhausted: recoveryBudgetExhausted || skipFullScan,
        budgetMs: recoveryBudgetMs,
        stageBudgetMs,
        elapsedMs: Date.now() - recoveryStart,
        stages: recoveryStagesRun,
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