/**
 * Decision engine — classifies screenshot evidence into exactly one of the
 * four documented outcomes:
 *
 *   APPROVED            — every mandatory screenshot gate passed (the FINAL
 *                         approval decision additionally runs the provider
 *                         policy — see providerVerification.js)
 *   MANUAL_REVIEW       — ONLY when the operator explicitly opts into
 *                         SENDER_NAME_POLICY=review; never produced by the
 *                         default policy
 *   PENDING_VERIFICATION— evidence was INSUFFICIENT to decide (OCR could not
 *                         read a field, config missing, budget exhausted).
 *                         Never an approval, never a rejection, never
 *                         fraud — the row stays resubmittable.
 *   REJECTED            — evidence definitively contradicts the request
 *                         (wrong amount/payee, stale/future transaction,
 *                         duplicate reference, corrupt image, failed status)
 *
 * Gate order: integrity -> extraction -> demo -> UPI -> amount -> date/time
 * -> transaction status -> transaction id -> OCR confidence -> receiver
 * name (skipped when not configured) -> sender name (advisory) ->
 * duplicate pre-check.
 *
 * `decidePaymentVerification()` is the same rule set expressed over flat
 * gate flags (kept as a pure function for unit testing individual gates);
 * `ValidationDecisionEngine.decide()` is the full-pipeline entry used by
 * the engine.
 */
import { MIN_OCR_CONFIDENCE_APPROVE, RECEIVER_UPI } from '../../config/paymentConfig.js';
import { matchUPIWithRecovery, isDemoScreenshot } from '../ocrService.js';

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
  'PROVIDER_UNAVAILABLE',
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
    case 'TRANSACTION_TOO_OLD':
    case 'FUTURE_TRANSACTION_TIMESTAMP':
      return 'The transaction date/time on the screenshot is outside the allowed payment window. Please create a new payment and try again.';
    case 'TRANSACTION_FAILED':
      return 'The transaction shown on the screenshot is not marked as completed.';
    case 'MISSING_UTR':
      return 'We could not find a transaction reference number on your screenshot. Please upload the full payment receipt.';
    case 'DUPLICATE_TRANSACTION':
      return 'This transaction reference has already been used for another payment.';
    case 'DUPLICATE_UTR':
      return 'This transaction reference has already been used for another payment.';
    case 'RECEIVER_NAME_MISMATCH':
      return 'The receiver name on the screenshot does not match the expected payment recipient.';
    case 'SENDER_NAME_MISMATCH':
      return 'The payer name on the screenshot does not match the account holder. Please make the payment from your own registered UPI account and try again.';
    case 'SENDER_NAME_UNREADABLE':
      return 'We could not read the payer name from your screenshot. Please upload a clearer image.';
    case 'PROVIDER_TRANSACTION_NOT_FOUND':
      return 'This transaction reference could not be confirmed by the payment provider. The payment is invalid — please check the transaction and try again.';
    case 'PROVIDER_UNAVAILABLE':
      return 'We could not confirm this transaction with the payment provider right now. Nothing was charged — please try again in a few minutes.';
    case 'PENDING_PROVIDER_VERIFICATION':
      return 'Your screenshot passed automated checks, but the payment could not be confirmed with the payment provider yet. It is pending verification.';
    case 'EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED':
      return 'Your screenshot passed automated checks and is awaiting confirmation. It is pending verification.';
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

// Public four-state outcome contract shared by the engine, the API responses
// and the admin dashboard: APPROVED / REJECTED / PENDING_VERIFICATION /
// MANUAL_REVIEW. `inconclusive` evidence (OCR failure, missing config,
// provider unavailable) maps to PENDING_VERIFICATION; ambiguous or
// contradictory evidence routed to a human maps to MANUAL_REVIEW.
export function statusForOutcome({ approved, inconclusive, review }) {
  if (approved) return 'APPROVED';
  if (review) return 'MANUAL_REVIEW';
  if (inconclusive) return 'PENDING_VERIFICATION';
  return 'REJECTED';
}

// Date-window failure variants collapse to the single user-facing reason
// INVALID_PAYMENT_DATE; the specific variant code (TRANSACTION_TOO_OLD /
// FUTURE_TRANSACTION_TIMESTAMP / ...) is preserved in details.variant.
const DATE_VARIANT_REASONS = new Set([
  'INVALID_PAYMENT_DATE_TOO_OLD',
  'INVALID_PAYMENT_DATE_FUTURE',
  'INVALID_PAYMENT_DATE_NOT_TODAY',
  'TRANSACTION_TOO_OLD',
  'FUTURE_TRANSACTION_TIMESTAMP',
]);

