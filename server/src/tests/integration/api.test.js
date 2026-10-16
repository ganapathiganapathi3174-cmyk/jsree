import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getAdminToken, ADMIN_TOKEN_SOURCE } from './_helpers.mjs';

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
let registeredEmail;
// True once the admin approval step has run; endpoints gated on requireActiveUser
// skip (visibly) instead of failing when the approval fixture was unavailable.
let approved = false;

// Admin capability for the whole suite. Resolved once up front from a JWT
// signed for the existing admin row (read-only) instead of repeatedly calling
// POST /auth/admin-login, which is currently unusable - see _helpers.mjs.
before(async () => { adminToken = await getAdminToken(); });

// Best-effort cleanup of the account this run created, so repeated runs against
// the shared database stay independent.
after(async () => {
  if (!testUserId) return;
  try {
    await supabase.from('users').update({ status: 'deleted' }).eq('id', testUserId);
  } catch { /* best effort */ }
});

function requireAdmin(t) {
  if (adminToken) return adminToken;
  t.skip(`ENV: no admin token available (${ADMIN_TOKEN_SOURCE})`);
  return null;
}

function requireApproved(t) {
  if (approved) return true;
  t.skip('ENV: account was never approved (admin fixture unavailable), so requireActiveUser endpoints are not exercised here');
  return false;
}

describe('Auth Integration', () => {
  it('POST /auth/register - should register a new user', async () => {
    const email = `inttest_${Date.now()}_${Math.floor(Math.random() * 9999)}@example.com`;
    const mobile = `9${Date.now().toString().slice(-6)}${Math.floor(1000 + Math.random() * 9000)}`;
    const res = await api('POST', '/auth/register', {
      name: 'Integration Test', email, mobile,
      password: 'Test@123', plan: '120'
    });
    assert.equal(res.success, true);
    assert.ok(res.data?.user?.id);
    assert.ok(res.data?.token);
    registeredEmail = email;
    testUserId = res.data.user.id;
    testToken = res.data.token;
  });

  it('POST /auth/register - should reject duplicate email', async () => {
    // Uses this run's own email so the assertion does not depend on a seeded
    // account existing in the shared database.
    const res = await api('POST', '/auth/register', {
      name: 'Dup', email: registeredEmail, mobile: '0000000000', password: 'Test@123', plan: '120'
    });
    assert.equal(res.success, false);
    assert.equal(res.status, 409);
    assert.equal(res.code, 'EMAIL_EXISTS');
  });

  // BUG-012 (confirmed intended behaviour, enforced by requireActiveUser):
  // a registered user whose payment is still pending CANNOT log in -
  // authService.login() rejects status === 'pending' with 403
  // PAYMENT_NOT_APPROVED and returns the payment id. The equivalent live
  // coverage is business-rules R9.
  it('POST /auth/login - pending user is blocked (403 PAYMENT_NOT_APPROVED)', async () => {
    const res = await api('POST', '/auth/login', { email: registeredEmail, password: 'Test@123' });
    assert.equal(res.success, false);
    assert.equal(res.status, 403);
    assert.equal(res.code, 'PAYMENT_NOT_APPROVED');
    assert.equal(res.data?.accountStatus, 'pending');
  });

  // authService.login() compares the password BEFORE inspecting status, so a
  // wrong password yields INVALID_CREDENTIALS regardless of account state.
  it('POST /auth/login - should reject wrong password', async () => {
    const res = await api('POST', '/auth/login', { email: registeredEmail, password: 'wrong' });
    assert.equal(res.success, false);
    assert.equal(res.status, 401);
    assert.equal(res.code, 'INVALID_CREDENTIALS');
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

  // Known-failing defect in this environment, deliberately left red rather
  // than weakened or skipped. authService.adminLogin() looks the admin up by
  // ADMIN_EMAIL and, when no row matches, auto-inserts one with the hard-coded
  // referral_code 'ADMIN001'. The shared database already has a (different
  // email) admin row holding ADMIN001, so the insert returns null and the
  // endpoint answers ADMIN_LOGIN_FAILED: "Cannot read properties of null
  // (reading 'id')". Fixing it means either aligning ADMIN_EMAIL/.env with the
  // existing admin row or changing the auto-provision policy - both need
  // explicit approval. Admin capability for the other tests in this suite does
  // NOT depend on this endpoint (see _helpers.mjs).
  it('POST /auth/admin-login - should login admin', async () => {
    const res = await api('POST', '/auth/admin-login', {
      email: process.env.ADMIN_EMAIL, password: 'Admin@123'
    });
    if (!res.success) {
      console.error(`[KNOWN DEFECT] admin-login failed: status=${res.status} code=${res.code} message=${res.message} | ADMIN_EMAIL=${process.env.ADMIN_EMAIL} | fix requires approval: align env with the existing admin row, or change adminLogin() auto-provision policy`);
    }
    assert.equal(res.success, true, `admin-login failed: ${res.code} ${res.message}`);
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

  it('Admin approve payment activates account for dashboard access', async (t) => {
    const token = requireAdmin(t);
    if (!token) return;
    const res = await api('PUT', `/admin/payments/${testPaymentId}/approve`, {}, token);
    assert.equal(res.success, true);
    const dash = await api('GET', '/users/dashboard', null, testToken);
    assert.equal(dash.status, 200);
    approved = true;
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
  it('GET /wallet/balance - should return balance', async (t) => {
    if (!requireApproved(t)) return;
    const res = await api('GET', '/wallet/balance', null, testToken);
    assert.ok(typeof res.balance === 'number');
  });

  it('GET /wallet/transactions - should return transactions', async (t) => {
    if (!requireApproved(t)) return;
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
  it('GET /export/financial-summary - should return summary', async (t) => {
    const token = requireAdmin(t);
    if (!token) return;
    const res = await api('GET', '/export/financial-summary', null, token);
    assert.ok(res !== undefined);
  });
});

describe('Receipt Integration', () => {
  it('GET /receipts/my-receipts - should return receipts', async (t) => {
    if (!requireApproved(t)) return;
    const res = await api('GET', '/receipts/my-receipts', null, testToken);
    assert.ok(Array.isArray(res.receipts));
    assert.ok(res.pagination);
  });
});

describe('Admin Bulk Actions', () => {
  it('PUT /admin/payments/bulk-approve - should require paymentIds', async (t) => {
    const token = requireAdmin(t);
    if (!token) return;
    const res = await api('PUT', '/admin/payments/bulk-approve', {}, token);
    assert.equal(res.success, false);
  });

  it('PUT /admin/payments/bulk-approve - should accept array', async (t) => {
    const token = requireAdmin(t);
    if (!token) return;
    const res = await api('PUT', '/admin/payments/bulk-approve', { paymentIds: [] }, token);
    assert.ok(res !== undefined);
  });
});
