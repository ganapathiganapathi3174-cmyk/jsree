import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  decidePaymentVerification,
  runScreenshotVerification,
} from '../../services/verificationService.js';

// ─────────────────────────────────────────────────────────────
// EXACT PARITY: Register membership payment vs TopUp payment.
// Both flows consume the SAME runScreenshotVerification output and
// the SAME decidePaymentVerification. This suite proves that for
// identical verification inputs, both contexts decide identically
// (CASE 1–20), across providers, amounts, and all reject reasons.
// Business actions AFTER approval intentionally differ and are NOT
// part of this suite (covered by wallet/idempotency suites).
// ─────────────────────────────────────────────────────────────

const { runOCR } = vi.hoisted(() => ({ runOCR: vi.fn() }));
vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runOCR,
    runAmountRecoveryOCR: vi.fn(async () => []),
    runAdditionalOCRPasses: vi.fn(async () => []),
  };
});

afterEach(() => { vi.useRealTimers(); });

const UPI = 'jayarajj126-3@okicici';
const AT_0940 = () => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-08T04:10:00.000Z')); }; // 09:40 IST
const DATE_LINE = 'Date: 08/09/2026, 09:36 AM';

// Run the SHARED pipeline once per payment-type context. The engine
// receives identical evidence; only the caller context label differs.
async function verifyAs(context, text, expectedAmount) {
  void context;
  runOCR.mockResolvedValue({ text, confidence: 88 });
  return runScreenshotVerification({
    imageBuffer: Buffer.from(`parity-${expectedAmount}-${text.length}`),
    expectedAmount,
    receiverUpi: UPI,
  });
}

async function bothContexts(text, expectedAmount) {
  AT_0940();
  const m = await verifyAs('MEMBERSHIP', text, expectedAmount);
  const t = await verifyAs('TOPUP', text, expectedAmount);
  return { m: m.verificationResult, t: t.verificationResult };
}

function receipt({ amount = '₹120', upi = UPI, status = 'Payment Successful', utr = 'UPI transaction ID: T7PARITY01', date = DATE_LINE, provider = null } = {}) {
  const lines = [provider || 'Google Pay', status, amount, `To Jayaraj`, upi, date, utr];
  return lines.join('\n');
}

// CASE 12 — decision parity over every gate combination.
describe('PARITY decision engine: identical inputs → identical decisions', () => {
  const gates = ['upiMatch', 'amountMatch', 'dateValid', 'utrPresent', 'transactionStatusOk'];
  it('all-true approves in both contexts', () => {
    const base = { upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true, transactionStatusOk: true, ocrConfidence: 90 };
    const m = decidePaymentVerification(base);
    const t = decidePaymentVerification({ ...base });
    expect(m).toEqual(t);
    expect(m.decision).toBe('approved');
  });

  for (const g of gates) {
    it(`false ${g} rejects identically with the same reason`, () => {
      const base = { upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true, transactionStatusOk: true, ocrConfidence: 90 };
      const m = decidePaymentVerification({ ...base, [g]: false });
      const t = decidePaymentVerification({ ...base, [g]: false });
      expect(t).toEqual(m);
      expect(m.decision).toBe('rejected');
    });
  }

  it('low OCR confidence rejects identically', () => {
    const base = { upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true, transactionStatusOk: true, ocrConfidence: 30 };
    expect(decidePaymentVerification({ ...base })).toEqual(decidePaymentVerification({ ...base }));
    expect(decidePaymentVerification({ ...base }).decision).toBe('rejected');
  });
});

// CASE 1/2 — valid receipts approve identically.
describe('PARITY valid receipts approve in both flows', () => {
  for (const amount of [120, 500, 1000]) {
    it(`CASE 1/2: valid ₹${amount} → APPROVED in both`, async () => {
      const { m, t } = await bothContexts(receipt({ amount: `₹${amount}` }), amount);
      expect(m.decision).toBe('approved');
      expect(t.decision).toBe(m.decision);
      expect(t.reason).toBe(m.reason);
    });
  }
});

