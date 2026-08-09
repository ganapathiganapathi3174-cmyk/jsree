import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

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
  try { return { status: res.status, ...JSON.parse(text) }; }
  catch { return { status: res.status, success: false, message: 'HTML response (404?)' }; }
}

let P = 0, F = 0;
function ok(n, c, d) { if (c) { P++; console.log(`  PASS  ${n}`); } else { F++; console.log(`  FAIL  ${n}: ${d||''}`); } }

async function testRegistration() {
  console.log('\n=== 1. REGISTRATION ===');
  const r1 = await api('POST', '/auth/register', { name: 'Test User 1', email: 'test1@example.com', mobile: '9999999001', password: 'Test@123', plan: '120' });
  ok('Register user 1', r1.success, JSON.stringify(r1.message||r1.errors));

  const u1 = r1.data?.user, t1 = r1.data?.token;
  ok('User 1 has referral code', u1?.referral_code?.startsWith('REF'), u1?.referral_code);
  ok('User 1 status pending', u1?.status === 'pending', u1?.status);

  const r2 = await api('POST', '/auth/register', { name: 'Test User 2', email: 'test2@example.com', mobile: '9999999002', password: 'Test@123', plan: '120', referralCode: u1.referral_code });
  ok('Register user 2 with referral', r2.success, JSON.stringify(r2.message));

  const r3 = await api('POST', '/auth/register', { name: 'Test User 3', email: 'test3@example.com', mobile: '9999999003', password: 'Test@123', plan: '500', referralCode: u1.referral_code });
  ok('Register user 3 with referral', r3.success, JSON.stringify(r3.message));

  const r4 = await api('POST', '/auth/register', { name: 'Test User 4', email: 'test4@example.com', mobile: '9999999004', password: 'Test@123', plan: '1000' });
  ok('Register user 4', r4.success, JSON.stringify(r4.message));

  const dup = await api('POST', '/auth/register', { name: 'Dup', email: 'test1@example.com', mobile: '9999999005', password: 'Test@123', plan: '120' });
  ok('Reject duplicate email', !dup.success, JSON.stringify(dup.message));

  return { u1, t1, u2: r2.data?.user, t2: r2.data?.token, u3: r3.data?.user, t3: r3.data?.token, u4: r4.data?.user, t4: r4.data?.token };
}

async function testPayment(users) {
  console.log('\n=== 2. PAYMENT ===');
  const p1 = await api('POST', '/payments', { plan: '120' }, users.t1);
  ok('Create payment', p1.success, JSON.stringify(p1.message||p1.errors));

  const dup = await api('POST', '/payments', { plan: '120' }, users.t1);
  ok('Reject duplicate pending', !dup.success, JSON.stringify(dup.message));

  return { payId: p1.data?.id };
}

async function testAdminLogin() {
  console.log('\n=== 3. ADMIN LOGIN ===');
  const r = await api('POST', '/auth/admin-login', { email: process.env.ADMIN_EMAIL, password: 'Admin@123' });
  ok('Admin login', r.success && r.data?.token, JSON.stringify(r.message));

  const bad = await api('POST', '/auth/admin-login', { email: process.env.ADMIN_EMAIL, password: 'wrong' });
  ok('Reject wrong password', !bad.success, JSON.stringify(bad.message));

  return { at: r.data?.token };
}

async function testApproval(users, at, payId) {
  console.log('\n=== 4. PAYMENT APPROVAL ===');
  const a = await api('PUT', `/admin/payments/${payId}/approve`, {}, at);
  ok('Admin approve payment', a.success, JSON.stringify(a.message));

  const { data: u } = await supabase.from('users').select('status, current_plan').eq('id', users.u1.id).single();
  ok('User 1 active', u?.status === 'active', u?.status);
  ok('User 1 plan 120', u?.current_plan === 120, u?.current_plan);
}

async function testReferral(users, at) {
  console.log('\n=== 5. REFERRAL DEACTIVATION ===');
  const p2 = await api('POST', '/payments', { plan: '120' }, users.t2);
  await api('PUT', `/admin/payments/${p2.data?.id}/approve`, {}, at);

  let { data: u1 } = await supabase.from('users').select('status').eq('id', users.u1.id).single();
  ok('Still active after 1 referral', u1?.status === 'active', u1?.status);

  const p3 = await api('POST', '/payments', { plan: '500' }, users.t3);
  await api('PUT', `/admin/payments/${p3.data?.id}/approve`, {}, at);

  ({ data: u1 } = await supabase.from('users').select('status, inactive_reason').eq('id', users.u1.id).single());
  ok('INACTIVE after 2 referrals', u1?.status === 'inactive', u1?.status);
  ok('Reason recorded', u1?.inactive_reason === 'inactive_due_to_referral_condition', u1?.inactive_reason);

  const ref = await api('POST', '/auth/register', { name: 'X', email: 'x@x.com', mobile: '9999999099', password: 'Test@123', plan: '120', referralCode: (await supabase.from('users').select('referral_code').eq('id', users.u1.id).single()).data.referral_code });
  ok('Block referral from inactive', !ref.success, JSON.stringify(ref.message));
}

