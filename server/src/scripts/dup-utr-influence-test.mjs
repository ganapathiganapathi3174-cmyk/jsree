import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const API = 'http://localhost:5000/api';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const RECEIVER_UPI = process.env.ADMIN_UPI_ID || 'jayarajj126-3@okicici';

function makeToken(id, role) { return jwt.sign({ userId: id, role }, process.env.JWT_SECRET, { expiresIn: '7d' }); }

async function api(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = { raw: text.substring(0,200) }; }
  return { status: res.status, ...parsed };
}

function makeScreenshot(amount, upi, utr, dateStr) {
  const readableDate = dateStr.replace(/\//g, ' / ');
  const svg = `<svg width="400" height="700" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <text x="200" y="50" text-anchor="middle" font-size="24" font-weight="bold">Payment Successful</text>
    <text x="200" y="100" text-anchor="middle" font-size="18">₹${amount}</text>
    <text x="200" y="160" text-anchor="middle" font-size="14">To: ${upi}</text>
    <text x="200" y="200" text-anchor="middle" font-size="14">UTR: ${utr}</text>
    <text x="200" y="240" text-anchor="middle" font-size="14">Date: ${readableDate}</text>
    <text x="200" y="300" text-anchor="middle" font-size="12">Transaction successful</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// Current date within ±30 min window. Real UPI screenshots show IST wall-clock
// (Asia/Kolkata, UTC+05:30), so encode the instant as its IST clock text.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const now = new Date();
const t = new Date(now.getTime() - 5 * 60 * 1000);
const ist = new Date(t.getTime() + IST_OFFSET_MS);
const dd = String(ist.getUTCDate()).padStart(2, '0');
const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
const yyyy = ist.getUTCFullYear();
const hh = String(ist.getUTCHours()).padStart(2, '0');
const mi = String(ist.getUTCMinutes()).padStart(2, '0');
const recentDate = `${dd}/${mm}/${yyyy} ${hh}:${mi}`;

async function register() {
  const e = `dup_${Date.now()}_${Math.random().toString(36).slice(2)}@x.com`;
  const r = await api('POST', '/auth/register', { name: 'Dup Test', email: e, mobile: `9${String(Date.now()).slice(-9)}`, password: 'Test@123', plan: '120' });
  if (!r.data?.user?.id) throw new Error('register failed: ' + r.message);
  const pm = await api('POST', '/payments', { plan: '120' }, r.data.token);
  return { userId: r.data.user.id, token: r.data.token, paymentId: pm.data?.id, email: e };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name} — ${detail || ''}`); }
  else { fail++; console.log(`  FAIL  ${name} — ${detail || ''}`); }
}

console.log('=== Duplicate UTR Influence Test ===');
console.log('UPI:', RECEIVER_UPI, 'amount: 120, date:', recentDate);

// Create two users/payments
const u1 = await register();
const u2 = await register();
check('user1 registered', !!u1.paymentId, u1.email);
check('user2 registered', !!u2.paymentId, u2.email);

// Same screenshot (same UTR) uploaded to both
const sameUtr = 'DUPLICATE_UTR_12345';
const buf = await makeScreenshot(120, RECEIVER_UPI, sameUtr, recentDate);
const boundary = '----b' + Date.now();
function multipart(buf) {
  const b = '----formboundary' + Date.now();
  const h = Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="screenshot"; filename="p.png"\r\nContent-Type: image/png\r\n\r\n`);
  const f = Buffer.from(`\r\n--${b}--\r\n`);
  return { b, body: Buffer.concat([h, buf, f]) };
}
const m1 = multipart(buf);
const up1 = await fetch(`${API}/payments/${u1.paymentId}/screenshot`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${u1.token}`, 'Content-Type': `multipart/form-data; boundary=${m1.b}` },
  body: m1.body,
});
const d1 = JSON.parse(await up1.text());
const m2 = multipart(buf);
const up2 = await fetch(`${API}/payments/${u2.paymentId}/screenshot`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${u2.token}`, 'Content-Type': `multipart/form-data; boundary=${m2.b}` },
  body: m2.body,
});
const d2 = JSON.parse(await up2.text());

console.log('  Payment1 decision:', d1?.data?.verification?.decision, 'reason:', d1?.data?.verification?.reason);
console.log('  Payment2 decision:', d2?.data?.verification?.decision, 'reason:', d2?.data?.verification?.reason);
check('payment1 approved (no UTR crash)', d1?.data?.verification?.decision === 'approved', d1?.data?.verification?.reason);
check('payment2 approved with duplicate UTR', d2?.data?.verification?.decision === 'approved', d2?.data?.verification?.reason);

const [{ data: p1 }, { data: p2 }] = await Promise.all([
  supabase.from('payments').select('status, transaction_id').eq('id', u1.paymentId).single(),
  supabase.from('payments').select('status, transaction_id').eq('id', u2.paymentId).single(),
]);
check('payment1 DB status approved', p1?.status === 'approved', `status=${p1?.status}`);
check('payment2 DB status approved', p2?.status === 'approved', `status=${p2?.status} utr=${p2?.transaction_id}`);

// Cleanup
await supabase.from('users').update({ status: 'deleted' }).eq('id', u1.userId);
await supabase.from('users').update({ status: 'deleted' }).eq('id', u2.userId);
await supabase.from('payments').delete().eq('user_id', u1.userId);
await supabase.from('payments').delete().eq('user_id', u2.userId);
await supabase.from('users').delete().eq('id', u1.userId);
await supabase.from('users').delete().eq('id', u2.userId);

console.log(`\n=== RESULTS: ${pass} PASS / ${fail} FAIL ===`);
process.exit(fail > 0 ? 1 : 0);
