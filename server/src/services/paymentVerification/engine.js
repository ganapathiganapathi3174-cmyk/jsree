/**
 * Unified Payment Verification Engine (paymentVerificationEngine/v2).
 *
 * ONE module performs the COMPLETE verification of a payment proof — for
 * BOTH registration payments and wallet top-ups:
 *
 *   1. image integrity      (imageIntegrity.js)
 *   2. preprocessing + OCR  (ocr.js / extractFields.js)
 *   3. field validators     (Check A amount, B receiver, C date/time,
 *                           D transaction id + duplicate pre-check,
 *                           B sender advisory)
 *   4. decision engine      (decisionEngine.js — four-state classification)
 *   5. provider verification + approval policy (providerVerification.js)
 *
 * Result contract — the four-state outcome is ALWAYS present:
 *
 *   validatePayment()  screenshot layer only (keeps the historical shape:
 *                      { success, approved, inconclusive, review, status,
 *                        reason, code, message, ... }).
 *
 *   verify()           full pipeline: screenshot layer + provider + policy,
 *                      returning { outcome, ... } where outcome is exactly
 *                      one of:
 *                        APPROVED            -> commit approval (caller
 *                                               reserves the UTR first)
 *                        REJECTED            -> definitive, persist
 *                        PENDING_VERIFICATION-> TECHNICAL no-decision
 *                                               (provider timeout/error):
 *                                               inconclusive:true, caller
 *                                               keeps the row resubmittable
 *                                               (never approve, never park,
 *                                               never label as fraud)
 *                        MANUAL_REVIEW       -> only reachable when the
 *                                               operator explicitly opts into
 *                                               SENDER_NAME_POLICY=review
 *                      plus a ready-to-persist `verificationResult`.
 *
 * OCR_TIMEOUT / OCR_FAILED / PREPROCESSING_FAILED / ENGINE_ERROR always
 * surface as inconclusive (success:false) — infrastructure can never become
 * a decision. Provider verification NEVER throws; a configured provider that
 * cannot answer fails safe to a retryable no-decision.
 */
import { validateImageIntegrity } from './imageIntegrity.js';
import { preprocessForOCR } from './ocr.js';
import { extractPaymentFields } from './extractFields.js';
import { validateAmount } from './validateAmount.js';
import { validateReceiver } from './validateReceiver.js';
import { validateDateTime } from './validateTimestamp.js';
import { validateTransactionId } from './validateTransactionId.js';
import { validateSender } from './validateSender.js';
import { checkDuplicateTransaction } from './duplicateDetection.js';
import {
  ValidationDecisionEngine,
  codeForInconclusive,
  userMessageFor,
} from './decisionEngine.js';
import { resolveApprovalOutcome } from './providerVerification.js';
import { RECEIVER_UPI, RECEIVER_NAME, SENDER_NAME_POLICY } from '../../config/paymentConfig.js';
import { ENGINE_ID } from './auditService.js';

function inconclusiveResult(reason, details, timings, extra = {}) {
  return {
    success: false,
    approved: false,
    inconclusive: true,
    review: false,
    outcome: 'PENDING_VERIFICATION',
    status: 'PENDING_VERIFICATION',
    reason,
    code: codeForInconclusive(reason),
    message: userMessageFor(reason),
    details,
    timings,
    ...extra,
  };
}

export class PaymentVerificationEngine {
  constructor() {
    this.decisionEngine = new ValidationDecisionEngine();
  }

  // ───────────────────────────────────────────────────────────
  // Screenshot layer: integrity -> preprocess -> OCR -> validators ->
  // duplicate pre-check -> decision engine. No provider call, no policy.
  // ───────────────────────────────────────────────────────────
  async validatePayment({
    imageBuffer,
    file = null,
    paymentRequest, // { type, expectedAmount, paymentId, userId, receiverName, receiverUpi, ... }
    serverTime = new Date(),
    timeoutMs = 60000,
    // TEST-ONLY escape hatch: legacy verification tests feed synthetic
    // buffers that are not decodable images. Production never sets this.
    skipIntegrityCheck = false,
  }) {
    const startTime = Date.now();
    const timings = {};

    try {
      // Stage 1: Image Integrity (magic bytes + decode probe)
      const stage1Start = Date.now();
      const integrity = skipIntegrityCheck
        ? { valid: true, errors: [], warnings: ['integrity check skipped'] }
        : await validateImageIntegrity(imageBuffer, file);
      timings.stage1_integrity = Date.now() - stage1Start;

      if (!integrity.valid) {
        return {
          success: false,
          approved: false,
          inconclusive: false,
          review: false,
          outcome: 'REJECTED',
          status: 'REJECTED',
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

      // Stage 7b: sender (payer) name — advisory identity check (Rule B).
      // Disabled automatically when no expected payer identity is supplied
      // or the policy is 'off'; an unreadable sender line never blocks.
      const senderPolicy = paymentRequest.senderPolicy || SENDER_NAME_POLICY;
      const senderValidation = validateSender(
        extraction.extractedSenderNames,
        paymentRequest.expectedPayerName || null,
        senderPolicy,
      );

      // Stage 8: Duplicate pre-check (advisory — the AUTHORITATIVE gate is
      // the atomic approved_utrs reservation the caller performs on commit).
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
        senderValidation,
        paymentRequest,
      });
      timings.stage9_decision = Date.now() - stage9Start;

      timings.total = Date.now() - startTime;

      return {
        success: true,
        approved: decision.approved === true,
        inconclusive: decision.inconclusive === true,
        review: decision.review === true,
        outcome: decision.status || null,
        status: decision.status || null,
        reason: decision.reason || null,
        code: decision.code || null,
        message: decision.message || null,
        details: decision.details,
        checks: decision.checks,
        upiDiagnostics: decision.upiDiagnostics || null,
        nameDiagnostics: decision.nameDiagnostics || null,
        transactionId: decision.transactionId || null,
        matchedAmount: decision.matchedAmount,
        matchedReceiver: decision.matchedReceiver || null,
        transactionDate: decision.transactionDate,
        transactionStatus: decision.transactionStatus,
        ocrConfidence: decision.ocrConfidence,
        extractedData: decision.extractedData,
        senderValidation: senderValidation.applicable ? senderValidation : null,
        auditLog: decision.auditLog,
        timings,
      };
    } catch (error) {
      const timingsFinal = { ...timings, total: Date.now() - startTime };
      console.error('[PaymentVerificationEngine] Error:', error);
      if (error?.code === 'OCR_TIMEOUT') {
        return inconclusiveResult('OCR_TIMEOUT', [error.message], timingsFinal);
      }
      return inconclusiveResult('ENGINE_ERROR', [error.message || 'Internal validation error'], timingsFinal);
    }
  }

