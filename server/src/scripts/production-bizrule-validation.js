import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const BASE = 'http://localhost:4173/api';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const results = { pass: 0, fail: 0, tests: [] };
function assert(name, condition, detail) {
  if (condition) { results.pass++; results.tests.push({ name, status: 'PASS' }); console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { results.fail++; results.tests.push({ name, status: 'FAIL' }); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  try { return { status: res.status, ...JSON.parse(text) }; }
  catch { return { status: res.status, success: false, message: 'Non-JSON' }; }
}

const rand = () => `${Date.now()}_${Math.floor(Math.random() * 99999)}`;
let adminToken;
const cleanupIds = [];

async function adminLogin() {
  const r = await api('POST', '/auth/admin-login', { email: process.env.ADMIN_EMAIL, password: 'Admin@123' });
  adminToken = r.data?.token;
}

async function registerUser(plan = '120') {
  const email = `prod_${rand()}@example.com`;
  const mobile = `8${Math.floor(Math.random() * 900000000 + 100000000)}`;
  const reg = await api('POST', '/auth/register', { name: 'Prod Test', email, mobile, password: 'Test@123', plan });
  const user = reg.data?.user;
  const token = reg.data?.token;
  const pm = await api('POST', '/payments', { plan }, token);
  return { email, mobile, user, token, payment: pm.data };
}

async function main() {
  console.log('============================================');
  console.log('  PRODUCTION BUSINESS-RULE VALIDATION');
  console.log(`  BASE: ${BASE}`);
  console.log('============================================\n');
  await adminLogin();
  assert('admin login works', !!adminToken, 'token issued');

  // Step 4: fresh registration
  console.log('\n--- Step 4: Fresh Registration ---');
  const fresh = await registerUser();
  assert('register succeeds (201)', fresh.user?.id, fresh.email);
  assert('user status = pending', fresh.user?.status === 'pending', fresh.user?.status);
  assert('payment created', !!fresh.payment?.id, fresh.payment?.status);
  cleanupIds.push(fresh.user.id);

  // Step 5: pending -> dashboard blocked
  console.log('\n--- Step 5: Pending -> Dashboard Blocked ---');
  const d5 = await api('GET', '/users/dashboard', null, fresh.token);
  assert('dashboard 403 for pending', d5.status === 403, d5.code);
  const w5 = await api('GET', '/wallet/balance', null, fresh.token);
  assert('wallet 403 for pending', w5.status === 403, w5.code);
  const r5 = await api('GET', '/referrals/my-referrals', null, fresh.token);
  assert('referrals 403 for pending', r5.status === 403, r5.code);
  const t5 = await api('GET', '/topups', null, fresh.token);
  assert('topups 403 for pending', t5.status === 403, t5.code);
  const login5 = await api('POST', '/auth/login', { email: fresh.email, password: 'Test@123' });
  assert('login 403 for pending', login5.status === 403, `${login5.code} data.paymentId=${login5.data?.paymentId}`);
  const ps5 = await api('GET', '/payments', null, fresh.token);
  assert('pending can read own payment status', ps5.success === true, `${ps5.data?.length} payment(s)`);

  // Step 6: approval -> dashboard enabled
  console.log('\n--- Step 6: Approval -> Dashboard Enabled ---');
  const ap6 = await api('PUT', `/admin/payments/${fresh.payment.id}/approve`, {}, adminToken);
  assert('admin approve succeeds', ap6.success === true, ap6.message);
  const d6 = await api('GET', '/users/dashboard', null, fresh.token);
  assert('dashboard 200 after approval', d6.status === 200, 'enabled');
  const { data: user6 } = await supabase.from('users').select('status, referral_code').eq('id', fresh.user.id).single();
  assert('user status = active', user6?.status === 'active', user6?.status);
  const { data: pay6 } = await supabase.from('payments').select('status').eq('id', fresh.payment.id).single();
  assert('payment status = approved', pay6?.status === 'approved', pay6?.status);
  assert('referral code present', !!user6?.referral_code, user6?.referral_code);
  const { data: notif6 } = await supabase.from('notifications').select('id').eq('user_id', fresh.user.id);
  assert('approval notification created', (notif6 || []).some(n => n.id), `${(notif6 || []).length} notifications`);

  // Step 7: rejected -> dashboard blocked
  console.log('\n--- Step 7: Rejected -> Dashboard Blocked ---');
  const rej = await registerUser();
  cleanupIds.push(rej.user.id);
  const rj7 = await api('PUT', `/admin/payments/${rej.payment.id}/reject`, { reason: 'Test rejection' }, adminToken);
  assert('admin reject succeeds', rj7.success === true, rj7.message);
  const d7 = await api('GET', '/users/dashboard', null, rej.token);
  assert('dashboard 403 after rejection', d7.status === 403, d7.code);
  const w7 = await api('GET', '/wallet/balance', null, rej.token);
  assert('wallet 403 after rejection', w7.status === 403, w7.code);
  const { data: user7 } = await supabase.from('users').select('status').eq('id', rej.user.id).single();
  assert('user still pending after rejection', user7?.status === 'pending', user7?.status);
  const ps7 = await api('GET', '/payments', null, rej.token);
  const rejPay = (ps7.data || []).find(p => p.id === rej.payment.id);
  assert('rejection reason surfaced', !!rejPay?.rejection_reason, rejPay?.rejection_reason);

  // Step 8: admin delete pending registration
  console.log('\n--- Step 8: Admin Delete Pending Registration ---');
  const del = await registerUser();
  const d8 = await api('DELETE', `/admin/payments/${del.payment.id}`, {}, adminToken);
  assert('delete pending registration 200', d8.status === 200, d8.data?.message || d8.message);
  const d8b = await api('DELETE', `/admin/payments/${del.payment.id}`, {}, adminToken);
  assert('double delete idempotent', d8b.data?.alreadyDeleted === true, 'alreadyDeleted');
  const { data: user8 } = await supabase.from('users').select('id').eq('id', del.user.id).single();
  assert('user removed from DB', user8 === null, 'gone');
  const { data: pay8 } = await supabase.from('payments').select('id').eq('id', del.payment.id).single();
  assert('payment removed from DB', pay8 === null, 'gone');
  // RBAC
  const rbac = await api('DELETE', `/admin/payments/${fresh.payment.id}`, {}, fresh.token);
  assert('non-admin delete blocked 403', rbac.status === 403, rbac.code);
  const noauth = await api('DELETE', `/admin/payments/${fresh.payment.id}`);
  assert('unauthenticated delete blocked 401', noauth.status === 401, noauth.code);

  // Step 9: wallet/topup (using approved user from step 6)
  console.log('\n--- Step 9: Wallet / Topup (approved user) ---');
  const wb9 = await api('GET', '/wallet/balance', null, fresh.token);
  assert('wallet balance accessible', wb9.status === 200 && typeof wb9.balance === 'number', `balance=${wb9.balance}`);
  const wt9 = await api('GET', '/wallet/transactions', null, fresh.token);
  assert('wallet transactions accessible', wt9.status === 200 && Array.isArray(wt9.transactions), `${wt9.transactions?.length} txns`);
  const t9 = await api('GET', '/topups', null, fresh.token);
  assert('topups accessible', t9.success === true, `${t9.data?.length} topups`);

  // Step 10: referral (approved user)
  console.log('\n--- Step 10: Referral ---');
  const rc10 = await api('GET', '/referrals/my-code', null, fresh.token);
  assert('referral code endpoint works', rc10.success === true, rc10.data?.referralCode || rc10.data?.code || rc10.data?.referral_code);
  const mr10 = await api('GET', '/referrals/my-referrals', null, fresh.token);
  assert('my-referrals works', mr10.success === true, `${mr10.data?.referrals?.length || mr10.referrals?.length || 0} referrals`);
  const v10 = await api('GET', '/referrals/validate?code=XXXXXX');
  assert('referral validate endpoint responds', v10.success === true && v10.data?.valid === false, v10.data?.message || 'invalid code rejected');

  // Step 11: admin panel
  console.log('\n--- Step 11: Admin Panel ---');
  const aPay = await api('GET', '/admin/payments', null, adminToken);
  assert('admin payments list', aPay.success === true, `${aPay.data?.length} payments`);
  const aUsr = await api('GET', '/admin/users', null, adminToken);
  assert('admin users list', aUsr.success === true, `${aUsr.data?.users?.length || aUsr.data?.length} users`);
  const aStats = await api('GET', '/admin/dashboard', null, adminToken);
  assert('admin dashboard stats', aStats.status === 200 || aStats.success === true, 'available');
  const aFin = await api('GET', '/export/financial-summary', null, adminToken);
  assert('admin financial summary', aFin.status === 200 || aFin.success === true, 'available');
  const aAudit = await api('GET', '/admin/audit-logs', null, adminToken);
  assert('admin audit logs', aAudit.status === 200 || aAudit.success === true, 'available');

  // Step 15: no secrets exposed via API responses
  console.log('\n--- Step 15: No Secrets Exposed ---');
  const raw = JSON.stringify([d5, w5, ap6, d6, aPay, aUsr]);
  const secretPatterns = [/password_hash/, /SUPABASE_SERVICE_ROLE_KEY/, /service_role/, /JWT_SECRET/i];
  const leaked = secretPatterns.filter(p => p.test(raw));
  assert('no secrets in API responses', leaked.length === 0, leaked.length ? `LEAKED: ${leaked.join(',')}` : 'clean');

  // cleanup
  console.log('\n--- Cleanup ---');
  for (const uid of cleanupIds) {
    try {
      const { data } = await supabase.from('payments').select('id, status').eq('user_id', uid);
      if (data?.[0]?.status === 'pending') {
        await api('DELETE', `/admin/payments/${data[0].id}`, {}, adminToken);
      } else {
        await supabase.from('users').update({ status: 'deleted' }).eq('id', uid);
      }
    } catch { /* best effort */ }
  }
  try { await supabase.from('users').delete().eq('id', rej.user.id); } catch {}
  console.log('\n============================================');
  console.log(`  RESULTS: ${results.pass} PASSED / ${results.fail} FAILED`);
  console.log('============================================');
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
