import { MIN_OCR_CONFIDENCE_APPROVE, RECEIVER_UPI } from '../../config/paymentConfig.js';
import { matchUPIWithRecovery, isDemoScreenshot } from '../ocrService.js';

/**
 * Stage 10-11: Decision Engine
 *
 * Mirrors the legacy decidePaymentVerification gate ORDER and outcomes, and
 * classifies every failure into exactly one of three terminal states:
 *
 *   approved     — every mandatory gate passed
 *   inconclusive — the evidence was insufficient to DECIDE (OCR could not
 *                  read the field, config missing, budget exhausted).
 *                  The caller keeps the payment resubmittable — never a
 *                  rejection, never an approval.
 *   rejected     — the evidence definitively contradicts the request
 *                  (wrong amount, wrong payee, stale/failed transaction,
 *                  duplicate reference, corrupt image).
 *
 * Gate order (same as legacy): UPI -> amount -> date/time -> transaction
 * status -> transaction id -> OCR confidence -> receiver name -> duplicate.
 */
const INCONCLUSIVE_REASONS = new Set([
  'AMOUNT_NOT_DETECTED',
  'MISSING_EXPECTED_AMOUNT',
  'PAYMENT_DATE_NOT_DETECTED',
  'PAYMENT_TIME_NOT_DETECTED',
  'RECEIVER_NAME_UNREADABLE',
  'RECEIVER_NAME_INCOMPLETE',
  'RECEIVER_NAME_NOT_CONFIGURED',
  'RECEIVER_UPI_NOT_CONFIGURED',
  'OCR_UNREADABLE',
  'OCR_EXTRACTION_FAILED',
  'OCR_FAILED',
]);

export function isInconclusiveReason(reason) {
  return INCONCLUSIVE_REASONS.has(reason);
}

export function userMessageFor(reason) {
  switch (reason) {
    case 'AMOUNT_NOT_DETECTED':
    case 'MISSING_EXPECTED_AMOUNT':
      return 'We could not read the amount from your screenshot. Please upload a clearer image of the payment receipt.';
    case 'PAYMENT_DATE_NOT_DETECTED':
      return 'We could not read the transaction date from your screenshot. Please upload a clearer image.';
    case 'PAYMENT_TIME_NOT_DETECTED':
      return 'We could not read the transaction time from your screenshot. Please upload a clearer image.';
    case 'RECEIVER_NAME_UNREADABLE':
    case 'RECEIVER_NAME_INCOMPLETE':
      return 'We could not read the receiver name from your screenshot. Please upload a clearer image.';
    case 'RECEIVER_NAME_NOT_CONFIGURED':
      return 'Payment verification is temporarily unavailable. Please try again later.';
    case 'RECEIVER_UPI_NOT_CONFIGURED':
      return 'Payment verification is temporarily unavailable. Please try again later.';
    case 'LOW_OCR_CONFIDENCE':
      return 'We could not read your screenshot clearly enough to verify it. Please upload a clearer image.';
    case 'OCR_UNREADABLE':
      return 'Your screenshot could not be read. Please upload a clearer image of the payment receipt.';
    case 'OCR_EXTRACTION_FAILED':
    case 'OCR_FAILED':
      return 'Screenshot verification could not be completed. Please try again.';
    case 'OCR_TIMEOUT':
      return 'Screenshot verification took too long. Please try again.';
    case 'UPI_MISMATCH':
      return 'The receiver UPI ID on the screenshot does not match the expected payment recipient. Please make sure you paid the correct UPI ID.';
    case 'AMOUNT_MISMATCH':
    case 'CONFLICTING_AMOUNTS':
      return 'The amount on the screenshot does not match the expected payment amount.';
    case 'INVALID_PAYMENT_DATE':
    case 'INVALID_PAYMENT_DATE_FUTURE':
    case 'INVALID_PAYMENT_DATE_TOO_OLD':
    case 'INVALID_PAYMENT_DATE_NOT_TODAY':
      return 'The transaction date/time on the screenshot is outside the allowed payment window. Please create a new payment and try again.';
    case 'TRANSACTION_FAILED':
      return 'The transaction shown on the screenshot is not marked as completed.';
    case 'MISSING_UTR':
      return 'We could not find a transaction reference number on your screenshot. Please upload the full payment receipt.';
    case 'DUPLICATE_TRANSACTION':
      return 'This transaction reference has already been used for another payment.';
    case 'RECEIVER_NAME_MISMATCH':
      return 'The receiver name on the screenshot does not match the expected payment recipient.';
    case 'IMAGE_INTEGRITY_FAILED':
      return 'The uploaded file is not a valid image. Please upload a screenshot of your payment receipt.';
    case 'DEMO_SCREENSHOT':
      return 'This looks like a demo/sample screenshot, not a real payment receipt. Please upload your actual payment screenshot.';
    default:
      return 'Screenshot verification could not be completed. Please try again.';
  }
}

