import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runScreenshotVerification } from '../../services/verificationService.js';

const { runOCR, runAmountRecoveryOCR } = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
}));

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR };
});

const RECEIVER_UPI = 'jayarajj126-3@okicici';

// Real UPI screenshots show IST (Asia/Kolkata) wall-clock time.
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
});

describe('runScreenshotVerification (shared pipeline, payments + top-ups)', () => {
  it('correct UPI + correct amount + valid date + NO UTR -> APPROVED', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, null, istClock()), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.utr).toBeNull();
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
  });

  it('invalid date/time (older than window) -> REJECTED (INVALID_PAYMENT_DATE)', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, 'RANDOM9XYZ', istClock(-24 * 60)), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });
});
