/**
 * Unified payment verification module — the SINGLE verification path for
 * registration payments and wallet top-ups.
 *
 *   engine.validatePayment()   screenshot layer (integrity -> OCR -> gates
 *                              -> decision engine)
 *   engine.verify()            full pipeline (+ provider verification +
 *                              approval policy) -> four-state outcome
 *   resolveApprovalOutcome()   provider + auto-approve policy alone
 *   decidePaymentVerification() pure flat-gate decision rule
 *   duplicate pre-check + atomic approved-UTR ledger
 *   audit/history writers
 *
 * Everything a flow needs to verify a payment proof lives behind this
 * barrel; flows keep only their persistence and business side effects.
 */
import paymentVerificationEngine, {
  PaymentVerificationEngine,
} from './engine.js';

export { paymentVerificationEngine, PaymentVerificationEngine };

export {
  validateImageIntegrity,
} from './imageIntegrity.js';

export {
  preprocessForOCR,
  runOcrPrimary,
  runOcrAdditionalPasses,
  runAmountRecoveryProbe,
  runAmountRecoveryDeep,
} from './ocr.js';

export { extractPaymentFields } from './extractFields.js';

export {
  validateAmount,
  normalizeAmountStrict,
} from './validateAmount.js';

export { validateReceiver } from './validateReceiver.js';

export { validateDateTime } from './validateTimestamp.js';

export { validateTransactionId } from './validateTransactionId.js';

export { validateSender } from './validateSender.js';

export {
  checkDuplicateTransaction,
  normalizeUtr,
  reserveApprovedUtr,
  releaseApprovedUtr,
} from './duplicateDetection.js';

export {
  verifyWithProvider,
  resolveApprovalOutcome,
} from './providerVerification.js';

export {
  ValidationDecisionEngine,
  decidePaymentVerification,
  requireExternalPaymentConfirmation,
  statusForOutcome,
  isInconclusiveReason,
  codeForInconclusive,
  userMessageFor,
} from './decisionEngine.js';

export {
  ENGINE_ID,
  historyFieldsForOutcome,
  recordVerificationAttempt,
  recordVerificationOutcome,
  logVerificationAction,
  listVerificationHistory,
  deriveOutcomeStatus,
} from './auditService.js';

export default paymentVerificationEngine;
