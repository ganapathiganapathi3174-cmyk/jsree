import { describe, it, expect, vi, beforeEach } from 'vitest';
import { claimTopupForReceiver, checkHasCompletedOwnTopup, computeTopupSummary, TOPUP_RECEIVED_REQUIRED } from '../../services/topupService.js';

const { supabaseMock, walletCredit } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
  walletCredit: vi.fn(),
}));

vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock }));
vi.mock('../../services/walletService.js', () => ({ default: { credit: walletCredit } }));

// Helper: build a fluent chain mock where every method returns `self`
function fluentChain(overrides = {}) {
  const c = {};
  for (const m of ['select', 'eq', 'in', 'insert', 'update', 'limit', 'order', 'maybeSingle', 'single']) {
    c[m] = vi.fn((...args) => {
      if (overrides[m]) return overrides[m](c, ...args);
      return c;
    });
  }
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

const PENDING = {
  id: 'topup-1', sender_id: 'sender-a', receiver_id: 'sponsor-b',
  amount: 120, status: 'pending_claim', created_at: '2026-08-20T10:00:00.000Z',
};
const COMPLETED = { ...PENDING, status: 'completed', completed_at: '2026-08-20T11:00:00.000Z' };
const UPDATED_ROW = { data: [{ id: 'topup-1', status: 'completed' }], error: null };
const UPDATED_EMPTY = { data: [], error: null };
const OWN_EXISTS = { data: [{ id: 'own-1' }], error: null };
const OWN_NONE = { data: [], error: null };

// ─────────────────────────────────────────────────────────────
// TWO-PHASE CLAIM FLOW
// ─────────────────────────────────────────────────────────────
describe('Two-phase claim flow', () => {
  it('TEST 1: B has NOT done own top-up -> cannot claim', async () => {
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: PENDING, error: null }) }))
      .mockReturnValueOnce(fluentChain({ limit: () => OWN_NONE }));

    await expect(claimTopupForReceiver('topup-1', 'sponsor-b')).rejects.toMatchObject({ code: 'OWN_TOPUP_REQUIRED' });
    expect(walletCredit).not.toHaveBeenCalled();
  });

  it('TEST 2: B completes own top-up -> becomes claimable', async () => {
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: PENDING, error: null }) }))
      .mockReturnValueOnce(fluentChain({ limit: () => OWN_EXISTS }))
      .mockReturnValueOnce(fluentChain({ select: () => UPDATED_ROW }))
      .mockReturnValueOnce(fluentChain({ limit: () => ({ data: [], error: null }) }));

    const result = await claimTopupForReceiver('topup-1', 'sponsor-b');
    expect(result.credited).toBe(true);
    expect(result.alreadyClaimed).toBe(false);
  });

  it('TEST 3: B claims -> wallet credited exactly once', async () => {
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: PENDING, error: null }) }))
      .mockReturnValueOnce(fluentChain({ limit: () => OWN_EXISTS }))
      .mockReturnValueOnce(fluentChain({ select: () => UPDATED_ROW }))
      .mockReturnValueOnce(fluentChain({ limit: () => ({ data: [], error: null }) }));

    const result = await claimTopupForReceiver('topup-1', 'sponsor-b');

    expect(result.credited).toBe(true);
    expect(walletCredit).toHaveBeenCalledTimes(1);
    expect(walletCredit).toHaveBeenCalledWith('sponsor-b', 120, 'Top-up claimed', 'topup-1', 'topup_receiver');
  });

  it('TEST 4: B clicks Claim again -> blocked, NO second credit', async () => {
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: COMPLETED, error: null }) }));

    const result = await claimTopupForReceiver('topup-1', 'sponsor-b');
    expect(result.credited).toBe(false);
    expect(result.alreadyClaimed).toBe(true);
    expect(walletCredit).not.toHaveBeenCalled();
  });

  it('TEST 5: A payment rejected -> no claimable top-up', async () => {
    const rejected = { ...PENDING, status: 'rejected', rejection_reason: 'UPI_MISMATCH' };
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: rejected, error: null }) }));

    await expect(claimTopupForReceiver('topup-1', 'sponsor-b')).rejects.toMatchObject({ code: 'NOT_CLAIMABLE' });
    expect(walletCredit).not.toHaveBeenCalled();
  });

  it('TEST 6: Two senders -> both tracked independently', async () => {
    const t1 = { ...PENDING, id: 'topup-1', sender_id: 'a' };
    const t2 = { ...PENDING, id: 'topup-2', sender_id: 'c' };

    // Claim topup-1
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: t1, error: null }) }))
      .mockReturnValueOnce(fluentChain({ limit: () => OWN_EXISTS }))
      .mockReturnValueOnce(fluentChain({ select: () => UPDATED_ROW }))
      .mockReturnValueOnce(fluentChain({ limit: () => ({ data: [], error: null }) }));

    const r1 = await claimTopupForReceiver('topup-1', 'sponsor-b');
    expect(r1.credited).toBe(true);

    // Claim topup-2
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: t2, error: null }) }))
      .mockReturnValueOnce(fluentChain({ limit: () => OWN_EXISTS }))
      .mockReturnValueOnce(fluentChain({ select: () => ({ data: [{ id: 'topup-2', status: 'completed' }], error: null }) }))
      .mockReturnValueOnce(fluentChain({ limit: () => ({ data: [], error: null }) }));

    const r2 = await claimTopupForReceiver('topup-2', 'sponsor-b');
    expect(r2.credited).toBe(true);
    expect(walletCredit).toHaveBeenCalledTimes(2);
  });

  it('TEST 7: B has 2 pending but NOT done own top-up -> CANNOT claim', async () => {
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: PENDING, error: null }) }))
      .mockReturnValueOnce(fluentChain({ limit: () => OWN_NONE }));

    await expect(claimTopupForReceiver('topup-1', 'sponsor-b')).rejects.toMatchObject({ code: 'OWN_TOPUP_REQUIRED' });
    expect(walletCredit).not.toHaveBeenCalled();
  });

  it('TEST 8: B completes own top-up -> pending become claimable', async () => {
    // First attempt: NOT done
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: PENDING, error: null }) }))
      .mockReturnValueOnce(fluentChain({ limit: () => OWN_NONE }));

    await expect(claimTopupForReceiver('topup-1', 'sponsor-b')).rejects.toMatchObject({ code: 'OWN_TOPUP_REQUIRED' });

    // Second attempt: NOW done
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: PENDING, error: null }) }))
      .mockReturnValueOnce(fluentChain({ limit: () => OWN_EXISTS }))
      .mockReturnValueOnce(fluentChain({ select: () => UPDATED_ROW }))
      .mockReturnValueOnce(fluentChain({ limit: () => ({ data: [], error: null }) }));

    const result = await claimTopupForReceiver('topup-1', 'sponsor-b');
    expect(result.credited).toBe(true);
  });

  it('TEST 9: Concurrent claims -> exactly ONE credit', async () => {
    // First claim wins
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: PENDING, error: null }) }))
      .mockReturnValueOnce(fluentChain({ limit: () => OWN_EXISTS }))
      .mockReturnValueOnce(fluentChain({ select: () => UPDATED_ROW }))
      .mockReturnValueOnce(fluentChain({ limit: () => ({ data: [], error: null }) }));

    const r1 = await claimTopupForReceiver('topup-1', 'sponsor-b');
    expect(r1.credited).toBe(true);

    // Second claim: topup is now completed
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: COMPLETED, error: null }) }));

    const r2 = await claimTopupForReceiver('topup-1', 'sponsor-b');
    expect(r2.credited).toBe(false);
    expect(r2.alreadyClaimed).toBe(true);
    expect(walletCredit).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────