// Codes the HTTP controllers already translate into proper statuses
// (504 for OCR_TIMEOUT, 400 for OCR_FAILED / OCR_UNREADABLE). Everything
// else falls through to the controller's default error handling.
export function codeForInconclusive(reason) {
  if (reason === 'OCR_TIMEOUT') return 'OCR_TIMEOUT';
  if (reason === 'OCR_UNREADABLE') return 'OCR_UNREADABLE';
  if (reason === 'AMOUNT_NOT_DETECTED' || reason === 'PAYMENT_DATE_NOT_DETECTED' ||
      reason === 'PAYMENT_TIME_NOT_DETECTED' || reason === 'RECEIVER_NAME_UNREADABLE' ||
      reason === 'RECEIVER_NAME_INCOMPLETE') return 'OCR_UNREADABLE';
  if (reason === 'OCR_EXTRACTION_FAILED') return 'OCR_FAILED';
  return reason; // config / engine / db reasons pass through verbatim
}

export class ValidationDecisionEngine {
  constructor() {
    this.timings = {};
    this.auditLog = [];
  }

  log(stage, message, data = {}) {
    this.auditLog.push({ stage, message, data, timestamp: new Date().toISOString() });
  }

  _result(base) {
    const reason = base.reason || null;
    if (base.approved) {
      return { approved: true, inconclusive: false, reason: null, ...base };
    }
    // Classification: a reason in the inconclusive set (missing evidence,
    // unreadable field, missing config) is NEVER a rejection — the caller
    // keeps the payment resubmittable. Everything else is a definitive
    // rejection (the evidence contradicts the request).
    const inconclusive = base.inconclusive === true ||
      (!base.approved && isInconclusiveReason(reason));
    if (inconclusive) {
      return {
        approved: false,
        inconclusive: true,
        reason,
        code: codeForInconclusive(reason),
        message: userMessageFor(reason),
        ...base,
        inconclusive: true,
      };
    }
    return {
      approved: false,
      inconclusive: false,
      reason,
      code: reason,
      message: userMessageFor(reason),
      ...base,
    };
  }

