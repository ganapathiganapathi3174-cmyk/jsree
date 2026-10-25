import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runScreenshotVerification } from '../../services/verificationService.js';

// ─────────────────────────────────────────────────────────────
// OCR recovery budgets — deterministic behaviour tests.
//
// The amount-recovery stages are the expensive part of a verification
// attempt. They now run under three limits:
//
//   overall deadline  → the shared budget for the whole attempt
//                       (OCR_VERIFICATION_BUDGET_MS). Exceeding it aborts
//                       the attempt with OCR_TIMEOUT (retryable, NEVER an
//                       approval).
//   recovery budget   → the targeted phase (probe → deep → currency).
//   stage budget      → a single stage.
//
// These tests pin the behaviour that matters:
//   1. a stage that exhausts its budget STOPS the chain — the expensive
//      full-height sweep is skipped and the receipt becomes manual_review
//      / AMOUNT_NOT_DETECTED;
//   2. a receipt whose amount IS recoverable still passes;
//   3. evidence read before a budget ran out is KEPT;
//   4. the existing approval rules are unchanged (wrong amount still
//      rejects, UPI mismatch still rejects, a timeout still never approves);
//   5. Register and TopUp behave identically.
//
// Time is faked (Date only) so every budget boundary is exact.
// ─────────────────────────────────────────────────────────────

const {
  runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses,
  runDeepAmountRecovery, verifyAmountWithCurrencyRecovery,
} = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
  runAdditionalOCRPasses: vi.fn(),
  runDeepAmountRecovery: vi.fn(),
  verifyAmountWithCurrencyRecovery: vi.fn(),
}));

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runOCR,
    runAmountRecoveryOCR,
    runAdditionalOCRPasses,
    runDeepAmountRecovery,
    verifyAmountWithCurrencyRecovery,
  };
});

