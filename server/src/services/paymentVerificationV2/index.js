import paymentVerificationEngine, {
  PaymentVerificationEngine,
} from './engine.js';

export { paymentVerificationEngine, PaymentVerificationEngine };

export { validateImageIntegrity } from './screenshotIntegrity.js';

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
} from './amountValidation.js';

export { validateReceiver } from './receiverValidation.js';

export { validateDateTime } from './timestampValidation.js';

export { validateTransactionId } from './utrValidation.js';

export { validateSender } from './senderValidation.js';

export {
  checkDuplicateTransaction,
  normalizeUtr,
  reserveApprovedUtr,
  releaseApprovedUtr,
} from './duplicateDetection.js';

export {
  verifyWithProvider,
  resolveApprovalOutcome,
} from './paymentAuthenticity.js';

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
} from './auditHistory.js';

export {
  matchUPIWithRecovery,
  matchReceiverName,
  matchSenderName,
  normalizeName,
  extractPaymentData,
  extractTransactionStatus,
  dateTimeEntryToDate,
  isSameIstDay,
  isDemoScreenshot,
  closeOCRWorkers,
} from './ocrExtraction.js';

export default paymentVerificationEngine;
