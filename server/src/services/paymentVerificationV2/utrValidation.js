/**
 * Check D (part 1) — TRANSACTION ID (UPI ref / UTR) extraction gate.
 *
 * The UTR is never an input to the other gates, but approval is impossible
 * without one: a missing reference can neither be duplicate-checked nor
 * provider-verified, so it is a definitive reject (MISSING_UTR) — never
 * silently treated as a unique genuine transaction.
 */
export function validateTransactionId(utrs) {
  if (!utrs || utrs.length === 0) {
    return { valid: false, reason: 'MISSING_UTR', detected: [] };
  }

  // Get the first valid-looking UTR
  for (const utr of utrs) {
    const normalized = String(utr).replace(/\s+/g, '').trim();
    if (normalized && normalized.length >= 6) { // UPI refs are usually longer
      return { valid: true, transactionId: normalized, raw: utr };
    }
  }

  return { valid: false, reason: 'MISSING_UTR', detected: utrs };
}
