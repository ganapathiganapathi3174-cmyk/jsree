import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runScreenshotVerification } from '../../services/verificationService.js';

// Gate 1 (UPI) is evaluated before Gate 2 (amount) in decidePaymentVerification,
// so once UPI fails the decision is fixed at UPI_MISMATCH. The three amount
// recovery stages cost up to 125 OCR calls (~40s) and cannot change that
// outcome, so they must be skipped. These tests pin that contract: they assert
// both the short-circuit AND that the UPI-pass path still runs recovery.
const {
  runOCR, runAdditionalOCRPasses, runAmountRecoveryOCR,
  runDeepAmountRecovery, verifyAmountWithCurrencyRecovery,
} = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAdditionalOCRPasses: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
  runDeepAmountRecovery: vi.fn(),
  verifyAmountWithCurrencyRecovery: vi.fn(),
}));

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runOCR, runAdditionalOCRPasses, runAmountRecoveryOCR,
    runDeepAmountRecovery, verifyAmountWithCurrencyRecovery,
  };
});

const RECEIVER_UPI = 'jayarajj126-3@okicici';

function istClock(minOffset = 0) {
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const ist = new Date(Date.now() + minOffset * 60 * 1000 + IST_OFFSET_MS);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(ist.getUTCDate())}/${p(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()} ${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}`;
}

const verify = (args = {}) => runScreenshotVerification({
  imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, ...args,
});

beforeEach(() => {
  vi.clearAllMocks();
  runAdditionalOCRPasses.mockResolvedValue([]);
  runAmountRecoveryOCR.mockResolvedValue([]);
  runDeepAmountRecovery.mockResolvedValue([]);
  verifyAmountWithCurrencyRecovery.mockResolvedValue({ verified: false });
});

describe('amount-recovery short-circuit (Gate 1 runs before Gate 2)', () => {
  it('skips ALL amount recovery when UPI already mismatches', async () => {
    runOCR.mockResolvedValue({
      text: `Payment Successful\nAmount ₹500\nTo: wrongperson@okicici\nUTR: 412345678901\nDate: ${istClock()}`,
      confidence: 90,
    });

    const { verificationResult } = await verify();

    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('UPI_MISMATCH');
    expect(runAmountRecoveryOCR).not.toHaveBeenCalled();
    expect(runDeepAmountRecovery).not.toHaveBeenCalled();
    expect(verifyAmountWithCurrencyRecovery).not.toHaveBeenCalled();
  });

  it('skips recovery when NO UPI was extracted at all', async () => {
    runOCR.mockResolvedValue({
      text: `Payment Successful\nAmount ₹500\nUTR: 412345678901\nDate: ${istClock()}`,
      confidence: 90,
    });

    const { verificationResult } = await verify();

    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('UPI_MISMATCH');
    expect(runAmountRecoveryOCR).not.toHaveBeenCalled();
    expect(runDeepAmountRecovery).not.toHaveBeenCalled();
  });

  it('STILL runs amount recovery when UPI matches (Gate 2 is live)', async () => {
    // Correct receiver UPI, but no extractable amount -> recovery must run.
    runOCR.mockResolvedValue({
      text: `Payment Successful\nTo: ${RECEIVER_UPI}\nUTR: 412345678901\nDate: ${istClock()}`,
      confidence: 90,
    });
    runAmountRecoveryOCR.mockResolvedValue([120]);

    const { verificationResult } = await verify();

    expect(runAmountRecoveryOCR).toHaveBeenCalledTimes(1);
    expect(verificationResult.amountMatch).toBe(true);
    expect(verificationResult.recoveredFromBands).toBe(true);
    // Deep + currency recovery are only fallbacks, so they must not run.
    expect(runDeepAmountRecovery).not.toHaveBeenCalled();
    expect(verifyAmountWithCurrencyRecovery).not.toHaveBeenCalled();
  });

  it('escalates through every recovery stage when UPI matches and amount stays unreadable', async () => {
    runOCR.mockResolvedValue({
      text: `Payment Successful\nTo: ${RECEIVER_UPI}\nUTR: 412345678901\nDate: ${istClock()}`,
      confidence: 90,
    });
    runAmountRecoveryOCR.mockResolvedValue([]);
    runDeepAmountRecovery.mockResolvedValue([120]);

    const { verificationResult } = await verify();

    expect(runAmountRecoveryOCR).toHaveBeenCalledTimes(1);
    expect(runDeepAmountRecovery).toHaveBeenCalledTimes(1);
    expect(verifyAmountWithCurrencyRecovery).not.toHaveBeenCalled();
    expect(verificationResult.amountMatch).toBe(true);
    expect(verificationResult.decision).toBe('approved');
  });

  it('runs currency recovery as the last resort when UPI matches', async () => {
    runOCR.mockResolvedValue({
      text: `Payment Successful\nTo: ${RECEIVER_UPI}\nUTR: 412345678901\nDate: ${istClock()}`,
      confidence: 90,
    });
    runAmountRecoveryOCR.mockResolvedValue([]);
    runDeepAmountRecovery.mockResolvedValue([]);
    verifyAmountWithCurrencyRecovery.mockResolvedValue({ verified: true });

    const { verificationResult } = await verify();

    expect(verifyAmountWithCurrencyRecovery).toHaveBeenCalledTimes(1);
    expect(verificationResult.amountMatch).toBe(true);
    expect(verificationResult.decision).toBe('approved');
  });

  it('does not let a skipped recovery change the rejection reason', async () => {
    // Gate 1 must win: reason stays UPI_MISMATCH even though the amount is
    // unreadable (amount would otherwise have driven AMOUNT_MISMATCH).
    runOCR.mockResolvedValue({
      text: `Payment Successful\nTo: wrongperson@okicici\nUTR: 412345678901\nDate: ${istClock()}`,
      confidence: 90,
    });

    const { verificationResult } = await verify();

    expect(verificationResult.reason).toBe('UPI_MISMATCH');
    expect(verificationResult.amountMatch).toBe(false);
    expect(verificationResult.upiMatch).toBe(false);
  });
});
