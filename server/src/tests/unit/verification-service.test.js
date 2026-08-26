import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runScreenshotVerification } from '../../services/verificationService.js';

const { runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses } = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
  runAdditionalOCRPasses: vi.fn(),
}));

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses };
});

const RECEIVER_UPI = 'jayarajj126-3@okicici';

function istClock(minOffset = 0) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(Date.now() + minOffset * 60 * 1000 + IST_OFFSET_MS);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(ist.getUTCDate())}/${p(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()} ${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}`;
}

function makeText(amount, upi, utr, date) {
  const utrLine = utr ? `UTR: ${utr}` : '';
  const dateLine = date ? `Date: ${date}` : '';
  return `Payment Successful\nAmount \u20B9${amount}\nTo: ${upi}\n${utrLine}\n${dateLine}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  runAmountRecoveryOCR.mockResolvedValue([]);
  runAdditionalOCRPasses.mockResolvedValue([]);
});

describe('runScreenshotVerification (shared pipeline, payments + top-ups)', () => {
  it('correct UPI + correct amount + valid date + UTR -> APPROVED', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, 'UTR12345', istClock()), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.utr).toBe('UTR12345');
  });

  it('correct UPI + correct amount + valid date + NO UTR -> REJECTED (MISSING_UTR)', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, null, istClock()), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('MISSING_UTR');
  });

  it('correct UPI + correct amount + valid date + duplicate UTR -> APPROVED', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, 'DUPLICATE123', istClock()), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.utr).toBe('DUPLICATE123');
  });

  it('correct UPI + correct amount + valid date + random UTR -> APPROVED', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, 'RANDOM9XYZ', istClock()), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.decision).toBe('approved');
  });

  it('wrong UPI -> REJECTED (UPI_MISMATCH)', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, 'wrongperson@okicici', 'RANDOM9XYZ', istClock()), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('UPI_MISMATCH');
  });

  it('wrong amount -> REJECTED (AMOUNT_MISMATCH)', async () => {
    runOCR.mockResolvedValue({ text: makeText(500, RECEIVER_UPI, 'RANDOM9XYZ', istClock()), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('AMOUNT_MISMATCH');
    expect(verificationResult.amountMatch).toBe(false);
  });

  it('invalid date/time (older than window) -> REJECTED (INVALID_PAYMENT_DATE)', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, 'RANDOM9XYZ', istClock(-24 * 60)), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('all gates pass (UPI + amount + date + UTR + success status) -> APPROVED', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, 'UTR99999', istClock()), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.upiMatch).toBe(true);
    expect(verificationResult.amountMatch).toBe(true);
    expect(verificationResult.dateValid).toBe(true);
    expect(verificationResult.utr).toBe('UTR99999');
  });
});

describe('Gate rejection regression (payments + top-ups share this engine)', () => {
  it('wrong UPI still rejects even when the amount matches', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, 'wrongperson@okicici', 'RANDOM9XYZ', istClock()), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('UPI_MISMATCH');
  });

  it('wrong amount rejects even when UPI + date are valid', async () => {
    runOCR.mockResolvedValue({ text: makeText(500, RECEIVER_UPI, 'UTR123', istClock()), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('AMOUNT_MISMATCH');
  });

  it('invalid date still rejects regardless of the amount', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, 'RANDOM9XYZ', istClock(-48 * 60)), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('unreadable/unusable screenshot still fails (OCR_UNREADABLE)', async () => {
    runOCR.mockResolvedValue({ text: '', confidence: 0 });
    await expect(runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    })).rejects.toMatchObject({ code: 'OCR_UNREADABLE' });
  });

  it('all amount formats with matching UPI + date + UTR + status -> APPROVED', async () => {
    const cases = [
      [120, 120], [500, 500], [1000, 1000], [120.00, 120], [999.99, 999.99],
    ];
    for (const [ocrAmount, plan] of cases) {
      runOCR.mockResolvedValue({ text: makeText(ocrAmount, RECEIVER_UPI, '412345678901', istClock()), confidence: 90 });
      const { verificationResult } = await runScreenshotVerification({
        imageBuffer: Buffer.from('img'), expectedAmount: plan, receiverUpi: RECEIVER_UPI,
      });
      expect(verificationResult.decision, `amount ${ocrAmount} / plan ${plan}`).toBe('approved');
    }
  });
});
