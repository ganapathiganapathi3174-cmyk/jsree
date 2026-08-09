import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../../.env') });

const API = 'http://localhost:5000/api';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const text = await res.text();
  try { return { status: res.status, ...JSON.parse(text) }; }
  catch { return { status: res.status, success: false, message: 'Non-JSON response' }; }
}

let adminToken;
let created = [];

async function cleanup() {
  for (const uid of created) {
    try {
      const { data } = await supabase.from('payments').select('id, status').eq('user_id', uid);
      if (data?.[0]?.status === 'pending') {
        await api('DELETE', `/admin/payments/${data[0].id}`, null, adminToken);
      } else if (data?.[0]) {
        await supabase.from('users').update({ status: 'deleted' }).eq('id', uid);
      } else {
        await supabase.from('users').delete().eq('id', uid);
      }
    } catch { /* best effort */ }
  }
  created = [];
}

async function createPendingUser(plan = '120') {
  const email = `rule_${Date.now()}_${Math.floor(Math.random() * 9999)}@example.com`;
  const mobile = `9${Math.floor(Math.random() * 900000000 + 100000000)}`;
  const reg = await api('POST', '/auth/register', { name: 'Rule Test', email, mobile, password: 'Test@123', plan });
  assert.equal(reg.success, true);
  const { id } = reg.data.user;
  const token = reg.data.token;
  created.push(id);
  const pm = await api('POST', '/payments', { plan }, token);
  assert.equal(pm.success, true);
  return { user: reg.data.user, token, payment: pm.data, email, mobile };
}

describe('Business Rule: Payment Approval Required for Dashboard Access', () => {
  let pending;

  before(async () => {
    const login = await api('POST', '/auth/admin-login', { email: process.env.ADMIN_EMAIL, password: 'Admin@123' });
    adminToken = login.data?.token;
    pending = await createPendingUser();
  });

  after(async () => { await cleanup(); });

  it('R1. Register creates a user with status=pending', async () => {
    assert.equal(pending.user.status, 'pending');
    assert.ok(pending.payment.id);
    assert.equal(pending.payment.status, 'pending');
  });

  it('R2. Pending user is blocked from /users/dashboard (403 PAYMENT_NOT_APPROVED)', async () => {
    const res = await api('GET', '/users/dashboard', null, pending.token);
    assert.equal(res.status, 403);
    assert.equal(res.code, 'PAYMENT_NOT_APPROVED');
  });

  it('R3. Pending user is blocked from /wallet/balance (403)', async () => {
    const res = await api('GET', '/wallet/balance', null, pending.token);
    assert.equal(res.status, 403);
    assert.equal(res.code, 'PAYMENT_NOT_APPROVED');
  });

  it('R4. Pending user is blocked from /wallet/transactions (403)', async () => {
    const res = await api('GET', '/wallet/transactions', null, pending.token);
    assert.equal(res.status, 403);
    assert.equal(res.code, 'PAYMENT_NOT_APPROVED');
  });

  it('R5. Pending user is blocked from /referrals/my-referrals (403)', async () => {
    const res = await api('GET', '/referrals/my-referrals', null, pending.token);
    assert.equal(res.status, 403);
    assert.equal(res.code, 'PAYMENT_NOT_APPROVED');
  });

  it('R6. Pending user is blocked from /topups (403)', async () => {
    const res = await api('GET', '/topups', null, pending.token);
    assert.equal(res.status, 403);
    assert.equal(res.code, 'PAYMENT_NOT_APPROVED');
  });

  it('R7. Pending user is blocked from /receipts/my-receipts (403)', async () => {
    const res = await api('GET', '/receipts/my-receipts', null, pending.token);
    assert.equal(res.status, 403);
    assert.equal(res.code, 'PAYMENT_NOT_APPROVED');
  });

  it('R8. Pending user CAN still read own payment status (GET /payments)', async () => {
    const res = await api('GET', '/payments', null, pending.token);
    assert.equal(res.success, true);
    assert.ok(Array.isArray(res.data));
    assert.ok(res.data.some(p => p.id === pending.payment.id));
  });

  it('R9. Login for pending user returns 403 PAYMENT_NOT_APPROVED with payment data', async () => {
    const res = await api('POST', '/auth/login', { email: pending.email, password: 'Test@123' });
    assert.equal(res.status, 403);
    assert.equal(res.code, 'PAYMENT_NOT_APPROVED');
    assert.equal(res.data?.accountStatus, 'pending');
    assert.equal(res.data?.paymentId, pending.payment.id);
  });
});

