import {
  PAYMENT_PROVIDER_VERIFY_URL,
  PAYMENT_PROVIDER_API_KEY,
  PAYMENT_PROVIDER_TIMEOUT_MS,
  PAYMENT_PROVIDER_MOCK_TIMEOUT,
} from '../config/paymentConfig.js';

// ─────────────────────────────────────────────────────────────
// Payment provider verification abstraction (Rule F).
//
// A screenshot displaying "Completed" is NOT evidence that money moved.
// Final approval of a payment (beyond the OCR gates) requires an
// authoritative check against a payment provider / bank integration.
//
// This module is the single integration seam:
//   - mode 'none'  (default): no provider configured. verifyTransaction
//     returns { available:false } and callers keep the payment at
//     PENDING_VERIFICATION / manual review. Nothing is ever simulated.
//   - mode 'mock'  (development + tests only): deterministic simulated
//     responses. REFUSED when NODE_ENV=production (degrades to 'none').
//   - mode 'live'  : HTTP call to PAYMENT_PROVIDER_VERIFY_URL with the
//     API key; timeouts and errors fail safe (never throw, never approve).
//
// Idempotency: verifyTransaction is a read-only query by nature. Exactly-
// once effects (UTR reservation via approved_utrs UNIQUE insert, wallet
// credit via credit_wallets_atomic) are enforced by the calling flows, not
// here — replaying a provider lookup is always safe.
// ─────────────────────────────────────────────────────────────

let mockModeWarningLogged = false;

export function getProviderMode() {
  const raw = (process.env.PAYMENT_PROVIDER_MODE || 'none').toLowerCase();
  if (raw === 'mock') {
    if (process.env.NODE_ENV === 'production') {
      if (!mockModeWarningLogged) {
        console.error('[paymentProvider] PAYMENT_PROVIDER_MODE=mock is refused in production; falling back to none');
        mockModeWarningLogged = true;
      }
      return 'none';
    }
    return 'mock';
  }
  if (raw === 'live') return 'live';
  return 'none';
}

export function describeProvider() {
  const mode = getProviderMode();
  return {
    mode,
    available: mode !== 'none',
    verifyUrlConfigured: Boolean(PAYMENT_PROVIDER_VERIFY_URL),
    timeoutMs: PAYMENT_PROVIDER_TIMEOUT_MS,
  };
}

function unavailableResult(status = 'UNAVAILABLE', extra = {}) {
  return {
    available: false,
    verified: false,
    status,
    provider: getProviderMode(),
    checkedAt: new Date().toISOString(),
    ...extra,
  };
}

async function verifyLive({ transactionId, amount, receiverUpi, timeoutMs }) {
  if (!PAYMENT_PROVIDER_VERIFY_URL) {
    return unavailableResult('MISCONFIGURED', { error: 'PAYMENT_PROVIDER_VERIFY_URL is not set' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(PAYMENT_PROVIDER_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(PAYMENT_PROVIDER_API_KEY ? { Authorization: `Bearer ${PAYMENT_PROVIDER_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        transactionId,
        amount,
        currency: 'INR',
        receiverUpi: receiverUpi || undefined,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      return unavailableResult('PROVIDER_ERROR', { httpStatus: resp.status });
    }
    const body = await resp.json().catch(() => null);
    const verified = body?.verified === true || body?.status === 'SUCCESS';
    return {
      available: true,
      verified,
      status: verified ? 'SUCCESS' : (body?.status || 'NOT_FOUND'),
      provider: 'live',
      providerReference: body?.providerReference || body?.rrn || null,
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const timedOut = err?.name === 'AbortError' || err?.name === 'TimeoutError';
    return unavailableResult(timedOut ? 'TIMEOUT' : 'PROVIDER_ERROR', {
      error: timedOut ? 'Provider verification timed out' : (err?.message || 'Provider request failed'),
    });
  } finally {
    clearTimeout(timer);
  }
}

function verifyMock({ transactionId }) {
  if (PAYMENT_PROVIDER_MOCK_TIMEOUT) {
    return unavailableResult('TIMEOUT', { error: 'Simulated provider timeout (PAYMENT_PROVIDER_MOCK_TIMEOUT)' });
  }
  // The mock only "confirms" transactions that carry a reference — a
  // screenshot without a UTR can never be provider-verified, even in dev.
  const verified = typeof transactionId === 'string' && transactionId.trim().length >= 6;
  return {
    available: true,
    verified,
    status: verified ? 'MOCK_VERIFIED' : 'NOT_FOUND',
    provider: 'mock',
    checkedAt: new Date().toISOString(),
  };
}

// Main entry. NEVER throws: an unavailable/timed-out/erroring provider is
// reported as { verified:false } so the caller fails safe to
// PENDING_VERIFICATION instead of crashing the upload request.
export async function verifyTransaction({ transactionId, amount, receiverUpi = null, timeoutMs = null } = {}) {
  const mode = getProviderMode();
  const budget = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : PAYMENT_PROVIDER_TIMEOUT_MS;

  try {
    if (mode === 'mock') return verifyMock({ transactionId, amount });
    if (mode === 'live') return verifyLive({ transactionId, amount, receiverUpi, timeoutMs: budget });
    return unavailableResult();
  } catch (err) {
    return unavailableResult('PROVIDER_ERROR', { error: err?.message || 'Provider verification failed' });
  }
}

export default { getProviderMode, describeProvider, verifyTransaction };
