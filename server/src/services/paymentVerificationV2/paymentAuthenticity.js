/**
 * Provider verification + FINAL approval policy (Phases 4 & 5 of the engine).
 *
 * Deterministic decision policy (production):
 *
 *   Screenshot gates all passed (integrity, OCR fields, UTR, exact amount,
 *   receiver UPI, receiver name when configured, date window, transaction
 *   status, confidence floor, duplicate pre-check) AND:
 *
 *   - NO provider configured (mode 'none', the production default)
 *        -> APPROVED. The mandatory screenshot checks ARE the verification
 *           policy. LIMITATION: a screenshot alone cannot conclusively prove
 *           bank settlement — live UPI/bank verification is not configured,
 *           so approval rests on screenshot evidence + the atomic approved-UTR
 *           ledger, not on provider confirmation.
 *   - provider configured + confirms the transaction   -> APPROVED
 *   - provider configured + DEFINITIVE negative (transaction not found /
 *     invalid)                                          -> REJECTED
 *     (invalid transaction reference — a definite failure condition)
 *   - provider configured + technical failure (timeout, error,
 *     misconfiguration)                                 -> PENDING_VERIFICATION
 *     with reason PROVIDER_UNAVAILABLE: a no-decision, retryable outcome.
 *     Technical failures are NEVER fraud and NEVER an approval.
 *
 * Provider responses are ALWAYS fetched server-side. A browser-supplied
 * "verified" flag is never an input to this module.
 */
import { verifyTransaction, getProviderMode } from '../paymentProviderService.js';

// Provider statuses that are a DEFINITIVE negative answer (the provider
// looked the reference up and says it does not exist / is invalid), as
// opposed to a technical failure where the provider could not answer.
const DEFINITIVE_NEGATIVE_STATUSES = new Set(['NOT_FOUND', 'INVALID', 'MISMATCH', 'FAILED', 'NOT_COMPLETED']);

/**
 * Runs the provider confirmation for a screenshot-approved transaction.
 * NEVER throws: an unavailable/timed-out/erroring provider returns
 * { verified:false } so the outcome fails safe — never to an approval.
 */
export async function verifyWithProvider({ transactionId, amount, receiverUpi = null, timeoutMs = null }) {
  const mode = getProviderMode();
  if (mode === 'none') {
    return {
      available: false,
      verified: false,
      status: 'UNAVAILABLE',
      provider: 'none',
      checkedAt: new Date().toISOString(),
    };
  }
  try {
    return await verifyTransaction({ transactionId, amount, receiverUpi, timeoutMs });
  } catch (err) {
    // Defensive: verifyTransaction itself never throws; belt and braces so a
    // provider exception can never become an approval (or a crash).
    return {
      available: false,
      verified: false,
      status: 'PROVIDER_ERROR',
      provider: mode,
      checkedAt: new Date().toISOString(),
      error: err?.message || 'Provider verification failed',
    };
  }
}

/**
 * Resolves the FINAL outcome for a screenshot that passed every mandatory
 * gate. See the module header for the decision table. NEVER returns APPROVED
 * when a configured provider gave a definitive negative or could not answer.
 */
export async function resolveApprovalOutcome({ transactionId, matchedAmount, receiverUpi = null }) {
  const provider = await verifyWithProvider({
    transactionId,
    amount: matchedAmount,
    receiverUpi,
  });

  const mode = getProviderMode();

  // No live provider integration is configured (mode 'none'): the mandatory
  // screenshot checks are the verification policy — all gates passed means
  // APPROVED. (Production limitation documented in the module header.)
  if (mode === 'none') {
    return { outcome: 'APPROVED', reason: null, provider };
  }

  if (provider.verified === true) {
    return { outcome: 'APPROVED', reason: null, provider };
  }

  // A configured provider that DEFINITIVELY says the transaction is not
  // found/invalid: a definite failure condition -> automatic rejection.
  if (provider.available === true && DEFINITIVE_NEGATIVE_STATUSES.has(provider.status)) {
    return { outcome: 'REJECTED', reason: 'PROVIDER_TRANSACTION_NOT_FOUND', provider };
  }

  // Everything else from a configured provider (timeout, HTTP error,
  // misconfiguration, unknown status) is a TECHNICAL failure: no decision,
  // never fraud, never an approval. The caller keeps the record
  // resubmittable so the user can retry.
  return { outcome: 'PENDING_VERIFICATION', reason: 'PROVIDER_UNAVAILABLE', provider };
}

export default { verifyWithProvider, resolveApprovalOutcome };
