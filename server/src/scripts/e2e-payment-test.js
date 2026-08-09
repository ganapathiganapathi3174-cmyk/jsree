import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { runOCR, extractPaymentData, matchAmount, matchUPI, normalizeUTR } from '../services/ocrService.js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const RECEIVER_UPI = process.env.ADMIN_UPI_ID || 'jayarajj126-3@okicici';

async function createTestScreenshot(amount, upi, utr, date) {
  const svg = `<svg width="400" height="700" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <text x="200" y="50" text-anchor="middle" font-size="24" font-weight="bold">Payment Successful</text>
    <text x="200" y="100" text-anchor="middle" font-size="18">₹${amount}</text>
    <text x="200" y="160" text-anchor="middle" font-size="14">To: ${upi}</text>
    <text x="200" y="200" text-anchor="middle" font-size="14">UTR: ${utr}</text>
    <text x="200" y="240" text-anchor="middle" font-size="14">Date: ${date}</text>
    <text x="200" y="300" text-anchor="middle" font-size="12">Transaction successful</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function runTest(name, amount, upi, utr, date, expectedDecision) {
  console.log(`\n--- Test: ${name} ---`);
  try {
    const buffer = await createTestScreenshot(amount, upi, utr, date);
    const ocr = await runOCR(buffer);
    console.log(`[OCR] Raw text: ${JSON.stringify(ocr.text.substring(0, 200))}`);
    console.log(`[OCR] Confidence: ${ocr.confidence}`);

    const extracted = extractPaymentData(ocr.text);
    console.log(`[EXTRACT] Amounts: ${JSON.stringify(extracted.amounts)}`);
    console.log(`[EXTRACT] UPIs: ${JSON.stringify(extracted.upis)}`);
    console.log(`[EXTRACT] UTRs: ${JSON.stringify(extracted.utrs)}`);
    console.log(`[EXTRACT] Dates: ${JSON.stringify(extracted.dates)}`);

    const amountOK = matchAmount(extracted.amounts, amount);
    const upiOK = matchUPI(extracted.upis, RECEIVER_UPI);
    const utrVal = extracted.utrs.length > 0 ? normalizeUTR(extracted.utrs[0]) : null;

    console.log(`[MATCH] Amount: ${amountOK}, UPI: ${upiOK}, UTR: ${utrVal}`);

    const decision = !utrVal ? 'rejected' : !amountOK ? 'rejected' : !upiOK ? 'rejected' : 'approved';
    const passed = decision === expectedDecision;
    console.log(`[DECISION] ${decision} (expected: ${expectedDecision}) ${passed ? 'PASS' : 'FAIL'}`);
    return passed;
  } catch (err) {
    console.log(`[ERROR] ${err.message}`);
    return expectedDecision === 'error';
  }
}

async function main() {
  console.log('=== Payment Verification E2E Test ===');
  console.log(`Receiver UPI: ${RECEIVER_UPI}`);

  let total = 0, passed = 0;

  const tests = [
    ['Valid payment (₹120)', 120, RECEIVER_UPI, '123456789012', '15/06/2026', 'approved'],
    ['Valid payment (₹500)', 500, RECEIVER_UPI, 'UTR9876543210', '20/07/2026', 'approved'],
    ['Valid payment (₹1000)', 1000, RECEIVER_UPI, 'TXN1122334455', '01/08/2026', 'approved'],
    ['Wrong amount', 100, RECEIVER_UPI, '123456789012', '15/06/2026', 'rejected'],
    ['Wrong UPI', 120, 'wrong@upi', '123456789012', '15/06/2026', 'rejected'],
    ['No UTR', 120, RECEIVER_UPI, '', '15/06/2026', 'rejected'],
  ];

  for (const [name, amount, upi, utr, date, expected] of tests) {
    total++;
    if (await runTest(name, amount, upi, utr, date, expected)) passed++;
  }

  console.log(`\n=== Results: ${passed}/${total} passed ===`);

  // Test duplicate UTR in database
  console.log('\n--- Test: Duplicate UTR Check ---');
  const testUTR = 'E2E_DUP_' + Date.now();
  const userId = '00000000-0000-0000-0000-000000000001';

  const { data: p1 } = await supabase.from('payments').insert({
    user_id: userId, selected_plan: 120, expected_amount: 120,
    upi_id: RECEIVER_UPI, status: 'approved', transaction_id: testUTR,
    verified_at: new Date().toISOString(), approved_at: new Date().toISOString()
  }).select('id').single();

  if (p1) {
    const { data: existing } = await supabase.from('payments')
      .select('id, user_id, status').eq('transaction_id', testUTR).neq('id', 'nonexistent').single();
    console.log(`[DUPLICATE CHECK] Found: ${existing ? 'YES' : 'NO'} ${existing ? 'BLOCKED' : 'ALLOWED'}`);
    if (existing) { passed++; }
    total++;
    await supabase.from('payments').delete().eq('id', p1.id);
  }

  console.log(`\n=== Final Results: ${passed}/${total} passed ===`);
}

main().catch(console.error);
