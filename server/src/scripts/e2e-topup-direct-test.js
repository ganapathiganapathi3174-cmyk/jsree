import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const RECEIVER_UPI = process.env.ADMIN_UPI_ID || 'jayarajj126-3@okicici';

const results = { pass: 0, fail: 0, tests: [] };
function assert(name, condition, detail) {
  if (condition) { results.pass++; results.tests.push({ name, status: 'PASS', detail }); console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`); }
  else { results.fail++; results.tests.push({ name, status: 'FAIL', detail }); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

function istWallClock(ms, useComma) {
  const ist = new Date(ms + 5.5 * 60 * 60 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = ist.getUTCFullYear();
  const h24 = ist.getUTCHours();
  const h12 = String(h24 % 12 || 12).padStart(2, '0');
  const mi = String(ist.getUTCMinutes()).padStart(2, '0');
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  return useComma
    ? `${dd}/${mm}/${yyyy}, ${h12}:${mi} ${ampm}`
    : `${dd}/${mm}/${yyyy} ${h12}:${mi} ${ampm}`;
}

async function createRealScreenshot(amount, upi, utr, dateStr) {
  const svg = `<svg width="600" height="900" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <text x="300" y="80" text-anchor="middle" font-size="36" font-weight="bold" fill="#333">Payment Successful</text>
    <line x1="60" y1="110" x2="540" y2="110" stroke="#ccc" stroke-width="2"/>
    <text x="60" y="170" font-size="24" fill="#444">Amount</text>
    <text x="540" y="170" text-anchor="end" font-size="30" font-weight="bold" fill="#333">Rs. ${amount}</text>
    <line x1="60" y1="200" x2="540" y2="200" stroke="#eee" stroke-width="2"/>
    <text x="60" y="260" font-size="24" fill="#444">To</text>
    <text x="540" y="260" text-anchor="end" font-size="20" fill="#333">${upi}</text>
    <line x1="60" y1="290" x2="540" y2="290" stroke="#eee" stroke-width="2"/>
    <text x="60" y="350" font-size="24" fill="#444">UTR</text>
    <text x="540" y="350" text-anchor="end" font-size="20" fill="#333">${utr}</text>
    <line x1="60" y1="380" x2="540" y2="380" stroke="#eee" stroke-width="2"/>
    <text x="60" y="440" font-size="24" fill="#444">Date</text>
    <text x="540" y="440" text-anchor="end" font-size="20" fill="#333">${dateStr}</text>
    <line x1="60" y1="470" x2="540" y2="470" stroke="#eee" stroke-width="2"/>
    <text x="300" y="560" text-anchor="middle" font-size="20" fill="#999">UPI Transaction</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function multipart(fieldName, buffer, filename, mime, fields = {}) {
  const boundary = '----TopupE2E' + Date.now() + Math.random().toString(36).slice(2);
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`));
  parts.push(buffer);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function multipartFields(fields) {
  const boundary = '----TopupE2E' + Date.now() + Math.random().toString(36).slice(2);
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function api(base, method, path, { token, body, headers } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
    body,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function activateUser(userId) {
  const { error } = await supabase.from('users').update({ status: 'active' }).eq('id', userId);
  if (error) console.log('  activate error:', error.message);
}

async function main() {
  console.log('========================================');
  console.log('  DIRECT SPONSOR TOP-UP E2E (PORT 5099)');
  console.log('========================================\n');

  const RUN = Date.now();
  const { spawn } = await import('child_process');
  const serverProc = spawn('node', ['src/index.js'], {
    cwd: join(__dirname, '../..'),
    env: { ...process.env, PORT: '5099' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let serverOutput = '';
  serverProc.stdout.on('data', (d) => (serverOutput += d.toString()));
  serverProc.stderr.on('data', (d) => (serverOutput += d.toString()));

  await new Promise((resolve) => setTimeout(resolve, 12000));
  assert('server started', serverOutput.includes('Server running'), serverOutput.substring(0, 200));

  const BASE = 'http://localhost:5099/api';
  const utr1 = `E2E${RUN}A`;   // A's approved top-up UTR
  const utrBad = `E2E${RUN}B`; // wrong-amount/UPI run
  const utr2 = `E2E${RUN}C`;   // B's approved top-up UTR
  const dateStr = istWallClock(Date.now() - 2 * 60 * 1000, true);

  const usersToClean = [];
  const topupsToClean = [];

  try {
    // ─────────────────────────────────────────────
    // SETUP: sponsor + two downline users (same sponsor)
    // ─────────────────────────────────────────────
    const emailS = `e2e_sp_${RUN}@test.com`;
    const emailA = `e2e_a_${RUN}@test.com`;
    const emailB = `e2e_b_${RUN}@test.com`;
    const mobileS = `9${RUN.toString().slice(-9)}`;
    const mobileA = `8${RUN.toString().slice(-9)}`;
    const mobileB = `7${RUN.toString().slice(-9)}`;

    const regS = await api(BASE, 'POST', '/auth/register', { body: JSON.stringify({ name: 'Sponsor E2E', email: emailS, mobile: mobileS, password: 'Test@123', plan: '120' }), headers: { 'Content-Type': 'application/json' } });
    assert('sponsor registers', regS.status === 201, JSON.stringify(regS.json).substring(0, 120));
    const sponsorToken = regS.json.data?.token;
    const sponsorId = regS.json.data?.user?.id;
    await activateUser(sponsorId);
    usersToClean.push(sponsorId);

    const { data: sponsorRow } = await supabase.from('users').select('referral_code').eq('id', sponsorId).single();
    const sponsorCode = sponsorRow?.referral_code;
    assert('sponsor has referral code', !!sponsorCode, sponsorCode);

    const regA = await api(BASE, 'POST', '/auth/register', { body: JSON.stringify({ name: 'User A E2E', email: emailA, mobile: mobileA, password: 'Test@123', plan: '120', referralCode: sponsorCode }), headers: { 'Content-Type': 'application/json' } });
    const tokenA = regA.json.data?.token;
    const userAId = regA.json.data?.user?.id;
    assert('user A registers under sponsor', regA.status === 201, userAId);
    await activateUser(userAId);
    usersToClean.push(userAId);

    const regB = await api(BASE, 'POST', '/auth/register', { body: JSON.stringify({ name: 'User B E2E', email: emailB, mobile: mobileB, password: 'Test@123', plan: '120', referralCode: sponsorCode }), headers: { 'Content-Type': 'application/json' } });
    const tokenB = regB.json.data?.token;
    const userBId = regB.json.data?.user?.id;
    assert('user B registers under sponsor', regB.status === 201, userBId);
    await activateUser(userBId);
    usersToClean.push(userBId);

    // ─────────────────────────────────────────────
    // STEP 0: no pending top-up exists yet (the exact old blocker)
    // ─────────────────────────────────────────────
    const top0 = await api(BASE, 'GET', '/topups', { token: tokenA });
    assert('GET /topups works for A', top0.status === 200, JSON.stringify(top0.json).substring(0, 200));
    const pendingBefore = (top0.json.data || []).filter((t) => t.sender_id === userAId && ['created', 'payment_pending'].includes(t.status));
    assert('NO pending top-up required before A sends', pendingBefore.length === 0, `pending=${pendingBefore.length}`);
    assert('A summary: 0 received completed', top0.json.summary?.receivedCompletedCount === 0, JSON.stringify(top0.json.summary));
    assert('A summary: sponsor resolved', top0.json.summary?.sponsorId === sponsorId, `sponsorId=${top0.json.summary?.sponsorId}`);

    // ─────────────────────────────────────────────
    // STEP 1: DIRECT top-up with NO pre-existing request -> approved + credited + count 1
    // ─────────────────────────────────────────────
    const shot1 = await createRealScreenshot(120, RECEIVER_UPI, utr1, dateStr);
    const up1 = multipart('screenshot', shot1, 'proof1.png', 'image/png', { amount: '120' });
    const r1 = await api(BASE, 'POST', '/topups/direct', { token: tokenA, body: up1.body, headers: { 'Content-Type': up1.contentType } });
    assert('direct top-up #1 approved + credited', r1.status === 200 && r1.json.data?.credited === true, `status=${r1.status} credited=${r1.json.data?.credited} msg=${r1.json.message}`);
    const topup1Id = r1.json.data?.topupId;
    topupsToClean.push(topup1Id);

    const { data: row1 } = await supabase.from('topups').select('*').eq('id', topup1Id).single();
    assert('top-up #1 receiver = sponsor', row1?.receiver_id === sponsorId, `receiver=${row1?.receiver_id}`);
    assert('top-up #1 status = completed', row1?.status === 'completed', row1?.status);
    const { data: wtx1 } = await supabase.from('wallet_transactions').select('id').eq('reference_id', topup1Id).eq('reference_type', 'topup');
    assert('top-up #1 credited exactly once', (wtx1 || []).length === 1, `txn=${(wtx1 || []).length}`);

    const s1 = await api(BASE, 'GET', '/topups', { token: sponsorToken });
    assert('sponsor received-completed count = 1', s1.json.summary?.receivedCompletedCount === 1, JSON.stringify(s1.json.summary));

    // ─────────────────────────────────────────────
    // STEP 2: rejected top-up (wrong UPI) -> NOT counted
    // ─────────────────────────────────────────────
    const shotBad = await createRealScreenshot(500, 'wrong@upi', utrBad, dateStr);
    const upBad = multipart('screenshot', shotBad, 'bad.png', 'image/png', { amount: '500' });
    const rBad = await api(BASE, 'POST', '/topups/direct', { token: tokenA, body: upBad.body, headers: { 'Content-Type': upBad.contentType } });
    assert('bad-UPI top-up REJECTED', rBad.json.data?.credited === false, `msg=${rBad.json.message}`);
    const badId = rBad.json.data?.topupId;
    topupsToClean.push(badId);
    const s2 = await api(BASE, 'GET', '/topups', { token: sponsorToken });
    assert('rejected top-up does NOT count', s2.json.summary?.receivedCompletedCount === 1, `count=${s2.json.summary?.receivedCompletedCount}`);

    // ─────────────────────────────────────────────
    // STEP 3: pending (no screenshot) -> created, NOT counted
    // ─────────────────────────────────────────────
    const fieldsReq = multipartFields({ amount: '120' });
    const r3 = await api(BASE, 'POST', '/topups/direct', {
      token: tokenA,
      body: fieldsReq.body,
      headers: { 'Content-Type': fieldsReq.contentType },
    });
    // No screenshot field actually sent -> server treats file as absent -> creates pending record.
    assert('direct top-up without screenshot returns 201 created', r3.status === 201 && r3.json.data?.topupId, `status=${r3.status} msg=${r3.json.message}`);
    topupsToClean.push(r3.json.data?.topupId);
    const s3 = await api(BASE, 'GET', '/topups', { token: sponsorToken });
    assert('pending (created) top-up does NOT count', s3.json.summary?.receivedCompletedCount === 1, `count=${s3.json.summary?.receivedCompletedCount}`);

    // ─────────────────────────────────────────────
    // STEP 4: duplicate UTR re-submission -> rejected DUPLICATE_UTR, no double credit
    // The pending record from step 3 is RE-USED, so this also proves reuse.
    // ─────────────────────────────────────────────
    const shotDup = await createRealScreenshot(120, RECEIVER_UPI, utr1, dateStr);
    const upDup = multipart('screenshot', shotDup, 'dup.png', 'image/png', { amount: '120' });
    const r4 = await api(BASE, 'POST', '/topups/direct', { token: tokenA, body: upDup.body, headers: { 'Content-Type': upDup.contentType } });
    assert('duplicate-UTR top-up rejected', r4.json.data?.credited === false, `msg=${r4.json.message}`);
    const dupId = r4.json.data?.topupId;
    topupsToClean.push(dupId);
    assert('duplicate-UTR reuses the pending record id', dupId === r3.json.data?.topupId, `dupId=${dupId} pendingId=${r3.json.data?.topupId}`);
    const { data: dupRow } = await supabase.from('topups').select('status').eq('id', dupId).single();
    assert('pending record rolled to rejected (no credit)', dupRow?.status === 'rejected', dupRow?.status);
    const { data: wtxDup } = await supabase.from('wallet_transactions').select('id').eq('reference_id', dupId).eq('reference_type', 'topup');
    assert('duplicate-UTR top-up NOT credited', (wtxDup || []).length === 0, `txn=${(wtxDup || []).length}`);
    const s4 = await api(BASE, 'GET', '/topups', { token: sponsorToken });
    assert('sponsor count STILL 1 after rejections', s4.json.summary?.receivedCompletedCount === 1, `count=${s4.json.summary?.receivedCompletedCount}`);

    // ─────────────────────────────────────────────
    // STEP 5: second DIFFERENT sender (B) tops up sponsor -> count 2 -> MUST TOP-UP
    // ─────────────────────────────────────────────
    const shot2 = await createRealScreenshot(120, RECEIVER_UPI, utr2, dateStr);
    const up2 = multipart('screenshot', shot2, 'proof2.png', 'image/png', { amount: '120' });
    const r5 = await api(BASE, 'POST', '/topups/direct', { token: tokenB, body: up2.body, headers: { 'Content-Type': up2.contentType } });
    assert('direct top-up #2 (different sender) approved + credited', r5.json.data?.credited === true, `msg=${r5.json.message}`);
    topupsToClean.push(r5.json.data?.topupId);

    const s5 = await api(BASE, 'GET', '/topups', { token: sponsorToken });
    assert('sponsor received-completed count = 2', s5.json.summary?.receivedCompletedCount === 2, JSON.stringify(s5.json.summary));
    assert('sponsor MUST TOP-UP now (2 reached)', s5.json.summary?.mustTopup === true, `mustTopup=${s5.json.summary?.mustTopup}`);
    assert('sponsor remaining = 0', s5.json.summary?.remaining === 0, `remaining=${s5.json.summary?.remaining}`);

    // ─────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────
    console.log('\n========================================');
    console.log(`  FINAL: ${results.pass} PASSED / ${results.fail} FAILED`);
    console.log('========================================');
    results.tests.forEach((t) => console.log(`  ${t.status === 'PASS' ? '✓' : '✗'} ${t.name}`));
  } catch (err) {
    console.log('FATAL ERROR:', err.message);
    console.log(err.stack);
  } finally {
    serverProc.kill();

    // CLEANUP
    const safe = async (p) => { try { await p; } catch (e) { /* best-effort */ } };
    try {
      const ids = [...topupsToClean, ...usersToClean];
      if (topupsToClean.length) {
        const { data: topups } = await supabase.from('topups').select('id, screenshot_url').in('id', topupsToClean);
        const paths = (topups || []).map((t) => {
          const marker = `/storage/v1/object/public/payments/`;
          const i = t.screenshot_url?.indexOf(marker);
          return i >= 0 ? t.screenshot_url.slice(i + marker.length) : null;
        }).filter(Boolean);
        if (paths.length) await safe(supabase.storage.from('payments').remove(paths));
        await safe(supabase.from('approved_utrs').delete().in('reference_id', topupsToClean));
        await safe(supabase.from('wallet_transactions').delete().eq('reference_type', 'topup').in('reference_id', topupsToClean));
        await safe(supabase.from('topups').delete().in('id', topupsToClean));
      }
      const { data: deletedTopups } = await supabase.from('topups').select('id').or(`sender_id.in.(${ids.join(',')}),receiver_id.in.(${ids.join(',')})`);
      const orphanIds = (deletedTopups || []).map((t) => t.id);
      if (orphanIds.length) {
        await safe(supabase.from('approved_utrs').delete().in('reference_id', orphanIds));
        await safe(supabase.from('wallet_transactions').delete().eq('reference_type', 'topup').in('reference_id', orphanIds));
        await safe(supabase.from('topups').delete().in('id', orphanIds));
      }
      await safe(supabase.from('audit_logs').delete().or(`actor_id.in.(${ids.join(',')}),target_id.in.(${ids.join(',')})`));
      await safe(supabase.from('users').delete().in('id', usersToClean));
      console.log('  Cleanup done');
    } catch (cleanupErr) {
      console.log('  Cleanup error:', cleanupErr.message);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main().catch(console.error);