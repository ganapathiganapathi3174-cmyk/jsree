/**
 * Check D (part 2) — duplicate transaction detection + approved-UTR ledger.
 *
 * TWO layers protect against a UTR being spent twice (across registration
 * payments AND top-ups):
 *
 *   1. ADVISORY pre-check (checkDuplicateTransaction): a read-only lookup
 *      across approved_utrs / payments.transaction_id / topups.reference_id
 *      that surfaces a precise DUPLICATE_TRANSACTION reason early. A DB
 *      error here is reported as dbError and NEVER treated as either
 *      "duplicate" or "safe" — the authoritative gate is layer 2.
 *
 *   2. AUTHORITATIVE atomic reservation (reserveApprovedUtr): an INSERT
 *      against approved_utrs whose UNIQUE(utr) constraint (migration 007)
 *      guarantees exactly ONE winner for a given UTR under concurrency.
 *      Both flows reserve before an approval commits; a lost race flips the
 *      approval to REJECTED with DUPLICATE_UTR. Never SELECT-then-INSERT.
 */
import { supabase } from '../../db/supabase.js';
import { normalizeUtrValue } from '../../utils/paymentNormalize.js';

export async function checkDuplicateTransaction(transactionId, excludePaymentId = null, excludeTopupId = null) {
  if (!transactionId) return { isDuplicate: false };

  const normalized = (normalizeUtrValue ? normalizeUtrValue(transactionId) : null) ||
    String(transactionId).toUpperCase().replace(/[^A-Z0-9]/g, '');
  // Stored rows may use any of these forms (legacy rows only had whitespace
  // stripped, newer rows are fully normalized) — query every distinct form
  // so the pre-check never misses a duplicate on formatting alone.
  const lookupValues = [...new Set([
    String(transactionId),
    String(transactionId).replace(/\s+/g, '').toUpperCase(),
    normalized,
  ].filter(Boolean))];

  try {
    // Check in approved_utrs (every normalization form).
    for (const value of lookupValues) {
      const { data: approved, error: approvedErr } = await supabase
        .from('approved_utrs')
        .select('*')
        .eq('utr', value)
        .limit(1);
      if (approvedErr) return { isDuplicate: false, dbError: approvedErr.message || 'approved_utrs lookup failed' };

      if (approved && approved.length > 0) {
        // Same record re-verifying its own reference is not a duplicate.
        if ((excludePaymentId && approved[0].reference_type === 'payment' && approved[0].reference_id === excludePaymentId) ||
            (excludeTopupId && approved[0].reference_type === 'topup' && approved[0].reference_id === excludeTopupId)) {
          return { isDuplicate: false };
        }
        return { isDuplicate: true, source: approved[0] };
      }
    }

    // Also check payments and topups for any transaction_id (both the raw
    // and the normalized forms — rows may predate normalization).
    for (const value of lookupValues) {
      const { data: payments, error: paymentsErr } = await supabase
        .from('payments')
        .select('id')
        .eq('transaction_id', value)
        .neq('status', 'rejected')
        .limit(1);
      if (paymentsErr) return { isDuplicate: false, dbError: paymentsErr.message || 'payments lookup failed' };

      if (payments && payments.length > 0 &&
          !(excludePaymentId && payments[0].id === excludePaymentId)) {
        return { isDuplicate: true, source: 'payments' };
      }

      const { data: topups, error: topupsErr } = await supabase
        .from('topups')
        .select('id')
        .eq('reference_id', value)
        .neq('status', 'rejected')
        .limit(1);
      if (topupsErr) return { isDuplicate: false, dbError: topupsErr.message || 'topups lookup failed' };

      if (topups && topups.length > 0 &&
          !(excludeTopupId && topups[0].id === excludeTopupId)) {
        return { isDuplicate: true, source: 'topups' };
      }
    }

    return { isDuplicate: false };
  } catch (err) {
    return { isDuplicate: false, dbError: err?.message || 'duplicate check failed' };
  }
}

// ─────────────────────────────────────────────────────────────
// Approved-UTR ledger helpers (shared by payments AND top-ups).
//
// Only PREVIOUSLY APPROVED records live in approved_utrs, so a UTR that
// appears on a rejected/pending/failed/cancelled record can never block a
// future approval. Missing/empty UTRs are skipped entirely.
// ─────────────────────────────────────────────────────────────
export function normalizeUtr(utr) {
  if (!utr) return null;
  const normalized = String(utr).replace(/\s+/g, '').trim().toUpperCase();
  return normalized || null;
}

// Atomically records an approved UTR. Race-safe: the UNIQUE(utr) constraint
// (migration 007) guarantees that only ONE caller can reserve a given UTR —
// concurrent same-UTR submissions see a 23505 and are told "duplicate".
// Never a SELECT-then-INSERT.
//
// Returns:
//   { reserved: true,  duplicate: false, utr }  -> caller owns the UTR now
//   { reserved: false, duplicate: true,  utr }  -> already APPROVED elsewhere
//   { reserved: false, duplicate: false, utr: null } -> no UTR to reserve
export async function reserveApprovedUtr(utr, referenceType, referenceId) {
  const normalized = normalizeUtr(utr);
  if (!normalized) return { reserved: false, duplicate: false, utr: null };

  const { data, error } = await supabase
    .from('approved_utrs')
    .insert({ utr: normalized, reference_type: referenceType, reference_id: referenceId })
    .select('utr')
    .maybeSingle();

  if (error) {
    if (error.code === '23505') return { reserved: false, duplicate: true, utr: normalized };
    throw { message: 'Failed to record approved UTR', code: 'UTR_RESERVE_FAILED' };
  }
  return { reserved: true, duplicate: false, utr: normalized, id: data?.id || null };
}

// Removes a reservation made for a specific record (used to compensate when
// approval fails AFTER the UTR was reserved, so the UTR can be retried).
export async function releaseApprovedUtr(utr, referenceType, referenceId) {
  const normalized = normalizeUtr(utr);
  if (!normalized) return;
  await supabase
    .from('approved_utrs')
    .delete()
    .eq('utr', normalized)
    .eq('reference_id', referenceId);
}
