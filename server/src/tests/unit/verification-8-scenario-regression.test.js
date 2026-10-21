import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runScreenshotVerification } from '../../services/verificationService.js';
import { applyPaymentUtrPolicy } from '../../services/paymentService.js';

// ─────────────────────────────────────────────────────────────
// Consolidated regression: the eight verification scenarios that must keep
// their exact decision/reason after the screenshot-verification latency work
// (top-region probe, per-strategy early exits, preprocess memoization,
// commit-time expiry without the extra SELECT). The optimization lives in the
// recovery functions and must NEVER be able to change a gate outcome, so the
// recovery fns are mocked here to pin the decision layer in isolation;
// OCR-level behaviour is covered in ocr-latency-optimizations.test.js.
// ─────────────────────────────────────────────────────────────

const { runOCR, runAdditionalOCRPasses, runAmountRecoveryOCR, runDeepAmountRecovery, verifyAmountWithCurrencyRecovery } = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAdditionalOCRPasses: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
  runDeepAmountRecovery: vi.fn(),
  verifyAmountWithCurrencyRecovery: vi.fn(),
}));

const { supabaseMock } = vi.hoisted(() => ({ supabaseMock: { from: vi.fn() } }));

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runOCR, runAdditionalOCRPasses, runAmountRecoveryOCR,
    runDeepAmountRecovery, verifyAmountWithCurrencyRecovery,
  };
});

vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock, default: supabaseMock }));

const RECEIVER_UPI = 'jayarajj126-3@okicici';

// 27 Aug 2026 09:30:00 IST — receipt dated 09:25 IST (inside the ±30-min window).
const NOW = () => new Date('2026-08-27T04:00:00.000Z');

function receipt({ amount = 120, upi = RECEIVER_UPI, when = '27/08/2026, 9:25 AM', utr = 'T7GHD123456', status = 'Completed', to = 'Jayaraj', includeAmount = true } = {}) {
  const lines = [`To ${to}`];
  if (includeAmount) lines.push(`\u20B9${amount}`);
  lines.push(status);
  if (when) lines.push(when);
  if (utr) lines.push('UPI transaction ID', utr);
  if (upi) lines.push(upi);
  lines.push('Google Pay');
  return lines.join('\n');
}

function verify({ text, confidence = 85, expectedAmount = 120, receiverUpi = RECEIVER_UPI, receiverName, now = NOW() } = {}) {
  // `text: undefined` leaves a pre-set runOCR mock (reject/timeout) in place.
  if (text !== undefined) runOCR.mockResolvedValue({ text, confidence });
  return runScreenshotVerification({
    imageBuffer: Buffer.from('img'),
    expectedAmount,
    receiverUpi,
    receiverName,
    now,
  });
}

function makeUtrsChain(insertResult) {
  const obj = {
    insert: vi.fn(() => obj),
    select: vi.fn(() => obj),
    maybeSingle: vi.fn(() => Promise.resolve(insertResult)),
    delete: vi.fn(() => obj),
    eq: vi.fn(() => obj),
  };
  return obj;
}

beforeEach(() => {
  vi.clearAllMocks();
  runAdditionalOCRPasses.mockResolvedValue([]);
  runAmountRecoveryOCR.mockResolvedValue([]);
  runDeepAmountRecovery.mockResolvedValue([]);
  verifyAmountWithCurrencyRecovery.mockResolvedValue({ verified: false });
  supabaseMock.from.mockImplementation(() => makeUtrsChain({ data: { utr: 'X' }, error: null }));
});

// ── 1. Valid payment ──
describe('scenario 1: valid payment', () => {
  it('approves when every gate passes, including a matched payee name', async () => {
    const { verificationResult } = await verify({ text: receipt(), receiverName: 'Jayaraj' });

    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.reason).toBeNull();
    expect(verificationResult.checks.amount.passed).toBe(true);
    expect(verificationResult.checks.receiverUpi.passed).toBe(true);
    expect(verificationResult.checks.receiverName.passed).toBe(true);
    expect(verificationResult.checks.utr.passed).toBe(true);
    expect(verificationResult.checks.transactionDate.passed).toBe(true);
    expect(verificationResult.checks.transactionStatus.passed).toBe(true);
  });
});

// ── 2. Incorrect amount ──
describe('scenario 2: incorrect amount', () => {
  it('rejects AMOUNT_MISMATCH and still attempts amount recovery (Gate 2 live)', async () => {
    const { verificationResult } = await verify({ text: receipt({ amount: 500 }), receiverName: 'Jayaraj' });

    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('AMOUNT_MISMATCH');
    expect(verificationResult.checks.amount.passed).toBe(false);
    expect(verificationResult.checks.amount.expected).toBe(120);
    expect(verificationResult.checks.amount.detected).not.toBe(120);
    // UPI matched, so the recovery escalation must have been attempted.
    expect(runAmountRecoveryOCR).toHaveBeenCalledTimes(1);
    expect(runAmountRecoveryOCR).toHaveBeenCalledWith(expect.anything(), 120);
  });
});

// ── 3. UPI mismatch ──
describe('scenario 3: UPI mismatch', () => {
  it('rejects UPI_MISMATCH and skips ALL amount recovery stages', async () => {
    const { verificationResult } = await verify({ text: receipt({ upi: 'wrongperson@okicici' }), receiverName: 'Jayaraj' });

    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('UPI_MISMATCH');
    expect(runAmountRecoveryOCR).not.toHaveBeenCalled();
    expect(runDeepAmountRecovery).not.toHaveBeenCalled();
    expect(verifyAmountWithCurrencyRecovery).not.toHaveBeenCalled();
  });
});

