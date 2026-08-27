import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractAmounts,
  extractUPIs,
  extractUTRs,
  extractDateTimes,
  extractTransactionStatus,
  extractPaymentData,
  matchAmount,
  matchUPIWithRecovery,
  wordToNumber,
} from '../../services/ocrService.js';
import {
  runScreenshotVerification,
  decidePaymentVerification,
} from '../../services/verificationService.js';

const { runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery } = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
  runAdditionalOCRPasses: vi.fn(),
  runDeepAmountRecovery: vi.fn(),
}));

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery };
});

vi.mock('../../db/supabase.js', () => ({
  supabase: { from: vi.fn(() => ({ insert: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle: vi.fn() })) })), delete: vi.fn() })) },
  supabaseAnon: {},
  default: {},
}));

const RECEIVER_UPI = 'jayarajj126-3@okicici';
const NOW = () => new Date('2026-08-27T04:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  runAdditionalOCRPasses.mockResolvedValue([]);
  runDeepAmountRecovery.mockResolvedValue([]);
});

function gpayText(amount, upi, dateStr, utr = 'T7GHD123456') {
  return [
    'To Jayaraj',
    '+91 98765 4780',
    `₹${amount}`,
    'Completed',
    dateStr,
    'Canara Bank 8619',
    'UPI transaction ID',
    utr,
    upi,
    'Google Pay',
  ].join('\n');
}

function paytmText(amount, upi, dateStr, utr = 'PT6543210987') {
  return [
    'Money Sent Successfully',
    `Rupees ${wordToWords(amount)} Only`,
    'To: Jeyaraj Alagar',
    `UPI ID: ${upi}`,
    `UPI Ref No: ${utr}`,
    dateStr,
    'Paytm',
  ].join('\n');
}

function wordToWords(n) {
  if (n === 120) return 'One Hundred Twenty';
  if (n === 250) return 'Two Hundred Fifty';
  if (n === 500) return 'Five Hundred';
  if (n === 750) return 'Seven Hundred Fifty';
  if (n === 1000) return 'One Thousand';
  if (n === 1500) return 'One Thousand Five Hundred';
  if (n === 2500) return 'Two Thousand Five Hundred';
  if (n === 5000) return 'Five Thousand';
  return String(n);
}

// ═══════════════════════════════════════════════════════════════
// SECTION 1: wordToNumber — generic amount parser
// ═══════════════════════════════════════════════════════════════
describe('wordToNumber: generic compound amount parsing', () => {
  it('One Hundred Twenty → 120', () => expect(wordToNumber('One Hundred Twenty')).toBe(120));
  it('Two Hundred Fifty → 250', () => expect(wordToNumber('Two Hundred Fifty')).toBe(250));
  it('Five Hundred → 500', () => expect(wordToNumber('Five Hundred')).toBe(500));
  it('Seven Hundred Fifty → 750', () => expect(wordToNumber('Seven Hundred Fifty')).toBe(750));
  it('One Thousand → 1000', () => expect(wordToNumber('One Thousand')).toBe(1000));
  it('One Thousand Five Hundred → 1500', () => expect(wordToNumber('One Thousand Five Hundred')).toBe(1500));
  it('Two Thousand Five Hundred → 2500', () => expect(wordToNumber('Two Thousand Five Hundred')).toBe(2500));
  it('Five Thousand → 5000', () => expect(wordToNumber('Five Thousand')).toBe(5000));
  it('Four Thousand One Hundred Twenty → 4120', () => expect(wordToNumber('Four Thousand One Hundred Twenty')).toBe(4120));
  it('Nine Thousand Nine Hundred Ninety Nine → 9999', () => expect(wordToNumber('Nine Thousand Nine Hundred Ninety Nine')).toBe(9999));
  it('zero → 0', () => expect(wordToNumber('zero')).toBe(0));
  it('empty → 0', () => expect(wordToNumber('')).toBe(0));
  it('null → 0', () => expect(wordToNumber(null)).toBe(0));
});