  async decide(validationResults) {
    const {
      integrity,
      extraction,
      amountValidation,
      receiverValidation,
      dateTimeValidation,
      transactionIdValidation,
      duplicateCheck,
      paymentRequest,
    } = validationResults;

    const receiverUpi = paymentRequest?.receiverUpi || RECEIVER_UPI;
    const receiverName = paymentRequest?.receiverName;

    // Pre-gate: image integrity — definitive (the file itself is invalid).
    if (!integrity?.valid) {
      return this._result({
        approved: false,
        reason: 'IMAGE_INTEGRITY_FAILED',
        details: integrity?.errors || ['Invalid image'],
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    // Pre-gate: extraction — inconclusive (OCR failed to produce evidence).
    if (!extraction?.success) {
      return this._result({
        approved: false,
        reason: 'OCR_FAILED',
        details: ['Failed to extract payment details from screenshot'],
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    if (extraction.unreadable) {
      return this._result({
        approved: false,
        reason: 'OCR_UNREADABLE',
        details: ['Screenshot contained no readable text'],
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    // Screenshot authenticity: an obvious demo/sample/test screenshot is a
    // definitive reject BEFORE any content gate — nothing on it is evidence.
    if (isDemoScreenshot(extraction.ocrText)) {
      return this._result({
        approved: false,
        reason: 'DEMO_SCREENSHOT',
        details: ['Demo/sample screenshot markers detected in OCR text'],
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    const checks = {};

    // Gate 1: UPI must match the server-configured receiver UPI
    // (masked-suffix / truncation recovery included).
    if (!receiverUpi) {
      return this._result({
        approved: false,
        inconclusive: true,
        reason: 'RECEIVER_UPI_NOT_CONFIGURED',
        checks,
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }
    const upiValidation = matchUPIWithRecovery(extraction.extractedUPIs || [], receiverUpi);
    checks.receiverUpi = {
      passed: upiValidation.match === true,
      method: upiValidation.method,
      expected: receiverUpi,
      detected: upiValidation.candidate,
    };
    if (!upiValidation.match) {
      return this._result({
        approved: false,
        reason: 'UPI_MISMATCH',
        checks,
        details: { expected: receiverUpi, candidates: upiValidation.allCandidates },
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    // Gate 2 (Rule A): amount must match the server-resolved expected amount.
    checks.amount = {
      passed: amountValidation?.valid === true,
      reason: amountValidation?.reason || null,
      expected: paymentRequest?.expectedAmount,
      detected: amountValidation?.detected,
      method: amountValidation?.method || null,
    };
    if (!amountValidation?.valid) {
      return this._result({
        approved: false,
        reason: amountValidation?.reason || 'AMOUNT_MISMATCH',
        checks,
        details: { expected: paymentRequest?.expectedAmount, detected: amountValidation?.detected },
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    // Gate 3 (Rules C + D): transaction timestamp inside the freshness
    // window and on the current India calendar date.
    checks.transactionDate = {
      passed: dateTimeValidation?.valid === true,
      reason: dateTimeValidation?.reason || null,
      detected: dateTimeValidation?.transactionDate
        ? dateTimeValidation.transactionDate.toISOString()
        : null,
      diffMinutes: dateTimeValidation?.diffMinutes ?? null,
    };
    if (!dateTimeValidation?.valid) {
      // Specific variants (TOO_OLD / FUTURE / NOT_TODAY) all surface as the
      // single legacy reason INVALID_PAYMENT_DATE; details keep the variant.
      const rawDateReason = dateTimeValidation?.reason || 'INVALID_PAYMENT_DATE';
      const dateReason = rawDateReason.startsWith('INVALID_PAYMENT_DATE_')
        ? 'INVALID_PAYMENT_DATE'
        : rawDateReason;
      return this._result({
        approved: false,
        reason: dateReason,
        checks,
        details: { ...dateTimeValidation, variant: dateTimeValidation?.reason },
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    // Gate 4: transaction status must explicitly indicate success.
    // A receipt with NO status wording fails this gate (legacy behaviour:
    // "no status text -> TRANSACTION_FAILED").
    const transactionStatusOk = extraction.transactionStatus?.status === 'success';
    checks.transactionStatus = {
      passed: transactionStatusOk,
      detected: extraction.transactionStatus ? extraction.transactionStatus.matched : null,
      status: extraction.transactionStatus ? extraction.transactionStatus.status : null,
    };
    if (!transactionStatusOk) {
      return this._result({
        approved: false,
        reason: 'TRANSACTION_FAILED',
        checks,
        details: { detected: extraction.transactionStatus },
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    // Gate 5: transaction id (UTR / UPI reference) must be present.
    checks.utr = {
      passed: transactionIdValidation?.valid === true,
      reason: transactionIdValidation?.reason || null,
      value: transactionIdValidation?.transactionId || null,
      detected: extraction.extractedUTRs,
    };
    if (!transactionIdValidation?.valid) {
      return this._result({
        approved: false,
        reason: transactionIdValidation?.reason || 'MISSING_UTR',
        checks,
        details: { detected: extraction?.extractedUTRs },
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    // Gate 6: OCR confidence must meet the approval floor (config-driven).
    // Undefined confidence fails closed — never silently bypass the gate.
    const ocrConfidence = extraction.ocrConfidence;
    const confident = typeof ocrConfidence === 'number' && ocrConfidence >= MIN_OCR_CONFIDENCE_APPROVE;
    checks.ocrConfidence = {
      passed: confident,
      value: typeof ocrConfidence === 'number' ? ocrConfidence : null,
      floor: MIN_OCR_CONFIDENCE_APPROVE,
    };
    if (!confident) {
      // Legacy decidePaymentVerification semantics: low confidence is a
      // definitive rejection (the receipt was read but below the floor), not
      // an inconclusive infrastructure failure.
      return this._result({
        approved: false,
        reason: 'LOW_OCR_CONFIDENCE',
        checks,
        details: { value: typeof ocrConfidence === 'number' ? ocrConfidence : null, floor: MIN_OCR_CONFIDENCE_APPROVE },
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    // Gate 7 (SECONDARY): receiver name — evaluated whenever a name is
    // configured/expected. Missing config fails safe to inconclusive.
    if (receiverName !== undefined) {
      checks.receiverName = {
        passed: receiverValidation?.valid === true,
        reason: receiverValidation?.reason || null,
        expected: receiverName || null,
        detected: receiverValidation?.matched ||
          (receiverValidation?.detected ? receiverValidation.detected[0] : null),
      };
      if (!receiverValidation?.valid) {
        return this._result({
          approved: false,
          reason: receiverValidation?.reason || 'RECEIVER_NAME_MISMATCH',
          checks,
          details: { configured: receiverName, detected: receiverValidation?.detected },
          auditLog: this.auditLog,
          timings: this.timings,
        });
      }
    }

    // Gate 8: duplicate transaction reference (cross-flow) — definitive.
    // The pre-check is ADVISORY: a lookup failure is logged but does not
    // block the decision, because the AUTHORITATIVE duplicate gate is the
    // atomic approved_utrs reservation (UNIQUE constraint, INSERT ... ON
    // CONFLICT) that both flows perform before any approval commits. A
    // broken SELECT here can therefore never let a duplicate through.
    if (duplicateCheck?.dbError) {
      this.log('duplicate', 'pre-check lookup failed; relying on atomic reservation', {
        error: duplicateCheck.dbError,
      });
    }
    if (duplicateCheck?.isDuplicate) {
      return this._result({
        approved: false,
        reason: 'DUPLICATE_TRANSACTION',
        checks,
        details: duplicateCheck,
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    // All mandatory checks passed
    this.log('decision', 'all gates passed', { transactionId: transactionIdValidation.transactionId });
    return this._result({
      approved: true,
      checks,
      transactionId: transactionIdValidation.transactionId,
      matchedAmount: amountValidation.matchedAmount,
      matchedReceiver: receiverValidation?.matchedName || null,
      transactionDate: dateTimeValidation.transactionDate,
      transactionStatus: extraction.transactionStatus,
      ocrConfidence,
      extractedData: {
        amounts: extraction.extractedAmounts,
        receiverNames: extraction.extractedReceiverNames,
        utrs: extraction.extractedUTRs,
        upis: extraction.extractedUPIs,
        dates: extraction.extractedDateTimes,
        ocrConfidence: extraction.ocrConfidence,
        transactionStatus: extraction.transactionStatus,
        ocrTextLength: (extraction.ocrText || '').length,
      },
      auditLog: this.auditLog,
      timings: this.timings,
    });
  }
}
