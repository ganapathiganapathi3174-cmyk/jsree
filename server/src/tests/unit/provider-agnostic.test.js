import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runScreenshotVerification,
  decidePaymentVerification,
} from '../../services/verificationService.js';
import {
  extractAmounts,
  extractUPIs,
  extractUTRs,
  extractDateTimes,
  extractDates,
  extractTransactionStatus,
  extractPaymentData,
  matchAmount,
  matchUPI,
  isWithinForwardWindow,
} from '../../services/ocrService.js';

const { runOCR, runAmountRecoveryOCR } = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
}));

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR };
});

vi.mock('../../db/supabase.js', () => ({
  supabase: { from: vi.fn(() => ({ insert: vi.fn(() => ({ select: vi.fn(() => ({ maybeSingle: vi.fn() })) })), delete: vi.fn() })) },
  supabaseAnon: {},
  default: {},
}));

const RECEIVER_UPI = 'jayarajj126-3@okicici';
const NOW = () => new Date('2026-08-24T07:30:00.000Z'); // 2026-08-24 13:00 IST
const VALID_DATE = '24/08/2026, 1:00 PM';
const VALID_DATE_MONTH = '24 Aug 2026, 1:00 pm';
const VALID_DATE_24H = '24/08/2026 13:00';
const OLD_DATE = '23/08/2026, 1:00 PM';

beforeEach(() => {
  vi.clearAllMocks();
  runAmountRecoveryOCR.mockResolvedValue([]);
});

// ═══════════════════════════════════════════════════════════════
// HELPER: build receipt text for different UPI app layouts
// ═══════════════════════════════════════════════════════════════

function gpayReceipt(amount, upi, dateStr, extra = '') {
  return [
    `Google Pay`,
    `Payment Successful`,
    `₹${amount}`,
    `To Jayaraj`,
    `${upi}`,
    `Date: ${dateStr}`,
    `UPI transaction ID: T7GHD123456`,
    extra,
  ].filter(Boolean).join('\n');
}

function phonepeReceipt(amount, upi, dateStr, extra = '') {
  return [
    `PhonePe`,
    `Transaction Successful`,
    `Paid ₹${amount} to ${upi}`,
    `${dateStr}`,
    `Ref No: PP8901234567`,
    extra,
  ].filter(Boolean).join('\n');
}

function paytmReceipt(amount, upi, dateStr, extra = '') {
  return [
    `Paytm`,
    `Payment Successful`,
    `₹${amount}`,
    `Paid to ${upi}`,
    `UPI Ref No: PT6543210987`,
    `${dateStr}`,
    extra,
  ].filter(Boolean).join('\n');
}

function paytmSplitDateTime(amount, upi, datePart, timePart, extra = '') {
  return [
    `Paytm`,
    `Payment Successful`,
    `₹${amount}`,
    `Paid to ${upi}`,
    `UPI Ref No: PT6543210987`,
    `${datePart}`,
    `${timePart}`,
    extra,
  ].filter(Boolean).join('\n');
}

function bhimReceipt(amount, upi, dateStr, extra = '') {
  return [
    `BHIM`,
    `Payment Sent Successfully`,
    `Amount: ₹${amount}`,
    `To: ${upi}`,
    `Transaction ID: BH9876543210`,
    `${dateStr}`,
    extra,
  ].filter(Boolean).join('\n');
}

function bankUpiReceipt(amount, upi, dateStr, extra = '') {
  return [
    `ICICI Bank UPI`,
    `Transfer Successful`,
    `You paid ₹${amount} to ${upi}`,
    `Bank Ref No: IC2345678901`,
    `${dateStr}`,
    extra,
  ].filter(Boolean).join('\n');
}

function amazonPayReceipt(amount, upi, dateStr, extra = '') {
  return [
    `Amazon Pay UPI`,
    `Payment Completed`,
    `₹${amount} paid to ${upi}`,
    `Reference ID: AMZ1234567890`,
    `${dateStr}`,
    extra,
  ].filter(Boolean).join('\n');
}

