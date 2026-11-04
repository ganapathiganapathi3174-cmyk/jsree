/**
 * Verification audit/history for the unified payment verification engine.
 *
 * Every automated attempt — registration payments and top-ups — writes ONE
 * append-only row (payment_verifications) plus one audit_log entry, both
 * centralized here so the two flows record identically:
 *
 *   - recordVerificationOutcome()  maps the four-state outcome contract
 *     (APPROVED / REJECTED / PENDING_VERIFICATION / MANUAL_REVIEW) onto the
 *     persisted {status, decision} pair — one place, no per-flow drift.
 *   - logVerificationAction()      writes the audit_log entry.
 *   - recordVerificationAttempt()  raw escape hatch kept for callers that
 *     already assemble the row themselves (failure markers, admin actions).
 *
 * Both writers are deliberately NON-BLOCKING: an audit write failure must
 * never fail or roll back a payment decision. Authoritative state lives on
 * payments / topups (guarded updates + approved_utrs).
 */
import { logAction } from '../auditService.js';
import {
  recordVerificationAttempt,
  listVerificationHistory,
  deriveOutcomeStatus,
} from '../paymentVerificationHistoryService.js';

// Engine identifier recorded in verification_result / audit rows so every
// decision is traceable to the engine version that produced it.
export const ENGINE_ID = 'paymentVerificationEngine/v2';

export { recordVerificationAttempt, listVerificationHistory, deriveOutcomeStatus };

// Maps the four-state outcome to the {status, decision} pair persisted in
// payment_verifications. decision=null only for attempts that never reached
// a decision (inconclusive/failure markers) — those can never be read as an
// approval.
export function historyFieldsForOutcome(outcome, { decision } = {}) {
  switch (outcome) {
    case 'APPROVED':
      return { status: 'APPROVED', decision: decision ?? 'approved' };
    case 'REJECTED':
      return { status: 'REJECTED', decision: decision ?? 'rejected' };
    case 'MANUAL_REVIEW':
      return { status: 'MANUAL_REVIEW', decision: decision ?? 'manual_review' };
    case 'PENDING_VERIFICATION':
      // Parked for provider/human confirmation OR an inconclusive attempt:
      // verification_result.status stays PENDING_VERIFICATION while the
      // decision column keeps whatever the caller recorded (manual_review
      // for a park, null for a no-decision failure marker).
      return { status: 'PENDING_VERIFICATION', decision: decision ?? null };
    default:
      return { status: 'PENDING_VERIFICATION', decision: decision ?? null };
  }
}

// Single write path for a completed verification attempt (both flows).
// Non-blocking: returns null on failure, never throws.
export async function recordVerificationOutcome({
  referenceType,
  referenceId,
  outcome,
  reasonCode = null,
  decision, // optional override (null = no decision recorded)
  checks = null,
  extractedData = null,
  ocrConfidence = null,
  transactionId = null,
  provider = null,
  actorId = null,
  actorRole = 'system',
  engine = ENGINE_ID,
}) {
  const fields = historyFieldsForOutcome(outcome, { decision });
  return recordVerificationAttempt({
    referenceType,
    referenceId,
    engine,
    status: fields.status,
    decision: fields.decision,
    reasonCode,
    checks,
    extractedData,
    ocrConfidence,
    transactionId,
    provider,
    actorId,
    actorRole,
  });
}

// Single write path for the audit_log entry accompanying a verification run.
// Non-blocking: never throws.
export async function logVerificationAction({
  actorId = null,
  actorRole = 'system',
  action,
  referenceType,
  referenceId,
  metadata = {},
}) {
  try {
    await logAction(actorId, actorRole, action, referenceId, referenceType, metadata);
  } catch (e) {
    console.error('[paymentVerification] audit log failed', { action, referenceId, message: e?.message });
  }
}

export default {
  ENGINE_ID,
  historyFieldsForOutcome,
  recordVerificationAttempt,
  recordVerificationOutcome,
  logVerificationAction,
  deriveOutcomeStatus,
};
