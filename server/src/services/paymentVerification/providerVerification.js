/**
 * Provider verification + approval policy (Phases 4 & 5 of the engine).
 *
 * A screenshot displaying "Completed" — even one that passed EVERY
 * screenshot check — is NOT evidence that money moved. Final APPROVAL
 * requires BOTH:
 *   1. all screenshot checks passed, AND
 *   2. trusted provider confirmation of the transaction (Phase 4), AND
 *   3. the auto-approval policy gate (Phase 5): straight-through approval
 *      stays DISABLED by default; with PAYMENT_AUTO_APPROVE unset the
 *      payment is parked for human confirmation even when a provider
 *      confirms it.
 *
 * Provider modes (see paymentProviderService):
 *   none  – default: nothing is simulated; approval is impossible without
 *           a configured provider, payments park as PENDING_VERIFICATION.
 *   mock  – tests/dev only; refused when NODE_ENV=production.
 *   live  – server-to-server call to the configured provider API; timeouts
 *           and errors fail safe to PENDING_VERIFICATION (never approval).
 *
 * Provider responses are ALWAYS fetched server-side. A browser-supplied
 * "verified" flag is never an input to this module.
 */
import { verifyTransaction, getProviderMode } from '../paymentProviderService.js';
import { isPaymentAutoApproveEnabled } from '../../config/paymentConfig.js';

/**
 * Runs the provider confirmation for a screenshot-approved transaction.
 * NEVER throws: an unavailable/timed-out/erroring provider returns
 * { verified:false } so the outcome fails safe to PENDING_VERIFICATION.
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
 * Resolves the FINAL outcome for a screenshot that passed every check.
 *
 * Decision table (auto-approve OFF is the production default):
 *   provider configured + not confirmed        -> PENDING_VERIFICATION
 *                                                  (PENDING_PROVIDER_VERIFICATION)
 *   auto-approve OFF (any provider state)      -> PENDING_VERIFICATION
 *                                                  (EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED)
 *   auto-approve ON  + provider confirmed      -> APPROVED
 *   auto-approve ON  + no provider / not conf. -> PENDING_VERIFICATION
 *                                                  (PENDING_PROVIDER_VERIFICATION)
 *
 * Returns { outcome, reason, provider } — outcome is one of the four
 * documented states; this function NEVER returns APPROVED without a
 * confirmed provider response.
 */
export async function resolveApprovalOutcome({ transactionId, matchedAmount, receiverUpi = null }) {
  const provider = await verifyWithProvider({
    transactionId,
    amount: matchedAmount,
    receiverUpi,
  });

  // A configured provider that did not confirm the transaction always wins:
  // never fall through to auto-approval on an unconfirmed reference.
  if (provider.available === true && provider.verified !== true) {
    return { outcome: 'PENDING_VERIFICATION', reason: 'PENDING_PROVIDER_VERIFICATION', provider };
  }

  if (!isPaymentAutoApproveEnabled()) {
    // Production default: even a provider-confirmed screenshot is parked for
    // an authorized human until straight-through approval is explicitly
    // enabled AND validated against a provider sandbox.
    return {
      outcome: 'PENDING_VERIFICATION',
      reason: 'EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED',
      provider,
    };
  }

  if (provider.verified !== true) {
    // Auto-approve requested but no trusted confirmation exists (mode
    // 'none', timeout, error, not-found): OCR alone can never approve.
    return { outcome: 'PENDING_VERIFICATION', reason: 'PENDING_PROVIDER_VERIFICATION', provider };
  }

  return { outcome: 'APPROVED', reason: null, provider };
}

export default { verifyWithProvider, resolveApprovalOutcome };