// ── 4. Receiver-name mismatch ──
describe('scenario 4: receiver-name mismatch', () => {
  it('hard-rejects RECEIVER_NAME_MISMATCH when a different payee name was read', async () => {
    const { verificationResult } = await verify({ text: receipt({ to: 'Jayaraj' }), receiverName: 'Rahul Sharma' });

    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('RECEIVER_NAME_MISMATCH');
    expect(verificationResult.checks.receiverName.passed).toBe(false);
    expect(verificationResult.checks.receiverName.expected).toBe('Rahul Sharma');
    expect(verificationResult.checks.receiverName.detected).toBe('Jayaraj');
    // Identity gates that DID pass — only the name gate failed.
    expect(verificationResult.checks.amount.passed).toBe(true);
    expect(verificationResult.checks.receiverUpi.passed).toBe(true);
    expect(verificationResult.checks.utr.passed).toBe(true);
    expect(verificationResult.checks.transactionDate.passed).toBe(true);
    expect(verificationResult.checks.transactionStatus.passed).toBe(true);
  });
});

// ── 5. Receiver name not configured ──
describe('scenario 5: receiver name missing from config', () => {
  it('fails safe to manual_review RECEIVER_NAME_NOT_CONFIGURED — never approves', async () => {
    const { verificationResult } = await verify({ text: receipt(), receiverName: '' });

    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('RECEIVER_NAME_NOT_CONFIGURED');
    // Every other gate passed — the safety fallback is the ONLY outcome here.
    expect(verificationResult.checks.amount.passed).toBe(true);
    expect(verificationResult.checks.receiverUpi.passed).toBe(true);
    expect(verificationResult.checks.receiverName.passed).toBe(false);
  });
});

// ── 6. Duplicate UTR ──
describe('scenario 6: duplicate UTR', () => {
  it('approved decision + already-APPROVED UTR (unique violation) -> rejected DUPLICATE_UTR', async () => {
    supabaseMock.from.mockImplementation((table) => (
      table === 'approved_utrs'
        ? makeUtrsChain({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } })
        : makeUtrsChain({ data: null, error: null })
    ));

    const { newStatus, reason, reservedUtr } = await applyPaymentUtrPolicy('pay-1', { decision: 'approved', utr: 'T7GHD123456' });

    expect(newStatus).toBe('rejected');
    expect(reason).toBe('DUPLICATE_UTR');
    expect(reservedUtr).toBeNull();
  });

  it('approved decision + fresh UTR -> approved and reserved (control)', async () => {
    supabaseMock.from.mockImplementation((table) => (
      table === 'approved_utrs'
        ? makeUtrsChain({ data: { utr: 'T7GHD123456' }, error: null })
        : makeUtrsChain({ data: null, error: null })
    ));

    const { newStatus, reason, reservedUtr } = await applyPaymentUtrPolicy('pay-2', { decision: 'approved', utr: 'T7GHD123456' });

    expect(newStatus).toBe('approved');
    expect(reason).toBeNull();
    expect(reservedUtr).toBe('T7GHD123456');
  });
});

// ── 7. OCR failure ──
describe('scenario 7: OCR failure', () => {
  it('propagates OCR_FAILED when the OCR pass itself crashes', async () => {
    runOCR.mockRejectedValue(new Error('tesseract worker crashed'));

    await expect(verify({ text: undefined, receiverName: 'Jayaraj' })).rejects.toMatchObject({
      code: 'OCR_FAILED',
    });
  });

  it('propagates OCR_UNREADABLE when OCR returns nothing usable', async () => {
    runOCR.mockResolvedValue({ text: '   ', confidence: 0 });

    await expect(verify({ text: undefined, receiverName: 'Jayaraj' })).rejects.toMatchObject({
      code: 'OCR_UNREADABLE',
    });
  });
});

// ── 8. Timeout / recovery error paths ──
describe('scenario 8: timeout and recovery error paths', () => {
  it('OCR queue timeout surfaces as OCR_FAILED (retryable, no decision)', async () => {
    runOCR.mockRejectedValue(new Error('OCR queue wait exceeded 60000ms'));

    await expect(verify({ text: undefined })).rejects.toMatchObject({ code: 'OCR_FAILED' });
  });

  it('timeouts/throws inside EVERY recovery stage never crash verification', async () => {
    // Primary pass has no amount → recovery escalation runs → each stage
    // throws → all three are best-effort → engine still returns a decision.
    runAmountRecoveryOCR.mockRejectedValue(new Error('strip scheduler timeout'));
    runDeepAmountRecovery.mockRejectedValue(new Error('deep worker timeout'));
    verifyAmountWithCurrencyRecovery.mockRejectedValue(new Error('currency worker timeout'));

    const { verificationResult } = await verify({ text: receipt({ includeAmount: false }) });

    expect(runAmountRecoveryOCR).toHaveBeenCalledTimes(1);
    expect(runDeepAmountRecovery).toHaveBeenCalledTimes(1);
    expect(verifyAmountWithCurrencyRecovery).toHaveBeenCalledTimes(1);
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('AMOUNT_MISMATCH');
  });
});