// ═══════════════════════════════════════════════════════════════
// SECTION 1: EXTRACTION FUNCTION TESTS
// ═══════════════════════════════════════════════════════════════

describe('Extraction: Amounts from different formats', () => {
  it('extracts ₹120 (no space)', () => {
    expect(extractAmounts('₹120')).toContain(120);
  });
  it('extracts ₹ 120 (with space)', () => {
    expect(extractAmounts('₹ 120')).toContain(120);
  });
  it('extracts Rs. 500', () => {
    expect(extractAmounts('Rs. 500')).toContain(500);
  });
  it('extracts INR 1000', () => {
    expect(extractAmounts('INR 1000')).toContain(1000);
  });
  it('extracts 120.00', () => {
    expect(extractAmounts('120.00')).toContain(120);
  });
  it('extracts "You paid ₹500"', () => {
    expect(extractAmounts('You paid ₹500')).toContain(500);
  });
  it('extracts "Payment of ₹1000"', () => {
    expect(extractAmounts('Payment of ₹1000')).toContain(1000);
  });
  it('extracts "Payment amount: 500"', () => {
    expect(extractAmounts('Payment amount: 500')).toContain(500);
  });
  it('extracts amount from "Transferred ₹500"', () => {
    expect(extractAmounts('Transferred ₹500')).toContain(500);
  });
  it('extracts ₹1,000 with comma', () => {
    expect(extractAmounts('₹1,000')).toContain(1000);
  });
});

describe('Extraction: UPI IDs from different formats', () => {
  it('extracts "to user@bank"', () => {
    expect(extractUPIs('Paid to user@bank')).toContain('user@bank');
  });
  it('extracts VPA with spaces fixed (OCR-inserted space before @)', () => {
    expect(extractUPIs('user @upi')).toContain('user@upi');
  });
  it('extracts UPI after "Sent to"', () => {
    expect(extractUPIs('Sent to merchant@okicici')).toContain('merchant@okicici');
  });
  it('extracts UPI after "VPA"', () => {
    expect(extractUPIs('VPA: user@paytm')).toContain('user@paytm');
  });
  it('extracts UPI after "UPI ID"', () => {
    expect(extractUPIs('UPI ID: abc@axis')).toContain('abc@axis');
  });
});

describe('Extraction: UTR/Reference numbers', () => {
  it('extracts UTR from "UPI Ref No: PT6543210987"', () => {
    expect(extractUTRs('UPI Ref No: PT6543210987')).toContain('PT6543210987');
  });
  it('extracts UTR from "Bank Ref No: IC2345678901"', () => {
    expect(extractUTRs('Bank Ref No: IC2345678901')).toContain('IC2345678901');
  });
  it('extracts UTR from "Transaction ID: BH9876543210"', () => {
    expect(extractUTRs('Transaction ID: BH9876543210')).toContain('BH9876543210');
  });
  it('extracts UTR from "Ref No: PP8901234567"', () => {
    expect(extractUTRs('Ref No: PP8901234567')).toContain('PP8901234567');
  });
  it('extracts UTR from "Reference ID: AMZ1234567890"', () => {
    expect(extractUTRs('Reference ID: AMZ1234567890')).toContain('AMZ1234567890');
  });
  it('extracts UTR from "UPI Ref: T7GHD123456"', () => {
    expect(extractUTRs('UPI Ref: T7GHD123456')).toContain('T7GHD123456');
  });
  it('extracts UTR from "Payment Ref: 123456789012"', () => {
    expect(extractUTRs('Payment Ref: 123456789012')).toContain('123456789012');
  });
  it('falls back to bare 10-14 digit number', () => {
    expect(extractUTRs('done 12345678901234')).toContain('12345678901234');
  });
});

