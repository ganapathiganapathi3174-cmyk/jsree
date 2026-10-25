/**
 * Main Payment Validation Engine
 * Orchestrates all stages with proper error handling and atomicity.
 *
 * Result contract (single shape for every path):
 *   { success, approved, inconclusive, reason, code, message, ... }
 *
 *   approved=true           -> every mandatory gate passed
 *   inconclusive=true       -> evidence insufficient to decide (OCR/infra/
 *                              config); caller keeps the payment
 *                              resubmittable. NEVER an approval.
 *   approved=false,
 *   inconclusive=false      -> definitive rejection, safe to persist.
 *
 * OCR_TIMEOUT (budget overrun) always surfaces as inconclusive — a timed-out
 * attempt can never be read as a decision.
 */
import { validateImageIntegrity } from './stage1Integrity.js';
import { preprocessForOCR } from './stage2Preprocess.js';
import { extractPaymentFields } from './stage3Extraction.js';
import { validateAmount, validateReceiver, validateDateTime, validateTransactionId } from './stageValidation.js';
import { checkDuplicateTransaction } from './stageDuplicate.js';
import { ValidationDecisionEngine, codeForInconclusive, userMessageFor } from './decisionEngine.js';
import { RECEIVER_UPI, RECEIVER_NAME } from '../../config/paymentConfig.js';

function inconclusiveResult(reason, details, timings, extra = {}) {
  return {
    success: false,
    approved: false,
    inconclusive: true,
    reason,
    code: codeForInconclusive(reason),
    message: userMessageFor(reason),
    details,
    timings,
    ...extra,
  };
}

export class PaymentValidationEngine {
  constructor() {
    this.decisionEngine = new ValidationDecisionEngine();
  }

  async validatePayment({
    imageBuffer,
    file = null,
    paymentRequest, // { type: 'registration'|'topup', expectedAmount, paymentId, userId, receiverName, receiverUpi, ... }
    serverTime = new Date(),
    timeoutMs = 60000,
  }) {
    const startTime = Date.now();
    const timings = {};

    try {
      // Stage 1: Image Integrity (magic bytes + decode probe)
      const stage1Start = Date.now();
      const integrity = await validateImageIntegrity(imageBuffer, file);
      timings.stage1_integrity = Date.now() - stage1Start;

      if (!integrity.valid) {
        return {
          success: false,
          approved: false,
          inconclusive: false,
          reason: 'IMAGE_INTEGRITY_FAILED',
          code: 'IMAGE_INTEGRITY_FAILED',
          message: 'The uploaded file is not a valid image. Please upload a screenshot of your payment receipt.',
          details: integrity.errors,
          timings,
        };
      }

      // Stage 2: Preprocessing — a failure here is infrastructure, never a
      // decision about the payment.
      const stage2Start = Date.now();
      const preprocessResult = await preprocessForOCR(imageBuffer);
      timings.stage2_preprocess = Date.now() - stage2Start;

      if (!preprocessResult.success) {
        return inconclusiveResult('PREPROCESSING_FAILED', [preprocessResult.error], timings);
      }

      // Stage 3: OCR Extraction (conditional recovery passes). The RAW
      // buffer is handed over so the primary pass and every recovery pass
      // share one preprocessing memo entry.
      const stage3Start = Date.now();
      const deadline = startTime + timeoutMs;
      let extraction;
      try {
        extraction = await extractPaymentFields(imageBuffer, {
          deadline,
          expectedAmount: paymentRequest.expectedAmount,
          receiverUpi: paymentRequest.receiverUpi || RECEIVER_UPI,
        });
      } catch (ocrErr) {
        if (ocrErr?.code === 'OCR_TIMEOUT') {
          return inconclusiveResult('OCR_TIMEOUT', [ocrErr.message], { ...timings, stage3_extraction: Date.now() - stage3Start });
        }
        return inconclusiveResult('OCR_FAILED', [ocrErr?.message || 'OCR failed'], {
          ...timings,
          stage3_extraction: Date.now() - stage3Start,
        });
      }
      timings.stage3_extraction = Date.now() - stage3Start;

      if (!extraction.success) {
        return inconclusiveResult('OCR_FAILED', ['Failed to extract payment details'], timings);
      }

      // Find best date/time entry
      let bestDateTimeEntry = null;
      for (const dt of extraction.extractedDateTimes || []) {
        if (dt.hasTime) {
          bestDateTimeEntry = dt;
          break;
        } else if (!bestDateTimeEntry) {
          bestDateTimeEntry = dt;
        }
      }

      // Stage 4-7: Validations
      const stage4Start = Date.now();
      const amountValidation = validateAmount(extraction.extractedAmounts, paymentRequest.expectedAmount);
      timings.stage4_amount = Date.now() - stage4Start;

      const stage5Start = Date.now();
      const receiverName = paymentRequest.receiverName !== undefined
        ? paymentRequest.receiverName
        : RECEIVER_NAME;
      const receiverValidation = validateReceiver(extraction.extractedReceiverNames, receiverName);
      timings.stage5_receiver = Date.now() - stage5Start;

      const stage6Start = Date.now();
      const dateTimeValidation = validateDateTime(bestDateTimeEntry, serverTime);
      timings.stage6_datetime = Date.now() - stage6Start;

      const stage7Start = Date.now();
      const transactionIdValidation = validateTransactionId(extraction.extractedUTRs);
      timings.stage7_transactionId = Date.now() - stage7Start;

      // Stage 8: Duplicate check (fail-closed on DB errors)
      const stage8Start = Date.now();
      const duplicateCheck = await checkDuplicateTransaction(
        transactionIdValidation.transactionId,
        paymentRequest.type === 'registration' ? paymentRequest.paymentId : null,
        paymentRequest.type === 'topup' ? paymentRequest.paymentId : null,
      );
      timings.stage8_duplicate = Date.now() - stage8Start;

      // Stage 9-10: Decision
      const stage9Start = Date.now();
      const decision = await this.decisionEngine.decide({
        integrity,
        extraction,
        amountValidation,
        receiverValidation,
        dateTimeValidation,
        transactionIdValidation,
        duplicateCheck,
        paymentRequest,
      });
      timings.stage9_decision = Date.now() - stage9Start;

      timings.total = Date.now() - startTime;

      return {
        success: true,
        approved: decision.approved === true,
        inconclusive: decision.inconclusive === true,
        reason: decision.reason || null,
        code: decision.code || null,
        message: decision.message || null,
        details: decision.details,
        checks: decision.checks,
        transactionId: decision.transactionId || null,
        matchedAmount: decision.matchedAmount,
        matchedReceiver: decision.matchedReceiver || null,
        transactionDate: decision.transactionDate,
        transactionStatus: decision.transactionStatus,
        ocrConfidence: decision.ocrConfidence,
        extractedData: decision.extractedData,
        auditLog: decision.auditLog,
        timings,
      };
    } catch (error) {
      const timingsFinal = { ...timings, total: Date.now() - startTime };
      console.error('[PaymentValidationEngine] Error:', error);
      if (error?.code === 'OCR_TIMEOUT') {
        return inconclusiveResult('OCR_TIMEOUT', [error.message], timingsFinal);
      }
      return inconclusiveResult('ENGINE_ERROR', [error.message || 'Internal validation error'], timingsFinal);
    }
  }
}

export const paymentValidationEngine = new PaymentValidationEngine();
export default paymentValidationEngine;