const RECEIVER_UPI = 'jayarajj126-3@okicici';
const RECEIVER_NAME = 'JAYARAJ ALAGAR';
const CLOCK = new Date('2026-09-08T09:00:00.000Z'); // 14:30 IST
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istLine(d) {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const p = (n) => String(n).padStart(2, '0');
  let h = ist.getUTCHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${p(ist.getUTCDate())}/${p(ist.getUTCMonth() + 1)}/${p(ist.getUTCFullYear())}, ${h}:${p(ist.getUTCMinutes())} ${ap}`;
}

function receipt({ amount = '₹120', upi = RECEIVER_UPI, name = 'To JAYARAJ ALAGAR', when = istLine(new Date(CLOCK.getTime() - 5 * 60000)) } = {}) {
  const lines = ['Google Pay', 'Payment Successful'];
  if (amount !== null) lines.push(amount);
  if (name !== null) lines.push(name);
  if (upi !== null) lines.push(upi);
  if (when !== null) lines.push(when);
  lines.push('UPI transaction ID: T7BUDGET1');
  return lines.join('\n');
}

async function verify({ text, expectedAmount = 120, recoveryBudget, stageBudget, budgetMs } = {}) {
  if (text !== undefined) runOCR.mockResolvedValue({ text, confidence: 90 });
  const opts = {
    imageBuffer: Buffer.from('img'),
    expectedAmount,
    receiverUpi: RECEIVER_UPI,
    receiverName: RECEIVER_NAME,
    now: CLOCK,
  };
  if (recoveryBudget !== undefined) opts.recoveryBudget = recoveryBudget;
  if (stageBudget !== undefined) opts.stageBudget = stageBudget;
  if (budgetMs !== undefined) opts.budgetMs = budgetMs;
  return runScreenshotVerification(opts);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(CLOCK);
  runAdditionalOCRPasses.mockResolvedValue([]);
  runAmountRecoveryOCR.mockResolvedValue([]);
  runDeepAmountRecovery.mockResolvedValue([]);
  verifyAmountWithCurrencyRecovery.mockResolvedValue({ verified: false, method: 'no_evidence', evidence: '' });
});

afterEach(() => { vi.useRealTimers(); });

/** Simulates a stage that consumed `ms` of wall-clock time. */
function burn(ms) { vi.setSystemTime(Date.now() + ms); }

const fullScanCalls = () => runAmountRecoveryOCR.mock.calls.filter((c) => c[2]?.scan === 'full');
const probeCalls = () => runAmountRecoveryOCR.mock.calls.filter((c) => c[2]?.scan === 'probe');

// ═══════════════════════════════════════════════════════════════
describe('recovery budget — the chain stops at the budget', () => {
  it('skips the expensive full-height sweep and returns manual_review', async () => {
    // Probe costs 5 s and finds nothing; the deep stage burns the remaining
    // budget. The targeted budget is 6 s, so the full-height sweep (the most
    // expensive stage) must never start.
    runAmountRecoveryOCR.mockImplementation(async (_b, _e, opts) => {
      burn(5000);
      if (opts?.softDeadline && Date.now() >= opts.softDeadline) return [];
      return [];
    });
    runDeepAmountRecovery.mockImplementation(async (_b, _e, opts) => {
      burn(5000);
      if (opts?.softDeadline && Date.now() >= opts.softDeadline) return [];
      return [];
    });

    const { verificationResult } = await verify({ text: receipt({ amount: null }), recoveryBudget: 6000 });

    expect(probeCalls()).toHaveLength(1);
    expect(fullScanCalls()).toHaveLength(0);          // ← the sweep was skipped
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('AMOUNT_NOT_DETECTED');
    expect(verificationResult.checks.amount.detectedAny).toBe(false);
    expect(verificationResult.recovery.budgetExhausted).toBe(true);
    expect(verificationResult.checks.amount.recoveryBudgetExhausted).toBe(true);
  });

  it('reports the stages it ran and the budgets it used', async () => {
    runAmountRecoveryOCR.mockImplementation(async (_b, _e, opts) => { burn(5000); return []; });
    runDeepAmountRecovery.mockImplementation(async (_b, _e, opts) => { burn(5000); return []; });

    const { verificationResult } = await verify({ text: receipt({ amount: null }), recoveryBudget: 6000, stageBudget: 3000 });

    expect(verificationResult.recovery.budgetMs).toBe(6000);
    expect(verificationResult.recovery.stageBudgetMs).toBe(3000);
    expect(verificationResult.recovery.stages.map((s) => s.stage)).toContain('probe');
    expect(verificationResult.recovery.stages.map((s) => s.stage)).not.toContain('full_scan');
    expect(verificationResult.recovery.budgetExhausted).toBe(true);
  });

  it('never lets a single stage exceed the per-stage budget', async () => {
    const seen = [];
    runAmountRecoveryOCR.mockImplementation(async (_b, _e, opts) => {
      seen.push({ stage: 'probe', soft: opts?.softDeadline, at: Date.now() });
      burn(1000);
      return [];
    });
    runDeepAmountRecovery.mockImplementation(async (_b, _e, opts) => {
      seen.push({ stage: 'deep', soft: opts?.softDeadline, at: Date.now() });
      burn(1000);
      return [];
    });

    await verify({ text: receipt({ amount: null }), recoveryBudget: 60000, stageBudget: 2000 });

    for (const s of seen) {
      expect(s.soft, `${s.stage} soft deadline`).not.toBeNull();
      expect(s.soft).toBeLessThanOrEqual(s.at + 2000);   // stage cap
      expect(s.soft).toBeLessThanOrEqual(CLOCK.getTime() + 60000); // overall recovery budget
    }
  });
});

// ═══════════════════════════════════════════════════════════════
describe('recovery budget — valid receipts still pass', () => {
  it('approves a receipt whose amount is recovered by the deep stage', async () => {
    runDeepAmountRecovery.mockResolvedValue([120]);

    const { verificationResult } = await verify({ text: receipt({ amount: null }) });

    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.reason).toBeNull();
    expect(verificationResult.amountMatch).toBe(true);
    expect(verificationResult.recoveredFromBands).toBe(true);
    // The chain stopped at the stage that recovered the amount.
    expect(fullScanCalls()).toHaveLength(0);
    expect(verificationResult.recovery.budgetExhausted).toBe(false);
  });

  it('keeps the evidence a stage read before its budget ran out', async () => {
    // The deep stage finds the amount and then runs out of budget: the
    // partial evidence must survive, otherwise a valid payment would be
    // pushed to manual review.
    runDeepAmountRecovery.mockImplementation(async (_b, _e, opts) => {
      const found = [120];
      burn(5000);
      if (opts?.softDeadline && Date.now() >= opts.softDeadline) return found;
      return found;
    });

    const { verificationResult } = await verify({ text: receipt({ amount: null }), recoveryBudget: 6000 });

    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.amountMatch).toBe(true);
    expect(verificationResult.recoveredFromBands).toBe(true);
  });

  it('routes an unreadable amount to manual_review when the budget is ample', async () => {
    const { verificationResult } = await verify({ text: receipt({ amount: null }) });

    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('AMOUNT_NOT_DETECTED');
    // Budget not exhausted → the full-height sweep still runs (recall intact).
    expect(fullScanCalls()).toHaveLength(1);
    expect(verificationResult.recovery.budgetExhausted).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('recovery budget — existing approval rules are unchanged', () => {
  it('still rejects a confidently read, different amount', async () => {
    const { verificationResult } = await verify({ text: receipt({ amount: '₹500' }) });

    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('AMOUNT_MISMATCH');
    expect(verificationResult.checks.amount.detectedAny).toBe(true);
  });

  it('still rejects a different amount even when the recovery budget ran out', async () => {
    // A wrong amount was READ: the decision must not be softened into a
    // manual review, and the full-height sweep is still attempted.
    runAmountRecoveryOCR.mockImplementation(async (_b, _e, opts) => { burn(5000); return []; });
    runDeepAmountRecovery.mockImplementation(async (_b, _e, opts) => { burn(5000); return []; });

    const { verificationResult } = await verify({ text: receipt({ amount: '₹500' }), recoveryBudget: 6000 });

    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('AMOUNT_MISMATCH');
    expect(fullScanCalls()).toHaveLength(1);
  });

  it('still rejects a UPI mismatch without running any recovery stage', async () => {
    const { verificationResult } = await verify({ text: receipt({ upi: 'someoneelse@okicici' }) });

    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('UPI_MISMATCH');
    expect(runAmountRecoveryOCR).not.toHaveBeenCalled();
    expect(runDeepAmountRecovery).not.toHaveBeenCalled();
    expect(verifyAmountWithCurrencyRecovery).not.toHaveBeenCalled();
  });

  it('still requires the receiver name (Rule B)', async () => {
    const { verificationResult } = await verify({ text: receipt({ name: null }) });

    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('RECEIVER_NAME_UNREADABLE');
  });

  it('still enforces the forward-only 30-minute window (Rule D)', async () => {
    const future = istLine(new Date(CLOCK.getTime() + 10 * 60000));
    const { verificationResult } = await verify({ text: receipt({ when: future }) });

    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.timeWithinWindow).toBe(false);
  });

  it('still enforces the current IST calendar day (Rule C)', async () => {
    const { verificationResult } = await verify({
      text: receipt({ when: '07/09/2026, 02:25 PM' }),
    });

    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('recovery budget — a timeout never approves', () => {
  it('surfaces the hard deadline as an OCR_TIMEOUT, not a decision', async () => {
    const timeout = Object.assign(new Error('budget'), { code: 'OCR_TIMEOUT' });
    runAmountRecoveryOCR.mockRejectedValue(timeout);

    await expect(verify({ text: receipt({ amount: null }) })).rejects.toMatchObject({ code: 'OCR_TIMEOUT' });
  });

  it('never returns an approval when the overall deadline is exceeded', async () => {
    const timeout = Object.assign(new Error('budget'), { code: 'OCR_TIMEOUT' });
    runDeepAmountRecovery.mockRejectedValue(timeout);

    let result = null;
    let threw = false;
    try {
      result = await verify({ text: receipt({ amount: null }) });
    } catch (e) {
      threw = true;
      expect(e.code).toBe('OCR_TIMEOUT');
    }
    expect(threw).toBe(true);
    expect(result).toBeNull();
  });

  it('reports the hard deadline as an error code the callers map to 504', async () => {
    const timeout = Object.assign(new Error('budget'), { code: 'OCR_TIMEOUT' });
    runAmountRecoveryOCR.mockRejectedValue(timeout);

    const err = await verify({ text: receipt({ amount: null }) }).catch((e) => e);
    expect(err.code).toBe('OCR_TIMEOUT');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('recovery budget — Register and TopUp behave identically', () => {
  it('produces the same decision, reason and budget state for both contexts', async () => {
    const run = async () => {
      runAmountRecoveryOCR.mockImplementation(async (_b, _e, opts) => { burn(5000); return []; });
      runDeepAmountRecovery.mockImplementation(async (_b, _e, opts) => { burn(5000); return []; });
      const { verificationResult } = await verify({ text: receipt({ amount: null }), recoveryBudget: 6000 });
      return verificationResult;
    };

    const membership = await run();   // Register flow
    const topup = await run();        // TopUp flow — same engine, same inputs

    expect(topup.decision).toBe(membership.decision);
    expect(topup.reason).toBe(membership.reason);
    expect(topup.recovery.budgetExhausted).toBe(membership.recovery.budgetExhausted);
    expect(topup.decision).toBe('manual_review');
    expect(topup.reason).toBe('AMOUNT_NOT_DETECTED');
  });
});