// CLAIM ELIGIBILITY CHECK
// ─────────────────────────────────────────────────────────────
describe('checkHasCompletedOwnTopup', () => {
  it('returns true when user has completed outgoing top-up', async () => {
    supabaseMock.from.mockReturnValueOnce(fluentChain({ limit: () => OWN_EXISTS }));
    expect(await checkHasCompletedOwnTopup('u1')).toBe(true);
  });

  it('returns false when user has no completed outgoing top-ups', async () => {
    supabaseMock.from.mockReturnValueOnce(fluentChain({ limit: () => OWN_NONE }));
    expect(await checkHasCompletedOwnTopup('u1')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// COMPUTE TOPUP SUMMARY (two-phase)
// ─────────────────────────────────────────────────────────────
describe('computeTopupSummary (two-phase)', () => {
  const pending = (over) => ({ id: `p-${Math.random().toString(36).slice(2,6)}`, status: 'pending_claim', amount: 120, sender_id: 's-x', ...over });
  const completed = (over) => ({ id: `c-${Math.random().toString(36).slice(2,6)}`, status: 'completed', amount: 120, sender_id: 's-x', ...over });

  it('S1: pending + completed -> counts separately', async () => {
    supabaseMock.from.mockReturnValueOnce(fluentChain({ limit: () => OWN_NONE }));
    const s = await computeTopupSummary([pending(), completed()], 'u1');
    expect(s.receivedCompletedCount).toBe(1);
    expect(s.receivedPendingCount).toBe(1);
    expect(s.remaining).toBe(1);
    expect(s.mustTopup).toBe(false);
    expect(s.canClaim).toBe(false);
  });

  it('S2: 2 completed -> must-top-up', async () => {
    supabaseMock.from.mockReturnValueOnce(fluentChain({ limit: () => OWN_NONE }));
    const s = await computeTopupSummary([completed({ sender_id: 'a' }), completed({ sender_id: 'b' })], 'u1');
    expect(s.receivedCompletedCount).toBe(2);
    expect(s.mustTopup).toBe(true);
  });

  it('S3: only pending -> 0 completed', async () => {
    supabaseMock.from.mockReturnValueOnce(fluentChain({ limit: () => OWN_NONE }));
    const s = await computeTopupSummary([pending({ sender_id: 'a' }), pending({ sender_id: 'b' })], 'u1');
    expect(s.receivedCompletedCount).toBe(0);
    expect(s.receivedPendingCount).toBe(2);
    expect(s.remaining).toBe(2);
  });

  it('S4: rejected/created/failed never count', async () => {
    supabaseMock.from.mockReturnValueOnce(fluentChain({ limit: () => OWN_NONE }));
    const s = await computeTopupSummary([
      { status: 'rejected' }, { status: 'created' }, { status: 'failed' },
    ], 'u1');
    expect(s.receivedCompletedCount).toBe(0);
    expect(s.mustTopup).toBe(false);
  });

  it('S5: required constant is 2', () => {
    expect(TOPUP_RECEIVED_REQUIRED).toBe(2);
  });
});
