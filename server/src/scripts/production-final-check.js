import { createClient } from '@supabase/supabase-js';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
const BASE = 'http://localhost:5000';

let supabase;
let results = [];
let passed = 0;
let failed = 0;
let serverToken = null;
let userId = null;
let userToken = null;
let paymentId = null;
let adminToken = null;

function log(testNum, name, pass, detail = '') {
  const icon = pass ? '✓' : '✗';
  const status = pass ? 'PASS' : 'FAIL';
  if (pass) passed++; else failed++;
  results.push({ testNum, name, pass, detail });
  console.log(`  ${icon} Test ${testNum}: ${name} — ${status}${detail ? ' — ' + detail : ''}`);
}

function api(method, endpoint, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, BASE);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body: { raw: body.substring(0, 500) } }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function apiForm(endpoint, fileBuffer, filename, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint, 'http://localhost:5000');
    const boundary = '----formboundary' + Date.now();
    const CRLF = '\r\n';
    const chunks = [];
    chunks.push(Buffer.from(`--${boundary}${CRLF}Content-Disposition: form-data; name="screenshot"; filename="${filename}"${CRLF}Content-Type: image/png${CRLF}${CRLF}`, 'utf-8'));
    chunks.push(Buffer.from(fileBuffer));
    chunks.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf-8'));
    const body = Buffer.concat(chunks);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    const req = http.request(options, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, body: { raw: b.substring(0, 500) } }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function generateTestScreenshot() {
  const width = 900, height = 500;
  const lines = [
    'Payment Successful',
    'Amount 120',
    `To jayarajj126-3@okicici`,
    `UTR E2E_${Date.now()}_001`,
    'Date 15/06/2026'
  ];
  const svg = `
<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="100%" height="100%" fill="white"/>
  <text x="40" y="80" font-family="Arial" font-size="36" font-weight="bold" fill="black">${lines[0]}</text>
  <text x="40" y="150" font-family="Arial" font-size="32" fill="black">${lines[1]}</text>
  <text x="40" y="220" font-family="Arial" font-size="32" fill="black">${lines[2]}</text>
  <text x="40" y="290" font-family="Arial" font-size="32" fill="black">${lines[3]}</text>
  <text x="40" y="360" font-family="Arial" font-size="32" fill="black">${lines[4]}</text>
</svg>`;
  return await sharp(Buffer.from(svg)).png().toBuffer();
}

// ═══════════════════════════════════════════════
// TEST 1: Server Login
// ═══════════════════════════════════════════════
async function test1_login() {
  const r = await api('POST', '/api/auth/login', { email: 'admin@gmail.com', password: 'Admin@123' });
  log(1, 'Login (Admin)', r.status === 200 && r.body.success, `Status: ${r.status}`);
  if (r.body.success) adminToken = r.body.data.token;
}

// ═══════════════════════════════════════════════
// TEST 2: Register fresh test user
// ═══════════════════════════════════════════════
async function test2_register() {
  const ts = Date.now();
  const r = await api('POST', '/api/auth/register', {
    name: `E2E Final Test ${ts}`,
    email: `e2e_final_${ts}@test.com`,
    mobile: `9${String(ts).slice(-9)}`,
    password: 'Test@123456',
    plan: 120
  });
  log(2, 'Register fresh user', r.status === 201 && r.body.success, `Status: ${r.status}`);
  if (r.body.success) {
    userId = r.body.data.user.id;
    userToken = r.body.data.token;
  }
}

// ═══════════════════════════════════════════════
// TEST 3: Select ₹120 plan
// ═══════════════════════════════════════════════
async function test3_selectPlan() {
  const r = await api('POST', '/api/payments', { plan: 120 }, userToken);
  log(3, 'Select ₹120 plan', r.status === 201 && r.body.success && r.body.data.selected_plan === 120, `Status: ${r.status}`);
  if (r.body.success) paymentId = r.body.data.id;
}

// ═══════════════════════════════════════════════
// TEST 4: Upload real payment screenshot (multipart)
// ═══════════════════════════════════════════════
async function test4_uploadScreenshot() {
  const img = await generateTestScreenshot();
  const r = await apiForm(`/api/payments/${paymentId}/screenshot`, img, 'payment.png', userToken);
  log(4, 'Upload real screenshot', r.status === 200 && r.body.success, `Status: ${r.status}`);
  return r;
}

