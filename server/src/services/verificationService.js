import {
  runOCR,
  extractPaymentData,
  matchAmount,
  matchUPI,
  runAmountRecoveryOCR,
  isWithinTimeWindow,
  isWithinForwardWindow,
  dateTimeEntryToDate,
  isSameIstDay,
} from './ocrService.js';
import {
  PAYMENT_TIME_WINDOW_MINUTES,
  MIN_OCR_CONFIDENCE_APPROVE,
  MIN_OCR_CONFIDENCE_MANUAL,
  TIMEZONE,
} from '../config/paymentConfig.js';
import { supabase } from '../db/supabase.js';

// ─────────────────────────────────────────────────────────────
// Shared screenshot verification engine (payments AND top-ups).
//
// Final verification rule (both flows):
//   approved = upiMatch === true && dateValid === true
//              && ocrConfidence >= MIN_OCR_CONFIDENCE_APPROVE
//
// Amount is intentionally NOT part of the approval decision. The payer may
// send a different amount than the selected plan amount to the configured
// UPI. Approval depends on the destination UPI, an authentic readable
// screenshot, a valid transaction date, and the separate UTR uniqueness
// gate. The extracted amount and expected_amount are still captured for
// records, notifications and admin display only — they never approve or
// reject a payment/top-up.
//
// UTR / transaction ID has ZERO influence on that OCR decision — it is
// only captured for records/display. Missing, unreadable or random UTRs
// never affect approval.
//
// manual_review is a 4th decision (NOT an approval and NOT a rejection):
// it is returned when every SECURITY gate (UPI) passes but the
// evidence is not clean enough to auto-approve — e.g. the date was read
// without an exact time on the correct IST day, OCR confidence is below
// the approve floor, or the receipt wording is ambiguous/failed. Admin
// approval is required to finish it. Strong mismatches (UPI,
// confirmed duplicates) STILL reject immediately — manual_review never
// bypasses an existing security gate.
//
// SEPARATE approved-UTR duplicate rule (see approved_utrs below):
//   If a UTR WAS extracted and it belongs to a PREVIOUSLY APPROVED
//   payment/top-up, the flow is rejected with DUPLICATE_UTR (no user
//   activation, no balance credit). Rejected/pending/failed/cancelled
//   UTRs never block; missing UTRs skip the check entirely.
// ─────────────────────────────────────────────────────────────
export function decidePaymentVerification({ upiMatch, amountMatch, dateValid, dateAmbiguous, ocrConfidence }) {
  // Amount is deliberately NOT read here. amountMatch may be supplied by
  // callers for record-keeping, but it must never tip a decision — a correct
  // screenshot that shows a different amount than the selected plan is still
  // approved as long as UPI, date and screenshot authenticity gates pass.
  const confident = ocrConfidence === undefined || ocrConfidence >= MIN_OCR_CONFIDENCE_APPROVE;
  const approved = upiMatch === true && dateValid === true && confident;
  if (approved) return { decision: 'approved', reason: null };

  // Strong mismatches always reject — never downgrade to manual review.
  if (upiMatch !== true) return { decision: 'rejected', reason: 'UPI_MISMATCH' };

  // Security gate (UPI) passes; the remaining question is evidence quality.
  const evidenceEligible = dateValid === true || dateAmbiguous === true;
  const confidenceManualOk = ocrConfidence === undefined || ocrConfidence >= MIN_OCR_CONFIDENCE_MANUAL;

  if (dateValid === true) {
    // All gates pass but OCR confidence is below the auto-approve floor.
    // Above the manual floor -> admin review. Below it -> low-confidence
    // rejection (keeps garbage screenshots out of the queue entirely).
    if (confidenceManualOk && !confident) {
      return { decision: 'manual_review', reason: 'LOW_OCR_CONFIDENCE' };
    }
    return { decision: 'rejected', reason: 'LOW_OCR_CONFIDENCE' };
  }

  if (evidenceEligible && confidenceManualOk) {
    return { decision: 'manual_review', reason: dateAmbiguous ? 'DATE_AMBIGUOUS' : 'MANUAL_REVIEW' };
  }

  return { decision: 'rejected', reason: 'INVALID_PAYMENT_DATE' };
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

  try {
    if (!buffer && screenshotUrl) {
      const resp = await fetch(screenshotUrl);
      if (!resp.ok) throw new Error('Failed to fetch screenshot');
      buffer = Buffer.from(await resp.arrayBuffer());
    }
    const ocr = await runOCR(buffer);
    ocrText = ocr.text;
    ocrConfidence = ocr.confidence;
    const extracted = extractPaymentData(ocrText);
    extractedAmounts = extracted.amounts;
    extractedUPIs = extracted.upis;
    extractedUTRs = extracted.utrs;
    extractedDates = extracted.dates;
    extractedDateTimes = extracted.dateTimes;
    transactionStatus = extracted.transactionStatus;
  } catch (ocrErr) {
    throw { message: 'OCR processing failed', code: 'OCR_FAILED', details: ocrErr.message };
  }

  if (!ocrText || ocrText.trim().length < 5) {
    throw { message: 'OCR could not read the screenshot', code: 'OCR_UNREADABLE' };
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

  const upiMatch = matchUPI(extractedUPIs, receiverUpi);
  const utr = extractedUTRs.length > 0 ? extractedUTRs[0]?.replace(/\s+/g, '').trim() || null : null;

  // Time-aware date resolution: prefer a receipt line that carries an exact
  // time ("19/08/2026, 7:39 AM"); fall back to a date-only reading.
  const timeEntry = extractedDateTimes.find(e => e.hasTime) || null;
  const anyEntry = extractedDateTimes[0] || null;
  const dateEntry = timeEntry || anyEntry;
  const date = dateEntry ? dateTimeEntryToDate(dateEntry) : (extractedDates[0] || null);

  // Deterministic clock for tests; production uses the real server clock.
  const verificationTime = now instanceof Date ? now : new Date();
  const windowMinutes = PAYMENT_TIME_WINDOW_MINUTES;
  // Forward-only: transaction must be NOW or in the future (up to +30 min).
  // Past transactions (even 1 second ago) do NOT auto-approve.
  const dateValid = isWithinForwardWindow(date, verificationTime, windowMinutes);

  // "Same correct IST day, no exact time on the receipt" — not enough to
  // auto-approve (forward window requires exact time), but enough to route
  // to admin review instead of a hard INVALID_PAYMENT_DATE rejection.
  const dateAmbiguous = !dateValid && !!date && !(timeEntry || anyEntry)?.hasTime && isSameIstDay(date, verificationTime);

  const { decision, reason } = decidePaymentVerification({
    upiMatch, dateValid, dateAmbiguous, ocrConfidence,
  });

  // A receipt that explicitly says "Failed/Declined" can never auto-approve.
  let effectiveDecision = decision;
  let effectiveReason = reason;
  if (transactionStatus?.status === 'failed' && decision === 'approved') {
    effectiveDecision = 'manual_review';
    effectiveReason = 'TRANSACTION_FAILED';
  }

  const detectedAmount = amountMatch ? expectedAmount : (extractedAmounts[0] ?? null);
  const detectedUpi = extractedUPIs.length > 0 ? extractedUPIs.join(', ') : null;
  const detectedDate = dateEntry ? dateEntry.raw : (date ? date.toISOString() : null);

  const checks = {
    // Informational only — amount no longer influences the decision.
    amount: { passed: amountMatch, didMatch: amountMatch, expected: expectedAmount, detected: detectedAmount },
    receiverUpi: { passed: upiMatch, expected: receiverUpi, detected: detectedUpi },
    utr: { passed: !!utr, detected: utr, contextual: !!utr },
    transactionDate: { passed: dateValid, detected: detectedDate, timezone: TIMEZONE },
    transactionStatus: {
      passed: transactionStatus ? transactionStatus.status !== 'failed' : true,
      detected: transactionStatus ? transactionStatus.matched : null,
    },
    duplicate: { passed: true, utr: null },
  };

  const detected = {
    amount: detectedAmount,
    utr: utr || null,
    upi: detectedUpi,
    date: detectedDate,
    dateTimeMs: date && (timeEntry || anyEntry)?.hasTime ? date.getTime() : null,
    status: transactionStatus ? transactionStatus.matched : null,
  };

  // Field-level confidence scoring: per-field reliability indicators for
  // admin debugging and potential analytics.  None of these affect the
  // approve/reject decision — they are informational only.
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
      confidence: (timeEntry || anyEntry)?.hasTime ? 'high' : (date ? 'medium' : 'none'),
      reason: dateValid
        ? `Date/time within forward window`
        : (dateAmbiguous
          ? 'Date found but no exact time (manual review)'
          : 'No valid transaction date found'),
    },
    transactionStatus: {
      confidence: transactionStatus ? 'high' : 'none',
      reason: transactionStatus
        ? `Status detected: ${transactionStatus.status}`
        : 'No transaction status detected in screenshot',
    },
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
      dateAmbiguous,
      transactionStatus,
      decision: effectiveDecision,
      reason: effectiveReason,
      checks,
      detected,
      fieldConfidence,
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