import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runScreenshotVerification,
  decidePaymentVerification,
} from '../../services/verificationService.js';
import {
  extractDateTimes,
  extractTransactionStatus,
  isSameIstDay,
  parsePaymentDate,
} from '../../services/ocrService.js';

const { runOCR, runAmountRecoveryOCR } = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
}));

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR };
});

const RECEIVER_UPI = 'jayarajj126-3@okicici';

// Fixed server clock: 2026-08-16 13:00 IST == 07:30 UTC.
const NOW = () => new Date('2026-08-16T07:30:00.000Z');
const MIDNIGHT_IST_NOW = () => new Date('2026-08-15T18:40:00.000Z'); // 2026-08-16 00:10 IST

const p = (n) => String(n).padStart(2, '0');

function receipt(amount, upi, dateLine, extra = '') {
  return `Payment Successful\nAmount \u20B9${amount}\nTo: ${upi}\n${dateLine}\n${extra}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  runAmountRecoveryOCR.mockResolvedValue([]);
  // Default: high confidence.
  runOCR.mockResolvedValue({ text: '', confidence: 90 });
});

describe('Production verification decision engine (20-step spec mapping)', () => {
  it('correct upi + correct amount + valid date/time + NO UTR -> APPROVED', () => {
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: true });
    expect(decision).toBe('approved');
    expect(reason).toBeNull();
  });

  it('correct upi + correct amount + valid date/time + LOW confidence above manual floor -> manual_review', () => {
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: true, ocrConfidence: 40 });
    expect(decision).toBe('manual_review');
    expect(reason).toBe('LOW_OCR_CONFIDENCE');
  });

  it('confidence below the manual floor still REJECTS (never auto-approves garbage)', () => {
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: true, ocrConfidence: 20 });
    expect(decision).toBe('rejected');
    expect(reason).toBe('LOW_OCR_CONFIDENCE');
  });

  it('date-only on the correct IST day -> manual_review (DATE_AMBIGUOUS), not a hard rejection', () => {
    const { decision, reason } = decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: false, dateAmbiguous: true });
    expect(decision).toBe('manual_review');
    expect(reason).toBe('DATE_AMBIGUOUS');
  });

  it('UPI mismatch STILL rejects even when the date is merely ambiguous; amount is ignored', () => {
    // Amount is deliberately NOT part of the decision anymore.
    const wrongAmount = decidePaymentVerification({ upiMatch: true, amountMatch: false, dateValid: true, dateAmbiguous: true });
    expect(wrongAmount.decision).toBe('approved');

    const wrongUpi = decidePaymentVerification({ upiMatch: false, amountMatch: true, dateValid: true, dateAmbiguous: true });
    expect(wrongUpi.decision).toBe('rejected');
    expect(wrongUpi.reason).toBe('UPI_MISMATCH');
  });

  it('decisions depend only on UPI + date (amount removed from the spec)', () => {
    expect(decidePaymentVerification({ upiMatch: true, amountMatch: true, dateValid: true }).decision).toBe('approved');
    expect(decidePaymentVerification({ upiMatch: true, amountMatch: false, dateValid: true }).decision).toBe('approved');
    expect(decidePaymentVerification({ upiMatch: true, amountMatch: false, dateValid: false }).reason).toBe('INVALID_PAYMENT_DATE');
    expect(decidePaymentVerification({ upiMatch: false, amountMatch: true, dateValid: true }).reason).toBe('UPI_MISMATCH');
  });
});

describe('runScreenshotVerification — real UPI receipt formats (false-rejection fixes)', () => {
  it('comma + AM/PM "16/08/2026, 1:00 PM" is parsed with its time -> APPROVED at 13:00 IST', async () => {
    runOCR.mockResolvedValue({ text: receipt(120, RECEIVER_UPI, 'Date: 16/08/2026, 1:00 PM'), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({ imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW() });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.dateValid).toBe(true);
  });

  it('month-name + lowercase pm "16 Aug 2026, 1:00 pm" is parsed -> APPROVED', async () => {
    runOCR.mockResolvedValue({ text: receipt(500, RECEIVER_UPI, 'Date: 16 Aug 2026, 1:00 pm'), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({ imageBuffer: Buffer.from('img'), expectedAmount: 500, receiverUpi: RECEIVER_UPI, now: NOW() });
    expect(verificationResult.decision).toBe('approved');
  });

  it('date-only on the correct IST day -> manual_review, not a false rejection', async () => {
    runOCR.mockResolvedValue({ text: receipt(120, RECEIVER_UPI, 'Date: 16/08/2026'), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({ imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW() });
    expect(verificationResult.dateValid).toBe(false);
    expect(verificationResult.dateAmbiguous).toBe(true);
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('DATE_AMBIGUOUS');
  });

  it('date-only on a DIFFERENT (old) IST day -> rejected INVALID_PAYMENT_DATE', async () => {
    runOCR.mockResolvedValue({ text: receipt(120, RECEIVER_UPI, 'Date: 15/08/2026'), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({ imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW() });
    expect(verificationResult.dateAmbiguous).toBe(false);
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('receipt that says "Failed" can never auto-approve -> manual_review (TRANSACTION_FAILED)', async () => {
    runOCR.mockResolvedValue({ text: receipt(120, RECEIVER_UPI, 'Date: 16/08/2026 13:00', 'Payment Failed'), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({ imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW() });
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('TRANSACTION_FAILED');
    expect(verificationResult.transactionStatus.status).toBe('failed');
  });

  it('wrong amount no longer blocks an otherwise-correct receipt -> APPROVED', async () => {
    runOCR.mockResolvedValue({ text: receipt(500, RECEIVER_UPI, 'Date: 16/08/2026, 1:00 PM'), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({ imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW() });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.amountMatch).toBe(false);
  });

  it('midnight IST boundary: 00:00 IST today is within the window at 00:10 IST', async () => {
    runOCR.mockResolvedValue({ text: receipt(120, RECEIVER_UPI, 'Date: 16/08/2026 00:00'), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({ imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: MIDNIGHT_IST_NOW() });
    expect(verificationResult.dateValid).toBe(true);
    expect(verificationResult.decision).toBe('approved');
  });
});

describe('runScreenshotVerification — client body is NEVER trusted', () => {
  it('a client-supplied wrong amount/UPI cannot influence a server-verified screenshot', async () => {
    runOCR.mockResolvedValue({ text: receipt(120, RECEIVER_UPI, 'Date: 16/08/2026 13:00'), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
      clientAmount: 500,
      clientUpi: 'attacker@bank',
      clientUtr: 'FAKE123',
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.checks.amount.expected).toBe(120);
  });
});

describe('UTR extraction usability (label-priority, phones excluded)', () => {
  it('labeled UTR wins over a bare phone/bank number', async () => {
    runOCR.mockResolvedValue({
      text: `To: ${RECEIVER_UPI}\nAmount \u20B9120\nDate: 16/08/2026, 1:00 PM\nUPI transaction ID: T7GHD123456\n+91 9876543210`,
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({ imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW() });
    expect(verificationResult.utr).toBe('T7GHD123456');
  });

  it('bare 10-14 digit numbers are still captured when no label exists', async () => {
    runOCR.mockResolvedValue({ text: 'Payment done 12345678901234', confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({ imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: 'x@bank' });
    expect(verificationResult.utr).toBe('12345678901234');
  });
});

describe('Structured verification result (admin debugging)', () => {
  it('exposes checks + detected fields with Asia/Kolkata timezone', async () => {
    runOCR.mockResolvedValue({ text: receipt(120, RECEIVER_UPI, 'Date: 16/08/2026 13:00', 'UTR: ABC123456'), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({ imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW() });
    expect(verificationResult.checks.amount).toEqual({ passed: true, didMatch: true, expected: 120, detected: 120 });
    expect(verificationResult.checks.receiverUpi.passed).toBe(true);
    expect(verificationResult.checks.transactionDate.timezone).toBe('Asia/Kolkata');
    expect(verificationResult.checks.transactionDate.passed).toBe(true);
    expect(verificationResult.detected.utr).toBe('ABC123456');
    expect(typeof verificationResult.detected.dateTimeMs).toBe('number');
    expect(verificationResult.decision).toBe('approved');
  });
});

describe('Date/time extraction primitives', () => {
  it('extractDateTimes keeps the exact time for comma + am/pm formats', () => {
    const entries = extractDateTimes('Date: 19/08/2026, 7:39 AM\n8 Oct 2026, 4:40 pm');
    expect(entries.length).toBe(2);
    expect(entries[0].hasTime).toBe(true);
    expect(entries[0].day).toBe(19);
    expect(entries[0].hour).toBe(7);
    expect(entries[0].ampm).toBe('AM');
    expect(entries[1].day).toBe(8);
    expect(entries[1].hasTime).toBe(true);
    expect(entries[1].ampm).toBe('pm');
  });

  it('rejects nothing that parsePaymentDate accepted (format parity)', () => {
    const d = parsePaymentDate('15/06/2025 12:30 PM');
    expect(d).not.toBeNull();
    expect(isSameIstDay(d, parsePaymentDate('15/06/2025 18:00'))).toBe(true);
  });

  it('extractTransactionStatus identifies success and failure wording', () => {
    expect(extractTransactionStatus('Payment Completed')).toEqual({ status: 'success', matched: 'completed' });
    expect(extractTransactionStatus('Payment Failed')).toEqual({ status: 'failed', matched: 'failed' });
    expect(extractTransactionStatus('No status wording here')).toBeNull();
  });
});