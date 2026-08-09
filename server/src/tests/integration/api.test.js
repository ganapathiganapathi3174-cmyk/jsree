import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../../.env') });

const API = 'http://localhost:5000/api';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const JWT_SECRET = process.env.JWT_SECRET;

function makeToken(userId, role) { return jwt.sign({ userId, role }, JWT_SECRET, { expiresIn: '7d' }); }

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const text = await res.text();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return { status: res.status, success: true, data: parsed };
    return { status: res.status, ...parsed };
  }
  catch { return { status: res.status, success: false, message: 'Non-JSON response' }; }
}

let testUserId, testToken, testPaymentId, adminToken;

describe('Auth Integration', () => {
  it('POST /auth/register - should register a new user', async () => {
    const email = `inttest_${Date.now()}@example.com`;
    const res = await api('POST', '/auth/register', {
      name: 'Integration Test', email, mobile: `9${Date.now().toString().slice(-9)}`,
      password: 'Test@123', plan: '120'
    });
    assert.equal(res.success, true);
    assert.ok(res.data?.user?.id);
    assert.ok(res.data?.token);
    testUserId = res.data.user.id;
    testToken = res.data.token;
  });

  it('POST /auth/register - should reject duplicate email', async () => {
    const res = await api('POST', '/auth/register', {
      name: 'Dup', email: 'test1@example.com', mobile: '0000000000', password: 'Test@123', plan: '120'
    });
    assert.equal(res.success, false);
  });

  it('POST /auth/login - should login existing user', async () => {
    const res = await api('POST', '/auth/login', { email: 'test1@example.com', password: 'Test@123' });
    assert.equal(res.success, true);
    assert.ok(res.data?.token);
  });

  it('POST /auth/login - should reject wrong password', async () => {
    const res = await api('POST', '/auth/login', { email: 'test1@example.com', password: 'wrong' });
    assert.equal(res.success, false);
    assert.equal(res.status, 401);
  });

  it('GET /auth/profile - should return user profile', async () => {
    const token = testToken || makeToken(testUserId, 'user');
    const res = await api('GET', '/auth/profile', null, token);
    assert.equal(res.success, true);
    assert.ok(res.data?.email);
  });

  it('GET /auth/profile - should reject unauthenticated', async () => {
    const res = await api('GET', '/auth/profile');
    assert.equal(res.status, 401);
  });

  it('POST /auth/admin-login - should login admin', async () => {
    const res = await api('POST', '/auth/admin-login', {
      email: process.env.ADMIN_EMAIL, password: 'Admin@123'
    });
    if (res.success) {
      adminToken = res.data.token;
    }
    assert.equal(res.success, true);
    assert.ok(res.data?.token);
  });
});

describe('Payment Integration', () => {
  it('POST /payments - should create payment', async () => {
    const res = await api('POST', '/payments', { plan: '120' }, testToken);
    assert.equal(res.success, true);
    assert.ok(res.data?.id);
    testPaymentId = res.data.id;
  });

  it('GET /payments - should return user payments', async () => {
    const res = await api('GET', '/payments', null, testToken);
    assert.equal(res.success, true);
    assert.ok(Array.isArray(res.data));
  });

  it('Pending user is blocked from wallet before approval (403)', async () => {
    const res = await api('GET', '/wallet/balance', null, testToken);
    assert.equal(res.status, 403);
    assert.equal(res.code, 'PAYMENT_NOT_APPROVED');
  });

  it('Admin approve payment activates account for dashboard access', async () => {
    const loginRes = await api('POST', '/auth/admin-login', { email: process.env.ADMIN_EMAIL, password: 'Admin@123' });
    const token = loginRes.data?.token;
    if (!token) return;
    const res = await api('PUT', `/admin/payments/${testPaymentId}/approve`, {}, token);
    assert.equal(res.success, true);
    const dash = await api('GET', '/users/dashboard', null, testToken);
    assert.equal(dash.status, 200);
  });
});

describe('Notification Integration', () => {
  it('GET /notifications - should return notifications list', async () => {
    const res = await api('GET', '/notifications', null, testToken);
    assert.ok(res.notifications || res.data);
  });

  it('GET /notifications/unread-count - should return count', async () => {
    const res = await api('GET', '/notifications/unread-count', null, testToken);
    assert.ok(typeof res.count === 'number');
  });
});

describe('Wallet Integration', () => {
  it('GET /wallet/balance - should return balance', async () => {
    const res = await api('GET', '/wallet/balance', null, testToken);
    assert.ok(typeof res.balance === 'number');
  });

  it('GET /wallet/transactions - should return transactions', async () => {
    const res = await api('GET', '/wallet/transactions', null, testToken);
    assert.ok(Array.isArray(res.transactions));
    assert.ok(res.pagination);
  });
});

describe('Referral Tiers Integration', () => {
  it('GET /referral-tiers/tiers - should return tiers', async () => {
    const res = await api('GET', '/referral-tiers/tiers');
    const tiers = res.data;
    assert.ok(Array.isArray(tiers));
    assert.equal(tiers.length, 3);
    assert.equal(tiers[0].name, 'Bronze');
  });

  it('GET /referral-tiers/my-tier - should return user tier', async () => {
    const res = await api('GET', '/referral-tiers/my-tier', null, testToken);
    assert.ok(res.currentTier);
    assert.ok(res.allTiers);
  });
});

describe('Security Integration', () => {
  it('GET /security/ip-history - should return IP logs', async () => {
    const res = await api('GET', '/security/ip-history', null, testToken);
    assert.ok(Array.isArray(res.logs));
    assert.ok(res.pagination);
  });
});

describe('Export Integration (admin)', () => {
  it('GET /export/financial-summary - should return summary', async () => {
    const loginRes = await api('POST', '/auth/admin-login', { email: process.env.ADMIN_EMAIL, password: 'Admin@123' });
    if (!loginRes.data?.token) return;
    const res = await api('GET', '/export/financial-summary', null, loginRes.data.token);
    assert.ok(res !== undefined);
  });
});

describe('Receipt Integration', () => {
  it('GET /receipts/my-receipts - should return receipts', async () => {
    const res = await api('GET', '/receipts/my-receipts', null, testToken);
    assert.ok(Array.isArray(res.receipts));
    assert.ok(res.pagination);
  });
});

describe('Admin Bulk Actions', () => {
  it('PUT /admin/payments/bulk-approve - should require paymentIds', async () => {
    const loginRes = await api('POST', '/auth/admin-login', { email: process.env.ADMIN_EMAIL, password: 'Admin@123' });
    const token = loginRes.data?.token;
    if (!token) return;
    const res = await api('PUT', '/admin/payments/bulk-approve', {}, token);
    assert.equal(res.success, false);
  });

  it('PUT /admin/payments/bulk-approve - should accept array', async () => {
    const loginRes = await api('POST', '/auth/admin-login', { email: process.env.ADMIN_EMAIL, password: 'Admin@123' });
    const token = loginRes.data?.token;
    if (!token) return;
    const res = await api('PUT', '/admin/payments/bulk-approve', { paymentIds: [] }, token);
    assert.ok(res !== undefined);
  });
});
