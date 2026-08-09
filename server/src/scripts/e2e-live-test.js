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

async function createRealScreenshot(amount, upi, utr, date) {
  const svg = `<svg width="400" height="700" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <text x="200" y="60" text-anchor="middle" font-size="28" font-weight="bold" fill="#333">Payment Successful</text>
    <line x1="50" y1="80" x2="350" y2="80" stroke="#ccc" stroke-width="1"/>
    <text x="50" y="130" font-size="16" fill="#666">Amount</text>
    <text x="350" y="130" text-anchor="end" font-size="22" font-weight="bold" fill="#333">₹${amount}</text>
    <line x1="50" y1="150" x2="350" y2="150" stroke="#eee" stroke-width="1"/>
    <text x="50" y="190" font-size="16" fill="#666">To</text>
    <text x="350" y="190" text-anchor="end" font-size="14" fill="#333">${upi}</text>
    <line x1="50" y1="210" x2="350" y2="210" stroke="#eee" stroke-width="1"/>
    <text x="50" y="250" font-size="16" fill="#666">UTR</text>
    <text x="350" y="250" text-anchor="end" font-size="14" fill="#333">${utr}</text>
    <line x1="50" y1="270" x2="350" y2="270" stroke="#eee" stroke-width="1"/>
    <text x="50" y="310" font-size="16" fill="#666">Date</text>
    <text x="350" y="310" text-anchor="end" font-size="14" fill="#333">${date}</text>
    <line x1="50" y1="330" x2="350" y2="330" stroke="#eee" stroke-width="1"/>
    <text x="200" y="400" text-anchor="middle" font-size="14" fill="#999">UPI Transaction</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function runOCRLocal(buffer) {
  const { default: Tesseract } = await import('tesseract.js');
  const processed = await sharp(buffer).resize({ width: 1200, withoutEnlargement: true }).grayscale().normalize().sharpen().toBuffer();
  const result = await Tesseract.recognize(processed, 'eng');
  return { text: result.data.text || '', confidence: result.data.confidence || 0 };
}

function extractAll(text) {
  const spaceNorm = text.replace(/(\d)\s+(\d)/g, '$1$2');

  const amounts = [];
  for (const re of [/(?:₹|Rs\.?|INR)\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/gi, /(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:₹|Rs\.?|INR)/gi, /(?:amount|paid|sent|total|debit(?:ed)?)\s*[:\-]?\s*(?:₹|Rs\.?|INR)?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)/gi]) {
    let m; while ((m = re.exec(text)) !== null) { const v = parseFloat(m[1].replace(/,/g, '')); if (v > 0 && v < 100000) amounts.push(v); }
  }

  const upis = new Set();
  const spaceFixedUPI = text.replace(/(\w)\s+(@\w)/g, '$1$2').replace(/(\w-?\w*)\s+(@\w)/g, '$1$2').replace(/(\w{2,})\s+(\d{2,}-?\d+@\w+)/g, '$1$2');
  for (const re of [/([a-zA-Z0-9._-]+@[a-zA-Z0-9]+)/gi, /(?:to|vpa|upi\s*id)\s*[:\-]?\s*([a-zA-Z0-9._-]+@[a-zA-Z0-9]+)/gi]) {
    let m; while ((m = re.exec(spaceFixedUPI)) !== null) upis.add(m[1].replace(/\s+/g, '').toLowerCase());
  }

  const utrs = [];
  for (const re of [/(?:utr|txn|transaction|ref(?:erence)?|upi\s*ref)\s*(?:no|num|id|#)?\s*[:\-]?\s*([A-Za-z0-9_]{6,30})/gi, /\b(\d{10,14})\b/g, /\b([A-Za-z]{2,4}\d{8,12})\b/g]) {
    let m; while ((m = re.exec(spaceNorm)) !== null) { const v = m[1].replace(/\s+/g, '').trim(); if (v.length >= 6 && v.length <= 30) utrs.push(v); }
  }

  const dates = [];
  for (const re of [/(\d{1,2})\s*[\/\-\.]\s*(\d{1,2})\s*[\/\-\.]\s*(\d{2,4})/gi]) {
    let m; while ((m = re.exec(text)) !== null) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;
      const dt = new Date(parseInt(y), parseInt(mo) - 1, parseInt(d));
      if (!isNaN(dt.getTime())) dates.push(dt);
    }
  }

  return { amounts: [...new Set(amounts)], upis: [...upis], utrs: [...new Set(utrs)], dates };
}

async function main() {
  console.log('========================================');
  console.log('  FINAL LIVE PAYMENT VERIFICATION E2E');
  console.log('========================================\n');

  // =====================================================
  // PHASE 1: DATABASE VERIFICATION
  // =====================================================
  console.log('--- PHASE 1: Database Schema Verification ---');

  const { data: samplePayment, error: spErr } = await supabase.from('payments').select('*').limit(1);
  if (spErr) { console.log('CRITICAL: Cannot query payments table:', spErr.message); return; }
  const cols = Object.keys(samplePayment[0] || {});
  console.log('  Payment columns:', cols.join(', '));
  assert('payments table accessible', true, `${cols.length} columns`);

  const requiredCols = ['id', 'user_id', 'selected_plan', 'expected_amount', 'screenshot_url', 'upi_id', 'transaction_id', 'status', 'verification_result', 'verified_at', 'approved_at', 'rejected_at', 'rejection_reason'];
  const missingCols = requiredCols.filter(c => !cols.includes(c));
  assert('all required columns exist', missingCols.length === 0, missingCols.length > 0 ? `Missing: ${missingCols.join(', ')}` : 'OK');

  const { data: usersSample } = await supabase.from('users').select('*').limit(1);
  const userCols = Object.keys(usersSample[0] || {});
  assert('users table accessible', true, `${userCols.length} columns`);

  // Check for transaction_id index (we can't query pg_indexes via Supabase client, so we test dedup behavior directly)
  console.log('\n  Note: Unique index on transaction_id will be tested via duplicate UTR behavior.\n');

  // =====================================================
  // PHASE 2: OCR PIPELINE TEST
  // =====================================================
  console.log('--- PHASE 2: OCR Pipeline Test ---');

  const testUTR = `E2E_${Date.now()}_001`;
  const testAmount = 120;
  const testDate = '15/06/2026';

  const buffer = await createRealScreenshot(testAmount, RECEIVER_UPI, testUTR, testDate);
  assert('screenshot created', buffer.length > 1000, `${buffer.length} bytes`);

  const ocr = await runOCRLocal(buffer);
  console.log('  OCR raw text:', JSON.stringify(ocr.text.substring(0, 500)));
  console.log('  OCR confidence:', ocr.confidence);
  assert('OCR returns text', ocr.text.length > 5, `${ocr.text.length} chars`);

  const extracted = extractAll(ocr.text);
  console.log('  Extracted amounts:', JSON.stringify(extracted.amounts));
  console.log('  Extracted UPIs:', JSON.stringify(extracted.upis));
  console.log('  Extracted UTRs:', JSON.stringify(extracted.utrs));
  console.log('  Extracted dates:', JSON.stringify(extracted.dates.map(d => d.toISOString())));

  assert('amount extracted', extracted.amounts.length > 0, `Found: ${JSON.stringify(extracted.amounts)}`);
  assert('UPI extracted', extracted.upis.length > 0, `Found: ${JSON.stringify(extracted.upis)}`);
  assert('UTR extracted', extracted.utrs.length > 0, `Found: ${JSON.stringify(extracted.utrs)}`);
  assert('date extracted', extracted.dates.length > 0, `Found: ${extracted.dates[0]?.toISOString()}`);

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0));
    return dp[m][n];
  }
  const amountMatch = extracted.amounts.some(a => Math.abs(a - testAmount) < 0.01);
  const upiNorm = RECEIVER_UPI.toLowerCase();
  const upiMatch = extracted.upis.some(u => {
    const nu = u.toLowerCase();
    if (nu === upiNorm) return true;
    const maxDist = Math.max(1, Math.floor(upiNorm.length * 0.15));
    return levenshtein(nu, upiNorm) <= maxDist;
  });
  const utrVal = extracted.utrs[0]?.replace(/\s+/g, '').trim() || null;

  console.log(`\n  Expected amount: ${testAmount}, Match: ${amountMatch}`);
  console.log(`  Expected UPI: ${RECEIVER_UPI}, Match: ${upiMatch}`);
  console.log(`  Extracted UTR: ${utrVal}`);

  assert('amount matches expected', amountMatch, `Expected ${testAmount}`);
  assert('UPI matches expected', upiMatch, `Expected ${RECEIVER_UPI}`);
  assert('UTR is non-empty', utrVal !== null && utrVal.length >= 6, utrVal);

  // =====================================================
  // PHASE 3: CREATE REAL PAYMENT + UPLOAD VIA API
  // =====================================================
  console.log('\n--- PHASE 3: Real API E2E Test ---');

  // Start server
  const { spawn } = await import('child_process');
  const serverProc = spawn('node', ['src/index.js'], {
    cwd: join(__dirname, '../..'),
    env: { ...process.env, PORT: '5099' },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let serverOutput = '';
  serverProc.stdout.on('data', d => serverOutput += d.toString());
  serverProc.stderr.on('data', d => serverOutput += d.toString());

  await new Promise(resolve => setTimeout(resolve, 4000));
  assert('server started', serverOutput.includes('Server running'), serverOutput.substring(0, 200));

  const BASE = 'http://localhost:5099/api';

  try {
    // Register a test user
    const testEmail = `e2e_test_${Date.now()}@test.com`;
    const testMobile = `9${Date.now().toString().slice(-9)}`;
    const regRes = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'E2E Test', email: testEmail, mobile: testMobile, password: 'Test@123', plan: '120' })
    });
    const regData = await regRes.json();
    console.log('  Register status:', regRes.status);
    assert('registration succeeds', regRes.status === 201, JSON.stringify(regData).substring(0, 200));

    const userToken = regData.data?.token;
    const userId = regData.data?.user?.id;
    assert('token returned', !!userToken, userId);

    // Create payment
    const payRes = await fetch(`${BASE}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken}` },
      body: JSON.stringify({ plan: '120' })
    });
    const payData = await payRes.json();
    console.log('  Create payment status:', payRes.status);
    assert('payment created', payRes.status === 201, JSON.stringify(payData).substring(0, 200));

    const paymentId = payData.data?.id;
    assert('payment ID returned', !!paymentId, paymentId);

    // Query DB before upload
    const { data: beforePayment } = await supabase.from('payments').select('id, status, transaction_id, verification_result').eq('id', paymentId).single();
    console.log('  DB before upload:', JSON.stringify(beforePayment));
    assert('payment is pending before upload', beforePayment?.status === 'pending', `Status: ${beforePayment?.status}`);

    // Upload screenshot via API (multipart)
    const screenshotBuffer = await createRealScreenshot(120, RECEIVER_UPI, utrVal, testDate);
    const boundary = '----TestBoundary' + Date.now();
    const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="screenshot"; filename="payment.png"\r\nContent-Type: image/png\r\n\r\n`);
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, screenshotBuffer, footer]);

    const uploadRes = await fetch(`${BASE}/payments/${paymentId}/screenshot`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userToken}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body
    });
    const uploadData = await uploadRes.json();
    console.log('  Upload response status:', uploadRes.status);
    console.log('  Upload response:', JSON.stringify(uploadData).substring(0, 1000));

    assert('upload succeeds', uploadRes.status === 200, JSON.stringify(uploadData).substring(0, 300));

    const verification = uploadData.data?.verification;
    console.log('\n  === VERIFICATION RESULT ===');
    console.log('  Decision:', verification?.decision);
    console.log('  Status:', verification?.status);
    console.log('  Reason:', verification?.reason);
    console.log('  Amount match:', verification?.verificationResult?.amountMatch);
    console.log('  UPI match:', verification?.verificationResult?.upiMatch);
    console.log('  UTR:', verification?.verificationResult?.utr);
    console.log('  OCR confidence:', verification?.verificationResult?.ocrConfidence);

    assert('verification returned', !!verification, 'verification object present');
    assert('verification decision exists', verification?.decision === 'approved' || verification?.decision === 'rejected', `Decision: ${verification?.decision}`);

    // =====================================================
    // PHASE 4: DATABASE VERIFICATION AFTER UPLOAD
    // =====================================================
    console.log('\n--- PHASE 4: Database Verification After Upload ---');

    const { data: afterPayment } = await supabase.from('payments').select('*').eq('id', paymentId).single();
    console.log('  DB status after upload:', afterPayment?.status);
    console.log('  DB transaction_id:', afterPayment?.transaction_id);
    console.log('  DB verification_result:', JSON.stringify(afterPayment?.verification_result)?.substring(0, 300));
    console.log('  DB verified_at:', afterPayment?.verified_at);

    if (verification?.decision === 'approved') {
      assert('payment status = approved', afterPayment?.status === 'approved', `Actual: ${afterPayment?.status}`);
      assert('transaction_id stored', !!afterPayment?.transaction_id, afterPayment?.transaction_id);
      assert('verification_result populated', !!afterPayment?.verification_result, 'JSON present');
      assert('verified_at populated', !!afterPayment?.verified_at, afterPayment?.verified_at);

      // Check user activation
      const { data: userAfter } = await supabase.from('users').select('status, current_plan').eq('id', userId).single();
      console.log('  User status after approval:', userAfter?.status);
      console.log('  User current_plan:', userAfter?.current_plan);
      assert('user activated after approval', userAfter?.status === 'active', `Status: ${userAfter?.status}`);
      assert('user plan updated', userAfter?.current_plan === 120, `Plan: ${userAfter?.current_plan}`);
    } else {
      console.log('  Verification rejected — checking rejection reason');
      assert('rejection reason stored', !!afterPayment?.rejection_reason || afterPayment?.status === 'rejected', `Status: ${afterPayment?.status}, Reason: ${afterPayment?.rejection_reason}`);
    }

    // =====================================================
    // PHASE 5: DUPLICATE UTR TEST
    // =====================================================
    console.log('\n--- PHASE 5: Duplicate UTR Test ---');

    // Register second user
    const testEmail2 = `e2e_test2_${Date.now()}@test.com`;
    const testMobile2 = `8${Date.now().toString().slice(-9)}`;
    const regRes2 = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'E2E Test2', email: testEmail2, mobile: testMobile2, password: 'Test@123', plan: '120' })
    });
    const regData2 = await regRes2.json();
    const userToken2 = regData2.data?.token;
    const userId2 = regData2.data?.user?.id;

    // Create payment for second user
    const payRes2 = await fetch(`${BASE}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken2}` },
      body: JSON.stringify({ plan: '120' })
    });
    const payData2 = await payRes2.json();
    const paymentId2 = payData2.data?.id;

    // Upload same screenshot (same UTR)
    const uploadRes2 = await fetch(`${BASE}/payments/${paymentId2}/screenshot`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userToken2}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body
    });
    const uploadData2 = await uploadRes2.json();
    console.log('  Second upload decision:', uploadData2.data?.verification?.decision);
    console.log('  Second upload reason:', uploadData2.data?.verification?.reason);

    assert('duplicate UTR rejected', uploadData2.data?.verification?.decision === 'rejected', `Reason: ${uploadData2.data?.verification?.reason}`);

    const { data: payment2After } = await supabase.from('payments').select('status').eq('id', paymentId2).single();
    assert('second payment status = rejected', payment2After?.status === 'rejected', `Status: ${payment2After?.status}`);

    // =====================================================
    // PHASE 6: INVALID SCREENSHOT TEST
    // =====================================================
    console.log('\n--- PHASE 6: Invalid Screenshot Test ---');

    // Register third user
    const testEmail3 = `e2e_test3_${Date.now()}@test.com`;
    const testMobile3 = `7${Date.now().toString().slice(-9)}`;
    const regRes3 = await fetch(`${BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'E2E Test3', email: testEmail3, mobile: testMobile3, password: 'Test@123', plan: '500' })
    });
    const regData3 = await regRes3.json();
    const userToken3 = regData3.data?.token;
    const userId3 = regData3.data?.user?.id;

    const payRes3 = await fetch(`${BASE}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${userToken3}` },
      body: JSON.stringify({ plan: '500' })
    });
    const payData3 = await payRes3.json();
    const paymentId3 = payData3.data?.id;

    // Upload wrong-amount screenshot (120 instead of 500)
    const wrongBuffer = await createRealScreenshot(120, RECEIVER_UPI, `WRONG_${Date.now()}`, testDate);
    const boundary2 = '----TestBoundary' + Date.now();
    const header2 = Buffer.from(`--${boundary2}\r\nContent-Disposition: form-data; name="screenshot"; filename="wrong.png"\r\nContent-Type: image/png\r\n\r\n`);
    const footer2 = Buffer.from(`\r\n--${boundary2}--\r\n`);
    const body2 = Buffer.concat([header2, wrongBuffer, footer2]);

    const uploadRes3 = await fetch(`${BASE}/payments/${paymentId3}/screenshot`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userToken3}`, 'Content-Type': `multipart/form-data; boundary=${boundary2}` },
      body: body2
    });
    const uploadData3 = await uploadRes3.json();
    console.log('  Wrong amount decision:', uploadData3.data?.verification?.decision);
    console.log('  Wrong amount reason:', uploadData3.data?.verification?.reason);

    assert('wrong amount rejected', uploadData3.data?.verification?.decision === 'rejected', `Reason: ${uploadData3.data?.verification?.reason}`);

    // =====================================================
    // PHASE 7: CONCURRENT UTR TEST
    // =====================================================
    console.log('\n--- PHASE 7: Concurrent UTR Test ---');

    const concurrentUTR = `CONCURRENT_${Date.now()}`;
    const concurrentUsers = [];

    for (let i = 0; i < 3; i++) {
      const email = `concurrent_${Date.now()}_${i}@test.com`;
      const mobile = `6${Date.now().toString().slice(-8)}${i}`;
      const r = await fetch(`${BASE}/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Concurrent ${i}`, email, mobile, password: 'Test@123', plan: '120' })
      });
      const rd = await r.json();
      const pr = await fetch(`${BASE}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${rd.data.token}` },
        body: JSON.stringify({ plan: '120' })
      });
      const pd = await pr.json();
      concurrentUsers.push({ token: rd.data.token, paymentId: pd.data.id, userId: rd.data.user.id });
    }

    const concurrentBuffer = await createRealScreenshot(120, RECEIVER_UPI, concurrentUTR, testDate);
    const boundary3 = '----TestBoundary' + Date.now();
    const header3 = Buffer.from(`--${boundary3}\r\nContent-Disposition: form-data; name="screenshot"; filename="concurrent.png"\r\nContent-Type: image/png\r\n\r\n`);
    const footer3 = Buffer.from(`\r\n--${boundary3}--\r\n`);
    const body3 = Buffer.concat([header3, concurrentBuffer, footer3]);

    const promises = concurrentUsers.map(u =>
      fetch(`${BASE}/payments/${u.paymentId}/screenshot`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${u.token}`, 'Content-Type': `multipart/form-data; boundary=${boundary3}` },
        body: body3
      }).then(r => r.json()).catch(e => ({ error: e.message }))
    );

    const concurrentResults = await Promise.all(promises);
    const decisions = concurrentResults.map(r => r.data?.verification?.decision || r.error || 'unknown');
    console.log('  Concurrent decisions:', JSON.stringify(decisions));

    const approvedCount = decisions.filter(d => d === 'approved').length;
    console.log('  Approved count:', approvedCount);
    assert('at most 1 concurrent approval', approvedCount <= 1, `${approvedCount} approved out of 3`);

    // =====================================================
    // PHASE 8: CLEANUP
    // =====================================================
    console.log('\n--- PHASE 8: Cleanup ---');
    for (const u of concurrentUsers) {
      await supabase.from('payments').delete().eq('id', u.paymentId);
      await supabase.from('users').delete().eq('id', u.userId);
    }
    await supabase.from('payments').delete().eq('id', paymentId);
    await supabase.from('payments').delete().eq('id', paymentId2);
    await supabase.from('payments').delete().eq('id', paymentId3);
    await supabase.from('users').delete().eq('id', userId);
    await supabase.from('users').delete().eq('id', userId2);
    await supabase.from('users').delete().eq('id', userId3);
    console.log('  Cleanup done');

    // =====================================================
    // FINAL RESULTS
    // =====================================================
    console.log('\n========================================');
    console.log(`  FINAL: ${results.pass} PASSED / ${results.fail} FAILED`);
    console.log('========================================');
    results.tests.forEach(t => console.log(`  ${t.status === 'PASS' ? '✓' : '✗'} ${t.name}`));
    console.log('');

  } catch (err) {
    console.log('FATAL ERROR:', err.message);
    console.log(err.stack);
  } finally {
    serverProc.kill();
    await new Promise(r => setTimeout(r, 1000));
  }
}

main().catch(console.error);
