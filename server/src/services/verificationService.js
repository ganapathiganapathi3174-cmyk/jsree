import { runOCR, extractPaymentData, matchAmount, matchUPI, runAmountRecoveryOCR, isWithinTimeWindow } from './ocrService.js';

// ─────────────────────────────────────────────────────────────
// Shared screenshot verification engine (payments AND top-ups).
//
// Final verification rule (both flows):
//   approved = upiMatch === true && amountMatch === true && dateValid === true
//
// UTR / transaction ID intentionally has ZERO influence on the
// decision — it is only captured for historical records/display.
// Missing, unreadable, random or duplicate UTRs never affect approval.
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