// ═══════════════════════════════════════════════════════════════
// SECTION 2: extractAmounts — all currency formats
// ═══════════════════════════════════════════════════════════════
describe('extractAmounts: provider-agnostic currency formats', () => {
  it('₹120', () => expect(extractAmounts('₹120')).toContain(120));
  it('₹ 120', () => expect(extractAmounts('₹ 120')).toContain(120));
  it('Rs 120', () => expect(extractAmounts('Rs 120')).toContain(120));
  it('Rs. 120', () => expect(extractAmounts('Rs. 120')).toContain(120));
  it('INR 120', () => expect(extractAmounts('INR 120')).toContain(120));
  it('₹120.00', () => expect(extractAmounts('₹120.00')).toContain(120));
  it('₹1,000', () => expect(extractAmounts('₹1,000')).toContain(1000));
  it('₹5,000.00', () => expect(extractAmounts('₹5,000.00')).toContain(5000));
  it('₹250', () => expect(extractAmounts('₹250')).toContain(250));
  it('₹750', () => expect(extractAmounts('₹750')).toContain(750));
  it('₹1500', () => expect(extractAmounts('₹1500')).toContain(1500));
  it('₹2500', () => expect(extractAmounts('₹2500')).toContain(2500));
  it('₹5000', () => expect(extractAmounts('₹5000')).toContain(5000));
  it('Amount: 500', () => expect(extractAmounts('Amount: 500')).toContain(500));
  it('Paid 1000', () => expect(extractAmounts('Paid 1000')).toContain(1000));
  it('Rupees One Hundred Twenty Only → 120', () => expect(extractAmounts('Rupees One Hundred Twenty Only')).toContain(120));
  it('Rupees Five Hundred Only → 500', () => expect(extractAmounts('Rupees Five Hundred Only')).toContain(500));
  it('Rupees One Thousand Only → 1000', () => expect(extractAmounts('Rupees One Thousand Only')).toContain(1000));
  it('Rupees Two Thousand Five Hundred Only → 2500', () => expect(extractAmounts('Rupees Two Thousand Five Hundred Only')).toContain(2500));
  it('INR Five Hundred → 500', () => expect(extractAmounts('INR Five Hundred')).toContain(500));
  it('Rs. One Hundred Twenty Only → 120', () => expect(extractAmounts('Rs. One Hundred Twenty Only')).toContain(120));
  it('bare 120.00 without context → empty', () => expect(extractAmounts('120.00')).toEqual([]));
  it('date noise → empty', () => expect(extractAmounts('26/08/2026, 5:56 PM')).toEqual([]));
  it('random English without currency → empty', () => expect(extractAmounts('One Hundred Twenty something')).toEqual([]));
});

// ═══════════════════════════════════════════════════════════════
// SECTION 3: Match functions — exact monetary comparison
// ═══════════════════════════════════════════════════════════════
describe('matchAmount: exact monetary comparison', () => {
  it('120 matches 120', () => expect(matchAmount([120], 120)).toBe(true));
  it('120.0 matches 120', () => expect(matchAmount([120.0], 120)).toBe(true));
  it('120 does NOT match 120.01', () => expect(matchAmount([120.01], 120)).toBe(false));
  it('120 does NOT match 121', () => expect(matchAmount([121], 120)).toBe(false));
  it('500 does NOT match 5000', () => expect(matchAmount([5000], 500)).toBe(false));
  it('1000 does NOT match 100', () => expect(matchAmount([100], 1000)).toBe(false));
  it('2120 does NOT match 120 (currency corruption)', () => expect(matchAmount([2120], 120)).toBe(false));
  it('2500 does NOT match 500 (currency corruption)', () => expect(matchAmount([2500], 500)).toBe(false));
  it('empty list does NOT match any amount', () => expect(matchAmount([], 120)).toBe(false));
  it('list without matching amount', () => expect(matchAmount([500, 1000], 120)).toBe(false));
});