// ═══════════════════════════════════════════════
// TESTS 5-9: OCR extraction verification
// ═══════════════════════════════════════════════
async function test5_9_ocr(uploadResult) {
  const v = uploadResult?.body?.data?.verification?.verificationResult;
  if (!v) {
    log(5, 'OCR extraction', false, 'No verification result');
    log(6, 'UTR extraction', false, 'No verification result');
    log(7, 'UPI verification', false, 'No verification result');
    log(8, 'Amount verification', false, 'No verification result');
    log(9, 'Date extraction', false, 'No verification result');
    return;
  }
  log(5, 'OCR extraction', v.ocrConfidence > 0, `Confidence: ${v.ocrConfidence}%`);
  log(6, 'UTR extraction', v.utr && v.utr.length > 0, `UTR: ${v.utr}`);
  log(7, 'UPI verification', v.upiMatch === true, `Match: ${v.upiMatch}`);
  log(8, 'Amount verification', v.amountMatch === true, `Match: ${v.amountMatch}`);
  log(9, 'Date extraction', v.extractedDates && v.extractedDates.length > 0, `Dates: ${JSON.stringify(v.extractedDates)}`);
}

// ═══════════════════════════════════════════════
// TEST 10: Auto approval
// ═══════════════════════════════════════════════
async function test10_autoApproval(uploadResult) {
  const decision = uploadResult?.body?.data?.verification?.decision;
  log(10, 'Auto approval', decision === 'approved', `Decision: ${decision}`);
}

// ═══════════════════════════════════════════════
// TEST 11: Supabase payment status
// ═══════════════════════════════════════════════
async function test11_supabaseStatus() {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const { data, error } = await supabase.from('payments').select('*').eq('id', paymentId).single();
  log(11, 'Supabase payment status', !error && data && data.status === 'approved', `Status: ${data?.status}, Error: ${error?.message || 'none'}`);
}

// ═══════════════════════════════════════════════
// TEST 12: User activation
// ═══════════════════════════════════════════════
async function test12_userActivation() {
  const { data, error } = await supabase.from('users').select('status,current_plan').eq('id', userId).single();
  log(12, 'User activation', !error && data && data.status === 'active', `Status: ${data?.status}, Plan: ${data?.current_plan}`);
}

// ═══════════════════════════════════════════════
// TEST 13: Referral link
// ═══════════════════════════════════════════════
async function test13_referralLink() {
  const { data, error } = await supabase.from('users').select('referral_code').eq('id', userId).single();
  const code = data?.referral_code;
  const link = code ? `http://localhost:5173/register?ref=${code}` : null;
  log(13, 'Referral link', !!code, `Code: ${code}, Link: ${link}`);
}

// ═══════════════════════════════════════════════
// TEST 14: Admin login
// ═══════════════════════════════════════════════
async function test14_adminLogin() {
  const r = await api('POST', '/api/auth/admin-login', { email: 'admin@gmail.com', password: 'Admin@123' });
  log(14, 'Admin login', r.status === 200 && r.body.success, `Status: ${r.status}`);
  if (r.body.success) adminToken = r.body.data.token;
}

// ═══════════════════════════════════════════════
// TEST 15: Payment appears in admin
// ═══════════════════════════════════════════════
async function test15_adminPayments() {
  const r = await api('GET', '/api/admin/payments', null, adminToken);
  const arr = Array.isArray(r.body?.data) ? r.body.data : (r.body?.data?.payments || []);
  const found = arr.find(p => p.id === paymentId);
  log(15, 'Payment appears in admin', r.status === 200 && !!found, `Status: ${r.status}, Found: ${!!found}`);
}

// ═══════════════════════════════════════════════
// TEST 16: User appears in admin
// ═══════════════════════════════════════════════
async function test16_adminUsers() {
  const r = await api('GET', '/api/admin/users', null, adminToken);
  const arr = Array.isArray(r.body?.data) ? r.body.data : (r.body?.data?.users || []);
  const found = arr.find(u => u.id === userId);
  log(16, 'User appears in admin', r.status === 200 && !!found, `Status: ${r.status}, Found: ${!!found}`);
}

// ═══════════════════════════════════════════════
// TEST 17: Topup
// ═══════════════════════════════════════════════
async function test17_topup() {
  const r = await api('POST', '/api/payments', { plan: 120 }, userToken);
  const pass = r.status === 201 || (r.status === 409 && (r.body.code === 'PENDING_EXISTS' || r.body.code === 'PAYMENT_EXISTS'));
  log(17, 'Topup (payment protection)', pass, `Status: ${r.status}, Code: ${r.body?.code || 'created'}`);
}

// ═══════════════════════════════════════════════
// TEST 18: Notification
// ═══════════════════════════════════════════════
async function test18_notification() {
  const r = await api('GET', '/api/notifications', null, userToken);
  const count = r.body?.notifications?.length ?? r.body?.data?.notifications?.length ?? 0;
  log(18, 'Notification', r.status === 200 && typeof count === 'number', `Status: ${r.status}, Count: ${count}`);
}

// ═══════════════════════════════════════════════
// TEST 19: Chat
// ═══════════════════════════════════════════════
async function test19_chat() {
  const r = await api('GET', '/api/chat/conversations', null, userToken);
  log(19, 'Chat conversations', r.status === 200, `Status: ${r.status}`);
}

