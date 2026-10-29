import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────
// Deployment-readiness regression: authenticated screenshot proxies.
//
// After the `payments` storage bucket flips private, the ONLY supported
// preview path is the four authenticated backend streams:
//   GET /payments/:paymentId/screenshot            (owner or admin)
//   GET /topups/:topupId/proof                     (sender, receiver, or admin)
//   GET /admin/payments/:paymentId/screenshot      (admin route, owner-or-admin rule)
//   GET /admin/topups/:topupId/screenshot          (admin route, sender/receiver/admin rule)
//
// These tests pin the service-level authorization rules, the controller
// HTTP mapping (403/404/500, private no-store caching), and the guarantee
// that a storage failure surfaces a generic error instead of leaking the
// underlying storage message (which can embed project URLs/paths).
// ─────────────────────────────────────────────────────────────

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn(), storage: { from: vi.fn() } },
}));
vi.mock('../../db/supabase.js', () => ({
  supabase: supabaseMock,
  supabaseAnon: {},
  default: supabaseMock,
}));

import * as paymentService from '../../services/paymentService.js';
import * as topupService from '../../services/topupService.js';
import * as paymentController from '../../controllers/paymentController.js';
import * as topupController from '../../controllers/topupController.js';
import * as adminController from '../../controllers/adminController.js';
import { authenticateToken, requireActiveUser } from '../../middleware/auth.js';

const PUBLIC_URL = 'https://proj.supabase.co/storage/v1/object/public/payments/u1/proof.png';

function lookupChain(result) {
  const chain = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(result));
  chain.update = vi.fn(() => chain);
  return chain;
}

function storageOk(bytes = [1, 2, 3]) {
  const blob = { arrayBuffer: async () => Uint8Array.from(bytes).buffer, type: 'image/png' };
  const from = vi.fn(() => ({ download: vi.fn().mockResolvedValue({ data: blob, error: null }) }));
  supabaseMock.storage.from.mockReturnValue({ download: from().download });
  return from;
}

function storageFail() {
  const download = vi.fn().mockResolvedValue({
    data: null,
    error: { message: ' Denied: service-role-key-SUPERSECRET at https://proj.supabase.co' },
  });
  supabaseMock.storage.from.mockReturnValue({ download });
  return download;
}