describe('Extraction: Dates from different formats', () => {
  it('extracts "19/08/2026, 7:39 AM"', () => {
    const entries = extractDateTimes('19/08/2026, 7:39 AM');
    expect(entries.length).toBe(1);
    expect(entries[0].day).toBe(19);
    expect(entries[0].month).toBe(8);
    expect(entries[0].hasTime).toBe(true);
  });
  it('extracts "24 Aug 2026, 1:00 pm"', () => {
    const entries = extractDateTimes('24 Aug 2026, 1:00 pm');
    expect(entries.length).toBe(1);
    expect(entries[0].day).toBe(24);
    expect(entries[0].month).toBe(8);
    expect(entries[0].hasTime).toBe(true);
    expect(entries[0].ampm).toBe('pm');
  });
  it('extracts US format "Aug 19, 2026, 3:45 PM"', () => {
    const entries = extractDateTimes('Aug 19, 2026, 3:45 PM');
    expect(entries.length).toBe(1);
    expect(entries[0].day).toBe(19);
    expect(entries[0].month).toBe(8);
    expect(entries[0].hasTime).toBe(true);
  });
  it('extracts "19-08-2026 15:45" (24h)', () => {
    const entries = extractDateTimes('19-08-2026 15:45');
    expect(entries.length).toBe(1);
    expect(entries[0].day).toBe(19);
    expect(entries[0].hasTime).toBe(true);
    expect(entries[0].hour).toBe(15);
  });
  it('pairs cross-line date + time: date on line 1, time on line 2', () => {
    const entries = extractDateTimes('19/08/2026\n7:39 AM');
    expect(entries.length).toBe(2);
    expect(entries[0].hasTime).toBe(true);
    expect(entries[0].hour).toBe(7);
    expect(entries[0].ampm).toBe('AM');
    expect(entries[1].hasTime).toBe(true);
    expect(entries[1].day).toBe(19);
  });
  it('pairs cross-line month-name date + time', () => {
    const entries = extractDateTimes('19 Aug 2026\n3:45 PM');
    expect(entries.length).toBe(2);
    const timeEntry = entries.find(e => e.hasTime && e.ampm === 'PM');
    expect(timeEntry).toBeDefined();
    expect(timeEntry.hour).toBe(3);
  });
  it('returns empty for no dates', () => {
    expect(extractDateTimes('No date here')).toEqual([]);
  });
});

describe('isWithinForwardWindow: forward-only time validation', () => {
  const baseTime = new Date('2026-08-24T07:30:00.000Z'); // 13:00 IST

  it('exact same time -> true', () => {
    expect(isWithinForwardWindow(new Date('2026-08-24T07:30:00.000Z'), baseTime, 30)).toBe(true);
  });
  it('10 minutes in the future -> true', () => {
    expect(isWithinForwardWindow(new Date('2026-08-24T07:40:00.000Z'), baseTime, 30)).toBe(true);
  });
  it('30 minutes in the future -> true (boundary)', () => {
    expect(isWithinForwardWindow(new Date('2026-08-24T08:00:00.000Z'), baseTime, 30)).toBe(true);
  });
  it('31 minutes in the future -> false', () => {
    expect(isWithinForwardWindow(new Date('2026-08-24T08:01:00.000Z'), baseTime, 30)).toBe(false);
  });
  it('1 minute in the past -> false', () => {
    expect(isWithinForwardWindow(new Date('2026-08-24T07:29:00.000Z'), baseTime, 30)).toBe(false);
  });
  it('30 minutes in the past -> false', () => {
    expect(isWithinForwardWindow(new Date('2026-08-24T07:00:00.000Z'), baseTime, 30)).toBe(false);
  });
  it('null date -> false', () => {
    expect(isWithinForwardWindow(null, baseTime, 30)).toBe(false);
  });
});