describe('Business Rule: Admin Approval Activates Account Atomically', () => {
  let pending, adminToken2;

  before(async () => {
    const login = await api('POST', '/auth/admin-login', { email: process.env.ADMIN_EMAIL, password: 'Admin@123' });
    adminToken2 = login.data?.token;
    pending = await createPendingUser();
  });

  after(async () => { await cleanup(); });

  it('R10. Admin approve activates user (payment approved + user active + login works)', async () => {
    const res = await api('PUT', `/admin/payments/${pending.payment.id}/approve`, {}, adminToken2);
    assert.equal(res.success, true);

    const { data: user } = await supabase.from('users').select('status').eq('id', pending.user.id).single();
    assert.equal(user.status, 'active');

    const { data: payment } = await supabase.from('payments').select('status').eq('id', pending.payment.id).single();
    assert.equal(payment.status, 'approved');

    const login = await api('POST', '/auth/login', { email: pending.email, password: 'Test@123' });
    assert.equal(login.success, true);
    assert.equal(login.data.user.status, 'active');

    const dash = await api('GET', '/users/dashboard', null, pending.token);
    assert.equal(dash.status, 200);
  });
});

describe('Business Rule: Admin Delete Payment Registration', () => {
  let pending, adminToken3, target;

  before(async () => {
    const login = await api('POST', '/auth/admin-login', { email: process.env.ADMIN_EMAIL, password: 'Admin@123' });
    adminToken3 = login.data?.token;
    pending = await createPendingUser();
    target = { id: pending.payment.id, token: pending.token, email: pending.email };
  });

  after(async () => { await cleanup(); });

  it('R11. Delete without auth returns 401', async () => {
    const res = await api('DELETE', `/admin/payments/${target.id}`);
    assert.equal(res.status, 401);
  });

  it('R12. Delete by non-admin returns 403', async () => {
    const res = await api('DELETE', `/admin/payments/${target.id}`, null, pending.token);
    assert.equal(res.status, 403);
  });

  it('R13. Admin delete of pending registration removes payment + user', async () => {
    const res = await api('DELETE', `/admin/payments/${target.id}`, null, adminToken3);
    assert.equal(res.status, 200);
    assert.equal(res.success, true);

    const { data: payment } = await supabase.from('payments').select('id').eq('id', target.id).single();
    assert.equal(payment, null);

    const { data: user } = await supabase.from('users').select('id').eq('id', pending.user.id).single();
    assert.equal(user, null);

    const login = await api('POST', '/auth/login', { email: target.email, password: 'Test@123' });
    assert.equal(login.status, 401);
  });

  it('R14. Double-delete is idempotent (200, alreadyDeleted)', async () => {
    const res = await api('DELETE', `/admin/payments/${target.id}`, null, adminToken3);
    assert.equal(res.status, 200);
    assert.equal(res.data?.alreadyDeleted, true);
  });
});

describe('Business Rule: Financial History Blocks Permanent Deletion', () => {
  let pending, adminToken4;

  before(async () => {
    const login = await api('POST', '/auth/admin-login', { email: process.env.ADMIN_EMAIL, password: 'Admin@123' });
    adminToken4 = login.data?.token;
    pending = await createPendingUser();
  });

  after(async () => {
    try { await supabase.from('users').update({ status: 'deleted' }).eq('id', pending.user.id); } catch { /* ignore */ }
  });

  it('R15. Deleting an approved payment is blocked with FINANCIAL_HISTORY_EXISTS', async () => {
    const ap = await api('PUT', `/admin/payments/${pending.payment.id}/approve`, {}, adminToken4);
    assert.equal(ap.success, true);

    const res = await api('DELETE', `/admin/payments/${pending.payment.id}`, null, adminToken4);
    assert.equal(res.status, 409);
    assert.equal(res.code, 'FINANCIAL_HISTORY_EXISTS');
  });
});
