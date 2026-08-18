import { runOCR, extractPaymentData, matchAmount, matchUPI, runAmountRecoveryOCR, isWithinTimeWindow } from './ocrService.js';
import { supabase } from '../db/supabase.js';

// ─────────────────────────────────────────────────────────────
// Shared screenshot verification engine (payments AND top-ups).
//
// Final verification rule (both flows):
//   approved = upiMatch === true && amountMatch === true && dateValid === true
//
// UTR / transaction ID has ZERO influence on that OCR decision — it is
// only captured for records/display. Missing, unreadable or random UTRs
// never affect approval.
//
// SEPARATE approved-UTR duplicate rule (see approved_utrs below):
//   If a UTR WAS extracted and it belongs to a PREVIOUSLY APPROVED
//   payment/top-up, the flow is rejected with DUPLICATE_UTR (no user
//   activation, no balance credit). Rejected/pending/failed/cancelled
//   UTRs never block; missing UTRs skip the check entirely.
// ─────────────────────────────────────────────────────────────
export function decidePaymentVerification({ upiMatch, amountMatch, dateValid }) {
  const approved = upiMatch === true && amountMatch === true && dateValid === true;
  if (approved) return { decision: 'approved', reason: null };
  if (amountMatch !== true) return { decision: 'rejected', reason: 'AMOUNT_MISMATCH' };
  if (upiMatch !== true) return { decision: 'rejected', reason: 'UPI_MISMATCH' };
  return { decision: 'rejected', reason: 'INVALID_PAYMENT_DATE' };
}

// ─────────────────────────────────────────────────────────────
// Runs OCR on a screenshot and produces the verification result.
//
// Throws OCR_FAILED / OCR_UNREADABLE when the screenshot cannot be
// processed (caller keeps the record in a retryable state). On success
// returns { verificationResult, verificationTime, utr }.
// ─────────────────────────────────────────────────────────────
export async function runScreenshotVerification({ imageBuffer, screenshotUrl, expectedAmount, receiverUpi }) {
  let buffer = imageBuffer;
  let ocrText = '';
  let ocrConfidence = 0;
  let extractedAmounts = [];
  let recoveredFromBands = false;
  let extractedUPIs = [];
  let extractedUTRs = [];
  let extractedDates = [];

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
  } catch (ocrErr) {
    throw { message: 'OCR processing failed', code: 'OCR_FAILED', details: ocrErr.message };
  }

  if (!ocrText || ocrText.trim().length < 5) {
    throw { message: 'OCR could not read the screenshot', code: 'OCR_UNREADABLE' };
  }

  // Full-page OCR may have dropped a large-font amount line (common on UPI
  // receipts). Purely a recovery pass: the recovered tokens still go through
  // the exact same matchAmount() comparison below, and UPI / date rules are
  // unchanged, so this cannot create a false approval — it only prevents a
  // false AMOUNT_MISMATCH.
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
  const date = extractedDates[0] || null;
  // Use UTC for consistent timezone handling (Asia/Kolkata = UTC+5:30)
  const verificationTime = new Date();
  const dateValid = isWithinTimeWindow(date, verificationTime, 30);

  const { decision, reason } = decidePaymentVerification({ upiMatch, amountMatch, dateValid });

  return {
    verificationResult: {
      ocrConfidence,
      recoveredFromBands,
      extractedAmounts,
      extractedUPIs,
      extractedUTRs,
      extractedDates: extractedDates.map(d => d.toISOString()),
      amountMatch,
      upiMatch,
      utr: utr || null,
      dateValid,
      decision,
      reason,
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