describe('Extraction: Transaction status', () => {
  it('recognizes "Payment Successful"', () => {
    expect(extractTransactionStatus('Payment Successful').status).toBe('success');
  });
  it('recognizes "Transaction Successful"', () => {
    expect(extractTransactionStatus('Transaction Successful').status).toBe('success');
  });
  it('recognizes "Payment Sent Successfully"', () => {
    expect(extractTransactionStatus('Payment Sent Successfully').status).toBe('success');
  });
  it('recognizes "Transfer Successful"', () => {
    expect(extractTransactionStatus('Transfer Successful').status).toBe('success');
  });
  it('recognizes "Sent successfully"', () => {
    expect(extractTransactionStatus('Sent successfully').status).toBe('success');
  });
  it('recognizes "Completed"', () => {
    expect(extractTransactionStatus('Completed').status).toBe('success');
  });
  it('recognizes "Paid"', () => {
    expect(extractTransactionStatus('Paid').status).toBe('success');
  });
  it('recognizes "Payment Completed"', () => {
    expect(extractTransactionStatus('Payment Completed').status).toBe('success');
  });
  it('recognizes "Money Sent"', () => {
    expect(extractTransactionStatus('Money Sent').status).toBe('success');
  });
  it('recognizes "Transferred"', () => {
    expect(extractTransactionStatus('Transferred').status).toBe('success');
  });
  it('recognizes "Failed"', () => {
    expect(extractTransactionStatus('Failed').status).toBe('failed');
  });
  it('recognizes "Declined"', () => {
    expect(extractTransactionStatus('Declined').status).toBe('failed');
  });
  it('recognizes "Cancelled"', () => {
    expect(extractTransactionStatus('Cancelled').status).toBe('failed');
  });
  it('recognizes "Pending"', () => {
    expect(extractTransactionStatus('Pending').status).toBe('failed');
  });
  it('recognizes "Processing"', () => {
    expect(extractTransactionStatus('Processing').status).toBe('failed');
  });
  it('returns null for unknown status', () => {
    expect(extractTransactionStatus('Something random')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 2: FULL PIPELINE — VALID SCREENSHOTS
// ═══════════════════════════════════════════════════════════════

describe('Full pipeline: Google Pay receipt format', () => {
  it('valid GPay receipt with all fields -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.upiMatch).toBe(true);
  });

  it('GPay with month-name date format -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(500, RECEIVER_UPI, '24 Aug 2026, 1:00 pm'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 500, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
  });

  it('GPay with 24h time format -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, RECEIVER_UPI, '24/08/2026 13:00'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
  });
});

describe('Full pipeline: PhonePe receipt format', () => {
  it('valid PhonePe receipt -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: phonepeReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.upiMatch).toBe(true);
  });

  it('PhonePe with month-name date -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: phonepeReceipt(500, RECEIVER_UPI, '24 Aug 2026, 1:00 pm'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 500, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
  });

  it('PhonePe with "Transaction Successful" wording -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: phonepeReceipt(1000, RECEIVER_UPI, '24/08/2026 13:00'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 1000, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
  });
});

describe('Full pipeline: Paytm receipt format', () => {
  it('valid Paytm receipt with same-line date+time -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: paytmReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.upiMatch).toBe(true);
  });

  it('Paytm with split date+time (cross-line) -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: paytmSplitDateTime(120, RECEIVER_UPI, '24/08/2026', '1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.dateValid).toBe(true);
  });

  it('Paytm with month-name date -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: paytmReceipt(500, RECEIVER_UPI, '24 Aug 2026, 1:00 pm'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 500, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
  });

  it('Paytm with 24h format -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: paytmReceipt(1000, RECEIVER_UPI, '24/08/2026 13:00'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 1000, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
  });

  it('Paytm with "Payment Successful" wording -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: paytmReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.transactionStatus.status).toBe('success');
  });
});

describe('Full pipeline: BHIM receipt format', () => {
  it('valid BHIM receipt -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: bhimReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.upiMatch).toBe(true);
  });

  it('BHIM with "Payment Sent Successfully" wording -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: bhimReceipt(500, RECEIVER_UPI, '24 Aug 2026, 1:00 pm'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 500, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
  });
});

