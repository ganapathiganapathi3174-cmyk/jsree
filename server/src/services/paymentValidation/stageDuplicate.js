import { supabase } from '../../db/supabase.js';
import { normalizeUtrValue } from '../../utils/paymentNormalize.js';

/**
 * Stage 8-9: Duplicate checks (cross-flow: payments, top-ups, approved UTRs).
 *
 * ADVISORY pre-check: it catches duplicates early with a precise
 * DUPLICATE_TRANSACTION reason, but it is NOT the security boundary — the
 * authoritative gate is the atomic approved_utrs reservation
 * (reserveApprovedUtr, UNIQUE(utr) + INSERT ... ON CONFLICT) that both flows
 * perform before an approval commits. A database error here is therefore
 * reported as dbError (logged by the decision engine) rather than treated as
 * "not a duplicate" or as a hard failure.
 */
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
