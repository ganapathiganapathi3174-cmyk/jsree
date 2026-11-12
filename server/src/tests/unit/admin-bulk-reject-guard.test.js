import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { generateToken } from '../../utils/helpers.js';

// ─────────────────────────────────────────────────────────────
// bulk-reject guarded transition.
//
// The route checked payment.status === 'pending' and then issued an
// UNGUARDED update — a concurrent approval between the two steps was
// overwritten with 'rejected'. The update now carries .eq('status',
// 'pending') and a 0-row match is reported as skipped instead of
// rejected (and logs no audit entry for a transition that did not
// happen).
// ─────────────────────────────────────────────────────────────

const { supabaseState, supabaseMock, logActionMock, adminControllerMocks } = vi.hoisted(() => {
  process.env.JWT_SECRET = 'isolated-bulk-reject-test-secret';
  const controller = () => vi.fn((_req, res) => res.json({ success: true }));
  return {
    logActionMock: vi.fn(),
    supabaseMock: { from: vi.fn() },
    supabaseState: {
      role: 'admin',
      payment: { id: 'pay-1', user_id: 'user-9', status: 'pending', expected_amount: 120 },
      updateRows: [{ id: 'pay-1' }],
      paymentsFromCount: 0,
    },
    adminControllerMocks: {
      getDashboard: controller(),
      getUsers: controller(),
      getUserDetails: controller(),
      updateUserStatus: controller(),
      resetUserPassword: controller(),
      deleteUser: controller(),
      getPayments: controller(),
      getPaymentDetail: controller(),
      reviewPayment: controller(),
      getPaymentScreenshot: controller(),
      getTopupScreenshot: controller(),
      approvePayment: controller(),
      rejectPayment: controller(),
      deletePayment: controller(),
      getTopups: controller(),
      reviewTopup: controller(),
      deleteTopup: controller(),
      getPlanChangeRequests: controller(),
      approvePlanChangeRequest: controller(),
      rejectPlanChangeRequest: controller(),
      deletePlanChange: controller(),
      getInactiveUsers: controller(),
      activateUser: controller(),
      getChats: controller(),
      getChatMessages: controller(),
      markChatRead: controller(),
      sendAdminMessage: controller(),
      getAuditLogs: controller(),
    },
  };
});

vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock, supabaseAnon: {}, default: supabaseMock }));
vi.mock('../../services/auditService.js', () => ({ logAction: logActionMock }));
vi.mock('../../controllers/adminController.js', () => adminControllerMocks);
vi.mock('../../controllers/chatController.js', () => ({ sendAdminMessage: adminControllerMocks.sendAdminMessage }));
vi.mock('../../services/paymentService.js', () => ({ approvePayment: vi.fn() }));

import adminRouter from '../../routes/admin.js';

function authChain() {
  const chain = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.neq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({
    data: {
      id: 'admin-1', full_name: 'Admin', email: 'admin@test.local', mobile: '1',
      role: supabaseState.role, status: 'active', referral_code: 'ADM1',
      current_plan: '120', avatar_url: null,
    },
    error: null,
  }));
  return chain;
}

function paymentsFetchChain() {
  const chain = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve({ data: supabaseState.payment, error: null }));
  return chain;
}

function paymentsGuardedUpdateChain() {
  const chain = {};
  chain.update = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.select = vi.fn(() => Promise.resolve({ data: supabaseState.updateRows, error: null }));
  return chain;
}

supabaseMock.from.mockImplementation((table) => {
  if (table === 'users') return authChain();
  if (table === 'payments') {
    supabaseState.paymentsFromCount += 1;
    // 1st: auth already consumed users; within bulk-reject loop the first
    // payments query is the status fetch, the second is the guarded update.
    return supabaseState.paymentsFromCount % 2 === 1
      ? paymentsFetchChain()
      : paymentsGuardedUpdateChain();
  }
  throw new Error(`unexpected table: ${table}`);
});

let server;

afterEach(async () => {
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  server = null;
  supabaseState.role = 'admin';
  supabaseState.payment = { id: 'pay-1', user_id: 'user-9', status: 'pending', expected_amount: 120 };
  supabaseState.updateRows = [{ id: 'pay-1' }];
  supabaseState.paymentsFromCount = 0;
  vi.clearAllMocks();
});

async function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/admin', adminRouter);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function bulkReject(base, paymentIds) {
  const token = generateToken({ userId: 'admin-1' });
  const response = await fetch(`${base}/admin/payments/bulk-reject`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(paymentIds),
  });
  return { status: response.status, body: await response.json() };
}

describe('PUT /admin/payments/bulk-reject — guarded transition', () => {
  it('rejects a pending payment through the status guard', async () => {
    const base = await startApp();
    const { status, body } = await bulkReject(base, { paymentIds: ['pay-1'], reason: 'fraud' });

    expect(status).toBe(200);
    expect(body.data).toEqual([{ id: 'pay-1', status: 'rejected' }]);
    expect(logActionMock).toHaveBeenCalledTimes(1);
  });

  it('skips when the guarded update matches 0 rows (concurrent approval won)', async () => {
    supabaseState.updateRows = []; // the .eq('status','pending') guard matched nothing
    const base = await startApp();
    const { status, body } = await bulkReject(base, { paymentIds: ['pay-1'], reason: 'fraud' });

    expect(status).toBe(200);
    expect(body.data).toEqual([{ id: 'pay-1', status: 'skipped', reason: 'concurrent modification' }]);
    expect(logActionMock).not.toHaveBeenCalled();
  });

  it('skips a payment that is no longer pending at fetch time', async () => {
    supabaseState.payment = { id: 'pay-1', user_id: 'user-9', status: 'approved', expected_amount: 120 };
    const base = await startApp();
    const { status, body } = await bulkReject(base, { paymentIds: ['pay-1'] });

    expect(status).toBe(200);
    expect(body.data).toEqual([{ id: 'pay-1', status: 'skipped', reason: 'not pending' }]);
    expect(logActionMock).not.toHaveBeenCalled();
  });

  it('requires an admin (RBAC unchanged)', async () => {
    supabaseState.role = 'user';
    const base = await startApp();
    const token = generateToken({ userId: 'user-1' });
    const response = await fetch(`${base}/admin/payments/bulk-reject`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentIds: ['pay-1'] }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe('ADMIN_REQUIRED');
  });
});