describe('Full pipeline: Bank UPI receipt format', () => {
  it('valid Bank UPI receipt -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: bankUpiReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.upiMatch).toBe(true);
  });

  it('Bank UPI with "Transfer Successful" wording -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: bankUpiReceipt(1000, RECEIVER_UPI, '24 Aug 2026, 1:00 pm'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 1000, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
  });

  it('Bank UPI with "You paid" wording -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: bankUpiReceipt(120, RECEIVER_UPI, '24/08/2026 13:00'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
  });
});

describe('Full pipeline: Amazon Pay receipt format', () => {
  it('valid Amazon Pay receipt -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: amazonPayReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.upiMatch).toBe(true);
  });

  it('Amazon Pay with "Payment Completed" wording -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: amazonPayReceipt(500, RECEIVER_UPI, '24 Aug 2026, 1:00 pm'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 500, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 3: INVALID SCREENSHOTS — REJECTION/REVIEW RULES
// ═══════════════════════════════════════════════════════════════

describe('Invalid screenshots: wrong UPI -> REJECTED', () => {
  it('all providers reject wrong UPI regardless of layout', async () => {
    const layouts = [
      ['GPay', gpayReceipt(120, 'attacker@okicici', '24/08/2026, 1:00 PM')],
      ['PhonePe', phonepeReceipt(120, 'attacker@okicici', '24/08/2026, 1:00 PM')],
      ['Paytm', paytmReceipt(120, 'attacker@okicici', '24/08/2026, 1:00 PM')],
      ['BHIM', bhimReceipt(120, 'attacker@okicici', '24/08/2026, 1:00 PM')],
      ['Bank', bankUpiReceipt(120, 'attacker@okicici', '24/08/2026, 1:00 PM')],
      ['Amazon', amazonPayReceipt(120, 'attacker@okicici', '24/08/2026, 1:00 PM')],
    ];
    for (const [name, text] of layouts) {
      runOCR.mockResolvedValue({ text, confidence: 90 });
      const { verificationResult } = await runScreenshotVerification({
        imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
      });
      expect(verificationResult.decision, `${name} should reject wrong UPI`).toBe('rejected');
      expect(verificationResult.reason, `${name} reason`).toBe('UPI_MISMATCH');
    }
  });
});

describe('Invalid screenshots: old/out-of-window date -> REJECTED', () => {
  it('all providers reject out-of-window dates', async () => {
    const layouts = [
      ['GPay', gpayReceipt(120, RECEIVER_UPI, '15/08/2026, 1:00 PM')],
      ['PhonePe', phonepeReceipt(120, RECEIVER_UPI, '15/08/2026, 1:00 PM')],
      ['Paytm', paytmReceipt(120, RECEIVER_UPI, '15/08/2026, 1:00 PM')],
      ['BHIM', bhimReceipt(120, RECEIVER_UPI, '15/08/2026, 1:00 PM')],
      ['Bank', bankUpiReceipt(120, RECEIVER_UPI, '15/08/2026, 1:00 PM')],
      ['Amazon', amazonPayReceipt(120, RECEIVER_UPI, '15/08/2026, 1:00 PM')],
    ];
    for (const [name, text] of layouts) {
      runOCR.mockResolvedValue({ text, confidence: 90 });
      const { verificationResult } = await runScreenshotVerification({
        imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
      });
      expect(verificationResult.decision, `${name} should reject old date`).toBe('rejected');
      expect(verificationResult.reason, `${name} reason`).toBe('INVALID_PAYMENT_DATE');
    }
  });
});

describe('Invalid screenshots: failed transaction -> MANUAL_REVIEW', () => {
  it('all providers route failed transactions to manual review', async () => {
    const layouts = [
      ['GPay', gpayReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM', 'Payment Failed')],
      ['PhonePe', phonepeReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM', 'Transaction Failed')],
      ['Paytm', paytmReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM', 'Payment Declined')],
      ['BHIM', bhimReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM', 'Payment Cancelled')],
    ];
    for (const [name, text] of layouts) {
      runOCR.mockResolvedValue({ text, confidence: 90 });
      const { verificationResult } = await runScreenshotVerification({
        imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
      });
      expect(verificationResult.decision, `${name} should route failed to manual_review`).toBe('manual_review');
      expect(verificationResult.reason, `${name} reason`).toBe('TRANSACTION_FAILED');
      expect(verificationResult.transactionStatus.status).toBe('failed');
    }
  });
});

describe('Invalid screenshots: pending/processing transaction -> MANUAL_REVIEW', () => {
  it('pending transactions route to manual review', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM', 'Payment Pending'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('TRANSACTION_FAILED');
    expect(verificationResult.transactionStatus.status).toBe('failed');
  });
});

describe('Invalid screenshots: ambiguous date (same day, no time) -> MANUAL_REVIEW', () => {
  it('date-only on correct day routes to manual review, not rejection', async () => {
    runOCR.mockResolvedValue({
      text: paytmReceipt(120, RECEIVER_UPI, '24/08/2026'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('DATE_AMBIGUOUS');
  });
});

describe('Security: no provider-specific bypass', () => {
  it('does not approve simply because text contains "Paytm"', async () => {
    runOCR.mockResolvedValue({
      text: `Paytm\nPayment Successful\n₹120\nTo: wrong@bank\n24/08/2026, 1:00 PM`,
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('UPI_MISMATCH');
  });

  it('does not approve simply because text contains "Google Pay"', async () => {
    runOCR.mockResolvedValue({
      text: `Google Pay\nPayment Successful\n₹120\nTo: wrong@bank\n24/08/2026, 1:00 PM`,
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('UPI_MISMATCH');
  });

  it('UPI match + date + no provider keyword still approves', async () => {
    runOCR.mockResolvedValue({
      text: `Payment of ₹120 to ${RECEIVER_UPI}\nCompleted\n24/08/2026, 1:00 PM`,
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 4: BOTH FLOWS (Registration Payment + Top-Up)
// ═══════════════════════════════════════════════════════════════

describe('Shared engine: registration payment and top-up use same rules', () => {
  it('registration payment: valid Paytm receipt -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: paytmReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
  });

  it('top-up: valid PhonePe receipt -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: phonepeReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
  });

  it('registration payment: wrong UPI -> REJECTED', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, 'attacker@okicici', '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('UPI_MISMATCH');
  });

  it('top-up: old date -> REJECTED', async () => {
    runOCR.mockResolvedValue({
      text: paytmReceipt(120, RECEIVER_UPI, '15/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('registration payment: failed transaction -> MANUAL_REVIEW', async () => {
    runOCR.mockResolvedValue({
      text: bhimReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM', 'Payment Failed'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('TRANSACTION_FAILED');
  });

  it('top-up: low OCR confidence -> MANUAL_REVIEW', async () => {
    runOCR.mockResolvedValue({
      text: paytmReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM'),
      confidence: 40,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('LOW_OCR_CONFIDENCE');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 5: AMOUNT INDEPENDENCE (shared with all providers)
// ═══════════════════════════════════════════════════════════════

describe('Amount independence: wrong amount never blocks valid receipt', () => {
  it('Paytm showing ₹500 for a ₹120 plan -> still APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: paytmReceipt(500, RECEIVER_UPI, '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.amountMatch).toBe(false);
  });

  it('GPay showing ₹1000 for a ₹500 plan -> still APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(1000, RECEIVER_UPI, '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 500, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.amountMatch).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 6: FORWARD-ONLY TIME WINDOW (server → server + 30 min)
// ═══════════════════════════════════════════════════════════════

describe('Forward-only time window: past transactions rejected', () => {
  it('transaction 5 minutes in the past -> REJECTED (not within forward window)', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, RECEIVER_UPI, '24/08/2026, 12:55 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.dateValid).toBe(false);
    // Has exact time in the past → clearly invalid, not ambiguous
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('transaction 30 minutes in the past -> REJECTED', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, RECEIVER_UPI, '24/08/2026, 12:30 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.dateValid).toBe(false);
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('transaction exactly at server time -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.dateValid).toBe(true);
    expect(verificationResult.decision).toBe('approved');
  });

  it('transaction 10 minutes in the future -> APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, RECEIVER_UPI, '24/08/2026, 1:10 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.dateValid).toBe(true);
    expect(verificationResult.decision).toBe('approved');
  });

  it('transaction 30 minutes in the future -> APPROVED (boundary)', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, RECEIVER_UPI, '24/08/2026, 1:30 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.dateValid).toBe(true);
    expect(verificationResult.decision).toBe('approved');
  });

  it('transaction 31 minutes in the future -> REJECTED (beyond window)', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, RECEIVER_UPI, '24/08/2026, 1:31 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.dateValid).toBe(false);
  });
});

describe('Forward-only window: correct date, no time -> manual review', () => {
  it('date-only receipt on the same day -> DATE_AMBIGUOUS (manual review)', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, RECEIVER_UPI, '24/08/2026'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.dateValid).toBe(false);
    expect(verificationResult.dateAmbiguous).toBe(true);
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('DATE_AMBIGUOUS');
  });

  it('date-only receipt on wrong day -> REJECTED', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, RECEIVER_UPI, '23/08/2026'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.dateValid).toBe(false);
    expect(verificationResult.dateAmbiguous).toBe(false);
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });
});

// ═══════════════════════════════════════════════════════════════
// SECTION 7: FIELD-LEVEL CONFIDENCE SCORING
// ═══════════════════════════════════════════════════════════════

describe('Field-level confidence scoring', () => {
  it('full valid receipt returns high confidence for all fields', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.fieldConfidence.amount.confidence).toBe('high');
    expect(verificationResult.fieldConfidence.receiverUpi.confidence).toBe('high');
    expect(verificationResult.fieldConfidence.utr.confidence).toBe('high');
    expect(verificationResult.fieldConfidence.transactionDate.confidence).toBe('high');
    expect(verificationResult.fieldConfidence.transactionStatus.confidence).toBe('high');
  });

  it('wrong amount returns low confidence for amount field', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(500, RECEIVER_UPI, '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.fieldConfidence.amount.confidence).toBe('low');
    expect(verificationResult.fieldConfidence.receiverUpi.confidence).toBe('high');
  });

  it('wrong UPI returns low confidence for receiverUpi field', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, 'attacker@okicici', '24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.fieldConfidence.receiverUpi.confidence).toBe('low');
    expect(verificationResult.fieldConfidence.amount.confidence).toBe('high');
  });

  it('date-only receipt returns medium confidence for transactionDate', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, RECEIVER_UPI, '24/08/2026'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.fieldConfidence.transactionDate.confidence).toBe('medium');
    expect(verificationResult.fieldConfidence.transactionDate.reason).toContain('no exact time');
  });

  it('no UTR in receipt returns none confidence for utr field', async () => {
    runOCR.mockResolvedValue({
      text: `Google Pay\nPayment Successful\n₹120\nTo Jayaraj\n${RECEIVER_UPI}\nDate: 24/08/2026, 1:00 PM`,
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.fieldConfidence.utr.confidence).toBe('none');
    expect(verificationResult.fieldConfidence.utr.reason).toContain('No UTR');
  });

  it('failed transaction returns high confidence for transactionStatus', async () => {
    runOCR.mockResolvedValue({
      text: gpayReceipt(120, RECEIVER_UPI, '24/08/2026, 1:00 PM', 'Payment Failed'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.fieldConfidence.transactionStatus.confidence).toBe('high');
    expect(verificationResult.fieldConfidence.transactionStatus.reason).toContain('failed');
  });
});