function mockRes() {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), set: vi.fn(), send: vi.fn() };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── streamPaymentScreenshot (service) ───────────────────────
describe('paymentService.streamPaymentScreenshot — access control', () => {
  it('serves the payment owner', async () => {
    supabaseMock.from.mockReturnValue(lookupChain({ data: { user_id: 'u1', screenshot_url: PUBLIC_URL }, error: null }));
    storageOk();
    const out = await paymentService.streamPaymentScreenshot('pay-1', { id: 'u1', role: 'user' });
    expect(out.contentType).toBe('image/png');
    expect(out.buffer).toBeInstanceOf(Buffer);
  });

  it('serves an admin', async () => {
    supabaseMock.from.mockReturnValue(lookupChain({ data: { user_id: 'u1', screenshot_url: PUBLIC_URL }, error: null }));
    storageOk();
    await expect(paymentService.streamPaymentScreenshot('pay-1', { id: 'admin-1', role: 'admin' }))
      .resolves.toMatchObject({ contentType: 'image/png' });
  });

  it('rejects a different user with UNAUTHORIZED', async () => {
    supabaseMock.from.mockReturnValue(lookupChain({ data: { user_id: 'owner-1', screenshot_url: PUBLIC_URL }, error: null }));
    await expect(paymentService.streamPaymentScreenshot('pay-1', { id: 'attacker', role: 'user' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(supabaseMock.storage.from).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated requester (no user on the request)', async () => {
    supabaseMock.from.mockReturnValue(lookupChain({ data: { user_id: 'u1', screenshot_url: PUBLIC_URL }, error: null }));
    await expect(paymentService.streamPaymentScreenshot('pay-1', undefined))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('reports a missing payment as PAYMENT_NOT_FOUND', async () => {
    supabaseMock.from.mockReturnValue(lookupChain({ data: null, error: { message: 'not found' } }));
    await expect(paymentService.streamPaymentScreenshot('pay-x', { id: 'u1', role: 'user' }))
      .rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
  });

  it('reports a payment with no screenshot as NO_SCREENSHOT', async () => {
    supabaseMock.from.mockReturnValue(lookupChain({ data: { user_id: 'u1', screenshot_url: null }, error: null }));
    await expect(paymentService.streamPaymentScreenshot('pay-1', { id: 'u1', role: 'user' }))
      .rejects.toMatchObject({ code: 'NO_SCREENSHOT' });
  });

  it('maps a storage failure to a generic SCREENSHOT_UNAVAILABLE without leaking storage details', async () => {
    supabaseMock.from.mockReturnValue(lookupChain({ data: { user_id: 'u1', screenshot_url: PUBLIC_URL }, error: null }));
    storageFail();
    const err = await paymentService.streamPaymentScreenshot('pay-1', { id: 'u1', role: 'user' })
      .then(() => null, (e) => e);
    expect(err).toMatchObject({ code: 'SCREENSHOT_UNAVAILABLE' });
    expect(err.message).toBe('Screenshot not available');
    expect(err.message).not.toMatch(/SUPERSECRET|service-role|supabase\.co/i);
  });
});

// ── streamTopupScreenshot (service) ─────────────────────────
describe('topupService.streamTopupScreenshot — access control', () => {
  const TOPUP_URL = 'https://proj.supabase.co/storage/v1/object/public/payments/sender-1/proof.png';

  function topupLookup(row) {
    supabaseMock.from.mockReturnValue(lookupChain({ data: row, error: null }));
  }

  it('serves the sender', async () => {
    topupLookup({ sender_id: 'sender-1', receiver_id: 'recv-1', screenshot_url: TOPUP_URL });
    storageOk();
    await expect(topupService.streamTopupScreenshot('top-1', { id: 'sender-1', role: 'user' }))
      .resolves.toMatchObject({ contentType: 'image/png' });
  });

  it('serves the receiver', async () => {
    topupLookup({ sender_id: 'sender-1', receiver_id: 'recv-1', screenshot_url: TOPUP_URL });
    storageOk();
    await expect(topupService.streamTopupScreenshot('top-1', { id: 'recv-1', role: 'user' }))
      .resolves.toMatchObject({ contentType: 'image/png' });
  });

  it('serves an admin', async () => {
    topupLookup({ sender_id: 'sender-1', receiver_id: 'recv-1', screenshot_url: TOPUP_URL });
    storageOk();
    await expect(topupService.streamTopupScreenshot('top-1', { id: 'admin-1', role: 'admin' }))
      .resolves.toMatchObject({ contentType: 'image/png' });
  });

  it('rejects an unrelated user with UNAUTHORIZED before touching storage', async () => {
    topupLookup({ sender_id: 'sender-1', receiver_id: 'recv-1', screenshot_url: TOPUP_URL });
    await expect(topupService.streamTopupScreenshot('top-1', { id: 'attacker', role: 'user' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(supabaseMock.storage.from).not.toHaveBeenCalled();
  });

  it('reports a missing topup as TOPUP_NOT_FOUND', async () => {
    supabaseMock.from.mockReturnValue(lookupChain({ data: null, error: { message: 'not found' } }));
    await expect(topupService.streamTopupScreenshot('top-x', { id: 'sender-1', role: 'user' }))
      .rejects.toMatchObject({ code: 'TOPUP_NOT_FOUND' });
  });

  it('reports no proof as NO_SCREENSHOT', async () => {
    topupLookup({ sender_id: 'sender-1', receiver_id: 'recv-1', screenshot_url: null });
    await expect(topupService.streamTopupScreenshot('top-1', { id: 'sender-1', role: 'user' }))
      .rejects.toMatchObject({ code: 'NO_SCREENSHOT' });
  });

  it('maps a storage failure to a generic SCREENSHOT_UNAVAILABLE without leaking storage details', async () => {
    topupLookup({ sender_id: 'sender-1', receiver_id: 'recv-1', screenshot_url: TOPUP_URL });
    storageFail();
    const err = await topupService.streamTopupScreenshot('top-1', { id: 'sender-1', role: 'user' })
      .then(() => null, (e) => e);
    expect(err).toMatchObject({ code: 'SCREENSHOT_UNAVAILABLE' });
    expect(err.message).not.toMatch(/SUPERSECRET|service-role|supabase\.co/i);
  });
});

// ── controller HTTP mapping (all four routes) ───────────────
describe('screenshot proxy controllers — HTTP mapping', () => {
  function paymentRow(owner = 'u1') {
    return lookupChain({ data: { user_id: owner, screenshot_url: PUBLIC_URL }, error: null });
  }
  function topupRow() {
    return lookupChain({ data: { sender_id: 's1', receiver_id: 'r1', screenshot_url: PUBLIC_URL }, error: null });
  }

  it('paymentController.getPaymentScreenshot: owner gets 200 + private no-store cache', async () => {
    supabaseMock.from.mockReturnValue(paymentRow());
    storageOk();
    const res = mockRes();
    await paymentController.getPaymentScreenshot({ params: { paymentId: 'pay-1' }, user: { id: 'u1', role: 'user' } }, res);
    expect(res.set).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.send).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('paymentController.getPaymentScreenshot: another user gets 403 UNAUTHORIZED', async () => {
    supabaseMock.from.mockReturnValue(paymentRow());
    const res = mockRes();
    await paymentController.getPaymentScreenshot({ params: { paymentId: 'pay-1' }, user: { id: 'attacker', role: 'user' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, code: 'UNAUTHORIZED' }));
  });

  it('topupController.getTopupProof: sender gets 200', async () => {
    supabaseMock.from.mockReturnValue(topupRow());
    storageOk();
    const res = mockRes();
    await topupController.getTopupProof({ params: { topupId: 'top-1' }, user: { id: 's1', role: 'user' } }, res);
    expect(res.send).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('topupController.getTopupProof: unrelated user gets 403', async () => {
    supabaseMock.from.mockReturnValue(topupRow());
    const res = mockRes();
    await topupController.getTopupProof({ params: { topupId: 'top-1' }, user: { id: 'attacker', role: 'user' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it('adminController.getPaymentScreenshot: admin gets 200, non-owner non-admin gets 403', async () => {
    supabaseMock.from.mockReturnValue(paymentRow());
    storageOk();
    const okRes = mockRes();
    await adminController.getPaymentScreenshot({ params: { paymentId: 'pay-1' }, user: { id: 'admin-1', role: 'admin' } }, okRes);
    expect(okRes.send).toHaveBeenCalled();

    supabaseMock.from.mockReturnValue(paymentRow());
    const denyRes = mockRes();
    await adminController.getPaymentScreenshot({ params: { paymentId: 'pay-1' }, user: { id: 'stranger', role: 'user' } }, denyRes);
    expect(denyRes.status).toHaveBeenCalledWith(403);
  });

  it('adminController.getTopupScreenshot: admin gets 200, stranger gets 403', async () => {
    supabaseMock.from.mockReturnValue(topupRow());
    storageOk();
    const okRes = mockRes();
    await adminController.getTopupScreenshot({ params: { topupId: 'top-1' }, user: { id: 'admin-1', role: 'admin' } }, okRes);
    expect(okRes.send).toHaveBeenCalled();

    supabaseMock.from.mockReturnValue(topupRow());
    const denyRes = mockRes();
    await adminController.getTopupScreenshot({ params: { topupId: 'top-1' }, user: { id: 'stranger', role: 'user' } }, denyRes);
    expect(denyRes.status).toHaveBeenCalledWith(403);
  });

  it('storage failure returns a generic 404 (SCREENSHOT_UNAVAILABLE) and never echoes the storage error', async () => {
    supabaseMock.from.mockReturnValue(paymentRow());
    storageFail();
    const res = mockRes();
    await paymentController.getPaymentScreenshot({ params: { paymentId: 'pay-1' }, user: { id: 'u1', role: 'user' } }, res);
    // Controllers intentionally map SCREENSHOT_UNAVAILABLE to 404 so a
    // storage-side failure is indistinguishable from "no screenshot".
    expect(res.status).toHaveBeenCalledWith(404);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('SCREENSHOT_UNAVAILABLE');
    expect(JSON.stringify(body)).not.toMatch(/SUPERSECRET|service-role/i);
  });

  it('missing payment returns 404, not 500 (no existence leak via status)', async () => {
    supabaseMock.from.mockReturnValue(lookupChain({ data: null, error: { message: 'not found' } }));
    const res = mockRes();
    await paymentController.getPaymentScreenshot({ params: { paymentId: 'pay-x' }, user: { id: 'u1', role: 'user' } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ── route middleware: unauthenticated + pending-user gates ──
describe('route-level gates on the screenshot proxies', () => {
  it('authenticateToken rejects a missing Authorization header with 401 TOKEN_REQUIRED', async () => {
    const res = mockRes();
    const next = vi.fn();
    await authenticateToken({ headers: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_REQUIRED' }));
  });

  it('authenticateToken rejects a malformed token with 401 TOKEN_INVALID', async () => {
    const res = mockRes();
    const next = vi.fn();
    await authenticateToken({ headers: { authorization: 'Bearer not-a-real-token' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TOKEN_INVALID' }));
  });

  it('requireActiveUser blocks a pending user from the top-up proof route with 403', async () => {
    const res = mockRes();
    const next = vi.fn();
    requireActiveUser({ user: { id: 'u1', role: 'user', status: 'pending' } }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAYMENT_NOT_APPROVED' }));
  });

  it('requireActiveUser lets an active user and an admin through', () => {
    const next = vi.fn();
    requireActiveUser({ user: { id: 'u1', role: 'user', status: 'active' } }, mockRes(), next);
    requireActiveUser({ user: { id: 'a1', role: 'admin', status: 'active' } }, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