async function testReactivation(users, at) {
  console.log('\n=== 6. REACTIVATION ===');
  const a = await api('PUT', `/admin/users/${users.u1.id}/activate`, {}, at);
  ok('Admin reactivates user 1', a.success, JSON.stringify(a.message));
  const { data: u } = await supabase.from('users').select('status, inactive_reason').eq('id', users.u1.id).single();
  ok('User 1 active again', u?.status === 'active', u?.status);
}

async function testPlanChange(users, at) {
  console.log('\n=== 7. PLAN CHANGE ===');
  const req = await api('POST', '/plans/change-request', { requestedPlan: '500', reason: 'Upgrade' }, users.t2);
  ok('Create plan change request', req.success, JSON.stringify(req.message));

  const { data: ub } = await supabase.from('users').select('current_plan').eq('id', users.u2.id).single();
  ok('Plan unchanged before approve', ub?.current_plan === 120, ub?.current_plan);

  const ap = await api('PUT', `/admin/plan-change-requests/${req.data?.id}/approve`, {}, at);
  ok('Admin approves plan change', ap.success, JSON.stringify(ap.message));

  const { data: ua } = await supabase.from('users').select('current_plan').eq('id', users.u2.id).single();
  ok('Plan changed to 500', ua?.current_plan === 500, ua?.current_plan);

  const req2 = await api('POST', '/plans/change-request', { requestedPlan: '1000', reason: 'Again' }, users.t3);
  const re = await api('PUT', `/admin/plan-change-requests/${req2.data?.id}/reject`, { reason: 'No' }, at);
  ok('Admin rejects plan change', re.success, JSON.stringify(re.message));
  const { data: u3 } = await supabase.from('users').select('current_plan').eq('id', users.u3.id).single();
  ok('Rejected plan unchanged', u3?.current_plan === 500, u3?.current_plan);
}

async function testChat(users, at) {
  console.log('\n=== 8. CHAT ===');
  const conv = await api('GET', '/chat/conversations', null, users.t2);
  ok('Get conversation', conv.success, JSON.stringify(conv.message));
  const convId = conv.data?.id;

  const s1 = await api('POST', '/chat/messages', { message: 'Hello admin', conversation_id: convId }, users.t2);
  ok('User sends message', s1.success, JSON.stringify(s1.message));

  const msgs = await api('GET', `/chat/messages/${convId}`, null, users.t2);
  ok('User reads messages', msgs.success && msgs.data?.length > 0, msgs.data?.length);

  const sm = await api('POST', '/chat/messages', { message: 'Hello user', conversation_id: convId }, at);
  ok('Admin sends message', sm.success, JSON.stringify(sm.message));

  const rd = await api('PUT', `/chat/read/${convId}`, null, at);
  ok('Mark read', rd.success, JSON.stringify(rd.message));

  const otherT = makeToken(users.u4.id, 'user');
  const cross = await api('GET', `/chat/messages/${convId}`, null, otherT);
  ok('BLOCK cross-user chat', !cross.success, JSON.stringify(cross.message));
}

async function testSecurity(users, at) {
  console.log('\n=== 9. SECURITY ===');
  const d = await api('GET', '/admin/dashboard', null, users.t4);
  ok('BLOCK user->admin', d.status === 403, 'status:' + d.status);
  const no = await api('GET', '/admin/dashboard', null, null);
  ok('BLOCK no token', no.status === 401, 'status:' + no.status);
  const prof = await api('GET', '/users/dashboard', null, users.t4);
  ok('User own dashboard', prof.success, JSON.stringify(prof.message));
}

async function testAudit() {
  console.log('\n=== 10. AUDIT LOGS ===');
  const { data: logs } = await supabase.from('audit_logs').select('action').order('created_at', { ascending: false }).limit(20);
  ok('Audit logs exist', logs?.length > 0, 'count:' + logs?.length);
  ok('Has register logs', logs?.some(l => l.action === 'register'));
  ok('Has payment logs', logs?.some(l => l.action.includes('payment')));
}

async function main() {
  console.log('========================================');
  console.log('  REFERRALHUB E2E TESTS');
  console.log('========================================');
  try {
    const users = await testRegistration();
    const { payId } = await testPayment(users);
    const { at } = await testAdminLogin();
    await testApproval(users, at, payId);
    await testReferral(users, at);
    await testReactivation(users, at);
    await testPlanChange(users, at);
    await testChat(users, at);
    await testSecurity(users, at);
    await testAudit();
  } catch (e) { console.error('FATAL:', e); F++; }
  console.log(`\n========================================\n  ${P} PASSED, ${F} FAILED\n========================================`);
  process.exit(F > 0 ? 1 : 0);
}
main();
