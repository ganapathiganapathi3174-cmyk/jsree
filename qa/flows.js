// Critical UI flows: registration+QR, payment retry, wallet/topups,
// admin review modal (mobile), authorized screenshot routes, auth/protection,
// theme persistence, payment-security assertions.
// Each flow is guarded so one hang cannot stall the whole run.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { installMocks, initScript } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFromClient = createRequire(path.join(__dirname, '..', 'client', 'package.json'));
const { chromium } = requireFromClient('playwright');
const BASE = process.env.QA_BASE || 'http://localhost:5173';

const ART = path.join(__dirname, 'artifacts', 'flows');
mkdirSync(ART, { recursive: true });

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail: String(detail).slice(0, 300) });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${String(detail).slice(0, 200)}]` : ''}`);
}

async function flow(name, fn, ms = 90000) {
  console.log(`--- ${name} start`);
  const t0 = Date.now();
  try {
    await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`flow timeout ${ms}ms`)), ms))
    ]);
  } catch (e) {
    check(`${name} completed without crash`, false, e.message);
  }
  console.log(`--- ${name} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

const SHOT = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const consoleLog = [];
function wire(page, label) {
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || m.type() === 'warning') consoleLog.push(`[${label}] ${t.slice(0, 400)}`);
  });
  page.on('pageerror', (e) => consoleLog.push(`[${label}] PAGEERROR ${String(e).slice(0, 400)}`));
}

async function newPage(ctx, role, mocks = true) {
  const page = await ctx.newPage();
  await page.addInitScript(initScript(role));
  if (mocks) await installMocks(page);
  return page;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(ART, `${name}.png`), fullPage: false }).catch(() => {});
}

async function bodyText(page) {
  return page.evaluate(() => document.body.innerText);
}

const browser = await chromium.launch({ channel: 'chrome' });

// ---------------------------------------------------------------- F1: register -> QR -> approved
await flow('F1 register+QR+approved', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await newPage(ctx, 'anon');
  wire(page, 'F1');
  await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' });
  await page.fill('#register-name', 'QA Flow User');
  await page.fill('#register-email', 'qa.flow@example.test');
  await page.fill('#register-mobile', '9876543210');
  await page.fill('#register-password', 'secret123');
  await page.fill('#register-confirm-password', 'secret123');
  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('button', { name: /Basic/ }).waitFor({ state: 'visible', timeout: 10000 });
  check('F1 step2 choose plan visible', true);
  await page.getByRole('button', { name: /Basic/ }).click();
  await page.getByRole('button', { name: /Next/ }).click();
  await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 15000 });
  check('F1 step3 QR payment step shown', (await page.locator('input[type="file"]').count()) === 1);
  await shot(page, 'f1-step3-qr');
  await page.locator('input[type="file"]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: SHOT });
  await page.getByRole('button', { name: /Verify Payment/ }).click();
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  check('F1 approved -> /dashboard', page.url().includes('/dashboard'), page.url());
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('user') || '{}'));
  check('F1 user stored from API profile', stored.email === 'qa.user@example.test', stored.email);
  await shot(page, 'f1-dashboard');
  await ctx.close();
});

// ------------------------------------------------- F2: register -> rejected -> payment-status
await flow('F2 register rejected', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await newPage(ctx, 'anon');
  await page.route('**/api/payments/*/screenshot', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ success: true, data: { verification: { status: 'rejected', reason: 'Amount mismatch', inconclusive: false } } })
  }));
  wire(page, 'F2');
  await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' });
  await page.fill('#register-name', 'QA Reject User');
  await page.fill('#register-email', 'qa.reject@example.test');
  await page.fill('#register-mobile', '9876543211');
  await page.fill('#register-password', 'secret123');
  await page.fill('#register-confirm-password', 'secret123');
  await page.getByRole('button', { name: /Next/ }).click();
  await page.getByRole('button', { name: /Basic/ }).waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('button', { name: /Basic/ }).click();
  await page.getByRole('button', { name: /Next/ }).click();
  await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 15000 });
  await page.locator('input[type="file"]').setInputFiles({ name: 'proof.png', mimeType: 'image/png', buffer: SHOT });
  await page.getByRole('button', { name: /Verify Payment/ }).click();
  await page.waitForURL('**/payment-status', { timeout: 15000 });
  check('F2 rejected -> /payment-status (not dashboard)', page.url().includes('/payment-status'), page.url());
  await page.getByText(/rejected/i).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
  const body = await bodyText(page);
  const successClaim = /payment approved|registration and payment approved/i.test(body);
  const showsRejected = /reject|not approved/i.test(body);
  check('F2 backend state shown, no inferred success', !successClaim && showsRejected,
    `successClaim=${successClaim} rejected=${showsRejected} snippet=${(body.match(/.{0,70}(reject|approv).{0,70}/i) || [''])[0].replace(/\n/g, ' ')}`);
  await shot(page, 'f2-rejected-status');
  await ctx.close();
});

// ------------------------------- F3: payment-status retry (pending user, rejected payment)
await flow('F3 payment-status retry', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await newPage(ctx, 'pending');
  const apiCalls = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls.push(`${r.method()} ${r.url().replace(BASE, '')}`); });
  wire(page, 'F3');
  await page.goto(`${BASE}/payment-status`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Create New Payment Request/ }).waitFor({ state: 'visible', timeout: 10000 });
  check('F3 status page + retry CTA present', true);
  const t = await bodyText(page);
  check('F3 rejected/pending state visible', /pending|rejected/i.test(t));
  await shot(page, 'f3-status');
  await page.getByRole('button', { name: /Create New Payment Request/ }).click();
  await page.waitForSelector('input[type="file"]', { state: 'attached', timeout: 15000 });
  check('F3 QR section appears after retry', true);
  await page.locator('input[type="file"]').setInputFiles({ name: 'proof2.png', mimeType: 'image/png', buffer: SHOT });
  await page.getByRole('button', { name: /Verify Payment/ }).click();
  await page.waitForTimeout(1200);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('user') || '{}'));
  check('F3 post-verify user status comes from API profile', stored.status === 'active', `status=${stored.status} url=${page.url()}`);
  const walletCalls = apiCalls.filter(c => c.includes('wallet'));
  check('F3 no wallet/credit API call during verification', walletCalls.length === 0, walletCalls.join(','));
  await shot(page, 'f3-after-retry');
  await ctx.close();
});

// ------------------------------------------------------- F4: wallet + top-ups (user)
await flow('F4 wallet+topups', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await newPage(ctx, 'user');
  wire(page, 'F4');
  await page.goto(`${BASE}/dashboard/wallet`, { waitUntil: 'domcontentloaded' });
  await page.getByText('250').first().waitFor({ state: 'visible', timeout: 10000 });
  const wbody = await bodyText(page);
  check('F4 wallet balance rendered from API (250)', wbody.includes('250'));
  await shot(page, 'f4-wallet');
  await page.goto(`${BASE}/dashboard/topups`, { waitUntil: 'domcontentloaded' });
  await page.getByText(/Pending/i).first().waitFor({ state: 'visible', timeout: 10000 });
  const tbody = await bodyText(page);
  check('F4 top-up history rows present', /payment pending/i.test(tbody) && /completed/i.test(tbody) && /rejected/i.test(tbody),
    `snippet=${(tbody.match(/.{0,80}(Pending|Completed|Rejected).{0,80}/) || [''])[0].replace(/\n/g, ' ')}`);
  await shot(page, 'f4-topups');
  await page.goto(`${BASE}/dashboard/wallet`, { waitUntil: 'domcontentloaded' });
  await page.getByText('250').first().waitFor({ state: 'visible', timeout: 10000 });
  check('F4 wallet unchanged (no optimistic credit)', (await bodyText(page)).includes('250'));
  await ctx.close();
});

// --------------------- F5: admin payments detail + review modal on 360px mobile
await flow('F5 admin review modal (360px)', async () => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await newPage(ctx, 'admin');
  wire(page, 'F5');
  const reviewBodies = [];
  const screenshotReqs = [];
  page.on('request', (r) => {
    if (r.url().includes('/review')) reviewBodies.push(r.postDataJSON?.());
    if (r.url().includes('/screenshot')) screenshotReqs.push(r.url().replace(BASE, ''));
  });
  await page.goto(`${BASE}/admin/payments`, { waitUntil: 'domcontentloaded' });
  await page.locator('button[aria-label="View details"]').first().waitFor({ state: 'visible', timeout: 10000 });
  check('F5 payments table renders on 360px', true);
  await shot(page, 'f5-list-mobile');
  let row = page.locator('tr', { hasText: 'TXNQA445566' }).first();
  if (!(await row.count())) row = page.locator('tr', { hasText: 'Manual review' }).first();
  if (!(await row.count())) row = page.locator('tr', { hasText: 'manual review' }).first();
  if (!(await row.count())) row = page.locator('tbody tr').filter({ has: page.locator('button[aria-label="View details"]') }).nth(1);
  const approveBtn = row.locator('button[aria-label="Approve payment"]').first();
  if (await approveBtn.count()) {
    await approveBtn.click(); // opens modal AND preselects approve action
  } else {
    await row.locator('button[aria-label="View details"]').first().click();
    await page.getByText('Payment Details').first().waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('button[aria-label="Approve payment"]').last().click().catch(() => {});
  }
  await page.getByText('Payment Details').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1000); // let screenshot blob load
  const modalShot = await page.evaluate(() => {
    const img = [...document.querySelectorAll('img')].find(i => (i.src || '').startsWith('blob:'));
    return img ? { w: img.naturalWidth } : null;
  });
  check('F5 modal open + screenshot via authorized proxy', !!modalShot && modalShot.w > 0,
    `img=${JSON.stringify(modalShot)} reqs=${screenshotReqs.join(',')}`);
  await shot(page, 'f5-modal-mobile');
  // Mandatory reason: approve without reason must be blocked
  await page.locator('#review-reason').fill('');
  await page.getByRole('button', { name: /Confirm approve/i }).click();
  await page.waitForTimeout(500);
  const t1 = await bodyText(page);
  check('F5 empty reason blocks approval (client validation)', /reason is required/i.test(t1) && reviewBodies.length === 0,
    `posts=${reviewBodies.length} toast=${(t1.match(/.{0,60}reason.{0,60}/i) || [''])[0].replace(/\n/g, ' ')}`);
  // With reason
  await page.locator('#review-reason').fill('Confirmed UTR with bank statement');
  await page.getByRole('button', { name: /Confirm approve/i }).click();
  await page.waitForTimeout(900);
  check('F5 review POST carries action+reason', reviewBodies.length === 1 && reviewBodies[0]?.action === 'approve' && /bank statement/.test(reviewBodies[0]?.reason || ''),
    JSON.stringify(reviewBodies));
  const t2 = await bodyText(page);
  check('F5 approval success feedback', /approved/i.test(t2));
  await shot(page, 'f5-approved');
  await ctx.close();
});

// --------------------------------------- F6: admin top-up proof via authorized route
await flow('F6 admin topup proof proxy', async () => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await newPage(ctx, 'admin');
  wire(page, 'F6');
  const proofReqs = [];
  page.on('request', (r) => { if (r.url().includes('/screenshot')) proofReqs.push(r.url().replace(BASE, '')); });
  await page.goto(`${BASE}/admin/topups`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Open uploaded payment proof' }).first().waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('button', { name: 'Open uploaded payment proof' }).first().click();
  await page.waitForTimeout(1000);
  const imgOk = await page.evaluate(() => {
    const img = [...document.querySelectorAll('img')].find(i => (i.src || '').startsWith('blob:'));
    return img ? img.naturalWidth : 0;
  });
  check('F6 proof via /api/admin/topups/:id/screenshot only',
    imgOk > 0 && proofReqs.some(u => /\/api\/admin\/topups\/[^/]+\/screenshot/.test(u)) && !proofReqs.some(u => u.includes('storage')),
    proofReqs.join(','));
  await shot(page, 'f6-topup-proof');
  await ctx.close();
});

// --------------------------- F7: login / logout / role protection / 401 interceptor
await flow('F7 auth+protection', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const anon = await ctx.newPage();
  await installMocks(anon);
  await anon.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await anon.waitForURL('**/login', { timeout: 8000 }).catch(() => {});
  check('F7 no token -> /login', anon.url().includes('/login'), anon.url());

  await anon.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await anon.fill('#login-email', 'qa.user@example.test');
  await anon.fill('#login-password', 'secret123');
  await anon.locator('button[type="submit"]').click();
  await anon.waitForURL('**/dashboard', { timeout: 8000 });
  check('F7 login -> /dashboard', anon.url().includes('/dashboard'), anon.url());

  const adm = await newPage(ctx, 'admin');
  await adm.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await adm.waitForURL('**/admin', { timeout: 10000 }).catch(() => {});
  check('F7 admin blocked from user route', adm.url().replace(BASE, '').startsWith('/admin'), adm.url());

  const pend = await newPage(ctx, 'pending');
  await pend.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await pend.waitForURL('**/payment-status', { timeout: 10000 }).catch(() => {});
  check('F7 pending user -> /payment-status', pend.url().includes('/payment-status'), pend.url());

  // logout via navbar dropdown
  const usr = await newPage(ctx, 'user');
  await usr.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await usr.waitForTimeout(700);
  const menuBtn = usr.locator('header button:has(.lucide-chevron-down)').first();
  let logoutOk = false, logoutDetail = 'menu button not found';
  if (await menuBtn.count()) {
    await menuBtn.click();
    await usr.waitForTimeout(300);
    const lo = usr.getByRole('button', { name: /log out/i }).first();
    if (await lo.count()) {
      await lo.click();
      await usr.waitForURL('**/login', { timeout: 5000 }).catch(() => {});
      logoutOk = usr.url().includes('/login') && !(await usr.evaluate(() => !!localStorage.getItem('token')));
      logoutDetail = usr.url();
    } else logoutDetail = 'logout item not in dropdown';
  }
  check('F7 logout -> /login + token cleared', logoutOk, logoutDetail);

  const u401 = await newPage(ctx, 'user');
  await u401.route('**/api/users/profile', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Token expired' }) }));
  await u401.goto(`${BASE}/dashboard/profile`, { waitUntil: 'domcontentloaded' });
  await u401.waitForURL('**/login', { timeout: 8000 }).catch(() => {});
  check('F7 401 interceptor -> /login + token cleared',
    u401.url().includes('/login') && !(await u401.evaluate(() => !!localStorage.getItem('token'))), u401.url());
  await ctx.close();
});

// ------------------------------------------------------- F8: theme toggle persistence
await flow('F8 theme persistence', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await newPage(ctx, 'user');
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  check('F8 dark is default', await page.evaluate(() => document.documentElement.classList.contains('dark')));
  await page.locator('[aria-label="Switch to light mode"]').first().click();
  await page.waitForTimeout(300);
  const stored = await page.evaluate(() => localStorage.getItem('darkMode'));
  check('F8 toggle to light + persisted', (await page.evaluate(() => !document.documentElement.classList.contains('dark'))) && stored === 'false', stored);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(400);
  check('F8 theme survives reload', await page.evaluate(() => !document.documentElement.classList.contains('dark')));
  await shot(page, 'f8-light-theme');
  await page.locator('[aria-label="Switch to dark mode"]').first().click();
  await page.waitForTimeout(300);
  check('F8 back to dark', await page.evaluate(() => document.documentElement.classList.contains('dark')));
  await ctx.close();
});

// ------------------------------------------------- F9: payment security sweep
await flow('F9 payment security sweep', async () => {
  const tokenAppears = consoleLog.filter(l => /qa-token-(user|admin)/.test(l));
  check('F9 no bearer token in console logs', tokenAppears.length === 0, tokenAppears[0]);
  const secretish = consoleLog.filter(l => /supabase|service_role|api[_-]?key/i.test(l));
  check('F9 no secrets in console logs', secretish.length === 0, secretish[0]);
  const pageErrors = consoleLog.filter(l => l.includes('PAGEERROR'));
  check('F9 no uncaught page errors across flows', pageErrors.length === 0, pageErrors[0]);
});

await browser.close();

const failed = results.filter(r => !r.pass);
writeFileSync(path.join(__dirname, 'flows-results.json'), JSON.stringify({ results, consoleLog: consoleLog.slice(0, 500) }, null, 2));
console.log(`\n=== FLOWS: ${results.length - failed.length}/${results.length} passed ===`);
if (failed.length) console.log('FAILURES:\n' + failed.map(f => ` - ${f.name}: ${f.detail}`).join('\n'));
process.exit(failed.length ? 1 : 0);