  // ───────────────────────────────────────────────────────────
  // Full pipeline: screenshot layer + provider verification + approval
  // policy -> four-state outcome with a ready-to-persist
  // verificationResult. This is the ONE entry both flows call.
  //
  // The caller owns persistence: guarded status transition, atomic UTR
  // reservation (commit-time duplicate gate), approval side effects.
  // ───────────────────────────────────────────────────────────
  async verify({
    imageBuffer,
    file = null,
    paymentRequest,
    purpose, // 'registration' | 'topup'
    serverTime = new Date(),
    timeoutMs = 60000,
    skipIntegrityCheck = false,
  }) {
    const screenshot = await this.validatePayment({
      imageBuffer,
      file,
      paymentRequest,
      serverTime,
      timeoutMs,
      skipIntegrityCheck,
    });

    // Inconclusive (OCR/infra): never a decision, never an approval — the
    // caller keeps the record resubmittable and throws a retryable error.
    // (Definitive gates failures — including image integrity — carry
    // inconclusive:false and fall through to REJECTED / MANUAL_REVIEW.)
    if (screenshot.inconclusive === true) {
      return { ...screenshot, outcome: 'PENDING_VERIFICATION' };
    }

    // Definitive rejection or ambiguous (manual review) from the gates.
    if (!screenshot.approved) {
      const outcome = screenshot.review === true ? 'MANUAL_REVIEW' : 'REJECTED';
      // Top-ups present DUPLICATE_TRANSACTION as the UTR-specific reason.
      const reason = outcome === 'REJECTED' && purpose === 'topup' && screenshot.reason === 'DUPLICATE_TRANSACTION'
        ? 'DUPLICATE_UTR'
        : screenshot.reason;
      const verificationResult = {
        ...screenshot,
        decision: outcome === 'MANUAL_REVIEW' ? 'manual_review' : 'rejected',
        status: outcome,
        reason,
        utr: screenshot.transactionId || null,
        engine: ENGINE_ID,
      };
      return { ...screenshot, reason, outcome, verificationResult };
    }

    // Screenshot passed every gate — provider confirmation (when a provider
    // is configured) + the deterministic approval policy decide between
    // APPROVED, REJECTED and a retryable no-decision. NEVER throws.
    const resolution = await resolveApprovalOutcome({
      transactionId: screenshot.transactionId,
      matchedAmount: screenshot.matchedAmount,
      receiverUpi: paymentRequest?.receiverUpi || RECEIVER_UPI,
    });

    if (resolution.outcome === 'APPROVED') {
      const verificationResult = {
        ...screenshot,
        decision: 'approved',
        status: 'APPROVED',
        reason: null,
        utr: screenshot.transactionId || null,
        provider: resolution.provider,
        engine: ENGINE_ID,
      };
      return {
        ...screenshot,
        outcome: 'APPROVED',
        approved: true,
        provider: resolution.provider,
        verificationResult,
      };
    }

    if (resolution.outcome === 'REJECTED') {
      const reason = resolution.reason || 'PROVIDER_TRANSACTION_NOT_FOUND';
      const verificationResult = {
        ...screenshot,
        decision: 'rejected',
        status: 'REJECTED',
        reason,
        utr: screenshot.transactionId || null,
        provider: resolution.provider,
        engine: ENGINE_ID,
      };
      return {
        ...screenshot,
        approved: false,
        outcome: 'REJECTED',
        reason,
        code: reason,
        message: userMessageFor(reason),
        provider: resolution.provider,
        verificationResult,
      };
    }

    // PENDING_VERIFICATION from the resolution stage is always a TECHNICAL
    // failure (configured provider timed out / errored / misconfigured).
    // Surface it as INCONCLUSIVE: the caller records a no-decision attempt,
    // the row stays resubmittable, and the user gets an honest retry message.
    // It is never fraud, never an approval, and never a manual-review park.
    const reason = resolution.reason || 'PROVIDER_UNAVAILABLE';
    return {
      ...screenshot,
      success: false,
      approved: false,
      inconclusive: true,
      review: false,
      outcome: 'PENDING_VERIFICATION',
      status: 'PENDING_VERIFICATION',
      reason,
      code: reason,
      message: userMessageFor(reason),
      provider: resolution.provider,
      details: { provider: resolution.provider },
      verificationResult: {
        ...screenshot,
        decision: null,
        ocrDecision: 'approved',
        status: 'PENDING_VERIFICATION',
        reason,
        utr: screenshot.transactionId || null,
        provider: resolution.provider,
        engine: ENGINE_ID,
      },
    };
  }
}

export const paymentVerificationEngine = new PaymentVerificationEngine();
export default paymentVerificationEngine;
