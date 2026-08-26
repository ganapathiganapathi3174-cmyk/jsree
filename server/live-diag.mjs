import sharp from 'sharp';
import { readFileSync } from 'fs';

const BASE = 'https://jsree-backend-production.up.railway.app/api';
const RECEIVER_UPI = 'jayarajj126-3@okicici';
const EXPECTED_AMOUNT = 120;
const PASSWORD = 'DiagTest123!';

function readEnv() {
  const lines = readFileSync('.env', 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.+)/);
    if (m) env[m[1].toLowerCase()] = m[2];
  }
  return { supabaseUrl: env.supabase_url, supabaseServiceKey: env.supabase_service_role_key };
}

async function registerOrLogin(name, email, mobile) {
  let r = await fetch(`${BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, mobile, password: PASSWORD, plan: '120' }),
  });
  let d = await r.json();
  if (d.data?.token) return { token: d.data.token, userId: d.data.user.id };
  r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  d = await r.json();
  return { token: d.data?.token || null, userId: d.data?.user?.id || null, loginData: d.data };
}

async function createPayment(token) {
  const r = await fetch(`${BASE}/payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ plan: '120' }),
  });
  const d = await r.json();
  if (d.data?.id) return d.data;
  const pr = await fetch(`${BASE}/payments`, { headers: { 'Authorization': `Bearer ${token}` } });
  const pd = await pr.json();
  return pd.data?.find(p => p.status === 'pending') || pd.data?.[0];
}