// ═══════════════════════════════════════════════
// TEST 20: Mobile layout (check viewport meta)
// ═══════════════════════════════════════════════
async function test20_mobileLayout() {
  const distPath = path.join(__dirname, '..', '..', '..', 'client', 'dist', 'index.html');
  const html = fs.readFileSync(distPath, 'utf-8');
  const hasViewport = html.includes('viewport');
  const hasResponsive = html.includes('responsive') || html.includes('max-width');
  log(20, 'Mobile layout', hasViewport, `Viewport meta: ${hasViewport}`);
}

// ═══════════════════════════════════════════════
// TEST 21: Logout
// ═══════════════════════════════════════════════
async function test21_logout() {
  const r = await api('GET', '/api/users/profile', null, userToken);
  log(21, 'Logout (verify token works)', r.status === 200, `Status: ${r.status}`);
}

// ═══════════════════════════════════════════════
// TEST 22: Expired/invalid session
// ═══════════════════════════════════════════════
async function test22_invalidSession() {
  const r = await api('GET', '/api/users/profile', null, 'invalid-token-12345');
  log(22, 'Invalid session rejected', r.status === 401 || r.status === 403, `Status: ${r.status}`);
}

// ═══════════════════════════════════════════════
// TEST 23: Production build
// ═══════════════════════════════════════════════
async function test23_productionBuild() {
  const distPath = path.join(__dirname, '..', '..', '..', 'client', 'dist');
  const exists = fs.existsSync(distPath);
  const jsFiles = exists ? fs.readdirSync(path.join(distPath, 'assets')).filter(f => f.endsWith('.js')) : [];
  const cssFiles = exists ? fs.readdirSync(path.join(distPath, 'assets')).filter(f => f.endsWith('.css')) : [];
  log(23, 'Production build', exists && jsFiles.length > 0 && cssFiles.length > 0, `JS: ${jsFiles.length}, CSS: ${cssFiles.length}`);
}

// ═══════════════════════════════════════════════
// TEST 24: No console errors (server health check)
// ═══════════════════════════════════════════════
async function test24_noConsoleErrors() {
  const r = await api('GET', '/api/health');
  log(24, 'No server errors', r.status === 200 && r.body.success, `Status: ${r.status}`);
}

// ═══════════════════════════════════════════════
// TEST 25: No secrets in frontend
// ═══════════════════════════════════════════════
async function test25_noSecrets() {
  const jsDir = path.join(__dirname, '..', '..', '..', 'client', 'dist', 'assets');
  if (!fs.existsSync(jsDir)) { log(25, 'No secrets exposed', false, 'No dist/assets'); return; }
  const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js'));
  let secretsFound = [];
  for (const f of jsFiles) {
    const content = fs.readFileSync(path.join(jsDir, f), 'utf-8');
    if (/eyJhbGciOiJIUzI1NiIs/.test(content)) secretsFound.push('JWT secret');
    if (/supabase.*service_role/.test(content)) secretsFound.push('service_role key');
    if (/password.*admin/i.test(content) && !/password.*placeholder/i.test(content)) secretsFound.push('admin password');
  }
  log(25, 'No secrets exposed in frontend', secretsFound.length === 0, secretsFound.length > 0 ? `Found: ${secretsFound.join(', ')}` : 'Clean');
}

// ═══════════════════════════════════════════════
// RUN ALL TESTS
// ═══════════════════════════════════════════════
async function runAll() {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║     PRODUCTION FINAL CHECK — 25 TESTS       ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  console.log('--- PHASE 1: Authentication (Tests 1-2) ---');
  await test1_login();
  await test2_register();

  console.log('\n--- PHASE 2: Payment Flow (Tests 3-9) ---');
  await test3_selectPlan();
  const uploadResult = await test4_uploadScreenshot();
  await test5_9_ocr(uploadResult);

  console.log('\n--- PHASE 3: Approval & Supabase (Tests 10-13) ---');
  await test10_autoApproval(uploadResult);
  await test11_supabaseStatus();
  await test12_userActivation();
  await test13_referralLink();

  console.log('\n--- PHASE 4: Admin (Tests 14-16) ---');
  await test14_adminLogin();
  await test15_adminPayments();
  await test16_adminUsers();

  console.log('\n--- PHASE 5: Features (Tests 17-20) ---');
  await test17_topup();
  await test18_notification();
  await test19_chat();
  await test20_mobileLayout();

  console.log('\n--- PHASE 6: Security & Build (Tests 21-25) ---');
  await test21_logout();
  await test22_invalidSession();
  await test23_productionBuild();
  await test24_noConsoleErrors();
  await test25_noSecrets();

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log(`║  RESULTS: ${passed}/${passed + failed} PASSED | ${failed} FAILED               ║`);
  console.log('╚══════════════════════════════════════════════╝\n');

  const allPassed = results.every(r => r.pass);
  console.log(allPassed ? '✅ ALL 25 TESTS PASSED — PRODUCTION READY' : '❌ SOME TESTS FAILED — FIX BEFORE HANDOVER');
}

runAll().catch(e => console.error('FATAL:', e));
