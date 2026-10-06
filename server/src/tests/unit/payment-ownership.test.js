import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────
// Regression: GET /payments/:paymentId/status and
// POST /payments/:paymentId/verify accepted any authenticated caller.
// Both endpoints are payment-scoped and must be owner-only — the sibling
// uploadScreenshot already enforced payment.user_id and topupController
// enforced sender/receiver/admin on its detail endpoint.
// ─────────────────────────────────────────────────────────────

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));
vi.mock('../../db/supabase.js', () => ({
  supabase: supabaseMock,
  supabaseAnon: {},
  default: supabaseMock,
}));

import * as paymentService from '../../services/paymentService.js';
import * as paymentController from '../../controllers/paymentController.js';

function paymentLookup(result) {
  const chain = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(result));
  return chain;
}

function mockRes() {
  return { status: vi.fn().mockReturnThis(), json: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('paymentService.requirePaymentOwner', () => {
  it('returns the row for the owner', async () => {
    supabaseMock.from.mockReturnValue(paymentLookup({ data: { user_id: 'u1' }, error: null }));
    await expect(paymentService.requirePaymentOwner('pay-1', { id: 'u1', role: 'user' }))
      .resolves.toEqual({ user_id: 'u1' });
  });

  it('rejects a different user with UNAUTHORIZED', async () => {
    supabaseMock.from.mockReturnValue(paymentLookup({ data: { user_id: 'owner-1' }, error: null }));
    await expect(paymentService.requirePaymentOwner('pay-1', { id: 'someone-else', role: 'user' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('allows an admin requester', async () => {
    supabaseMock.from.mockReturnValue(paymentLookup({ data: { user_id: 'owner-1' }, error: null }));
    await expect(paymentService.requirePaymentOwner('pay-1', { id: 'admin-1', role: 'admin' }))
      .resolves.toEqual({ user_id: 'owner-1' });
  });

  it('reports a missing payment as PAYMENT_NOT_FOUND', async () => {
    supabaseMock.from.mockReturnValue(paymentLookup({ data: null, error: { message: 'not found' } }));
    await expect(paymentService.requirePaymentOwner('pay-missing', { id: 'u1', role: 'user' }))
      .rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
  });
});

describe('paymentController — payment-scoped endpoints are owner-only', () => {
  it('getPaymentStatus returns 403 for another user', async () => {
    supabaseMock.from.mockReturnValue(paymentLookup({ data: { user_id: 'owner-1' }, error: null }));
    const res = mockRes();

    await paymentController.getPaymentStatus(
      { params: { paymentId: 'pay-1' }, user: { id: 'attacker', role: 'user' } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, code: 'UNAUTHORIZED' }));
  });

  it('getPaymentStatus serves the owner', async () => {
    const row = { id: 'pay-1', user_id: 'u1', status: 'pending', selected_plan: 120, expected_amount: 120 };
    supabaseMock.from.mockReturnValue(paymentLookup({ data: row, error: null }));
    const res = mockRes();

    await paymentController.getPaymentStatus(
      { params: { paymentId: 'pay-1' }, user: { id: 'u1', role: 'user' } },
      res
    );

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true, data: expect.objectContaining({ id: 'pay-1' }) });
  });

  it('verifyPaymentManual returns 403 before any verification work happens', async () => {
    supabaseMock.from.mockReturnValue(paymentLookup({ data: { user_id: 'owner-1' }, error: null }));
    const res = mockRes();

    await paymentController.verifyPaymentManual(
      { params: { paymentId: 'pay-1' }, user: { id: 'attacker', role: 'user' } },
      res
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, code: 'UNAUTHORIZED' }));
    // Only the ownership lookup ran — verifyPayment never touched the database.
    expect(supabaseMock.from).toHaveBeenCalledTimes(1);
  });
});
