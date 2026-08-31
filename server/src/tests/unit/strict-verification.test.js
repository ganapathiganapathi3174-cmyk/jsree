import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runScreenshotVerification,
  decidePaymentVerification,
  normalizeUtr,
  reserveApprovedUtr,
} from '../../services/verificationService.js';
import {
  extractPaymentData,
  matchUPI,
  matchAmount,
  isWithinForwardWindow,
  extractTransactionStatus,
} from '../../services/ocrService.js';

const { runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses } = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
  runAdditionalOCRPasses: vi.fn(),
}));

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses };
});

vi.mock('../../db/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          maybeSingle: vi.fn(),
        })),
      })),
      delete: vi.fn(),
    })),
  },
  supabaseAnon: {},
  default: {},
}));

const RECEIVER_UPI = 'jayarajj126-3@okicici';
const NOW = () => new Date('2026-08-24T07:30:00.000Z'); // 2026-08-24 13:00 IST

function receipt(amount, upi, dateLine, utr = '12345678901234', extra = '') {
  return `Payment Successful\nAmount \u20B9${amount}\nTo: ${upi}\n${dateLine}\nUTR: ${utr}\n${extra}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  runAmountRecoveryOCR.mockResolvedValue([]);
  runAdditionalOCRPasses.mockResolvedValue([]);
});

// ═══════════════════════════════════════════════════════════════
// 1. UPI EXACT MATCH
// ═══════════════════════════════════════════════════════════════
describe('UPI exact match', () => {
  it('exact match passes', () => {
    expect(matchUPI(['jayarajj126-3@okicici'], RECEIVER_UPI)).toBe(true);
  });

  it('one-character difference in local part → reject', () => {
    expect(matchUPI(['jayarajj126-4@okicici'], RECEIVER_UPI)).toBe(false);
  });

  it('one-character difference in domain → reject', () => {
    expect(matchUPI(['jayarajj126-3@okocici'], RECEIVER_UPI)).toBe(false);
  });

  it('missing a character → reject', () => {
    expect(matchUPI(['jayarajj126-3@okicci'], RECEIVER_UPI)).toBe(false);
  });

  it('completely wrong UPI → reject', () => {
    expect(matchUPI(['different@okicici'], RECEIVER_UPI)).toBe(false);
  });

  it('case difference after normalization → pass', () => {
    expect(matchUPI(['Jayarajj126-3@OKICICI'], RECEIVER_UPI)).toBe(true);
  });

  it('whitespace in UPI after normalization → pass', () => {
    expect(matchUPI(['jayarajj126-3 @okicici'], RECEIVER_UPI)).toBe(true);
  });

  it('empty extracted list → reject', () => {
    expect(matchUPI([], RECEIVER_UPI)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. TRANSACTION DATE + TIME — FORWARD-ONLY WINDOW
// ═══════════════════════════════════════════════════════════════
describe('Transaction date + time forward-only window', () => {
  const serverTime = new Date('2026-08-24T07:30:00.000Z'); // 13:00 IST

  it('NOW → valid', () => {
    expect(isWithinForwardWindow(serverTime, serverTime, 30)).toBe(true);
  });

  it('NOW + 10 min → valid', () => {
    const t = new Date(serverTime.getTime() + 10 * 60 * 1000);
    expect(isWithinForwardWindow(t, serverTime, 30)).toBe(true);
  });

  it('NOW + 30 min → valid', () => {
    const t = new Date(serverTime.getTime() + 30 * 60 * 1000);
    expect(isWithinForwardWindow(t, serverTime, 30)).toBe(true);
  });

  it('NOW + 31 min → reject', () => {
    const t = new Date(serverTime.getTime() + 31 * 60 * 1000);
    expect(isWithinForwardWindow(t, serverTime, 30)).toBe(false);
  });

  it('NOW - 1 min (past) → reject', () => {
    const t = new Date(serverTime.getTime() - 1 * 60 * 1000);
    expect(isWithinForwardWindow(t, serverTime, 30)).toBe(false);
  });

  it('NOW - 1 hour (past) → reject', () => {
    const t = new Date(serverTime.getTime() - 60 * 60 * 1000);
    expect(isWithinForwardWindow(t, serverTime, 30)).toBe(false);
  });

  it('null date → reject', () => {
    expect(isWithinForwardWindow(null, serverTime, 30)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. MISSING / AMBIGUOUS DATE OR TIME
// ═══════════════════════════════════════════════════════════════
describe('Missing or ambiguous date/time → REJECT', () => {
  it('date-only (no time) on correct day → REJECTED (no time component)', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, RECEIVER_UPI, 'Date: 24/08/2026'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.hasTimeComponent).toBe(false);
    expect(verificationResult.decision).toBe('rejected');
  });

  it('missing date entirely → REJECTED', async () => {
    runOCR.mockResolvedValue({
      text: `Payment Successful\nAmount \u20B9120\nTo: ${RECEIVER_UPI}\nUTR: 12345678901234`,
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.dateValid).toBe(false);
    expect(verificationResult.decision).toBe('rejected');
  });

  it('wrong date → REJECTED', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, RECEIVER_UPI, 'Date: 20/07/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('ambiguous time (e.g. "12:00" with no AM/PM on 12h format receipt) → still parsed but must be in window', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, RECEIVER_UPI, 'Date: 24/08/2026 12:00'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    // 12:00 IST = 06:30 UTC. Server = 07:30 UTC. 12:00 is 1 hour BEFORE server → rejected
    expect(verificationResult.dateValid).toBe(false);
    expect(verificationResult.decision).toBe('rejected');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. AUTOMATED FLOW — NEVER manual_review
// ═══════════════════════════════════════════════════════════════
describe('Automated flow never returns manual_review', () => {
  it('decidePaymentVerification: all pass → approved (not manual_review)', () => {
    const result = decidePaymentVerification({
      upiMatch: true, amountMatch: true, dateValid: true,
      utrPresent: true, transactionStatusOk: true, ocrConfidence: 90,
    });
    expect(result.decision).toBe('approved');
    expect(result.decision).not.toBe('manual_review');
  });

  it('decidePaymentVerification: all fail → rejected (not manual_review)', () => {
    const result = decidePaymentVerification({
      upiMatch: false, amountMatch: false, dateValid: false,
      utrPresent: false, transactionStatusOk: false, ocrConfidence: 0,
    });
    expect(result.decision).toBe('rejected');
    expect(result.decision).not.toBe('manual_review');
  });

  it('decidePaymentVerification: any single failure → rejected (not manual_review)', () => {
    const combinations = [
      { upiMatch: false, amountMatch: true, dateValid: true, utrPresent: true, transactionStatusOk: true, ocrConfidence: 90 },
      { upiMatch: true, amountMatch: false, dateValid: true, utrPresent: true, transactionStatusOk: true, ocrConfidence: 90 },
      { upiMatch: true, amountMatch: true, dateValid: false, utrPresent: true, transactionStatusOk: true, ocrConfidence: 90 },
      { upiMatch: true, amountMatch: true, dateValid: true, utrPresent: false, transactionStatusOk: true, ocrConfidence: 90 },
      { upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true, transactionStatusOk: false, ocrConfidence: 90 },
      { upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true, transactionStatusOk: true, ocrConfidence: 40 },
    ];
    for (const combo of combinations) {
      const result = decidePaymentVerification(combo);
      expect(result.decision).toBe('rejected');
      expect(result.decision).not.toBe('manual_review');
    }
  });

  it('runScreenshotVerification: full flow never returns manual_review', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, RECEIVER_UPI, 'Date: 24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).not.toBe('manual_review');
    expect(['approved', 'rejected']).toContain(verificationResult.decision);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. AMOUNT MATCH
// ═══════════════════════════════════════════════════════════════
describe('Amount match', () => {
  it('correct amount → pass', () => {
    expect(matchAmount([120], 120)).toBe(true);
  });

  it('wrong amount → reject', () => {
    expect(matchAmount([500], 120)).toBe(false);
  });

  it('no amounts extracted → reject', () => {
    expect(matchAmount([], 120)).toBe(false);
  });

  it('close but not exact (119.99) → reject', () => {
    expect(matchAmount([119.99], 120)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. TRANSACTION STATUS
// ═══════════════════════════════════════════════════════════════
describe('Transaction status', () => {
  it('successful → pass', () => {
    const s = extractTransactionStatus('Payment Successful');
    expect(s).toEqual({ status: 'success', matched: 'payment successful' });
  });

  it('completed → pass', () => {
    const s = extractTransactionStatus('Transaction Completed');
    expect(s).toEqual({ status: 'success', matched: 'completed' });
  });

  it('failed → reject', () => {
    const s = extractTransactionStatus('Payment Failed');
    expect(s).toEqual({ status: 'failed', matched: 'failed' });
  });

  it('pending → reject', () => {
    const s = extractTransactionStatus('Payment Pending');
    expect(s).toEqual({ status: 'failed', matched: 'pending' });
  });

  it('no status text → null (rejected by engine)', () => {
    const s = extractTransactionStatus('Some random text');
    expect(s).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. UTR PRESENCE
// ═══════════════════════════════════════════════════════════════
describe('UTR presence', () => {
  it('valid UTR → pass', () => {
    const result = decidePaymentVerification({
      upiMatch: true, amountMatch: true, dateValid: true,
      utrPresent: true, transactionStatusOk: true, ocrConfidence: 90,
    });
    expect(result.decision).toBe('approved');
  });

  it('missing UTR → reject', () => {
    const result = decidePaymentVerification({
      upiMatch: true, amountMatch: true, dateValid: true,
      utrPresent: false, transactionStatusOk: true, ocrConfidence: 90,
    });
    expect(result.decision).toBe('rejected');
    expect(result.reason).toBe('MISSING_UTR');
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. OCR CONFIDENCE
// ═══════════════════════════════════════════════════════════════
describe('OCR confidence threshold', () => {
  it('confidence >= 55 → pass', () => {
    const result = decidePaymentVerification({
      upiMatch: true, amountMatch: true, dateValid: true,
      utrPresent: true, transactionStatusOk: true, ocrConfidence: 55,
    });
    expect(result.decision).toBe('approved');
  });

  it('confidence 54 → reject', () => {
    const result = decidePaymentVerification({
      upiMatch: true, amountMatch: true, dateValid: true,
      utrPresent: true, transactionStatusOk: true, ocrConfidence: 54,
    });
    expect(result.decision).toBe('rejected');
    expect(result.reason).toBe('LOW_OCR_CONFIDENCE');
  });

  it('undefined confidence -> rejected (fail closed)', () => {
    const result = decidePaymentVerification({
      upiMatch: true, amountMatch: true, dateValid: true,
      utrPresent: true, transactionStatusOk: true, ocrConfidence: undefined,
    });
    expect(result.decision).toBe('rejected');
    expect(result.reason).toBe('LOW_OCR_CONFIDENCE');
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. FIELD CONFIDENCE GATE
// ═══════════════════════════════════════════════════════════════
describe('Field confidence gate — all fields must be high', () => {
  it('all fields high → approved', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, RECEIVER_UPI, 'Date: 24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.fieldConfidence.amount.confidence).toBe('high');
    expect(verificationResult.fieldConfidence.receiverUpi.confidence).toBe('high');
    expect(verificationResult.fieldConfidence.utr.confidence).toBe('high');
    expect(verificationResult.fieldConfidence.transactionDate.confidence).toBe('high');
    expect(verificationResult.fieldConfidence.transactionStatus.confidence).toBe('high');
    expect(verificationResult.decision).toBe('approved');
  });

  it('missing date → transactionDate confidence none → rejected', async () => {
    runOCR.mockResolvedValue({
      text: `Payment Successful\nAmount \u20B9120\nTo: ${RECEIVER_UPI}\nUTR: 12345678901234`,
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.fieldConfidence.transactionDate.confidence).toBe('none');
    expect(verificationResult.decision).toBe('rejected');
  });

  it('wrong UPI → receiverUpi confidence low → rejected', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, 'wrong@bank', 'Date: 24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.fieldConfidence.receiverUpi.confidence).toBe('low');
    expect(verificationResult.decision).toBe('rejected');
  });
});

// ═══════════════════════════════════════════════════════════════
// 10. FULL END-TO-END: ALL VALID → APPROVE
// ═══════════════════════════════════════════════════════════════
describe('Full end-to-end: all conditions valid → APPROVE', () => {
  it('correct UPI, amount, time, status, UTR → approved', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, RECEIVER_UPI, 'Date: 24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.reason).toBeNull();
    expect(verificationResult.amountMatch).toBe(true);
    expect(verificationResult.upiMatch).toBe(true);
    expect(verificationResult.dateValid).toBe(true);
    expect(verificationResult.utr).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════
// 11. ANY CONDITION INVALID → REJECT
// ═══════════════════════════════════════════════════════════════
describe('Any single condition invalid → REJECT', () => {
  it('wrong UPI → rejected', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, 'wrong@bank', 'Date: 24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
  });

  it('wrong amount → rejected', async () => {
    runOCR.mockResolvedValue({
      text: receipt(500, RECEIVER_UPI, 'Date: 24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
  });

  it('past transaction → rejected', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, RECEIVER_UPI, 'Date: 24/08/2026, 12:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    // 12:00 IST = 06:30 UTC, server = 07:30 UTC → 1 hour in the past
    expect(verificationResult.decision).toBe('rejected');
  });

  it('failed payment → rejected', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, RECEIVER_UPI, 'Date: 24/08/2026, 1:00 PM', '12345678901234', 'Payment Failed'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('TRANSACTION_FAILED');
  });

  it('missing UTR → rejected', async () => {
    runOCR.mockResolvedValue({
      text: `Payment Successful\nAmount \u20B9120\nTo: ${RECEIVER_UPI}\nDate: 24/08/2026, 1:00 PM`,
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('MISSING_UTR');
  });

  it('low OCR confidence → rejected', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, RECEIVER_UPI, 'Date: 24/08/2026, 1:00 PM'),
      confidence: 30,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('LOW_OCR_CONFIDENCE');
  });

  it('date-only → rejected', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, RECEIVER_UPI, 'Date: 24/08/2026'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
  });
});

// ═══════════════════════════════════════════════════════════════
// 12. BINARY DECISION: ONLY approved OR rejected
// ═══════════════════════════════════════════════════════════════
describe('Binary decision: only approved or rejected', () => {
  it('decidePaymentVerification only returns approved or rejected', () => {
    const allCombinations = [];
    for (const upi of [true, false]) {
      for (const amount of [true, false]) {
        for (const date of [true, false]) {
          for (const utr of [true, false]) {
            for (const status of [true, false]) {
              for (const conf of [0, 40, 55, 90]) {
                allCombinations.push({ upiMatch: upi, amountMatch: amount, dateValid: date, utrPresent: utr, transactionStatusOk: status, ocrConfidence: conf });
              }
            }
          }
        }
      }
    }
    for (const combo of allCombinations) {
      const result = decidePaymentVerification(combo);
      expect(['approved', 'rejected']).toContain(result.decision);
      expect(result.decision).not.toBe('manual_review');
      expect(result.decision).not.toBe('pending_review');
      expect(result.decision).not.toBe('needs_review');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 13. NORMALIZE UTR
// ═══════════════════════════════════════════════════════════════
describe('UTR normalization', () => {
  it('strips whitespace and uppercases', () => {
    expect(normalizeUtr(' abc 123 ')).toBe('ABC123');
  });

  it('null → null', () => {
    expect(normalizeUtr(null)).toBeNull();
  });

  it('empty string → null', () => {
    expect(normalizeUtr('')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// 14. EDGE CASES
// ═══════════════════════════════════════════════════════════════
describe('Edge cases', () => {
  it('OCR returns empty text → OCR_UNREADABLE thrown', async () => {
    runOCR.mockResolvedValue({ text: '', confidence: 90 });
    await expect(
      runScreenshotVerification({
        imageBuffer: Buffer.from('img'),
        expectedAmount: 120,
        receiverUpi: RECEIVER_UPI,
        now: NOW(),
      })
    ).rejects.toMatchObject({ code: 'OCR_UNREADABLE' });
  });

  it('OCR returns very short text → OCR_UNREADABLE thrown', async () => {
    runOCR.mockResolvedValue({ text: 'ab', confidence: 90 });
    await expect(
      runScreenshotVerification({
        imageBuffer: Buffer.from('img'),
        expectedAmount: 120,
        receiverUpi: RECEIVER_UPI,
        now: NOW(),
      })
    ).rejects.toMatchObject({ code: 'OCR_UNREADABLE' });
  });

  it('OCR throws → OCR_FAILED thrown', async () => {
    runOCR.mockRejectedValue(new Error('tesseract error'));
    await expect(
      runScreenshotVerification({
        imageBuffer: Buffer.from('img'),
        expectedAmount: 120,
        receiverUpi: RECEIVER_UPI,
        now: NOW(),
      })
    ).rejects.toMatchObject({ code: 'OCR_FAILED' });
  });
});

// ═══════════════════════════════════════════════════════════════
// 15. PAYMENT CONFIG CONSTANTS
// ═══════════════════════════════════════════════════════════════
describe('Payment config', () => {
  it('RECEIVER_UPI is exactly jayarajj126-3@okicici', async () => {
    const { RECEIVER_UPI: configUpi } = await import('../../config/paymentConfig.js');
    expect(configUpi).toBe('jayarajj126-3@okicici');
  });

  it('MIN_OCR_CONFIDENCE_APPROVE is 55', async () => {
    const { MIN_OCR_CONFIDENCE_APPROVE } = await import('../../config/paymentConfig.js');
    expect(MIN_OCR_CONFIDENCE_APPROVE).toBe(55);
  });

  it('PAYMENT_TIME_WINDOW_MINUTES is 30', async () => {
    const { PAYMENT_TIME_WINDOW_MINUTES } = await import('../../config/paymentConfig.js');
    expect(PAYMENT_TIME_WINDOW_MINUTES).toBe(30);
  });
});

// ═══════════════════════════════════════════════════════════════
// 16. UPI OCR TRUNCATION RECOVERY — end-to-end
// ═══════════════════════════════════════════════════════════════
describe('UPI OCR truncation recovery — full pipeline', () => {
  it('truncated UPI (missing trailing "i") → recovered → APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, 'jayarajj126-3@okicic', 'Date: 24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.upiMatch).toBe(true);
    expect(verificationResult.upiDiagnostics.matchMethod).toBe('ocr_recovery_truncation');
    expect(verificationResult.upiDiagnostics.matchedCandidate).toBe('jayarajj126-3@okicic');
  });

  it('completely wrong UPI → no recovery → REJECTED', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, 'attacker@paytm', 'Date: 24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('UPI_MISMATCH');
    expect(verificationResult.upiDiagnostics.matchMethod).toBe('none');
  });

  it('similar but different UPI (substitution) → no recovery → REJECTED', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, 'jayarajj126-3@okocici', 'Date: 24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.upiDiagnostics.matchMethod).toBe('none');
  });

  it('diagnostics include all candidate UPIs', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, 'jayarajj126-3@okicic', 'Date: 24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.upiDiagnostics.originalCandidates).toContain('jayarajj126-3@okicic');
    expect(verificationResult.upiDiagnostics.expectedUpi).toBe(RECEIVER_UPI);
  });
});

// ═══════════════════════════════════════════════════════════════
// 17. MULTI-PASS OCR — additional pass merging
// ═══════════════════════════════════════════════════════════════
describe('Multi-pass OCR — additional passes merge candidates', () => {
  it('additional passes recover amount missed by primary → APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: `Payment Successful\nTo: ${RECEIVER_UPI}\nDate: 24/08/2026, 1:00 PM\nUTR: 12345678901234`,
      confidence: 90,
    });
    runAdditionalOCRPasses.mockResolvedValue([
      { text: '₹120\nCompleted', confidence: 85, pass: 'upscaled' },
      { text: '120', confidence: 78, pass: 'thresholded' },
    ]);
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.amountMatch).toBe(true);
    expect(verificationResult.ocrPassInfo.additionalPassesRun).toBe(2);
  });

  it('additional passes recover UPI missed by primary → APPROVED', async () => {
    runOCR.mockResolvedValue({
      text: `Payment Successful\n₹120\nDate: 24/08/2026, 1:00 PM\nUTR: 12345678901234`,
      confidence: 90,
    });
    runAdditionalOCRPasses.mockResolvedValue([
      { text: `To: ${RECEIVER_UPI}`, confidence: 85, pass: 'upscaled' },
    ]);
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.upiMatch).toBe(true);
  });

  it('additional passes failure does not crash verification', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, RECEIVER_UPI, 'Date: 24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    runAdditionalOCRPasses.mockRejectedValue(new Error('Tesseract crash'));
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
  });

  it('no additional passes run when not mocked (backward compat)', async () => {
    runOCR.mockResolvedValue({
      text: receipt(120, RECEIVER_UPI, 'Date: 24/08/2026, 1:00 PM'),
      confidence: 90,
    });
    runAdditionalOCRPasses.mockResolvedValue([]);
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      now: NOW(),
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.ocrPassInfo.additionalPassesRun).toBe(0);
  });
});
