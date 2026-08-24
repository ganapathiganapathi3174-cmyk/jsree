import { describe, it, expect, vi, beforeEach } from 'vitest';
import { claimTopupForReceiver, checkHasCompletedOwnTopup, computeTopupSummary, TOPUP_RECEIVED_REQUIRED } from '../../services/topupService.js';

const { supabaseMock, walletCredit } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
  walletCredit: vi.fn(),
}));

vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock }));
vi.mock('../../services/walletService.js', () => ({ default: { credit: walletCredit } }));

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

const COMPLETED_TOPUP = {
  id: 'topup-1', sender_id: 'sender-a', receiver_id: 'sponsor-b',
  amount: 120, status: 'completed', created_at: '2026-08-20T10:00:00.000Z',
};
const REJECTED_TOPUP = { ...COMPLETED_TOPUP, status: 'rejected' };
const CREATED_TOPUP = { ...COMPLETED_TOPUP, status: 'created' };

describe('Claim flow (immediate completion)', () => {
  it('TEST 1: completed topup -> already claimed, no credit', async () => {
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: COMPLETED_TOPUP, error: null }) }));

    const result = await claimTopupForReceiver('topup-1', 'sponsor-b');
    expect(result.credited).toBe(false);
    expect(result.alreadyClaimed).toBe(true);
    expect(walletCredit).not.toHaveBeenCalled();
  });

  it('TEST 2: rejected topup -> NOT_CLAIMABLE', async () => {
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: REJECTED_TOPUP, error: null }) }));

    await expect(claimTopupForReceiver('topup-1', 'sponsor-b')).rejects.toMatchObject({ code: 'NOT_CLAIMABLE' });
    expect(walletCredit).not.toHaveBeenCalled();
  });

  it('TEST 3: created topup -> NOT_CLAIMABLE', async () => {
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: CREATED_TOPUP, error: null }) }));

    await expect(claimTopupForReceiver('topup-1', 'sponsor-b')).rejects.toMatchObject({ code: 'NOT_CLAIMABLE' });
    expect(walletCredit).not.toHaveBeenCalled();
  });

  it('TEST 4: wrong receiver -> Unauthorized', async () => {
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: COMPLETED_TOPUP, error: null }) }));

    await expect(claimTopupForReceiver('topup-1', 'wrong-user')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('TEST 5: topup not found -> TOPUP_NOT_FOUND', async () => {
    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: null, error: { message: 'not found' } }) }));

    await expect(claimTopupForReceiver('nonexistent', 'sponsor-b')).rejects.toMatchObject({ code: 'TOPUP_NOT_FOUND' });
  });

  it('TEST 6: two completed topups -> both return already claimed', async () => {
    const t1 = { ...COMPLETED_TOPUP, id: 'topup-1' };
    const t2 = { ...COMPLETED_TOPUP, id: 'topup-2' };

    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: t1, error: null }) }));
    const r1 = await claimTopupForReceiver('topup-1', 'sponsor-b');
    expect(r1.alreadyClaimed).toBe(true);

    supabaseMock.from
      .mockReturnValueOnce(fluentChain({ single: () => ({ data: t2, error: null }) }));
    const r2 = await claimTopupForReceiver('topup-2', 'sponsor-b');
    expect(r2.alreadyClaimed).toBe(true);
    expect(walletCredit).not.toHaveBeenCalled();
  });
});

describe('checkHasCompletedOwnTopup', () => {
  it('returns true when user has completed outgoing top-up', async () => {
    supabaseMock.from.mockReturnValueOnce(fluentChain({ limit: () => ({ data: [{ id: 'own-1' }], error: null }) }));
    expect(await checkHasCompletedOwnTopup('u1')).toBe(true);
  });

  it('returns false when user has no completed outgoing top-ups', async () => {
    supabaseMock.from.mockReturnValueOnce(fluentChain({ limit: () => ({ data: [], error: null }) }));
    expect(await checkHasCompletedOwnTopup('u1')).toBe(false);
  });
});

describe('computeTopupSummary', () => {
  const completed = (over) => ({ id: `c-${Math.random().toString(36).slice(2,6)}`, status: 'completed', amount: 120, sender_id: 's-x', ...over });

  it('S1: 2 completed -> must-top-up', async () => {
    const s = await computeTopupSummary([completed({ sender_id: 'a' }), completed({ sender_id: 'b' })], 'u1');
    expect(s.receivedCompletedCount).toBe(2);
    expect(s.mustTopup).toBe(true);
  });

  it('S2: 1 completed -> remaining 1', async () => {
    const s = await computeTopupSummary([completed()], 'u1');
    expect(s.receivedCompletedCount).toBe(1);
    expect(s.remaining).toBe(1);
    expect(s.mustTopup).toBe(false);
  });

  it('S3: 0 completed -> remaining 2', async () => {
    const s = await computeTopupSummary([], 'u1');
    expect(s.receivedCompletedCount).toBe(0);
    expect(s.remaining).toBe(2);
  });

  it('S4: rejected/created never count', async () => {
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