function canonicalDateReason(reason) {
  if (!reason) return 'INVALID_PAYMENT_DATE';
  return DATE_VARIANT_REASONS.has(reason) ? 'INVALID_PAYMENT_DATE' : reason;
}

// ─────────────────────────────────────────────────────────────
// Flat-flag decision rule (pure). Used by unit tests and as the single
// source of truth for gate semantics; the class below applies the SAME
// rules to full-pipeline evidence.
// ─────────────────────────────────────────────────────────────
export function decidePaymentVerification({
  upiMatch, amountMatch, dateValid, utrPresent,
  transactionStatusOk, ocrConfidence,
  receiverName, nameMatch, nameFound, nameConfigured,
  // Optional refinements. `undefined` keeps hard-rejection behaviour;
  // `false` means "the field could NOT be read" and fails closed into
  // manual_review (never an approval).
  amountDetected,
  dateDetected,
  timeDetected,
  namePartial,
}) {
  // Gate 1: UPI must match
  if (upiMatch !== true) return { decision: 'rejected', reason: 'UPI_MISMATCH' };

  // Gate 2 (Check A): amount must match the server-resolved expected amount.
  if (amountMatch !== true) {
    // No amount could be read at all — the screenshot is inconclusive,
    // not wrong. Fail closed into manual review instead of accusing the
    // user of paying the wrong amount.
    if (amountDetected === false) return { decision: 'manual_review', reason: 'AMOUNT_NOT_DETECTED' };
    return { decision: 'rejected', reason: 'AMOUNT_MISMATCH' };
  }

  // Gate 3 (Check C): timestamp inside the freshness window, Asia/Kolkata.
  if (dateValid !== true) {
    if (dateDetected === false) return { decision: 'manual_review', reason: 'PAYMENT_DATE_NOT_DETECTED' };
    if (timeDetected === false) return { decision: 'manual_review', reason: 'PAYMENT_TIME_NOT_DETECTED' };
    return { decision: 'rejected', reason: 'INVALID_PAYMENT_DATE' };
  }

  // Gate 4 (Check E): transaction status must explicitly indicate success.
  if (transactionStatusOk !== true) return { decision: 'rejected', reason: 'TRANSACTION_FAILED' };

  // Gate 5 (Check D): UTR must be present.
  if (utrPresent !== true) return { decision: 'rejected', reason: 'MISSING_UTR' };

  // Gate 6: OCR confidence must meet the approval floor.
  // Undefined confidence fails closed — never silently bypass the gate.
  const confident = ocrConfidence !== undefined && ocrConfidence >= MIN_OCR_CONFIDENCE_APPROVE;
  if (!confident) return { decision: 'rejected', reason: 'LOW_OCR_CONFIDENCE' };

  // Gate 7 (Check B): receiver name. Only evaluated when a receiver name
  // is supplied AND configured. Undefined => disabled (direct callers /
  // legacy tests). Not configured => the secondary gate is unavailable and
  // is skipped (every other mandatory gate still applies).
  if (receiverName !== undefined && nameConfigured === true) {
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

// ─────────────────────────────────────────────────────────────
// External-confirmation demotion: an engine-approved screenshot that still
// needs provider/human confirmation is parked — never a straight approval.
// Kept as a named helper because both flows (and their tests) record this
// transition explicitly.
// ─────────────────────────────────────────────────────────────
export function requireExternalPaymentConfirmation(verificationResult) {
  if (verificationResult?.decision !== 'approved') return verificationResult;

  return {
    ...verificationResult,
    ocrDecision: 'approved',
    decision: 'manual_review',
    status: 'PENDING_VERIFICATION',
    reason: 'EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED',
  };
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
      return { approved: true, inconclusive: false, review: false, status: 'APPROVED', reason: null, ...base };
    }
    // Review: evidence is ambiguous/contradictory (e.g. payer-name mismatch
    // under the default policy) — a human must decide. Never an approval,
    // never a definitive rejection.
    if (base.review === true) {
      return {
        ...base,
        approved: false,
        inconclusive: false,
        review: true,
        status: 'MANUAL_REVIEW',
        reason,
        code: reason,
        message: userMessageFor(reason),
      };
    }
    // Classification: a reason in the inconclusive set (missing evidence,
    // unreadable field, missing config) is NEVER a rejection — the caller
    // keeps the payment resubmittable. Everything else is a definitive
    // rejection (the evidence contradicts the request).
    const inconclusive = base.inconclusive === true ||
      (!base.approved && isInconclusiveReason(reason));
    if (inconclusive) {
      return {
        ...base,
        approved: false,
        inconclusive: true,
        review: false,
        status: 'PENDING_VERIFICATION',
        reason,
        code: codeForInconclusive(reason),
        message: userMessageFor(reason),
      };
    }
    return {
      ...base,
      approved: false,
      inconclusive: false,
      review: false,
      status: 'REJECTED',
      reason,
      code: reason,
      message: userMessageFor(reason),
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
      senderValidation = null,
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
    const upiDiagnostics = {
      originalCandidates: upiValidation.originalCandidates || [],
      normalizedCandidates: upiValidation.allCandidates || [],
      matchMethod: upiValidation.method,
      matchConfidence: upiValidation.confidence,
      matchedCandidate: upiValidation.candidate,
      expectedUpi: receiverUpi,
    };
    if (!upiValidation.match) {
      return this._result({
        approved: false,
        reason: 'UPI_MISMATCH',
        checks,
        upiDiagnostics,
        details: { expected: receiverUpi, candidates: upiValidation.allCandidates },
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    // Gate 2 (Check A): amount must match the server-resolved expected amount.
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
        upiDiagnostics,
        details: { expected: paymentRequest?.expectedAmount, detected: amountValidation?.detected },
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    // Gate 3 (Check C): transaction timestamp inside the freshness window
    // and on the current India calendar date (Asia/Kolkata).
    checks.transactionDate = {
      passed: dateTimeValidation?.valid === true,
      reason: dateTimeValidation?.reason || null,
      code: dateTimeValidation?.code || null,
      detected: dateTimeValidation?.transactionDate
        ? dateTimeValidation.transactionDate.toISOString()
        : null,
      diffMinutes: dateTimeValidation?.diffMinutes ?? null,
      timezone: dateTimeValidation?.timezone || null,
      windowMinutes: dateTimeValidation?.windowMinutes ?? null,
    };
    if (!dateTimeValidation?.valid) {
      const rawDateReason = dateTimeValidation?.reason || 'INVALID_PAYMENT_DATE';
      const dateReason = canonicalDateReason(rawDateReason);
      return this._result({
        approved: false,
        reason: dateReason,
        checks,
        upiDiagnostics,
        details: {
          ...dateTimeValidation,
          variant: rawDateReason,
          variantCode: dateTimeValidation?.code || rawDateReason,
        },
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    // Gate 4 (Check E): transaction status must explicitly indicate success.
    // A receipt with NO status wording fails this gate — OCR extraction
    // success is never treated as proof of settlement.
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
        upiDiagnostics,
        details: { detected: extraction.transactionStatus },
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    // Gate 5 (Check D): transaction id (UTR / UPI reference) must be present.
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
        upiDiagnostics,
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
      return this._result({
        approved: false,
        reason: 'LOW_OCR_CONFIDENCE',
        checks,
        upiDiagnostics,
        details: { value: typeof ocrConfidence === 'number' ? ocrConfidence : null, floor: MIN_OCR_CONFIDENCE_APPROVE },
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    // Gate 7 (Check B, SECONDARY): receiver name — evaluated whenever a
    // name is configured/expected. Missing config fails safe to inconclusive.
    let nameDiagnostics = null;
    if (receiverName !== undefined) {
      checks.receiverName = {
        passed: receiverValidation?.valid === true,
        reason: receiverValidation?.reason || null,
        expected: receiverName || null,
        detected: receiverValidation?.matched ||
          (receiverValidation?.detected ? receiverValidation.detected[0] : null),
      };
      nameDiagnostics = {
        enabled: true,
        expected: receiverName || null,
        candidates: receiverValidation?.detected || [],
        matchMethod: receiverValidation?.method || null,
        matched: receiverValidation?.matchedName || null,
        partial: receiverValidation?.reason === 'RECEIVER_NAME_INCOMPLETE',
      };
      if (!receiverValidation?.valid) {
        // No receiver name configured (server-side): the secondary name gate
        // is simply unavailable — requirement: "receiver name matches WHEN
        // reliable receiver-name evidence is available". Skip the gate and
        // keep enforcing every other mandatory check (receiver UPI, amount,
        // date, status, UTR, integrity, duplicates). Never reject a payment
        // because of missing server configuration, and never park it.
        if (receiverValidation?.reason === 'RECEIVER_NAME_NOT_CONFIGURED') {
          this.log('receiverName', 'not configured — secondary name gate skipped', {});
          // EXPLICIT disclosure (never silent): the row records that the
          // gate was disabled server-side. passed=null renders as N/A —
          // it can NEVER be read as a pass or a fail.
          checks.receiverName = {
            passed: null,
            skipped: true,
            reason: 'RECEIVER_NAME_NOT_CONFIGURED',
            expected: null,
            detected: receiverValidation?.detected || [],
          };
          nameDiagnostics = { enabled: false, skipped: 'RECEIVER_NAME_NOT_CONFIGURED' };
        } else {
          return this._result({
            approved: false,
            reason: receiverValidation?.reason || 'RECEIVER_NAME_MISMATCH',
            checks,
            upiDiagnostics,
            nameDiagnostics,
            details: { configured: receiverName, detected: receiverValidation?.detected },
            auditLog: this.auditLog,
            timings: this.timings,
          });
        }
      }
    }

    // Gate 7b (Rule B): sender (payer) name — advisory identity signal.
    //   - match             -> supporting evidence, never sufficient alone
    //   - unreadable        -> advisory only, NEVER blocks the payment
    //   - complete mismatch -> policy-driven: default 'reject' = definitive
    //                          rejection (no manual-review parking);
    //                          explicit 'review' = operator opt-in to
    //                          MANUAL_REVIEW for a human
    if (senderValidation?.applicable) {
      checks.senderName = {
        passed: senderValidation.passed,
        reason: senderValidation.reason || null,
        method: senderValidation.method || null,
        expected: senderValidation.expected || null,
        detected: senderValidation.detected?.[0] || senderValidation.matched || null,
      };
      if (senderValidation.reason === 'SENDER_NAME_MISMATCH') {
        if (senderValidation.policy === 'reject') {
          return this._result({
            approved: false,
            reason: 'SENDER_NAME_MISMATCH',
            checks,
            upiDiagnostics,
            nameDiagnostics,
            details: { expected: senderValidation.expected, detected: senderValidation.detected },
            auditLog: this.auditLog,
            timings: this.timings,
          });
        }
        return this._result({
          approved: false,
          review: true,
          reason: 'SENDER_NAME_MISMATCH',
          checks,
          upiDiagnostics,
          nameDiagnostics,
          details: { expected: senderValidation.expected, detected: senderValidation.detected, policy: 'review' },
          auditLog: this.auditLog,
          timings: this.timings,
        });
      }
      if (senderValidation.reason === 'SENDER_NAME_UNREADABLE') {
        this.log('sender', 'payer name unreadable — advisory only, not blocking', {
          detected: senderValidation.detected,
        });
      }
    }

    // Gate 8 (Check D): duplicate transaction reference (cross-flow) —
    // definitive. The pre-check is ADVISORY: a lookup failure is logged but
    // does not block the decision, because the AUTHORITATIVE duplicate gate
    // is the atomic approved_utrs reservation (UNIQUE constraint) that both
    // flows perform before any approval commits. A broken SELECT here can
    // therefore never let a duplicate through — nor be read as approval.
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
        upiDiagnostics,
        nameDiagnostics,
        details: duplicateCheck,
        auditLog: this.auditLog,
        timings: this.timings,
      });
    }

    // All mandatory screenshot checks passed.
    this.log('decision', 'all screenshot gates passed', { transactionId: transactionIdValidation.transactionId });
    return this._result({
      approved: true,
      checks,
      upiDiagnostics,
      nameDiagnostics,
      transactionId: transactionIdValidation.transactionId,
      matchedAmount: amountValidation.matchedAmount,
      matchedReceiver: receiverValidation?.matchedName || null,
      transactionDate: dateTimeValidation.transactionDate,
      transactionStatus: extraction.transactionStatus,
      ocrConfidence,
      extractedData: {
        amounts: extraction.extractedAmounts,
        receiverNames: extraction.extractedReceiverNames,
        senderNames: extraction.extractedSenderNames || [],
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

export default ValidationDecisionEngine;
