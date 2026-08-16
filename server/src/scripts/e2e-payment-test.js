import sharp from 'sharp';
import { runOCR, extractPaymentData, matchAmount, matchUPI } from '../services/ocrService.js';
import { decidePaymentVerification } from '../services/paymentService.js';
import dotenv from 'dotenv';

dotenv.config();

const RECEIVER_UPI = process.env.ADMIN_UPI_ID || 'jayarajj126-3@okicici';
const WINDOW_MIN = 30;

// Format a Date as UTC "DD/MM/YYYY HH:MM" so server-side parsePaymentDate (UTC) reads it correctly.
function fmtUTC(d) {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

const now = new Date();

// Date offsets relative to each test's referenceTime (screenshot generation instant).
const rel = (mins) => (ref) => new Date(ref.getTime() + mins * 60 * 1000);

async function createTestScreenshot(amount, upi, utr, date) {
  // Space-separated separators keep tesseract from merging digits (e.g. "1608/2026").
  const readableDate = date.replace(/\//g, ' / ');
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

async function runTest(name, screenshotAmount, expectedAmount, upi, utr, date, expectedDecision) {
  console.log(`\n--- Test: ${name} ---`);
  // Capture verification time at the instant the screenshot (payment) is generated,
  // floored to the minute to match the granularity of parsed dates (second = 0).
  const _ref = new Date();
  const referenceTime = new Date(_ref.getTime() - (_ref.getSeconds() * 1000 + _ref.getMilliseconds()));
  // date may be an offset function (relative to referenceTime) or a raw string (invalid-case input).
  const dateStr = typeof date === 'function' ? fmtUTC(date(referenceTime)) : date;
  try {
    const buffer = await createTestScreenshot(screenshotAmount, upi, utr, dateStr);
    const ocr = await runOCR(buffer);
    console.log(`[OCR] Raw text: ${JSON.stringify(ocr.text.substring(0, 200))}`);
    console.log(`[OCR] Confidence: ${ocr.confidence}`);

    const extracted = extractPaymentData(ocr.text);
    console.log(`[EXTRACT] Amounts: ${JSON.stringify(extracted.amounts)}`);
    console.log(`[EXTRACT] UPIs: ${JSON.stringify(extracted.upis)}`);
    console.log(`[EXTRACT] UTRs: ${JSON.stringify(extracted.utrs)}`);
    console.log(`[EXTRACT] Dates: ${JSON.stringify(extracted.dates)}`);

    const amountOK = matchAmount(extracted.amounts, expectedAmount);
    const upiOK = matchUPI(extracted.upis, RECEIVER_UPI);
    const paymentDate = extracted.dates[0] || null;
    const verificationTime = referenceTime;
    const dateValid = paymentDate
      ? (verificationTime.getTime() - paymentDate.getTime()) >= -WINDOW_MIN * 60 * 1000
        && (verificationTime.getTime() - paymentDate.getTime()) <= WINDOW_MIN * 60 * 1000
      : false;

    console.log(`[MATCH] Expected amount: ${expectedAmount}, match: ${amountOK}, UPI: ${upiOK}, Date valid: ${dateValid}`);

    const { decision, reason } = decidePaymentVerification({ upiMatch: upiOK, amountMatch: amountOK, dateValid });
    const passed = decision === expectedDecision;
    console.log(`[DECISION] ${decision} (expected: ${expectedDecision}) ${passed ? 'PASS' : 'FAIL'}${reason ? ' — ' + reason : ''}`);
    return passed;
  } catch (err) {
    console.log(`[ERROR] ${err.message}`);
    return expectedDecision === 'error';
  }
}

async function main() {
  console.log('=== Payment Verification E2E Test (±30 min UTC rule) ===');
  console.log(`Receiver UPI: ${RECEIVER_UPI}`);

  let total = 0, passed = 0;

  const tests = [
    // Delivery of the 12 required date-window scenarios (UTR must have ZERO influence):
    ['D1: date exactly -30 min → approved', 120, 120, RECEIVER_UPI, 'D1_UTRNON', rel(-30), 'approved'],
    ['D2: date -29 min → approved', 120, 120, RECEIVER_UPI, 'D2_UTRNON', rel(-29), 'approved'],
    ['D3: date now → approved', 120, 120, RECEIVER_UPI, 'D3_UTRNON', rel(0), 'approved'],
    ['D4: date now (no UTR) → approved', 120, 120, RECEIVER_UPI, '', rel(0), 'approved'],
    ['D5: date exactly +30 min → approved', 120, 120, RECEIVER_UPI, 'D5_UTRNON', rel(30), 'approved'],
    ['D6: date +29 min → approved', 120, 120, RECEIVER_UPI, 'D6_UTRNON', rel(29), 'approved'],
    ['D7: date +31 min → rejected', 120, 120, RECEIVER_UPI, 'D7_UTRNON', rel(31), 'rejected'],
    ['D8: date -31 min → rejected', 120, 120, RECEIVER_UPI, 'D8_UTRNON', rel(-31), 'rejected'],
    ['D9: date yesterday → rejected', 120, 120, RECEIVER_UPI, 'D9_UTRNON', rel(-1440), 'rejected'],
    ['D10: date 30 days old → rejected', 120, 120, RECEIVER_UPI, 'D10_UTRNON', rel(-43200), 'rejected'],
    ['D11: invalid date string → rejected', 120, 120, RECEIVER_UPI, 'D11_UTRNON', 'not-a-date', 'rejected'],
    ['D12: invalid/empty time → rejected', 120, 120, RECEIVER_UPI, 'D12_UTRNON', '32/13/2026 25:99', 'rejected'],
  ];

  for (const [name, shotAmt, expAmt, upi, utr, date, expected] of tests) {
    total++;
    if (await runTest(name, shotAmt, expAmt, upi, utr, date, expected)) passed++;
  }

  console.log(`\n=== Results: ${passed}/${total} passed ===`);
}

main().catch(console.error);