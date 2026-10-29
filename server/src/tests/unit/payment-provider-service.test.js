import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function loadService(envOverrides = {}) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...envOverrides };
  return import('../../services/paymentProviderService.js');
}

describe('paymentProviderService', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.PAYMENT_PROVIDER_MODE;
    delete process.env.PAYMENT_PROVIDER_MOCK_TIMEOUT;
    delete process.env.PAYMENT_PROVIDER_VERIFY_URL;
    delete process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('defaults to mode none and reports unavailable — never a simulated success', async () => {
    const svc = await loadService({});
    expect(svc.getProviderMode()).toBe('none');
    const r = await svc.verifyTransaction({ transactionId: 'T123456789', amount: 120 });
    expect(r.available).toBe(false);
    expect(r.verified).toBe(false);
    expect(r.status).toBe('UNAVAILABLE');
  });

  it('mock mode verifies a transaction that carries a reference', async () => {
    const svc = await loadService({ PAYMENT_PROVIDER_MODE: 'mock', NODE_ENV: 'development' });
    expect(svc.getProviderMode()).toBe('mock');
    const r = await svc.verifyTransaction({ transactionId: 'T123456789', amount: 120 });
    expect(r.available).toBe(true);
    expect(r.verified).toBe(true);
    expect(r.status).toBe('MOCK_VERIFIED');
  });

  it('mock mode does NOT verify a missing/short transaction reference', async () => {
    const svc = await loadService({ PAYMENT_PROVIDER_MODE: 'mock', NODE_ENV: 'development' });
    const r = await svc.verifyTransaction({ transactionId: 'AB', amount: 120 });
    expect(r.verified).toBe(false);
    expect(r.status).toBe('NOT_FOUND');
  });

  it('mock timeout knob returns verified:false with TIMEOUT (never throws)', async () => {
    const svc = await loadService({
      PAYMENT_PROVIDER_MODE: 'mock',
      NODE_ENV: 'development',
      PAYMENT_PROVIDER_MOCK_TIMEOUT: 'true',
    });
    const r = await svc.verifyTransaction({ transactionId: 'T123456789', amount: 120 });
    expect(r.verified).toBe(false);
    expect(r.status).toBe('TIMEOUT');
  });

  it('refuses mock mode in production (degrades to none)', async () => {
    const svc = await loadService({ PAYMENT_PROVIDER_MODE: 'mock', NODE_ENV: 'production' });
    expect(svc.getProviderMode()).toBe('none');
    const r = await svc.verifyTransaction({ transactionId: 'T123456789' });
    expect(r.verified).toBe(false);
    expect(r.available).toBe(false);
  });

  it('unknown mode falls back to none', async () => {
    const svc = await loadService({ PAYMENT_PROVIDER_MODE: 'bogus' });
    expect(svc.getProviderMode()).toBe('none');
  });

  it('live mode without a verify URL reports MISCONFIGURED, never approves', async () => {
    const svc = await loadService({ PAYMENT_PROVIDER_MODE: 'live', NODE_ENV: 'development' });
    const r = await svc.verifyTransaction({ transactionId: 'T123456789', amount: 120 });
    expect(r.available).toBe(false);
    expect(r.verified).toBe(false);
    expect(r.status).toBe('MISCONFIGURED');
  });

  it('live mode with a failing endpoint fails safe (PROVIDER_ERROR, verified:false)', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('network down'); };
    try {
      const svc = await loadService({
        PAYMENT_PROVIDER_MODE: 'live',
        NODE_ENV: 'development',
        PAYMENT_PROVIDER_VERIFY_URL: 'https://provider.invalid/verify',
      });
      const r = await svc.verifyTransaction({ transactionId: 'T123456789', amount: 120 });
      expect(r.verified).toBe(false);
      expect(r.status).toBe('PROVIDER_ERROR');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('live mode maps a SUCCESS provider response to verified:true', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ verified: true, status: 'SUCCESS', rrn: 'RRN999' }),
    });
    try {
      const svc = await loadService({
        PAYMENT_PROVIDER_MODE: 'live',
        NODE_ENV: 'development',
        PAYMENT_PROVIDER_VERIFY_URL: 'https://provider.invalid/verify',
      });
      const r = await svc.verifyTransaction({ transactionId: 'T123456789', amount: 120 });
      expect(r.available).toBe(true);
      expect(r.verified).toBe(true);
      expect(r.providerReference).toBe('RRN999');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('describeProvider exposes mode and availability', async () => {
    const svc = await loadService({});
    const d = svc.describeProvider();
    expect(d.mode).toBe('none');
    expect(d.available).toBe(false);
  });
});
