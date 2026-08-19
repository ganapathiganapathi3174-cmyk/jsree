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

  it('wrong amount with otherwise-valid receipt -> still APPROVED (amount removed from decision)', async () => {
    runOCR.mockResolvedValue({ text: makeText(500, RECEIVER_UPI, 'RANDOM9XYZ', istClock()), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.reason).toBeNull();
    // The mismatch is still recorded for admin display, but never rejects.
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
});

// ─────────────────────────────────────────────────────────────
// Regression: amount is REMOVED from the verification decision.
// A correct screenshot that shows a different amount than the selected
// plan is still approved. UPI mismatch, invalid date and unreadable
// screenshots keep rejecting exactly as before.
// ─────────────────────────────────────────────────────────────
describe('Amount independence regression (payments + top-ups share this engine)', () => {
  it('unreadable/missing amount line still APPROVES on valid UPI + date', async () => {
    runOCR.mockResolvedValue({ text: `Payment Successful\nTo: ${RECEIVER_UPI}\nDate: ${istClock()}\nUTR: X12345`, confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.amountMatch).toBe(false);
    expect(verificationResult.decision).toBe('approved');
  });

  it('all amount formats/plans approve when UPI + date are valid', async () => {
    const cases = [
      ['₹120', 120], ['₹500', 500], ['₹1000', 1000], ['120.00', 120], ['Rs 120', 120],
    ];
    for (const [shown, plan] of cases) {
      runOCR.mockResolvedValue({ text: makeText(shown, RECEIVER_UPI, 'UTR-1', istClock()), confidence: 90 });
      const { verificationResult } = await runScreenshotVerification({
        imageBuffer: Buffer.from('img'), expectedAmount: plan, receiverUpi: RECEIVER_UPI,
      });
      expect(verificationResult.decision, `amount ${shown} / plan ${plan}`).toBe('approved');
    }
  });

  it('wrong UPI still rejects even when the amount matches', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, 'wrongperson@okicici', 'RANDOM9XYZ', istClock()), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI,
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('UPI_MISMATCH');
  });

  it('invalid date still rejects regardless of the amount', async () => {
    runOCR.mockResolvedValue({ text: makeText(120, RECEIVER_UPI, 'RANDOM9XYZ', istClock(-48 * 60)), confidence: 90 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 500, receiverUpi: RECEIVER_UPI,
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
});
