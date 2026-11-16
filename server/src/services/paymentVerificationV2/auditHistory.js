/**
 * Verification audit/history for the unified payment verification engine.
 *
 * Every automated attempt ΓÇö registration payments and top-ups ΓÇö writes ONE
 * append-only row (payment_verifications) plus one audit_log entry, both
 * centralized here so the two flows record identically:
 *
 *   - recordVerificationOutcome()  maps the four-state outcome contract
 *     (APPROVED / REJECTED / PENDING_VERIFICATION / MANUAL_REVIEW) onto the
 *     persisted {status, decision} pair ΓÇö one place, no per-flow drift.
 *   - logVerificationAction()      writes the audit_log entry.
 *   - recordVerificationAttempt()  raw escape hatch kept for callers that
 *     already assemble the row themselves (failure markers, admin actions).
 *
 * Both writers are deliberately NON-BLOCKING: an audit write failure must
 * never fail or roll back a payment decision. Authoritative state lives on
 * payments / topups (guarded updates + approved_utrs).
 */
import { logAction } from '../auditService.js';
import { supabase } from '../../db/supabase.js';

export const ENGINE_ID = 'paymentVerificationV2/1.0';

const VALID_STATUSES = new Set(['APPROVED', 'REJECTED', 'PENDING_VERIFICATION', 'MANUAL_REVIEW']);

export async function recordVerificationAttempt({
  referenceType,
  referenceId,
  engine = null,
  status,
  decision = null,
  reasonCode = null,
  checks = null,
  extractedData = null,
  ocrConfidence = null,
  transactionId = null,
  provider = null,
  actorId = null,
  actorRole = 'system',
}) {
  try {
    if (!referenceType || !referenceId || !status) return null;
    const row = {
      reference_type: referenceType,
      reference_id: String(referenceId),
      engine,
      status: VALID_STATUSES.has(status) ? status : 'PENDING_VERIFICATION',
      decision,
      reason_code: reasonCode || null,
      checks: checks || null,
      extracted_data: extractedData || null,
      ocr_confidence: Number.isFinite(ocrConfidence) ? ocrConfidence : null,
      transaction_id: transactionId || null,
      provider: provider || null,
      actor_id: actorId || null,
      actor_role: actorRole,
    };
    const { error } = await supabase.from('payment_verifications').insert(row);
    if (error) {
      console.error('[verificationHistory] failed to record attempt', {
        referenceType,
        referenceId,
        code: error.code,
        message: error.message,
      });
      return null;
    }
    return row;
  } catch (e) {
    console.error('[verificationHistory] recording threw', { referenceType, referenceId, message: e?.message });
    return null;
  }
}

export async function listVerificationHistory(referenceType, referenceId, limit = 25) {
  try {
    const capped = Math.max(1, Math.min(Number(limit) || 25, 100));
    const { data, error } = await supabase
      .from('payment_verifications')
      .select('*')
      .eq('reference_type', referenceType)
      .eq('reference_id', String(referenceId))
      .order('created_at', { ascending: false })
      .limit(capped);
    if (error) throw error;
    return data || [];
  } catch (e) {
    console.error('[verificationHistory] list failed', { referenceType, referenceId, message: e?.message });
    return [];
  }
}

export function deriveOutcomeStatus(dbStatus, verificationResult = null) {
  if (dbStatus === 'approved') return 'APPROVED';
  if (dbStatus === 'rejected') return 'REJECTED';
  if (dbStatus === 'manual_review') {
    return verificationResult?.status === 'PENDING_VERIFICATION'
      ? 'PENDING_VERIFICATION'
      : 'MANUAL_REVIEW';
  }
  if (verificationResult?.inconclusive === true) return 'PENDING_VERIFICATION';
  return 'PENDING_VERIFICATION';
}

// Maps the four-state outcome to the {status, decision} pair persisted in
// payment_verifications. decision=null only for attempts that never reached
// a decision (inconclusive/failure markers) ΓÇö those can never be read as an
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