function svgToReceipt({ provider, upi, amount, utr, dateTime, statusText, txLabel }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="700">
  <rect width="400" height="700" fill="white"/>
  <rect width="400" height="80" fill="#1a73e8"/>
  <text x="200" y="50" text-anchor="middle" fill="white" font-size="24" font-family="Arial" font-weight="bold">${provider} Payment</text>
  <circle cx="200" cy="140" r="40" fill="#4CAF50"/>
  <text x="200" y="155" text-anchor="middle" fill="white" font-size="36" font-family="Arial">Done</text>
  <text x="200" y="210" text-anchor="middle" fill="#4CAF50" font-size="22" font-family="Arial" font-weight="bold">${statusText}</text>
  <text x="200" y="280" text-anchor="middle" fill="#333" font-size="42" font-family="Arial" font-weight="bold">Rs. ${amount}</text>
  <text x="200" y="310" text-anchor="middle" fill="#666" font-size="14" font-family="Arial">Payment Successful</text>
  <line x1="40" y1="340" x2="360" y2="340" stroke="#eee"/>
  <text x="40" y="375" fill="#999" font-size="13" font-family="Arial">Sent to</text>
  <text x="360" y="375" fill="#333" font-size="13" font-family="Arial" text-anchor="end">${upi}</text>
  <text x="40" y="415" fill="#999" font-size="13" font-family="Arial">${txLabel}</text>
  <text x="360" y="415" fill="#333" font-size="13" font-family="Arial" text-anchor="end">${utr}</text>
  <text x="40" y="455" fill="#999" font-size="13" font-family="Arial">Date</text>
  <text x="360" y="455" fill="#333" font-size="13" font-family="Arial" text-anchor="end">${dateTime}</text>
  <text x="40" y="495" fill="#999" font-size="13" font-family="Arial">Transaction Status</text>
  <text x="360" y="495" fill="#4CAF50" font-size="13" font-family="Arial" font-weight="bold" text-anchor="end">${statusText}</text>
  <line x1="40" y1="520" x2="360" y2="520" stroke="#eee"/>
  <text x="40" y="560" fill="#999" font-size="13" font-family="Arial">UPI Transaction ID</text>
  <text x="40" y="585" fill="#333" font-size="14" font-family="Arial" font-weight="bold">${utr}</text>
</svg>`;
}

async function uploadScreenshot(token, paymentId, pngBuf, filename) {
  const fd = new FormData();
  fd.append('screenshot', new Blob([pngBuf], { type: 'image/png' }), filename);
  const r = await fetch(`${BASE}/payments/${paymentId}/screenshot`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: fd,
  });
  return await r.json();
}

async function fetchDB(paymentId) {
  const env = readEnv();
  const r = await fetch(`${env.supabaseUrl}/rest/v1/payments?id=eq.${paymentId}&select=*`, {
    headers: { 'apikey': env.supabaseServiceKey, 'Authorization': `Bearer ${env.supabaseServiceKey}` },
  });
  const d = await r.json();
  return d[0] || null;
}

function buildDiag(provider, uploadResp, dbRec) {
  const vr = uploadResp?.data?.verification?.verificationResult || uploadResp?.data?.verification || dbRec?.verification_result || {};
  return {
    provider,
    expectedAmount: vr.checks?.amount?.expected ?? EXPECTED_AMOUNT,
    extractedAmounts: vr.extractedAmounts || [],
    extractedAmount: vr.checks?.amount?.detected ?? vr.detected?.amount,
    amountMatch: vr.amountMatch ?? vr.checks?.amount?.passed,
    expectedUpi: vr.checks?.receiverUpi?.expected ?? RECEIVER_UPI,
    extractedUPIs: vr.extractedUPIs || [],
    upiMatch: vr.upiMatch ?? vr.checks?.receiverUpi?.passed,
    extractedUtr: vr.utr ?? vr.checks?.utr?.detected,
    extractedUTRs: vr.extractedUTRs || [],
    utrPresent: !!vr.utr,
    extractedDate: vr.checks?.transactionDate?.detected,
    hasTimeComponent: vr.hasTimeComponent,
    dateValid: vr.dateValid ?? vr.checks?.transactionDate?.passed,
    transactionStatus: vr.transactionStatus?.status,
    statusValid: vr.checks?.transactionStatus?.passed,
    ocrConfidence: vr.ocrConfidence,
    confidenceValid: typeof vr.ocrConfidence === 'number' ? vr.ocrConfidence >= 55 : 'N/A',
    fieldConfidence: vr.fieldConfidence || {},
    allFieldsHigh: Object.values(vr.fieldConfidence || {}).every(f => f.confidence === 'high'),
    isDemo: vr.reason === 'DEMO_SCREENSHOT',
    finalDecision: vr.decision,
    rejectionReason: vr.reason,
    checks: vr.checks || {},
    dbStatus: dbRec?.status,
    dbRejectionReason: dbRec?.rejection_reason,
    apiStatus: uploadResp?.data?.verification?.status,
    apiDecision: uploadResp?.data?.verification?.decision,
    apiReason: uploadResp?.data?.verification?.reason,
  };
}

const PROVIDERS = [
  { name: 'GPay', txLabel: 'UPI Ref', statusText: 'Completed', mobile: '9000000001' },
  { name: 'PhonePe', txLabel: 'Transaction ID', statusText: 'Successful', mobile: '9000000002' },
  { name: 'Paytm', txLabel: 'UPI Ref No', statusText: 'Paid', mobile: '9000000003' },
  { name: 'BHIM', txLabel: 'Reference Id', statusText: 'Completed', mobile: '9000000004' },
  { name: 'Bank UPI', txLabel: 'RRN', statusText: 'Successful', mobile: '9000000005' },
  { name: 'Amazon Pay', txLabel: 'UTR', statusText: 'Completed', mobile: '9000000006' },
];

async function main() {
  console.log('=== LIVE END-TO-END DIAGNOSTIC ===\n');

  const healthR = await fetch(`${BASE}/health`);
  const healthD = await healthR.json();
  const serverTime = new Date(healthD.timestamp);
  console.log(`Server time: ${serverTime.toISOString()}`);

  const istOffset = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(serverTime.getTime() + istOffset);
  const dd = String(istNow.getUTCDate()).padStart(2, '0');
  const mm = String(istNow.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = istNow.getUTCFullYear();
  let hh = istNow.getUTCHours();
  const min = String(istNow.getUTCMinutes()).padStart(2, '0');
  const ampm = hh >= 12 ? 'PM' : 'AM';
  const hh12 = hh > 12 ? hh - 12 : (hh === 0 ? 12 : hh);
  const dateStr = `${dd}/${mm}/${yyyy}`;
  const timeStr = `${hh12}:${min} ${ampm}`;
  const screenDateTime = `${dateStr}, ${timeStr}`;
  console.log(`Screenshot timestamp: ${screenDateTime}\n`);

  const results = [];

  for (let i = 0; i < PROVIDERS.length; i++) {
    const p = PROVIDERS[i];
    const utr = `41${String(10000000000 + i * 1111111111).slice(0, 12)}`;
    const email = `diag${p.name.toLowerCase().replace(/\s+/g, '')}@test.com`;
    console.log(`--- ${p.name} (UTR: ${utr}) ---`);

    const user = await registerOrLogin(`Diag${p.name}`, email, p.mobile);
    if (!user.token) { console.log(`  SKIP: no token for ${email}\n`); continue; }

    const payment = await createPayment(user.token);
    if (!payment?.id) { console.log(`  SKIP: no payment\n`); continue; }
    console.log(`  Payment: ${payment.id} (status: ${payment.status})`);

    const svg = svgToReceipt({ provider: p.name, upi: RECEIVER_UPI, amount: EXPECTED_AMOUNT, utr, dateTime: screenDateTime, statusText: p.statusText, txLabel: p.txLabel });
    const pngBuf = await sharp(Buffer.from(svg)).png().toBuffer();
    console.log(`  Screenshot generated (${pngBuf.length} bytes)`);

    const uploadResp = await uploadScreenshot(user.token, payment.id, pngBuf, `${p.name}-receipt.png`);
    console.log(`  Upload success: ${uploadResp.success}`);
    if (!uploadResp.success) {
      console.log(`  Upload error: ${uploadResp.message} (${uploadResp.code})`);
    }

    const dbRec = await fetchDB(payment.id);
    const diag = buildDiag(p.name, uploadResp, dbRec);
    results.push(diag);

    console.log(`  DIAGNOSTIC:`);
    console.log(JSON.stringify(diag, null, 2));
    console.log('');
  }

  console.log('\n=== SUMMARY ===\n');
  for (const r of results) {
    const firstFail = r.amountMatch === false ? 'AMOUNT_MISMATCH' :
                      r.upiMatch === false ? 'UPI_MISMATCH' :
                      r.dateValid === false ? 'INVALID_PAYMENT_DATE' :
                      r.statusValid === false ? 'TRANSACTION_FAILED' :
                      !r.utrPresent ? 'MISSING_UTR' :
                      r.confidenceValid === false ? 'LOW_OCR_CONFIDENCE' :
                      r.allFieldsHigh === false ? 'LOW_FIELD_CONFIDENCE' :
                      r.isDemo ? 'DEMO_SCREENSHOT' :
                      null;
    console.log(`${r.provider}: decision=${r.finalDecision} reason=${r.rejectionReason} | firstFail=${firstFail || 'NONE'} | amount=${r.amountMatch} upi=${r.upiMatch} date=${r.dateValid} status=${r.statusValid} utr=${r.utrPresent} conf=${r.confidenceValid} fieldsHigh=${r.allFieldsHigh}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
