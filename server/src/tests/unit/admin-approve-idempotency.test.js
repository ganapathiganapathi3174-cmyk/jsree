import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────
// Deployment-readiness regression: admin approval is exactly-once.
//
// approvePayment must refuse a second approval of an already-approved
// registration payment (PAYMENT_NOT_PENDING) BEFORE any status update,
// UTR reservation, user activation, or wallet credit runs. Combined with
// the DB-level guards (approve_initial_payment early-return in migration
// 004, credit_wallets_atomic in 015), this is the service-layer half of
// the "registration activation + wallet credit are idempotent" gate.
// ─────────────────────────────────────────────────────────────

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../../db/supabase.js', () => ({
  supabase: supabaseMock,
  supabaseAnon: {},
  default: supabaseMock,
}));

import * as paymentService from '../../services/paymentService.js';

function paymentRow(row) {
  const chain = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({ data: row, error: null }));
  chain.update = vi.fn(() => chain);
  chain.then = undefined; // keep the chain out of await-coercion
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('paymentService.approvePayment — idempotency', () => {
  it('a second approval of an already-approved payment throws PAYMENT_NOT_PENDING with no update', async () => {
    const chain = paymentRow({ id: 'pay-1', status: 'approved', user_id: 'u1', screenshot_url: 'https://x/payments/p.png' });
    supabaseMock.from.mockReturnValue(chain);

    await expect(paymentService.approvePayment('pay-1', 'admin-1'))
      .rejects.toMatchObject({ code: 'PAYMENT_NOT_PENDING' });

    // Only the fetch ran — no update, no UTR reservation write.
    expect(chain.update).not.toHaveBeenCalled();
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
  });

  it('a second approval of a rejected payment also throws PAYMENT_NOT_PENDING', async () => {
    const chain = paymentRow({ id: 'pay-1', status: 'rejected', user_id: 'u1', screenshot_url: 'https://x/payments/p.png' });
    supabaseMock.from.mockReturnValue(chain);

    await expect(paymentService.approvePayment('pay-1', 'admin-1'))
      .rejects.toMatchObject({ code: 'PAYMENT_NOT_PENDING' });
    expect(chain.update).not.toHaveBeenCalled();
  });

  it('approvePayment still refuses an actionable payment that has no proof (no blind credit)', async () => {
    const chain = paymentRow({ id: 'pay-1', status: 'pending', user_id: 'u1', screenshot_url: null });
    supabaseMock.from.mockReturnValue(chain);

    await expect(paymentService.approvePayment('pay-1', 'admin-1'))
      .rejects.toMatchObject({ code: 'PAYMENT_PROOF_REQUIRED' });
    expect(chain.update).not.toHaveBeenCalled();
  });

  it('rejectPayment likewise refuses a non-actionable payment', async () => {
    const chain = paymentRow({ id: 'pay-1', status: 'approved', user_id: 'u1' });
    supabaseMock.from.mockReturnValue(chain);

    await expect(paymentService.rejectPayment('pay-1', 'admin-1', 'test'))
      .rejects.toMatchObject({ code: 'PAYMENT_NOT_PENDING' });
    expect(chain.update).not.toHaveBeenCalled();
  });
});
