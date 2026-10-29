// Full-site route × viewport audit.
// Usage: node qa/audit.js [--unmocked] [--viewport=360x800]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { installMocks, initScript } from './fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// playwright is installed (no-save) under client/node_modules
const requireFromClient = createRequire(path.join(__dirname, '..', 'client', 'package.json'));
const { chromium } = requireFromClient('playwright');
const BASE = process.env.QA_BASE || 'http://localhost:5173';
const UNMOCKED = process.argv.includes('--unmocked');
const onlyVp = (process.argv.find(a => a.startsWith('--viewport=')) || '').split('=')[1];

const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1440x900', width: 1440, height: 900 }
].filter(v => !onlyVp || v.name === onlyVp);

const ROUTES = [
  // [path, role, label]
  ['/', 'anon', 'landing'],
  ['/register', 'anon', 'register'],
  ['/login', 'anon', 'login'],
  ['/admin/login', 'anon', 'admin-login'],
  ['/payment-status', 'user', 'payment-status'],
  ['/definitely-not-a-route', 'user', 'not-found'],

  ['/dashboard', 'user', 'user-dashboard'],
  ['/dashboard/profile', 'user', 'user-profile'],
  ['/dashboard/payment', 'user', 'user-payment'],
  ['/dashboard/topups', 'user', 'user-topups'],
  ['/dashboard/referrals', 'user', 'user-referrals'],
  ['/dashboard/plan-change', 'user', 'user-plan-change'],
  ['/dashboard/chat', 'user', 'user-chat'],
  ['/dashboard/history', 'user', 'user-history'],
  ['/dashboard/wallet', 'user', 'user-wallet'],
  ['/dashboard/notifications', 'user', 'user-notifications'],
  ['/dashboard/receipts', 'user', 'user-receipts'],
  ['/dashboard/security', 'user', 'user-security'],

  ['/admin', 'admin', 'admin-dashboard'],
  ['/admin/users', 'admin', 'admin-users'],
  ['/admin/payments', 'admin', 'admin-payments'],
  ['/admin/topups', 'admin', 'admin-topups'],
  ['/admin/inactive-users', 'admin', 'admin-inactive-users'],
  ['/admin/plan-changes', 'admin', 'admin-plan-changes'],
  ['/admin/chat', 'admin', 'admin-chat'],
  ['/admin/audit-logs', 'admin', 'admin-audit-logs'],
  ['/admin/financial-reports', 'admin', 'admin-financial-reports'],
  ['/admin/suspicious-activity', 'admin', 'admin-suspicious-activity'],
  ['/admin/payment-settings', 'admin', 'admin-payment-settings']
];

const IGNORE_CONSOLE = [
  /favicon/i,
  /net::ERR_ABORTED.*\.map/i
];

function shouldIgnore(msg) {
  return IGNORE_CONSOLE.some(re => re.test(msg));
}

const results = [];
mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });

async function runViewport(vp) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  for (const [routePath, role, label] of ROUTES) {
    const page = await ctx.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    const failedReqs = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !shouldIgnore(m.text())) consoleErrors.push(m.text().slice(0, 300));
    });
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
    page.on('requestfailed', (r) => {
      const u = r.url();
      if (!u.includes('favicon')) failedReqs.push(`${r.failure()?.errorText} ${u.replace(BASE, '')}`.slice(0, 200));
    });

    await page.addInitScript(initScript(role));
    if (!UNMOCKED) await installMocks(page);

    let overflow = null;
    let title = '';
    try {
      await page.goto(BASE + routePath, { waitUntil: 'load', timeout: 20000 });
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(350);
      title = await page.title();
      overflow = await page.evaluate(() => {
        const de = document.scrollingElement || document.documentElement;
        const docOverflow = Math.max(0, de.scrollWidth - de.clientWidth);
        let worst = null;
        const vw = window.innerWidth;
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > vw + 1) {
            const excess = Math.round(r.right - vw);
            if (!worst || excess > worst.excess) {
              worst = { tag: el.tagName, cls: (el.className && el.className.toString().slice(0, 80)) || '', excess };
            }
          }
        }
        return { docOverflow, worst };
      });
    } catch (e) {
      pageErrors.push('NAV: ' + String(e).slice(0, 300));
    }

    const dir = path.join(__dirname, 'artifacts', vp.name);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${label}.png`), fullPage: true }).catch(() => {});

    results.push({ viewport: vp.name, path: routePath, label, role, title, overflow, consoleErrors, pageErrors, failedReqs });
    const bad = (overflow && overflow.docOverflow > 1) || consoleErrors.length || pageErrors.length;
    console.log(`${vp.name.padEnd(9)} ${routePath.padEnd(34)} ${bad ? 'ISSUES' : 'ok'}` +
      (overflow && overflow.docOverflow > 1 ? ` [overflow +${overflow.docOverflow}px: ${JSON.stringify(overflow.worst)}]` : '') +
      (consoleErrors.length ? ` [console: ${consoleErrors[0]}]` : '') +
      (pageErrors.length ? ` [pageerror: ${pageErrors[0]}]` : ''));
    await page.close();
  }
  await ctx.close();
}

// Viewports run in parallel for speed
await Promise.all(VIEWPORTS.map(runViewport));

await browser.close();
writeFileSync(path.join(__dirname, UNMOCKED ? 'results-unmocked.json' : 'results.json'), JSON.stringify(results, null, 2));

const issues = results.filter(r => (r.overflow && r.overflow.docOverflow > 1) || r.consoleErrors.length || r.pageErrors.length || r.failedReqs.length);
console.log(`\n=== ${UNMOCKED ? 'UNMOCKED' : 'MOCKED'} AUDIT: ${results.length} page loads, ${issues.length} with issues ===`);
process.exit(0);