// CASE 3–10 — negatives reject identically with identical reasons.
describe('PARITY rejections match in both flows', () => {
  const negatives = [
    ['CASE 3 wrong amount', receipt({ amount: '₹500' }), 120, 'AMOUNT_MISMATCH'],
    ['CASE 4 wrong UPI', receipt({ upi: 'attacker@upi' }), 120, 'UPI_MISMATCH'],
    ['CASE 6 failed transaction', receipt({ status: 'Transaction Failed' }), 120, 'TRANSACTION_FAILED'],
    ['CASE 7 missing UTR', ['Google Pay', 'Payment Successful', '₹120', 'To Jayaraj', UPI, DATE_LINE].join('\n'), 120, 'MISSING_UTR'],
    ['CASE 10 demo screenshot', ['Google Pay', 'DEMO', 'Payment Successful', '₹120', UPI, DATE_LINE, 'UTR: DEMO000001'].join('\n'), 120, 'DEMO_SCREENSHOT'],
  ];
  for (const [name, text, amount, reason] of negatives) {
    it(`${name} → REJECTED/${reason} in both`, async () => {
      const { m, t } = await bothContexts(text, amount);
      expect(m.decision).toBe('rejected');
      expect(m.reason).toBe(reason);
      expect(t.decision).toBe(m.decision);
      expect(t.reason).toBe(m.reason);
    });
  }

  it('CASE 8 low OCR confidence → REJECTED in both', async () => {
    AT_0940();
    runOCR.mockResolvedValue({ text: receipt({}), confidence: 20 });
    const m = await runScreenshotVerification({ imageBuffer: Buffer.from('a'), expectedAmount: 120, receiverUpi: UPI });
    const t = await runScreenshotVerification({ imageBuffer: Buffer.from('b'), expectedAmount: 120, receiverUpi: UPI });
    expect(m.verificationResult.decision).toBe('rejected');
    expect(t.verificationResult.decision).toBe(m.verificationResult.decision);
    expect(t.verificationResult.reason).toBe(m.verificationResult.reason);
  });
});

// CASE 13/14 — currency-collision parity.
describe('PARITY ₹2120 collisions reject in both flows', () => {
  it('CASE 13/14: genuine ₹2120 for ₹120 → REJECTED/AMOUNT_MISMATCH in both', async () => {
    const { m, t } = await bothContexts(receipt({ amount: '₹2120' }), 120);
    expect(m.decision).toBe('rejected');
    expect(m.reason).toBe('AMOUNT_MISMATCH');
    expect(t.decision).toBe(m.decision);
    expect(t.reason).toBe(m.reason);
  });
});

// CASE 15–20 — provider parity in both flows.
describe('PARITY providers decide identically in both flows', () => {
  const providers = {
    'CASE 15 Paytm': ['Paytm', 'Money Sent Successfully', '₹120', `To: ${UPI}`, 'UPI Ref No: PTPARITY01', DATE_LINE].join('\n'),
    'CASE 16 GPay dark': ['Google Pay', 'Payment Successful', '₹120', 'To Jayaraj', UPI, `Date: ${DATE_LINE}`, 'UPI transaction ID: T7DARKP01'].join('\n'),
    'CASE 17 GPay light': ['Google Pay', 'Payment Successful', '₹120', 'To Jayaraj', UPI, `Date: ${DATE_LINE}`, 'UPI transaction ID: T7LITEP01'].join('\n'),
    'CASE 18 PhonePe': ['PhonePe', 'Transaction Successful', '₹120', `Paid to ${UPI}`, DATE_LINE, 'Transaction ID: PPPARITY01'].join('\n'),
    'CASE 19 BHIM': ['BHIM', 'Payment Successful', '₹120', `To: ${UPI}`, 'UPI Reference Number: BHIMPAR001', DATE_LINE].join('\n'),
    'CASE 20 Bank UPI': ['SBI UPI', 'Transferred Successfully', 'Rs.120', `To: ${UPI}`, 'Bank Ref No: SBINPAR001', DATE_LINE].join('\n'),
  };
  for (const [name, text] of Object.entries(providers)) {
    it(`${name} → same APPROVED decision in both`, async () => {
      const { m, t } = await bothContexts(text, 120);
      expect(m.decision).toBe('approved');
      expect(t.decision).toBe(m.decision);
      expect(t.reason).toBe(m.reason);
    });
  }
});
