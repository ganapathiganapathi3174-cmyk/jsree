import { describe, expect, it, vi, beforeEach } from 'vitest';

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock('../../db/supabase.js', () => ({ default: supabaseMock }));

import walletService from '../../services/walletService.js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('atomic wallet credits', () => {
  it('credits through one transaction RPC and returns its ledger result', async () => {
    const transaction = { id: 'tx-1', user_id: 'user-1', amount: 6 };
    supabaseMock.rpc.mockResolvedValue({
      data: { results: [{ transaction, newBalance: 16, credited: true }] },
      error: null,
    });

    await expect(walletService.credit('user-1', 6, 'Referral bonus', 'payment-1', 'referral_bonus'))
      .resolves.toEqual({ transaction, newBalance: 16 });

    expect(supabaseMock.rpc).toHaveBeenCalledWith('credit_wallets_atomic', {
      p_credits: [{
        user_id: 'user-1',
        amount: 6,
        description: 'Referral bonus',
        reference_id: 'payment-1',
        reference_type: 'referral_bonus',
      }],
    });
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('submits both top-up wallet entries in the same RPC call', async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        results: [
          { transaction: { id: 'sender-tx' }, newBalance: 120, credited: true },
          { transaction: { id: 'receiver-tx' }, newBalance: 120, credited: true },
        ],
      },
      error: null,
    });
    const credits = [
      { userId: 'sender-1', amount: 120, description: 'Sender credit', referenceId: 'topup-1', referenceType: 'topup' },
      { userId: 'receiver-1', amount: 120, description: 'Receiver credit', referenceId: 'topup-1', referenceType: 'topup' },
    ];

    await expect(walletService.creditBatch(credits)).resolves.toHaveLength(2);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('propagates transaction failures without attempting a balance-only update', async () => {
    const dbError = { code: 'XX000', message: 'transaction aborted' };
    supabaseMock.rpc.mockResolvedValue({ data: null, error: dbError });

    await expect(walletService.credit('user-1', 6, 'Referral bonus')).rejects.toBe(dbError);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('rejects malformed RPC results rather than returning a success-shaped fallback', async () => {
    supabaseMock.rpc.mockResolvedValue({ data: null, error: null });

    await expect(walletService.creditBatch([
      { userId: 'user-1', amount: 6, description: 'Referral bonus' },
    ])).rejects.toThrow('Atomic wallet credit returned an invalid result');
  });
});
