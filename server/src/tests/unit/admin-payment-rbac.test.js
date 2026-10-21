import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { generateToken } from '../../utils/helpers.js';

const { userState, adminControllerMocks } = vi.hoisted(() => {
  process.env.JWT_SECRET = 'isolated-admin-rbac-test-secret';
  const controller = () => vi.fn((_req, res) => res.json({ success: true }));
  return {
    userState: { role: 'user' },
    adminControllerMocks: {
      getDashboard: controller(),
      getUsers: controller(),
      getUserDetails: controller(),
      updateUserStatus: controller(),
      resetUserPassword: controller(),
      deleteUser: controller(),
      getPayments: controller(),
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

vi.mock('../../controllers/adminController.js', () => adminControllerMocks);
vi.mock('../../controllers/chatController.js', () => ({
  sendAdminMessage: adminControllerMocks.sendAdminMessage,
}));
vi.mock('../../services/paymentService.js', () => ({
  approvePayment: vi.fn(),
}));
vi.mock('../../services/auditService.js', () => ({ logAction: vi.fn() }));
vi.mock('../../db/supabase.js', () => ({
  supabase: {
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({ data: { id: 'user-1', role: userState.role }, error: null }),
      };
      return query;
    },
  },
}));

import adminRouter from '../../routes/admin.js';

describe('admin financial actions require an admin role', () => {
  let server;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise(resolve => server.close(resolve));
    }
    server = null;
    userState.role = 'user';
    vi.clearAllMocks();
  });

  it('rejects a regular user attempting the payment approval endpoint', async () => {
    const app = express();
    app.use('/admin', adminRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const { port } = server.address();
    const token = generateToken({ userId: 'user-1' });

    const response = await fetch(`http://127.0.0.1:${port}/admin/payments/payment-1/approve`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe('ADMIN_REQUIRED');
    expect(adminControllerMocks.approvePayment).not.toHaveBeenCalled();
  });

  it('rejects a regular user attempting the top-up review endpoint', async () => {
    const app = express();
    app.use('/admin', adminRouter);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const { port } = server.address();
    const token = generateToken({ userId: 'user-1' });

    const response = await fetch(`http://127.0.0.1:${port}/admin/topups/topup-1/review`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.code).toBe('ADMIN_REQUIRED');
    expect(adminControllerMocks.reviewTopup).not.toHaveBeenCalled();
  });
});