// ═══════════════════════════════════════════════════════════════
// SECTION 4: UPI extraction and matching
// ═══════════════════════════════════════════════════════════════
describe('UPI extraction and matching', () => {
  it('extracts receiver UPI from GPay format', () => {
    const upis = extractUPIs('To: JEYARAJ ALAGAR\nGoogle Pay jayarajj126-3@okicici');
    expect(upis).toContain('jayarajj126-3@okicici');
  });
  it('extracts receiver UPI from Paytm format', () => {
    const upis = extractUPIs('UPI ID: jayarajj126-3@okicici\nFrom: Someone');
    expect(upis).toContain('jayarajj126-3@okicici');
  });
  it('does NOT match wrong UPI', () => {
    const result = matchUPIWithRecovery(['attacker@paytm'], RECEIVER_UPI);
    expect(result.match).toBe(false);
  });
  it('exact match → approved', () => {
    const result = matchUPIWithRecovery(['jayarajj126-3@okicici'], RECEIVER_UPI);
    expect(result.match).toBe(true);
    expect(result.method).toBe('exact');
  });
  it('trailing char dropped → recovered', () => {
    const result = matchUPIWithRecovery(['jayarajj126-3@okicic'], RECEIVER_UPI);
    expect(result.match).toBe(true);
    expect(result.method).toBe('ocr_recovery_truncation');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 5: Date/time extraction
// ═══════════════════════════════════════════════════════════════
describe('Date/time extraction', () => {
  it('GPay format: 27/08/2026, 9:25 AM', () => {
    const entries = extractDateTimes('27/08/2026, 9:25 AM');
    expect(entries.length).toBe(1);
    expect(entries[0].hasTime).toBe(true);
    expect(entries[0].day).toBe(27);
    expect(entries[0].month).toBe(8);
  });
  it('Paytm format: 9:12 AM, 27/8/2026 (time-before-date)', () => {
    const entries = extractDateTimes('9:12 AM, 27/8/2026');
    expect(entries.length).toBe(1);
    expect(entries[0].hasTime).toBe(true);
    expect(entries[0].hour).toBe(9);
    expect(entries[0].minute).toBe(12);
    expect(entries[0].ampm).toBe('AM');
  });
  it('month-name format: 27 Aug 2026, 9:25 AM', () => {
    const entries = extractDateTimes('27 Aug 2026, 9:25 AM');
    expect(entries.length).toBe(1);
    expect(entries[0].hasTime).toBe(true);
    expect(entries[0].day).toBe(27);
    expect(entries[0].month).toBe(8);
  });
  it('US format: Aug 27, 2026, 9:25 AM', () => {
    const entries = extractDateTimes('Aug 27, 2026, 9:25 AM');
    expect(entries.length).toBe(1);
    expect(entries[0].hasTime).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 6: Transaction status
// ═══════════════════════════════════════════════════════════════
describe('Transaction status', () => {
  it('Completed → success', () => expect(extractTransactionStatus('Completed').status).toBe('success'));
  it('Success → success', () => expect(extractTransactionStatus('Success').status).toBe('success'));
  it('Successful → success', () => expect(extractTransactionStatus('Successful').status).toBe('success'));
  it('Money Sent Successfully → success', () => expect(extractTransactionStatus('Money Sent Successfully').status).toBe('success'));
  it('Paid → success', () => expect(extractTransactionStatus('Paid').status).toBe('success'));
  it('Failed → failed', () => expect(extractTransactionStatus('Failed').status).toBe('failed'));
  it('Cancelled → failed', () => expect(extractTransactionStatus('Cancelled').status).toBe('failed'));
  it('Pending → failed', () => expect(extractTransactionStatus('Pending').status).toBe('failed'));
  it('null for unknown', () => expect(extractTransactionStatus('Something random')).toBeNull());
});

// ═══════════════════════════════════════════════════════════════
// SECTION 7: decidePaymentVerification — strict binary gates
// ═══════════════════════════════════════════════════════════════
describe('decidePaymentVerification: strict binary', () => {
  it('ALL pass → approved', () => {
    const r = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true, transactionStatusOk: true, ocrConfidence: 90 });
    expect(r.decision).toBe('approved');
  });
  it('wrong UPI → rejected UPI_MISMATCH', () => {
    const r = decidePaymentVerification({ upiMatch: false, amountMatch: true, dateValid: true, utrPresent: true, transactionStatusOk: true, ocrConfidence: 90 });
    expect(r.decision).toBe('rejected');
    expect(r.reason).toBe('UPI_MISMATCH');
  });
  it('wrong amount → rejected AMOUNT_MISMATCH', () => {
    const r = decidePaymentVerification({ upiMatch: true, amountMatch: false, dateValid: true, utrPresent: true, transactionStatusOk: true, ocrConfidence: 90 });
    expect(r.decision).toBe('rejected');
    expect(r.reason).toBe('AMOUNT_MISMATCH');
  });
  it('invalid date → rejected INVALID_PAYMENT_DATE', () => {
    const r = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: false, utrPresent: true, transactionStatusOk: true, ocrConfidence: 90 });
    expect(r.decision).toBe('rejected');
    expect(r.reason).toBe('INVALID_PAYMENT_DATE');
  });
  it('missing UTR → rejected MISSING_UTR', () => {
    const r = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: true, utrPresent: false, transactionStatusOk: true, ocrConfidence: 90 });
    expect(r.decision).toBe('rejected');
    expect(r.reason).toBe('MISSING_UTR');
  });
  it('failed tx → rejected TRANSACTION_FAILED', () => {
    const r = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true, transactionStatusOk: false, ocrConfidence: 90 });
    expect(r.decision).toBe('rejected');
    expect(r.reason).toBe('TRANSACTION_FAILED');
  });
  it('low OCR → rejected LOW_OCR_CONFIDENCE', () => {
    const r = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true, transactionStatusOk: true, ocrConfidence: 30 });
    expect(r.decision).toBe('rejected');
    expect(r.reason).toBe('LOW_OCR_CONFIDENCE');
  });
  it('no path to manual_review', () => {
    const combos = [
      { upiMatch: false, amountMatch: false, dateValid: false, utrPresent: false, transactionStatusOk: false, ocrConfidence: 0 },
      { upiMatch: true, amountMatch: false, dateValid: false, utrPresent: false, transactionStatusOk: false, ocrConfidence: 0 },
      { upiMatch: true, amountMatch: true, dateValid: false, utrPresent: false, transactionStatusOk: false, ocrConfidence: 0 },
      { upiMatch: true, amountMatch: true, dateValid: true, utrPresent: false, transactionStatusOk: false, ocrConfidence: 0 },
      { upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true, transactionStatusOk: false, ocrConfidence: 0 },
      { upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true, transactionStatusOk: true, ocrConfidence: 0 },
      { upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true, transactionStatusOk: true, ocrConfidence: 55 },
    ];
    for (const combo of combos) {
      const { decision } = decidePaymentVerification(combo);
      expect(['approved', 'rejected']).toContain(decision);
      expect(decision).not.toBe('manual_review');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 8: Full pipeline — GPay ALL amounts (mocked OCR)
// ═══════════════════════════════════════════════════════════════
describe('Full pipeline: GPay receipts — all amounts', () => {
  const amounts = [120, 250, 500, 750, 1000, 1500, 2500, 5000];
  for (const amt of amounts) {
    it(`GPay ₹${amt} → APPROVED`, async () => {
      runOCR.mockResolvedValue({ text: gpayText(amt, RECEIVER_UPI, '27/08/2026, 9:25 AM'), confidence: 85 });
      const { verificationResult } = await runScreenshotVerification({
        imageBuffer: Buffer.from('img'), expectedAmount: amt, receiverUpi: RECEIVER_UPI, now: NOW(),
      });
      expect(verificationResult.decision).toBe('approved');
      expect(verificationResult.amountMatch).toBe(true);
      expect(verificationResult.upiMatch).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION 9: Full pipeline — Paytm ALL amounts (mocked OCR)
// ═══════════════════════════════════════════════════════════════
describe('Full pipeline: Paytm receipts — all amounts', () => {
  const amounts = [120, 250, 500, 750, 1000, 1500, 2500, 5000];
  for (const amt of amounts) {
    it(`Paytm ₹${amt} (word-based) → APPROVED`, async () => {
      runOCR.mockResolvedValue({
        text: paytmText(amt, RECEIVER_UPI, '9:12 AM, 27/8/2026'),
        confidence: 75,
      });
      const { verificationResult } = await runScreenshotVerification({
        imageBuffer: Buffer.from('img'), expectedAmount: amt, receiverUpi: RECEIVER_UPI, now: NOW(),
      });
      expect(verificationResult.decision).toBe('approved');
      expect(verificationResult.amountMatch).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION 10: Full pipeline — numeric ₹ amounts for all providers
// ═══════════════════════════════════════════════════════════════
describe('Full pipeline: numeric ₹ amounts — all providers', () => {
  const providers = [
    ['GPay', (a, u, d) => `Google Pay\nPayment Successful\n₹${a}\nTo Jayaraj\n${u}\nDate: ${d}\nUPI transaction ID: T7GHD123456`],
    ['PhonePe', (a, u, d) => `PhonePe\nTransaction Successful\nPaid ₹${a} to ${u}\n${d}\nRef No: PP8901234567`],
    ['Paytm', (a, u, d) => `Paytm\nPayment Successful\n₹${a}\nPaid to ${u}\nUPI Ref No: PT6543210987\n${d}`],
    ['BHIM', (a, u, d) => `BHIM\nPayment Sent Successfully\nAmount: ₹${a}\nTo: ${u}\nTransaction ID: BH9876543210\n${d}`],
    ['Bank UPI', (a, u, d) => `ICICI Bank UPI\nTransfer Successful\nYou paid ₹${a} to ${u}\nBank Ref No: IC2345678901\n${d}`],
    ['Amazon Pay', (a, u, d) => `Amazon Pay UPI\nPayment Completed\n₹${a} paid to ${u}\nReference ID: AMZ1234567890\n${d}`],
  ];

  for (const [name, receiptFn] of providers) {
    for (const amt of [120, 500, 1000]) {
      it(`${name} ₹${amt} → APPROVED`, async () => {
        runOCR.mockResolvedValue({ text: receiptFn(amt, RECEIVER_UPI, '27/08/2026, 9:25 AM'), confidence: 85 });
        const { verificationResult } = await runScreenshotVerification({
          imageBuffer: Buffer.from('img'), expectedAmount: amt, receiverUpi: RECEIVER_UPI, now: NOW(),
        });
        expect(verificationResult.decision).toBe('approved');
      });
    }
  }
});

// ═══════════════════════════════════════════════════════════════
// SECTION 11: WRONG AMOUNT — must reject
// ═══════════════════════════════════════════════════════════════
describe('Strict rejection: wrong amount', () => {
  it('Expected 120, screenshot 500 → REJECTED', async () => {
    runOCR.mockResolvedValue({ text: gpayText(500, RECEIVER_UPI, '27/08/2026, 9:25 AM'), confidence: 85 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('AMOUNT_MISMATCH');
    expect(verificationResult.amountMatch).toBe(false);
  });

  it('Expected 500, screenshot 120 → REJECTED', async () => {
    runOCR.mockResolvedValue({ text: gpayText(120, RECEIVER_UPI, '27/08/2026, 9:25 AM'), confidence: 85 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 500, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('AMOUNT_MISMATCH');
  });

  it('Expected 1000, screenshot 500 → REJECTED', async () => {
    runOCR.mockResolvedValue({ text: gpayText(500, RECEIVER_UPI, '27/08/2026, 9:25 AM'), confidence: 85 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 1000, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('AMOUNT_MISMATCH');
  });

  it('Expected 120, OCR sees 2120 → REJECTED (no fuzzy match)', async () => {
    runOCR.mockResolvedValue({ text: gpayText(120, RECEIVER_UPI, '27/08/2026, 9:25 AM').replace('₹120', '2120'), confidence: 85 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.amountMatch).toBe(false);
  });

  it('Expected 500, OCR sees 5000 → REJECTED', async () => {
    runOCR.mockResolvedValue({ text: gpayText(500, RECEIVER_UPI, '27/08/2026, 9:25 AM').replace('₹500', '5000'), confidence: 85 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 500, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.amountMatch).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 12: WRONG UPI — must reject
// ═══════════════════════════════════════════════════════════════
describe('Strict rejection: wrong UPI', () => {
  it('all providers reject wrong UPI', async () => {
    const layouts = [
      ['GPay', gpayText(120, 'attacker@okicici', '27/08/2026, 9:25 AM')],
      ['PhonePe', `PhonePe\nTransaction Successful\nPaid ₹120 to attacker@okicici\n27/08/2026, 9:25 AM\nRef No: PP8901234567`],
      ['Paytm', `Paytm\nPayment Successful\n₹120\nPaid to attacker@okicici\nUPI Ref No: PT6543210987\n27/08/2026, 9:25 AM`],
    ];
    for (const [name, text] of layouts) {
      runOCR.mockResolvedValue({ text, confidence: 85 });
      const { verificationResult } = await runScreenshotVerification({
        imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
      });
      expect(verificationResult.decision, `${name} should reject wrong UPI`).toBe('rejected');
      expect(verificationResult.reason, `${name} reason`).toBe('UPI_MISMATCH');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 13: MISSING TIME — must reject
// ═══════════════════════════════════════════════════════════════
describe('Strict rejection: missing/invalid time', () => {
  it('date-only receipt → REJECTED', async () => {
    runOCR.mockResolvedValue({ text: gpayText(120, RECEIVER_UPI, '27/08/2026'), confidence: 85 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('old date → REJECTED', async () => {
    runOCR.mockResolvedValue({ text: gpayText(120, RECEIVER_UPI, '15/08/2026, 9:25 AM'), confidence: 85 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 14: FAILED/PENDING TRANSACTION — must reject
// ═══════════════════════════════════════════════════════════════
describe('Strict rejection: failed/pending transaction', () => {
  it('Failed → REJECTED', async () => {
    runOCR.mockResolvedValue({ text: gpayText(120, RECEIVER_UPI, '27/08/2026, 9:25 AM', 'T7GHD123456').replace('Completed', 'Failed'), confidence: 85 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('TRANSACTION_FAILED');
  });

  it('Pending → REJECTED', async () => {
    runOCR.mockResolvedValue({ text: gpayText(120, RECEIVER_UPI, '27/08/2026, 9:25 AM').replace('Completed', 'Pending'), confidence: 85 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('TRANSACTION_FAILED');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 15: MISSING UTR — must reject
// ═══════════════════════════════════════════════════════════════
describe('Strict rejection: missing UTR', () => {
  it('no UTR → REJECTED', async () => {
    runOCR.mockResolvedValue({
      text: `Google Pay\nPayment Successful\n₹120\nTo Jayaraj\n${RECEIVER_UPI}\n27/08/2026, 9:25 AM`,
      confidence: 85,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('MISSING_UTR');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 16: DEMO/SAMPLE — must reject
// ═══════════════════════════════════════════════════════════════
describe('DEMO/SAMPLE rejection', () => {
  it.each([
    ['DEMO', 'Google Pay\nDEMO\nPayment Successful\n₹120\nTo Jayaraj\n' + RECEIVER_UPI + '\n27/08/2026, 9:25 AM\nUPI Ref No: 123456789'],
    ['SAMPLE', 'PhonePe\nSAMPLE\nTransaction Successful\n₹120\nPaid to ' + RECEIVER_UPI + '\n27/08/2026, 9:25 AM\nUTR: 9876543210'],
    ['test payment', 'UPI\nTEST PAYMENT\nCompleted\n₹120\n' + RECEIVER_UPI + '\nRef No: 444555666\n27/08/2026, 9:25 AM'],
    ['MOCK', 'Google Pay\nMOCK\nPayment Successful\n₹120\nTo Jayaraj\n' + RECEIVER_UPI + '\n27/08/2026, 9:25 AM\nUPI Ref No: 777888999'],
    ['fake', 'Google Pay\nThis is a fake screenshot\nPayment Successful\n₹120\nTo Jayaraj\n' + RECEIVER_UPI + '\n27/08/2026, 9:25 AM\nUPI Ref No: 147147147'],
  ])('"%s" → REJECTED with DEMO_SCREENSHOT', async (label, text) => {
    runOCR.mockResolvedValue({ text, confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('DEMO_SCREENSHOT');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 17: GPay STYLIZED AMOUNT — real screenshot simulation
// ═══════════════════════════════════════════════════════════════
describe('GPay stylized amount recovery (pipeline simulation)', () => {
  it('primary OCR drops amount, recovery finds it → APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: 'To Jayaraj\n+91 98765 4780\nCompleted\n27/08/2026, 9:25 AM\nCanara Bank 8619\nUPI transaction ID\nT7GHD123456\njayarajj126-3@okicici\nGoogle Pay',
      confidence: 85,
    });
    runAmountRecoveryOCR.mockResolvedValue([120]);
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.amountMatch).toBe(true);
    expect(verificationResult.recoveredFromBands).toBe(true);
  });

  it('primary OCR drops amount, standard recovery fails, deep recovery finds it → APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: 'To Jayaraj\n+91 98765 4780\nCompleted\n27/08/2026, 9:25 AM\nCanara Bank 8619\nUPI transaction ID\nT7GHD123456\njayarajj126-3@okicici\nGoogle Pay',
      confidence: 85,
    });
    runAmountRecoveryOCR.mockResolvedValue([]);
    runDeepAmountRecovery.mockResolvedValue([120]);
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.amountMatch).toBe(true);
    expect(verificationResult.recoveredFromBands).toBe(true);
  });

  it('primary drops, both recoveries fail → REJECTED', async () => {
    runOCR.mockResolvedValue({
      text: 'To Jayaraj\n+91 98765 4780\nCompleted\n27/08/2026, 9:25 AM\nCanara Bank 8619\nUPI transaction ID\nT7GHD123456\njayarajj126-3@okicici\nGoogle Pay',
      confidence: 85,
    });
    runAmountRecoveryOCR.mockResolvedValue([]);
    runDeepAmountRecovery.mockResolvedValue([]);
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('AMOUNT_MISMATCH');
  });

  it('₹500: recovery finds it → APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: 'To Jayaraj\nCompleted\n27/08/2026, 9:25 AM\nCanara Bank 8619\nUPI transaction ID\nT7GHD123456\njayarajj126-3@okicici',
      confidence: 85,
    });
    runAmountRecoveryOCR.mockResolvedValue([500]);
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 500, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.amountMatch).toBe(true);
  });

  it('₹1000: deep recovery finds it → APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: 'To Jayaraj\nCompleted\n27/08/2026, 9:25 AM\nCanara Bank 8619\nUPI transaction ID\nT7GHD123456\njayarajj126-3@okicici',
      confidence: 85,
    });
    runAmountRecoveryOCR.mockResolvedValue([]);
    runDeepAmountRecovery.mockResolvedValue([1000]);
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 1000, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.amountMatch).toBe(true);
  });

  it('₹2500: deep recovery finds it → APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: 'To Jayaraj\nCompleted\n27/08/2026, 9:25 AM\nCanara Bank 8619\nUPI transaction ID\nT7GHD123456\njayarajj126-3@okicici',
      confidence: 85,
    });
    runAmountRecoveryOCR.mockResolvedValue([]);
    runDeepAmountRecovery.mockResolvedValue([2500]);
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 2500, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.amountMatch).toBe(true);
  });

  it('₹5000: primary finds it → APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: 'To Jayaraj\n₹5000\nCompleted\n27/08/2026, 9:25 AM\nCanara Bank 8619\nUPI transaction ID\nT7GHD123456\njayarajj126-3@okicici',
      confidence: 85,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 5000, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.amountMatch).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 18: LOW OCR CONFIDENCE — must reject
// ═══════════════════════════════════════════════════════════════
describe('Strict rejection: low OCR confidence', () => {
  it('OCR confidence 40 → REJECTED', async () => {
    runOCR.mockResolvedValue({ text: gpayText(120, RECEIVER_UPI, '27/08/2026, 9:25 AM'), confidence: 40 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('LOW_OCR_CONFIDENCE');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 19: FIELD CONFIDENCE — all fields must be high
// ═══════════════════════════════════════════════════════════════
describe('Field-level confidence', () => {
  it('valid receipt → all fields high', async () => {
    runOCR.mockResolvedValue({ text: gpayText(120, RECEIVER_UPI, '27/08/2026, 9:25 AM'), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.fieldConfidence.amount.confidence).toBe('high');
    expect(verificationResult.fieldConfidence.receiverUpi.confidence).toBe('high');
    expect(verificationResult.fieldConfidence.utr.confidence).toBe('high');
    expect(verificationResult.fieldConfidence.transactionDate.confidence).toBe('high');
    expect(verificationResult.fieldConfidence.transactionStatus.confidence).toBe('high');
  });

  it('wrong amount → amount confidence low', async () => {
    runOCR.mockResolvedValue({ text: gpayText(500, RECEIVER_UPI, '27/08/2026, 9:25 AM'), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.fieldConfidence.amount.confidence).toBe('low');
  });

  it('no amount → amount confidence none', async () => {
    runOCR.mockResolvedValue({
      text: `Google Pay\nPayment Successful\nTo Jayaraj\n${RECEIVER_UPI}\n27/08/2026, 9:25 AM\nUPI Ref No: T7GHD123456`,
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.fieldConfidence.amount.confidence).toBe('none');
  });
});
