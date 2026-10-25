/**
 * Stage 3-5: OCR and Field Extraction/Normalization
 * Leverage existing OCR service but with stricter controls.
 *
 * Recovery is CONDITIONAL — every extra pass costs the shared OCR worker:
 *   1. Primary full-page pass (always).
 *   2. Amount recovery only when the expected amount was not read:
 *      cheap top-region probe first, deep recovery second. The
 *      currency-symbol and full-height scans are not run (measured 0 hits
 *      on the reference receipts — pure latency).
 *   3. Extra passes (upscaled / thresholded) only when a mandatory field
 *      (UTR, date-time, receiver name, UPI, amount) is still missing.
 *
 * OCR_TIMEOUT always propagates — a budget overrun is an inconclusive
 * outcome, never a decision.
 */
import {
  runOCR,
  extractPaymentData,
  extractTransactionStatus,
  runAdditionalOCRPasses,
  runAmountRecoveryOCR,
  runDeepAmountRecovery,
  matchUPIWithRecovery,
} from '../ocrService.js';

function unionInto(target, incoming, keyFn) {
  const seen = new Set(target.map(keyFn));
  for (const item of incoming || []) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      target.push(item);
    }
  }
  return target;
}

export async function extractPaymentFields(buffer, options = {}) {
  const { deadline = null, expectedAmount = null, receiverUpi = null } = options;

  try {
    // Primary OCR pass (preprocesses internally, memoized per buffer).
    const ocr = await runOCR(buffer, { deadline });
    let ocrText = ocr.text || '';
    let ocrConfidence = ocr.confidence || 0;

    let extracted = extractPaymentData(ocrText);

    // ── Conditional amount recovery ──
    const amountMatches = expectedAmount != null &&
      extracted.amounts.some(a => Math.abs(a - expectedAmount) < 0.01);

    if (expectedAmount != null && !amountMatches) {
      let recovered = [];
      try {
        recovered = await runAmountRecoveryOCR(buffer, expectedAmount, { deadline, scan: 'probe' });
      } catch (e) {
        if (e?.code === 'OCR_TIMEOUT') throw e;
      }
      if (!recovered.some(a => Math.abs(a - expectedAmount) < 0.01)) {
        try {
          recovered = await runDeepAmountRecovery(buffer, expectedAmount, { deadline });
        } catch (e) {
          if (e?.code === 'OCR_TIMEOUT') throw e;
        }
      }
      if (recovered.length > 0) {
        extracted = { ...extracted, amounts: [...extracted.amounts] };
        unionInto(extracted.amounts, recovered, a => String(a));
      }
    }

    // ── Conditional field-completeness recovery ──
    // Triggered when a mandatory field is missing OR when the UPI read does
    // not match the expected receiver (a truncated/misread UPI is common —
    // the thresholded/upscaled passes routinely recover it).
    const upiMatched = !receiverUpi ||
      matchUPIWithRecovery(extracted.upis, receiverUpi).match === true;
    const missingMandatoryField =
      extracted.amounts.length === 0 ||
      extracted.utrs.length === 0 ||
      extracted.dateTimes.length === 0 ||
      extracted.receiverNames.length === 0 ||
      extracted.upis.length === 0 ||
      !extracted.transactionStatus ||
      !upiMatched;

    if (missingMandatoryField) {
      let passes = [];
      try {
        passes = await runAdditionalOCRPasses(buffer, { deadline });
      } catch (e) {
        if (e?.code === 'OCR_TIMEOUT') throw e;
      }
      for (const pass of passes) {
        if (!pass?.text) continue;
        const p = extractPaymentData(pass.text);
        unionInto(extracted.amounts, p.amounts, a => String(a));
        unionInto(extracted.upis, p.upis, String);
        unionInto(extracted.utrs, p.utrs, String);
        unionInto(extracted.dates, p.dates, String);
        unionInto(extracted.dateTimes, p.dateTimes, d => `${d.year}-${d.month}-${d.day}-${d.hour}-${d.minute}-${d.hasTime}`);
        unionInto(extracted.receiverNames, p.receiverNames, String);
        ocrText += '\n' + pass.text;
        ocrConfidence = Math.max(ocrConfidence, pass.confidence || 0);
      }
      // Re-evaluate status over the joined text: a "failed/declined" marker
      // seen in ANY pass must not be lost.
      extracted.transactionStatus = extractTransactionStatus(ocrText) || extracted.transactionStatus;
    }

    const trimmedLength = ocrText.replace(/\s+/g, '').length;

    return {
      success: true,
      unreadable: trimmedLength < 5,
      ocrText,
      ocrConfidence,
      extractedAmounts: extracted.amounts || [],
      extractedUPIs: extracted.upis || [],
      extractedUTRs: extracted.utrs || [],
      extractedDates: extracted.dates || [],
      extractedDateTimes: extracted.dateTimes || [],
      extractedReceiverNames: extracted.receiverNames || [],
      transactionStatus: extracted.transactionStatus || null,
    };
  } catch (error) {
    throw error;
  }
}
