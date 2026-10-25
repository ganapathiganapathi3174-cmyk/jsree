import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  runScreenshotVerification,
  decidePaymentVerification,
} from '../../services/verificationService.js';
import { matchReceiverName, normalizeName, isWithinPaymentWindow } from '../../services/ocrService.js';
import { resolvePlanAmount, istCalendarDayKey } from '../../utils/paymentNormalize.js';
import { PLAN_AMOUNTS } from '../../config/paymentConfig.js';

// ─────────────────────────────────────────────────────────────
// Strict payment validation — Register AND TopUp.
//
// Both flows call the SAME engine (runScreenshotVerification ->
// decidePaymentVerification), so every rule below is exercised once and
// asserted to be identical for both contexts.
//
//   Rule A — exact amount against the server-resolved plan amount
//   Rule B — receiver name against the configured receiver name
//   Rule C — transaction date on the current Asia/Kolkata calendar day
//   Rule D — transaction time inside 0..30 min of the server upload time
//
// All clocks are injected/fixed, so every boundary case is deterministic.
// ─────────────────────────────────────────────────────────────

const { runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery, verifyAmountWithCurrencyRecovery } = vi.hoisted(() => ({
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

// ── FIXED CLOCK ──────────────────────────────────────────────────
// The server upload/verification instant. 2026-09-08 14:30:00 IST
// == 2026-09-08T09:00:00.000Z
const UPLOAD_AT = new Date('2026-09-08T09:00:00.000Z');
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Formats an instant as an IST wall-clock "DD/MM/YYYY, h:mm AM/PM" receipt line. */
function istLine(d) {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const p = (n) => String(n).padStart(2, '0');
  let h = ist.getUTCHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${p(ist.getUTCDate())}/${p(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()}, ${h}:${p(ist.getUTCMinutes())} ${ap}`;
}

/** Minutes relative to the fixed upload instant. */
const at = (minutes) => new Date(UPLOAD_AT.getTime() + minutes * 60 * 1000);

function receipt({
  amount = '₹120',
  upi = RECEIVER_UPI,
  name = 'To JAYARAJ ALAGAR',
  status = 'Payment Successful',
  utr = 'UPI transaction ID: T7STRICT01',
  when = istLine(at(-5)),
  provider = 'Google Pay',
} = {}) {
  const lines = [provider, status];
  if (amount !== null) lines.push(amount);
  if (name !== null) lines.push(name);
  lines.push(upi);
  if (when !== null) lines.push(when);
  if (utr !== null) lines.push(utr);
  return lines.join('\n');
}

/** Runs the SHARED engine the way the register flow and the top-up flow do. */
async function verify({
  text,
  confidence = 90,
  expectedAmount = 120,
  receiverName = RECEIVER_NAME,
  now = UPLOAD_AT,
  budgetMs,
} = {}) {
  if (text !== undefined) runOCR.mockResolvedValue({ text, confidence });
  const opts = {
    imageBuffer: Buffer.from('img'),
    expectedAmount,
    receiverUpi: RECEIVER_UPI,
    receiverName,
    now,
  };
  if (budgetMs !== undefined) opts.budgetMs = budgetMs;
  return runScreenshotVerification(opts);
}

beforeEach(() => {
  vi.clearAllMocks();
  runAdditionalOCRPasses.mockResolvedValue([]);
  runAmountRecoveryOCR.mockResolvedValue([]);
  runDeepAmountRecovery.mockResolvedValue([]);
  verifyAmountWithCurrencyRecovery.mockResolvedValue({ verified: false, method: 'no_evidence', evidence: '' });
});

afterEach(() => { vi.useRealTimers(); });

// ═══════════════════════════════════════════════════════════════
// RULE A — exact amount
// ═══════════════════════════════════════════════════════════════
describe('Rule A — exact payment amount', () => {
  it('accepts the exact amount for every configured plan', async () => {
    for (const [plan, amount] of Object.entries(PLAN_AMOUNTS)) {
      const { verificationResult } = await verify({
        text: receipt({ amount: `₹${amount}` }),
        expectedAmount: amount,
      });
      expect(verificationResult.decision, `plan ${plan}`).toBe('approved');
      expect(verificationResult.checks.amount.passed).toBe(true);
      expect(verificationResult.checks.amount.expected).toBe(amount);
    }
  });

  it('accepts ₹1,000 written with a thousands separator', async () => {
    const { verificationResult } = await verify({
      text: receipt({ amount: '₹1,000' }),
      expectedAmount: 1000,
    });
    expect(verificationResult.decision).toBe('approved');
  });

  it('rejects a confidently read, different amount (AMOUNT_MISMATCH)', async () => {
    const { verificationResult } = await verify({
      text: receipt({ amount: '₹500' }),
      expectedAmount: 120,
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('AMOUNT_MISMATCH');
    expect(verificationResult.checks.amount.detectedAny).toBe(true);
  });

  it('rejects a partial/substring amount (₹1200 is not ₹120)', async () => {
    const { verificationResult } = await verify({
      text: receipt({ amount: '₹1200' }),
      expectedAmount: 120,
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('AMOUNT_MISMATCH');
  });

  it('routes a MISSING amount to manual_review (never a silent approval)', async () => {
    const { verificationResult } = await verify({
      text: receipt({ amount: null }),
    });
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('AMOUNT_NOT_DETECTED');
    expect(verificationResult.checks.amount.detectedAny).toBe(false);
  });

  it('routes an AMBIGUOUS amount (bare digits, no currency/label) to manual_review', async () => {
    // "2120" carries no currency or label context, so no amount can be read
    // with confidence — the extractor deliberately ignores bare digits.
    const { verificationResult } = await verify({
      text: receipt({ amount: '2120' }),
    });
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('AMOUNT_NOT_DETECTED');
  });

  it('never approves on a frontend-supplied expected amount — the server resolves the plan amount', () => {
    // resolvePlanAmount is the ONLY server-side source of the expected
    // amount. A client-supplied amount that is not a configured plan is
    // rejected outright.
    expect(resolvePlanAmount('120')).toBe(120);
    expect(resolvePlanAmount(500)).toBe(500);
    expect(resolvePlanAmount('1000')).toBe(1000);
    expect(resolvePlanAmount(1)).toBe(null);
    expect(resolvePlanAmount(999)).toBe(null);
    expect(resolvePlanAmount('abc')).toBe(null);
    expect(resolvePlanAmount(null)).toBe(null);
    expect(resolvePlanAmount('')).toBe(null);
    expect(resolvePlanAmount(undefined)).toBe(null);
  });

  it('uses the server-resolved amount for both flows (a client amount cannot bypass it)', async () => {
    // The plan amount comes from the server table, never from the client.
    const expected = resolvePlanAmount('500');
    const { verificationResult } = await verify({
      text: receipt({ amount: '₹500' }),
      expectedAmount: expected,
    });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.checks.amount.expected).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════
// RULE B — receiver name
// ═══════════════════════════════════════════════════════════════
describe('Rule B — receiver name', () => {
  it('passes the exact configured name JAYARAJ ALAGAR', async () => {
    const { verificationResult } = await verify({ text: receipt({ name: 'To JAYARAJ ALAGAR' }) });
    expect(verificationResult.checks.receiverName.passed).toBe(true);
    expect(verificationResult.decision).toBe('approved');
  });

  it('handles case and whitespace variations safely', async () => {
    for (const variant of ['To jayaraj alagar', 'To   JAYARAJ    ALAGAR', 'To Jayaraj Alagar', 'To jAyArAj AlAgAr']) {
      const { verificationResult } = await verify({ text: receipt({ name: variant }) });
      expect(verificationResult.checks.receiverName.passed, variant).toBe(true);
      expect(verificationResult.decision, variant).toBe('approved');
    }
  });

  it('ignores harmless punctuation in the payee name', async () => {
    const r = matchReceiverName(['JAYARAJ, ALAGAR.'], RECEIVER_NAME);
    expect(r.match).toBe(true);
  });

  it('routes a MISSING recipient to manual_review', async () => {
    const { verificationResult } = await verify({ text: receipt({ name: null }) });
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('RECEIVER_NAME_UNREADABLE');
  });

  it('rejects a DIFFERENT recipient (RECEIVER_NAME_MISMATCH)', async () => {
    const { verificationResult } = await verify({ text: receipt({ name: 'To SOMEONE ELSE' }) });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('RECEIVER_NAME_MISMATCH');
  });

  it('does NOT auto-approve a PARTIAL name that merely contains a configured token', async () => {
    // "JAYARAJ" alone (and "ALAGAR" alone) must never satisfy
    // "JAYARAJ ALAGAR".
    for (const partial of ['To JAYARAJ', 'To ALAGAR']) {
      const { verificationResult } = await verify({ text: receipt({ name: partial }) });
      expect(verificationResult.decision, partial).toBe('manual_review');
      expect(verificationResult.reason, partial).toBe('RECEIVER_NAME_INCOMPLETE');
      expect(verificationResult.checks.receiverName.passed).toBe(false);
    }
  });

  it('does not accept an unrelated name that shares only the surname', async () => {
    const r = matchReceiverName(['RAJESH ALAGAR'], RECEIVER_NAME);
    expect(r.match).toBe(false);
    expect(r.partial).toBe(true);
  });

  it('fails safe to manual_review when no receiver name is configured', async () => {
    const { verificationResult } = await verify({ receiverName: '' });
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('RECEIVER_NAME_NOT_CONFIGURED');
  });

  it('normalizes the configured name the same way as the OCR read', () => {
    expect(normalizeName('  JAYARAJ   ALAGAR. ')).toBe('jayaraj alagar');
  });
});

// ═══════════════════════════════════════════════════════════════
// RULE C — transaction date (current Asia/Kolkata calendar day)
// ═══════════════════════════════════════════════════════════════
describe('Rule C — transaction date', () => {
  it('accepts a transaction on the current India date', async () => {
    const { verificationResult } = await verify({ text: receipt({ when: istLine(at(-5)) }) });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.checks.transactionDate.onExpectedCalendarDay).toBe(true);
    expect(verificationResult.checks.transactionDate.sameCalendarDay).toBe(true);
  });

  it('rejects a PREVIOUS-day transaction', async () => {
    const yesterday = new Date(UPLOAD_AT.getTime() - 24 * 60 * 60 * 1000);
    const { verificationResult } = await verify({ text: receipt({ when: istLine(yesterday) }) });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
    expect(verificationResult.checks.transactionDate.sameCalendarDay).toBe(false);
  });

  it('rejects a FUTURE transaction timestamp', async () => {
    const { verificationResult } = await verify({ text: receipt({ when: istLine(at(10)) }) });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('computes the calendar day in Asia/Kolkata, not the server local timezone', () => {
    // 2026-09-08T18:00:00Z is 2026-09-08 23:30 IST — still the 8th in IST.
    expect(istCalendarDayKey(new Date('2026-09-08T18:00:00.000Z'))).toBe('2026-09-08');
    // 2026-09-08T19:00:00Z is 2026-09-09 00:30 IST — already the 9th in IST
    // (even though the UTC date is still the 8th).
    expect(istCalendarDayKey(new Date('2026-09-08T19:00:00.000Z'))).toBe('2026-09-09');
  });

  it('routes a MISSING date to manual_review', async () => {
    const { verificationResult } = await verify({ text: receipt({ when: null }) });
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('PAYMENT_DATE_NOT_DETECTED');
  });

  it('routes a date WITHOUT a time component to manual_review', async () => {
    const { verificationResult } = await verify({ text: receipt({ when: '08/09/2026' }) });
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('PAYMENT_TIME_NOT_DETECTED');
    expect(verificationResult.hasTimeComponent).toBe(false);
  });

  it('handles the midnight boundary (paid 23:50 IST, uploaded 00:10 IST)', async () => {
    // Upload at 2026-09-09 00:10 IST == 2026-09-08T18:40:00Z
    const uploadAfterMidnight = new Date('2026-09-08T18:40:00.000Z');
    const paid = new Date('2026-09-08T18:20:00.000Z'); // 23:50 IST on the 8th
    const { verificationResult } = await verify({
      text: receipt({ when: istLine(paid) }),
      now: uploadAfterMidnight,
    });
    // 20 minutes old and inside the window -> still valid.
    expect(verificationResult.checks.transactionDate.midnightStraddle).toBe(true);
    expect(verificationResult.checks.transactionDate.timeWithinWindow).toBe(true);
    expect(verificationResult.decision).toBe('approved');
  });

  it('rejects a midnight-straddle payment that is OUTSIDE the 30-minute window', async () => {
    const uploadAfterMidnight = new Date('2026-09-08T18:40:00.000Z');
    const paid = new Date('2026-09-08T17:00:00.000Z'); // 22:30 IST, 100 min old
    const { verificationResult } = await verify({
      text: receipt({ when: istLine(paid) }),
      now: uploadAfterMidnight,
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });
});

// ═══════════════════════════════════════════════════════════════
// RULE D — transaction time inside the 30-minute window
// ═══════════════════════════════════════════════════════════════
describe('Rule D — 30-minute transaction window', () => {
  it('accepts a transaction just INSIDE the boundary (29 min)', async () => {
    const { verificationResult } = await verify({ text: receipt({ when: istLine(at(-29)) }) });
    expect(verificationResult.checks.transactionDate.timeWithinWindow).toBe(true);
    expect(verificationResult.decision).toBe('approved');
  });

  it('accepts a transaction EXACTLY 30 minutes old (inclusive bound)', async () => {
    const { verificationResult } = await verify({ text: receipt({ when: istLine(at(-30)) }) });
    expect(verificationResult.checks.transactionDate.timeWithinWindow).toBe(true);
    expect(verificationResult.decision).toBe('approved');
  });

  it('rejects a transaction JUST OUTSIDE the boundary (30 min + 1 ms)', async () => {
    const upload = new Date(UPLOAD_AT.getTime() + 1);
    const { verificationResult } = await verify({
      text: receipt({ when: istLine(new Date(UPLOAD_AT.getTime() - 30 * 60 * 1000)) }),
      now: upload,
    });
    expect(verificationResult.checks.transactionDate.timeWithinWindow).toBe(false);
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('accepts a transaction at exactly the upload instant (zero age)', async () => {
    const { verificationResult } = await verify({ text: receipt({ when: istLine(at(0)) }) });
    expect(verificationResult.checks.transactionDate.timeWithinWindow).toBe(true);
    expect(verificationResult.decision).toBe('approved');
  });

  it('rejects a transaction timestamp in the future', async () => {
    // Receipt timestamps have minute precision, so the smallest future
    // reading is one minute ahead.
    const { verificationResult } = await verify({ text: receipt({ when: istLine(at(1)) }) });
    expect(verificationResult.checks.transactionDate.timeWithinWindow).toBe(false);
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('uses the SERVER-generated reference timestamp, not a client one', async () => {
    // The reference is captured once, before any OCR ran, and is exposed on
    // the result so the window can be audited.
    const { verificationResult } = await verify({ text: receipt({ when: istLine(at(-5)) }) });
    expect(verificationResult.uploadReferenceTime).toBe(UPLOAD_AT.toISOString());
    expect(verificationResult.checks.transactionDate.windowMinutes).toBe(30);
  });

  it('does not reset the window during OCR retries / recovery stages', async () => {
    // The recovery stages run AFTER the reference timestamp is captured, so
    // the window is still measured from the upload instant.
    runAmountRecoveryOCR.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return [];
    });
    const { verificationResult } = await verify({ text: receipt({ amount: null, when: istLine(at(-20)) }) });
    expect(verificationResult.uploadReferenceTime).toBe(UPLOAD_AT.toISOString());
    expect(verificationResult.checks.transactionDate.timeWithinWindow).toBe(true);
  });

  it('isWithinPaymentWindow is forward-only (unit)', () => {
    const now = new Date('2026-09-08T09:00:00.000Z');
    expect(isWithinPaymentWindow(new Date(now.getTime() - 5 * 60000), now, 30)).toBe(true);
    expect(isWithinPaymentWindow(new Date(now.getTime() - 30 * 60000), now, 30)).toBe(true);
    expect(isWithinPaymentWindow(new Date(now.getTime() - 30 * 60000 - 1), now, 30)).toBe(false);
    expect(isWithinPaymentWindow(new Date(now.getTime() + 1), now, 30)).toBe(false);
    expect(isWithinPaymentWindow(new Date(now.getTime() + 30 * 60000), now, 30)).toBe(false);
    expect(isWithinPaymentWindow(null, now, 30)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// DECISION ENGINE — manual_review vs rejected, fail closed
// ═══════════════════════════════════════════════════════════════
describe('decidePaymentVerification — inconclusive vs confident', () => {
  const base = {
    upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true,
    transactionStatusOk: true, ocrConfidence: 90,
  };

  it('keeps the legacy binary behaviour when no detection flags are supplied', () => {
    expect(decidePaymentVerification({ ...base, amountMatch: false }))
      .toEqual({ decision: 'rejected', reason: 'AMOUNT_MISMATCH' });
    expect(decidePaymentVerification({ ...base, dateValid: false }))
      .toEqual({ decision: 'rejected', reason: 'INVALID_PAYMENT_DATE' });
  });

  it('routes an unreadable amount to manual_review', () => {
    expect(decidePaymentVerification({ ...base, amountMatch: false, amountDetected: false }))
      .toEqual({ decision: 'manual_review', reason: 'AMOUNT_NOT_DETECTED' });
  });

  it('routes an unreadable date to manual_review', () => {
    expect(decidePaymentVerification({ ...base, dateValid: false, dateDetected: false }))
      .toEqual({ decision: 'manual_review', reason: 'PAYMENT_DATE_NOT_DETECTED' });
  });

  it('routes a missing time to manual_review', () => {
    expect(decidePaymentVerification({ ...base, dateValid: false, dateDetected: true, timeDetected: false }))
      .toEqual({ decision: 'manual_review', reason: 'PAYMENT_TIME_NOT_DETECTED' });
  });

  it('routes a partial receiver name to manual_review', () => {
    expect(decidePaymentVerification({
      ...base, receiverName: 'JAYARAJ ALAGAR', nameConfigured: true,
      nameMatch: false, nameFound: true, namePartial: true,
    })).toEqual({ decision: 'manual_review', reason: 'RECEIVER_NAME_INCOMPLETE' });
  });

  it('rejects a confidently different receiver name', () => {
    expect(decidePaymentVerification({
      ...base, receiverName: 'JAYARAJ ALAGAR', nameConfigured: true,
      nameMatch: false, nameFound: true, namePartial: false,
    })).toEqual({ decision: 'rejected', reason: 'RECEIVER_NAME_MISMATCH' });
  });

  it('never approves when a required field is missing (fail closed)', () => {
    const decisions = [
      decidePaymentVerification({ ...base, utrPresent: false }),
      decidePaymentVerification({ ...base, transactionStatusOk: false }),
      decidePaymentVerification({ ...base, ocrConfidence: 10 }),
      decidePaymentVerification({ ...base, upiMatch: false }),
      decidePaymentVerification({ ...base, receiverName: '', nameConfigured: false }),
    ];
    for (const d of decisions) expect(d.decision).not.toBe('approved');
  });
});

// ═══════════════════════════════════════════════════════════════
// OCR BUDGET / TIMEOUT — fail closed, never an approval
// ═══════════════════════════════════════════════════════════════
describe('OCR budget and failure modes', () => {
  it('aborts with OCR_TIMEOUT when the budget is exhausted (never approves)', async () => {
    // Simulates a slow OCR job that overruns the shared deadline.
    runOCR.mockImplementation(async (_buffer, opts) => {
      await new Promise((r) => setTimeout(r, 20));
      if (opts?.deadline && Date.now() >= opts.deadline) {
        const err = new Error('Screenshot verification exceeded its OCR time budget');
        err.code = 'OCR_TIMEOUT';
        throw err;
      }
      return { text: receipt(), confidence: 90 };
    });
    await expect(verify({ budgetMs: 1 })).rejects.toMatchObject({ code: 'OCR_TIMEOUT' });
  });

  it('completes normally when the budget is generous enough', async () => {
    const { verificationResult } = await verify({ budgetMs: 60000 });
    expect(verificationResult.decision).toBe('approved');
  });

  it('surfaces an OCR exception as OCR_FAILED (not an approval)', async () => {
    runOCR.mockRejectedValue(new Error('tesseract died'));
    await expect(verify()).rejects.toMatchObject({ code: 'OCR_FAILED' });
  });

  it('surfaces an unreadable screenshot as OCR_UNREADABLE', async () => {
    runOCR.mockResolvedValue({ text: '', confidence: 0 });
    await expect(verify()).rejects.toMatchObject({ code: 'OCR_UNREADABLE' });
  });

  it('propagates an OCR timeout raised by a recovery stage', async () => {
    runOCR.mockResolvedValue({ text: receipt({ amount: null }), confidence: 90 });
    runAmountRecoveryOCR.mockRejectedValue(Object.assign(new Error('budget'), { code: 'OCR_TIMEOUT' }));
    await expect(verify()).rejects.toMatchObject({ code: 'OCR_TIMEOUT' });
  });

  it('propagates an OCR timeout raised by the additional passes', async () => {
    runOCR.mockResolvedValue({ text: receipt({ amount: null }), confidence: 90 });
    runAdditionalOCRPasses.mockRejectedValue(Object.assign(new Error('budget'), { code: 'OCR_TIMEOUT' }));
    await expect(verify()).rejects.toMatchObject({ code: 'OCR_TIMEOUT' });
  });

  it('keeps a non-timeout recovery failure best-effort (the attempt still decides)', async () => {
    runOCR.mockResolvedValue({ text: receipt(), confidence: 90 });
    runAmountRecoveryOCR.mockRejectedValue(new Error('worker crashed'));
    const { verificationResult } = await verify();
    expect(verificationResult.decision).toBe('approved');
  });

  it('passes ONE shared deadline to every OCR stage', async () => {
    runOCR.mockResolvedValue({ text: receipt({ amount: null }), confidence: 90 });
    await verify();
    const deadlines = [
      runOCR.mock.calls[0][1]?.deadline,
      runAdditionalOCRPasses.mock.calls[0][1]?.deadline,
      runAmountRecoveryOCR.mock.calls[0][2]?.deadline,
      runDeepAmountRecovery.mock.calls[0][2]?.deadline,
      verifyAmountWithCurrencyRecovery.mock.calls[0][2]?.deadline,
    ];
    for (const d of deadlines) {
      expect(typeof d).toBe('number');
    }
    // One deadline for the whole attempt — the window is never reset.
    expect(new Set(deadlines).size).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// REGISTER / TOPUP PARITY — one engine, one rule set
// ═══════════════════════════════════════════════════════════════
describe('Register / TopUp parity — identical rules, identical outcomes', () => {
  async function bothFlows(opts) {
    const register = await verify(opts);
    const topup = await verify(opts);
    return { register: register.verificationResult, topup: topup.verificationResult };
  }

  const cases = [
    ['valid receipt', { text: receipt() }, 'approved'],
    ['wrong amount', { text: receipt({ amount: '₹500' }) }, 'rejected'],
    ['missing amount', { text: receipt({ amount: null }) }, 'manual_review'],
    ['wrong receiver name', { text: receipt({ name: 'To SOMEONE ELSE' }) }, 'rejected'],
    ['partial receiver name', { text: receipt({ name: 'To JAYARAJ' }) }, 'manual_review'],
    ['missing receiver name', { text: receipt({ name: null }) }, 'manual_review'],
    ['previous day', { text: receipt({ when: istLine(new Date(UPLOAD_AT.getTime() - 86400000)) }) }, 'rejected'],
    ['future timestamp', { text: receipt({ when: istLine(at(5)) }) }, 'rejected'],
    ['exactly 30 min old', { text: receipt({ when: istLine(at(-30)) }) }, 'approved'],
    ['just outside 30 min', { text: receipt({ when: istLine(at(-31)) }) }, 'rejected'],
    ['missing date', { text: receipt({ when: null }) }, 'manual_review'],
    ['missing time', { text: receipt({ when: '08/09/2026' }) }, 'manual_review'],
  ];

  for (const [label, opts, expected] of cases) {
    it(`${label} → ${expected} in BOTH flows`, async () => {
      const { register, topup } = await bothFlows(opts);
      expect(register.decision).toBe(expected);
      expect(topup.decision).toBe(expected);
      expect(register.reason).toBe(topup.reason);
      expect(register.checks).toEqual(topup.checks);
    });
  }

  it('uses the same receiver-name, date and time rules for both flows', async () => {
    const { register, topup } = await bothFlows({ text: receipt() });
    for (const key of ['amount', 'receiverUpi', 'receiverName', 'utr', 'transactionDate', 'transactionStatus']) {
      expect(register.checks[key], key).toEqual(topup.checks[key]);
    }
  });
});
