import { supabase } from '../db/supabase.js';

// ─────────────────────────────────────────────────────────────
// Verification history (append-only audit of validation attempts).
//
// Every automated validation run — registration payments and top-ups —
// writes ONE immutable row here describing what the engine decided, which
// checks passed, what was extracted from the screenshot, what the payment
// provider returned and who acted (user / system / admin).
//
// Recording is deliberately NON-BLOCKING: a history write failure must never
// fail or roll back the payment decision itself. The authoritative payment
// state lives on payments / topups (guarded updates + approved_utrs); this
// table is forensic history for the admin dashboard.
// ─────────────────────────────────────────────────────────────

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

// Maps the internal three-way engine outcome + DB row status to the public
// four-state contract used by the frontend and admin dashboard:
//   APPROVED / REJECTED / PENDING_VERIFICATION / MANUAL_REVIEW
export function deriveOutcomeStatus(dbStatus, verificationResult = null) {
  if (dbStatus === 'approved') return 'APPROVED';
  if (dbStatus === 'rejected') return 'REJECTED';
  if (dbStatus === 'manual_review') {
    return verificationResult?.status === 'PENDING_VERIFICATION'
      ? 'PENDING_VERIFICATION'
      : 'MANUAL_REVIEW';
  }
  // pending (or unknown): awaiting upload / verification in progress /
  // inconclusive OCR attempt — all of which are "pending verification".
  if (verificationResult?.inconclusive === true) return 'PENDING_VERIFICATION';
  return 'PENDING_VERIFICATION';
}

export default { recordVerificationAttempt, listVerificationHistory, deriveOutcomeStatus };
