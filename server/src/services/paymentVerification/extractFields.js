/**
 * Field extraction: runs the OCR passes and normalizes them into structured
 * payment CLAIMS (amounts, receiver names, sender names, date-times, UTRs,
 * UPIs, transaction status).
 *
 * OCR output is evidence, NOT proof: every value returned here is an
 * UNTRUSTED CLAIM that the validator modules and the decision engine must
 * check against server-side expectations.
 *
 * Recovery is CONDITIONAL — every extra pass costs the shared OCR worker:
 *   1. Primary full-page pass (always).
 *   2. Amount recovery only when the expected amount was not read:
 *      cheap top-region probe first, deep recovery second.
 *   3. Extra passes (upscaled / thresholded) only when a mandatory field
 *      (UTR, date-time, receiver name, UPI, amount) is still missing.
 *
 * OCR_TIMEOUT always propagates — a budget overrun is an inconclusive
 * outcome, never a decision.
 */
import {
  extractPaymentData,
  extractTransactionStatus,
  matchUPIWithRecovery,
} from '../ocrService.js';
import {
  runOcrPrimary,
  runOcrAdditionalPasses,
  runAmountRecoveryProbe,
  runAmountRecoveryDeep,
} from './ocr.js';
import {
  OCR_AMOUNT_RECOVERY_BUDGET_MS,
  OCR_RECOVERY_STAGE_BUDGET_MS,
} from '../../config/paymentConfig.js';

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
  const startedAt = Date.now();

  const recoveryStages = [];
  let recoveredFromBands = false;
  let recoveryBudgetExhausted = false;
  const ocrPassInfo = {
    primaryConfidence: 0,
    additionalPassesRun: 0,
    additionalPassConfidences: [],
    candidatesFromPasses: { amounts: [], upis: [], utrs: [] },
  };

  try {
    // Primary OCR pass (preprocesses internally, memoized per buffer).
    const ocr = await runOcrPrimary(buffer, { deadline });
    let ocrText = ocr.text || '';
    let ocrConfidence = ocr.confidence || 0;
    ocrPassInfo.primaryConfidence = ocrConfidence;

    let extracted = extractPaymentData(ocrText);

    // ── Conditional amount recovery ──
    const amountMatches = expectedAmount != null &&
      extracted.amounts.some(a => Math.abs(a - expectedAmount) < 0.01);

    if (expectedAmount != null && !amountMatches) {
      let recovered = [];
      const probeStart = Date.now();
      try {
        recovered = await runAmountRecoveryProbe(buffer, expectedAmount, { deadline });
        recoveryStages.push({ stage: 'probe', durationMs: Date.now() - probeStart, candidates: recovered.length });
      } catch (e) {
        if (e?.code === 'OCR_TIMEOUT') throw e;
        recoveryStages.push({ stage: 'probe', error: e?.code || 'stage_error' });
      }
      if (!recovered.some(a => Math.abs(a - expectedAmount) < 0.01)) {
        const deepStart = Date.now();
        try {
          const deepRecovered = await runAmountRecoveryDeep(buffer, expectedAmount, { deadline });
          recoveryStages.push({ stage: 'deep', durationMs: Date.now() - deepStart, candidates: deepRecovered.length });
          if (deepRecovered && deepRecovered.length > 0) recovered = [...new Set([...recovered, ...deepRecovered])];
        } catch (e) {
          if (e?.code === 'OCR_TIMEOUT') throw e;
          recoveryStages.push({ stage: 'deep', error: e?.code || 'stage_error' });
        }
      }
      if (recovered.length > 0) {
        const before = extracted.amounts.length;
        unionInto(extracted.amounts, recovered, a => String(a));
        if (extracted.amounts.length > before &&
            extracted.amounts.some(a => Math.abs(a - expectedAmount) < 0.01)) {
          recoveredFromBands = true;
        }
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
      const passesStart = Date.now();
      try {
        passes = await runOcrAdditionalPasses(buffer, { deadline });
      } catch (e) {
        if (e?.code === 'OCR_TIMEOUT') throw e;
      }
      ocrPassInfo.additionalPassesRun = passes.length;
      ocrPassInfo.additionalPassConfidences = passes.map(p => p?.confidence || 0);
      for (const pass of passes) {
        if (!pass?.text) continue;
        const p = extractPaymentData(pass.text);
        unionInto(extracted.amounts, p.amounts, a => String(a));
        unionInto(extracted.upis, p.upis, String);
        unionInto(extracted.utrs, p.utrs, String);
        unionInto(extracted.dates, p.dates, String);
        unionInto(extracted.dateTimes, p.dateTimes, d => `${d.year}-${d.month}-${d.day}-${d.hour}-${d.minute}-${d.hasTime}`);
        unionInto(extracted.receiverNames, p.receiverNames, String);
        unionInto(extracted.senderNames, p.senderNames, String);
        ocrText += '\n' + pass.text;
        ocrConfidence = Math.max(ocrConfidence, pass.confidence || 0);
      }
      ocrPassInfo.candidatesFromPasses = {
        amounts: [...extracted.amounts],
        upis: [...extracted.upis],
        utrs: [...extracted.utrs],
      };
      recoveryStages.push({ stage: 'additional_passes', durationMs: Date.now() - passesStart, passes: passes.length });
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
      extractedSenderNames: extracted.senderNames || [],
      transactionStatus: extracted.transactionStatus || null,
      recoveredFromBands,
      ocrPassInfo,
      recovery: {
        budgetExhausted: recoveryBudgetExhausted,
        budgetMs: OCR_AMOUNT_RECOVERY_BUDGET_MS,
        stageBudgetMs: OCR_RECOVERY_STAGE_BUDGET_MS,
        elapsedMs: Date.now() - startedAt,
        stages: recoveryStages,
      },
    };
  } catch (error) {
    throw error;
  }
}
