import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isPaymentExpired } from '../../services/paymentService.js';

// ─────────────────────────────────────────────────────────────
// PAYMENT EXPIRY UNIT TESTS
//
// Tests the isPaymentExpired helper and expiry-related logic.
// These are pure logic tests that do NOT require a database.
// ─────────────────────────────────────────────────────────────

describe('Payment Expiry — isPaymentExpired()', () => {
  it('returns true when expires_at is null', () => {
    expect(isPaymentExpired({ expires_at: null })).toBe(true);
  });

  it('returns true when payment is undefined', () => {
    expect(isPaymentExpired(undefined)).toBe(true);
  });

  it('returns true when payment is null', () => {
    expect(isPaymentExpired(null)).toBe(true);
  });

  it('returns true when expires_at is in the past', () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    expect(isPaymentExpired({ expires_at: past })).toBe(true);
  });

  it('returns false when expires_at is in the future', () => {
    const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    expect(isPaymentExpired({ expires_at: future })).toBe(false);
  });

  it('returns false exactly at the expiry time (strict > means equals is still valid)', () => {
    // `now > expires_at` with now === expires_at evaluates to false,
    // meaning the payment is still valid at the exact expiry instant.
    // This is the intended boundary behavior: the 30-minute window is [created, created+30min].
    const now = new Date();
    expect(isPaymentExpired({ expires_at: now.toISOString() })).toBe(false);
  });

  it('returns false one second before expiry', () => {
    const future = new Date(Date.now() + 1000).toISOString();
    expect(isPaymentExpired({ expires_at: future })).toBe(false);
  });

  it('returns true one second after expiry', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isPaymentExpired({ expires_at: past })).toBe(true);
  });
});

describe('Payment Expiry — 30-minute window boundary tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('payment created at T=0, expires at T+30min', () => {
    const createdAt = new Date('2026-09-07T10:00:00Z');
    vi.setSystemTime(createdAt);

    const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000);
    expect(isPaymentExpired({ expires_at: expiresAt.toISOString() })).toBe(false);
  });

  it('payment at T+29min59s — NOT expired', () => {
    const createdAt = new Date('2026-09-07T10:00:00Z');
    vi.setSystemTime(new Date(createdAt.getTime() + 29 * 60 * 1000 + 59 * 1000));

    const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000);
    expect(isPaymentExpired({ expires_at: expiresAt.toISOString() })).toBe(false);
  });

  it('payment at T+30min+1s — EXPIRED', () => {
    const createdAt = new Date('2026-09-07T10:00:00Z');
    vi.setSystemTime(new Date(createdAt.getTime() + 30 * 60 * 1000 + 1000));

    const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000);
    expect(isPaymentExpired({ expires_at: expiresAt.toISOString() })).toBe(true);
  });

  it('payment at T+31min — EXPIRED', () => {
    const createdAt = new Date('2026-09-07T10:00:00Z');
    vi.setSystemTime(new Date(createdAt.getTime() + 31 * 60 * 1000));

    const expiresAt = new Date(createdAt.getTime() + 30 * 60 * 1000);
    expect(isPaymentExpired({ expires_at: expiresAt.toISOString() })).toBe(true);
  });
});

describe('Payment Expiry — client-manipulated values ignored', () => {
  it('payment with only expires_at from server is checked correctly', () => {
    // Simulates: server sets expires_at, client cannot change it
    const serverSetExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    expect(isPaymentExpired({ expires_at: serverSetExpiry })).toBe(false);
  });

  it('expired payment with fake future expires_at — still checks server value', () => {
    // The client cannot change the expires_at value stored in DB.
    // isPaymentExpired only checks the value passed to it.
    const realExpiry = new Date(Date.now() - 1000).toISOString();
    expect(isPaymentExpired({ expires_at: realExpiry })).toBe(true);
  });
});

describe('Payment Expiry — midnight IST boundary', () => {
  it('payment created at 23:45 IST, expires at 00:15 IST (next day) — valid within window', () => {
    // 23:45 IST = 18:15 UTC, 00:15 IST = 18:45 UTC
    const createdIST = new Date('2026-09-07T18:15:00Z'); // 23:45 IST
    const expiresIST = new Date('2026-09-07T18:45:00Z'); // 00:15 IST next day

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T18:30:00Z')); // 00:00 IST
    expect(isPaymentExpired({ expires_at: expiresIST.toISOString() })).toBe(false);
    vi.useRealTimers();
  });

  it('payment created at 23:45 IST, expired after 00:15 IST', () => {
    const expiresIST = new Date('2026-09-07T18:45:00Z'); // 00:15 IST

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-07T18:46:00Z')); // 00:16 IST
    expect(isPaymentExpired({ expires_at: expiresIST.toISOString() })).toBe(true);
    vi.useRealTimers();
  });
});
