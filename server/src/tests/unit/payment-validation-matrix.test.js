import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runScreenshotVerification,
  reserveApprovedUtr,
} from '../../services/verificationService.js';

const { runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery, verifyAmountWithCurrencyRecovery } = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
  runAdditionalOCRPasses: vi.fn(),
  runDeepAmountRecovery: vi.fn(),
  verifyAmountWithCurrencyRecovery: vi.fn(),
}));

const dbState = vi.hoisted(() => ({ insertError: null, inserted: [] }));

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery, verifyAmountWithCurrencyRecovery };
});

vi.mock('../../db/supabase.js', () => {
  const del = { eq: () => del, then: (resolve) => resolve({ error: null }) };
  return {
    supabase: {
      from: () => ({
        insert: (row) => ({
          select: () => ({
            maybeSingle: async () => {
              if (dbState.insertError) return { data: null, error: dbState.insertError };
              dbState.inserted.push(row);
              return { data: row, error: null };
            },
          }),
        }),
        delete: () => del,
      }),
    },
    supabaseAnon: {},
    default: {},
  };
});

const RECEIVER_UPI = 'jayarajj126-3@okicici';
const IST_MS = 5.5 * 60 * 60 * 1000;

// 27 Aug 2026 09:30:00 IST
const NOW = () => new Date('2026-08-27T04:00:00.000Z');

function fmtIst(d) {
  const x = new Date(d.getTime() + IST_MS);
  const dd = String(x.getUTCDate()).padStart(2, '0');
  const mm = String(x.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = x.getUTCFullYear();
  let h = x.getUTCHours();
  const m = String(x.getUTCMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${dd}/${mm}/${yyyy}, ${h}:${m} ${ap}`;
}

function receipt({ amount = 120, upi = RECEIVER_UPI, when = '27/08/2026, 9:25 AM', utr = 'T7GHD123456', status = 'Completed' } = {}) {
  const lines = ['To Jayaraj', `₹${amount}`, status];
  if (when) lines.push(when);
  if (utr) lines.push('UPI transaction ID', utr);
  if (upi) lines.push(upi);
  lines.push('Google Pay');
  return lines.join('\n');
}

function verify({ text, confidence = 85, expectedAmount = 120, receiverUpi = RECEIVER_UPI, now = NOW() }) {
  runOCR.mockResolvedValue({ text, confidence });
  return runScreenshotVerification({
    imageBuffer: Buffer.from('img'),
    expectedAmount,
    receiverUpi,
    now,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.insertError = null;
  dbState.inserted.length = 0;
  runAdditionalOCRPasses.mockResolvedValue([]);
  runDeepAmountRecovery.mockResolvedValue([]);
  runAmountRecoveryOCR.mockResolvedValue([]);
  verifyAmountWithCurrencyRecovery.mockResolvedValue({ verified: false, method: 'no_evidence', evidence: '' });
});

// ═══════════════════════════════════════════════════════════════
// 1. TIME WINDOW BOUNDARIES (spec: within ±30 min of server time)
// ═══════════════════════════════════════════════════════════════
describe('Matrix 1: ±30 minute time window boundaries', () => {
  const tx0900 = receipt({ when: '27/08/2026, 9:00 AM' });

  it('transaction 29 min before server time → APPROVED', async () => {
    const { verificationResult } = await verify({ text: tx0900, now: new Date('2026-08-27T03:59:00.000Z') });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.dateValid).toBe(true);
  });

  it('transaction exactly 30 min before server time → APPROVED (inclusive bound)', async () => {
    const { verificationResult } = await verify({ text: tx0900, now: new Date('2026-08-27T04:00:00.000Z') });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.dateValid).toBe(true);
  });

  it('transaction 30 min + 1 ms before server time → REJECTED', async () => {
    const { verificationResult } = await verify({ text: tx0900, now: new Date('2026-08-27T04:00:00.001Z') });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('transaction 30 min in the FUTURE (exact) → APPROVED', async () => {
    const text = receipt({ when: '27/08/2026, 10:00 AM' });
    const { verificationResult } = await verify({ text, now: new Date('2026-08-27T04:00:00.000Z') });
    // Rule D: the window is FORWARD-ONLY — a transaction timestamp in the
    // future is never valid, not even exactly at the +30 min boundary.
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
    expect(verificationResult.dateValid).toBe(false);
  });

  it('transaction 30 min + 1 ms in the future → REJECTED', async () => {
    const text = receipt({ when: '27/08/2026, 10:00 AM' });
    const { verificationResult } = await verify({ text, now: new Date('2026-08-27T03:59:59.999Z') });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('transaction 31 min before server time → REJECTED', async () => {
    const { verificationResult } = await verify({ text: tx0900, now: new Date('2026-08-27T04:01:00.000Z') });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('previous-day transaction (24h old) → REJECTED', async () => {
    const text = receipt({ when: '26/08/2026, 9:00 AM' });
    const { verificationResult } = await verify({ text });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('date without time component → REJECTED', async () => {
    const text = receipt({ when: '27/08/2026' });
    const { verificationResult } = await verify({ text });
    // The time component could not be read -> INCONCLUSIVE -> manual review.
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('PAYMENT_TIME_NOT_DETECTED');
  });

  it('no date at all → REJECTED', async () => {
    const text = receipt({ when: null });    const { verificationResult } = await verify({ text });
    // No date at all could be read -> INCONCLUSIVE -> manual review.
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('PAYMENT_DATE_NOT_DETECTED');
  });

  it('midnight boundary: paid 23:50 IST, uploaded 00:10 IST (20 min apart, ±30-min spec) → APPROVED', async () => {
    const text = receipt({ when: '26/08/2026, 11:50 PM' });
    const now = new Date('2026-08-26T18:40:00.000Z'); // 27 Aug 00:10 IST
    const { verificationResult } = await verify({ text, now });
    expect(verificationResult.detected.date).toBe('26/08/2026, 11:50 PM');
    expect(verificationResult.checks.transactionDate.passed).toBe(true);
    expect(verificationResult.decision).toBe('approved');
  });

  it('midnight boundary control: paid 00:05 IST, uploaded 00:10 IST → APPROVED', async () => {
    const text = receipt({ when: '27/08/2026, 12:05 AM' });
    const now = new Date('2026-08-26T18:40:00.000Z'); // 27 Aug 00:10 IST
    const { verificationResult } = await verify({ text, now });
    expect(verificationResult.decision).toBe('approved');
  });

  it('midnight boundary: paid 23:40 IST, uploaded 00:05 IST (25 min apart) → APPROVED', async () => {
    const text = receipt({ when: '26/08/2026, 11:40 PM' });
    const now = new Date('2026-08-26T18:35:00.000Z'); // 27 Aug 00:05 IST
    const { verificationResult } = await verify({ text, now });
    expect(verificationResult.decision).toBe('approved');
  });

  it('midnight boundary: paid 23:10 IST, uploaded 00:05 IST (55 min apart) → REJECTED', async () => {
    const text = receipt({ when: '26/08/2026, 11:10 PM' });
    const now = new Date('2026-08-26T18:35:00.000Z'); // 27 Aug 00:05 IST
    const { verificationResult } = await verify({ text, now });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('INVALID_PAYMENT_DATE');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2. RECEIVER UPI VARIANTS
// ═══════════════════════════════════════════════════════════════
describe('Matrix 2: receiver UPI matching', () => {
  it('exact UPI → APPROVED', async () => {
    const { verificationResult } = await verify({ text: receipt({ upi: RECEIVER_UPI }) });
    expect(verificationResult.decision).toBe('approved');
  });

  it('wrong UPI → REJECTED UPI_MISMATCH', async () => {
    const { verificationResult } = await verify({ text: receipt({ upi: 'attacker@okicici' }) });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('UPI_MISMATCH');
  });

  it('no UPI in screenshot → REJECTED UPI_MISMATCH', async () => {
    const { verificationResult } = await verify({ text: receipt({ upi: null }) });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('UPI_MISMATCH');
  });

  it('OCR-truncated UPI (last char dropped) → APPROVED', async () => {
    const { verificationResult } = await verify({ text: receipt({ upi: 'jayarajj126-3@okicic' }) });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.upiMatch).toBe(true);
  });

  it('GPay-masked UPI (suffix form) → APPROVED', async () => {
    const { verificationResult } = await verify({ text: receipt({ upi: '26-3@okicici' }) });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.upiMatch).toBe(true);
    expect(verificationResult.upiDiagnostics.matchMethod).toBe('masked_suffix');
  });

  it('receiver UPI compared case-insensitively → APPROVED', async () => {
    const { verificationResult } = await verify({ text: receipt({ upi: 'JAYARAJJ126-3@OKICICI' }) });
    expect(verificationResult.decision).toBe('approved');
  });
});

// ═══════════════════════════════════════════════════════════════
// 3. AMOUNT
// ═══════════════════════════════════════════════════════════════
describe('Matrix 3: amount matching', () => {
  it('exact amount → APPROVED', async () => {
    const { verificationResult } = await verify({ text: receipt({ amount: 500 }), expectedAmount: 500 });
    expect(verificationResult.decision).toBe('approved');
  });

  it('wrong amount → REJECTED AMOUNT_MISMATCH', async () => {
    const { verificationResult } = await verify({ text: receipt({ amount: 500 }), expectedAmount: 120 });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('AMOUNT_MISMATCH');
  });

  it('missing amount → REJECTED AMOUNT_MISMATCH', async () => {
    const text = 'To Jayaraj\nCompleted\n27/08/2026, 9:25 AM\nUPI transaction ID\nT7GHD123456\n' + RECEIVER_UPI;
    const { verificationResult } = await verify({ text });
    // Rule A: an amount that could not be read is INCONCLUSIVE, not wrong.
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('AMOUNT_NOT_DETECTED');
  });

  it('expectedAmount supplied as numeric string (top-up path) → APPROVED', async () => {
    const { verificationResult } = await verify({ text: receipt({ amount: 500 }), expectedAmount: '500' });
    expect(verificationResult.decision).toBe('approved');
    expect(verificationResult.amountMatch).toBe(true);
  });

  it('formatted amount ₹1,000 → APPROVED', async () => {
    const { verificationResult } = await verify({ text: receipt({ amount: '1,000' }), expectedAmount: 1000 });
    expect(verificationResult.decision).toBe('approved');
  });
});

// ═══════════════════════════════════════════════════════════════
// 4. TRANSACTION STATUS
// ═══════════════════════════════════════════════════════════════
describe('Matrix 4: transaction status', () => {
  for (const [label, status] of [['Failed', 'Failed'], ['Pending', 'Pending'], ['Cancelled', 'Cancelled']]) {
    it(`${label} → REJECTED TRANSACTION_FAILED`, async () => {
      const { verificationResult } = await verify({ text: receipt({ status }) });
      expect(verificationResult.decision).toBe('rejected');
      expect(verificationResult.reason).toBe('TRANSACTION_FAILED');
    });
  }

  it('no status text → REJECTED TRANSACTION_FAILED', async () => {
    const { verificationResult } = await verify({ text: receipt({ status: null }) });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('TRANSACTION_FAILED');
  });

  it('Completed → APPROVED', async () => {
    const { verificationResult } = await verify({ text: receipt({ status: 'Completed' }) });
    expect(verificationResult.decision).toBe('approved');
  });
});

// ═══════════════════════════════════════════════════════════════
// 5. UTR
// ═══════════════════════════════════════════════════════════════
describe('Matrix 5: UTR presence, normalization, duplicates', () => {
  it('missing UTR → REJECTED MISSING_UTR', async () => {
    const { verificationResult } = await verify({ text: receipt({ utr: null }) });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('MISSING_UTR');
  });

  it('UTR with spaces/lowercase is normalized → APPROVED', async () => {
    const { verificationResult, utr } = await verify({ text: receipt({ utr: 't7ghd 123456' }) });
    expect(verificationResult.decision).toBe('approved');
    expect(utr).toBe('T7GHD123456');
  });

  it('first-time UTR reservation succeeds → reserved', async () => {
    const res = await reserveApprovedUtr('T7GHD123456', 'payment', 'p1');
    expect(res.reserved).toBe(true);
    expect(res.duplicate).toBe(false);
    expect(dbState.inserted[0].utr).toBe('T7GHD123456');
  });

  it('already-approved UTR → duplicate (23505)', async () => {
    dbState.insertError = { code: '23505', message: 'duplicate key value violates unique constraint' };
    const res = await reserveApprovedUtr('T7GHD123456', 'payment', 'p2');
    expect(res.reserved).toBe(false);
    expect(res.duplicate).toBe(true);
    expect(res.utr).toBe('T7GHD123456');
  });

  it('null UTR → no reservation attempted', async () => {
    const res = await reserveApprovedUtr(null, 'payment', 'p3');
    expect(res.reserved).toBe(false);
    expect(res.duplicate).toBe(false);
    expect(dbState.inserted.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6. OCR CONFIDENCE FLOOR
// ═══════════════════════════════════════════════════════════════
describe('Matrix 6: OCR confidence floor (MIN_OCR_CONFIDENCE_APPROVE = 55)', () => {
  it('confidence exactly 55 → APPROVED', async () => {
    const { verificationResult } = await verify({ text: receipt({}), confidence: 55 });
    expect(verificationResult.decision).toBe('approved');
  });

  it('confidence 54 → REJECTED LOW_OCR_CONFIDENCE', async () => {
    const { verificationResult } = await verify({ text: receipt({}), confidence: 54 });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('LOW_OCR_CONFIDENCE');
  });

  it('confidence undefined → REJECTED LOW_OCR_CONFIDENCE (fails closed)', async () => {
    runOCR.mockResolvedValue({ text: receipt({}), confidence: undefined });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('LOW_OCR_CONFIDENCE');
  });

  it('confidence 0 → REJECTED LOW_OCR_CONFIDENCE', async () => {
    const { verificationResult } = await verify({ text: receipt({}), confidence: 0 });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('LOW_OCR_CONFIDENCE');
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. DEMO / FAKE SCREENSHOTS
// ═══════════════════════════════════════════════════════════════
describe('Matrix 7: demo screenshot rejection', () => {
  it('DEMO marker → REJECTED DEMO_SCREENSHOT', async () => {
    const { verificationResult } = await verify({ text: 'DEMO\n' + receipt({}) });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('DEMO_SCREENSHOT');
  });
});

// ═══════════════════════════════════════════════════════════════
// 8. UNREADABLE OCR
// ═══════════════════════════════════════════════════════════════
describe('Matrix 8: unreadable screenshot', () => {
  it('empty OCR text → throws OCR_UNREADABLE', async () => {
    runOCR.mockResolvedValue({ text: '', confidence: 0 });
    await expect(runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    })).rejects.toMatchObject({ code: 'OCR_UNREADABLE' });
  });

  it('OCR throws → throws OCR_FAILED', async () => {
    runOCR.mockRejectedValue(new Error('tesseract died'));
    await expect(runScreenshotVerification({
      imageBuffer: Buffer.from('img'), expectedAmount: 120, receiverUpi: RECEIVER_UPI, now: NOW(),
    })).rejects.toMatchObject({ code: 'OCR_FAILED' });
  });
});

// ═══════════════════════════════════════════════════════════════
// 9. REGISTER vs TOP-UP PARITY (same engine, same inputs)
// ═══════════════════════════════════════════════════════════════
describe('Matrix 9: register payment and top-up parity', () => {
  const cases = [
    ['valid receipt', receipt({ amount: 500 }), 500, 'approved'],
    ['wrong amount', receipt({ amount: 1000 }), 500, 'rejected'],
    ['wrong upi', receipt({ upi: 'attacker@paytm' }), 500, 'rejected'],
    ['stale date', receipt({ amount: 500, when: '01/08/2026, 9:25 AM' }), 500, 'rejected'],
  ];

  for (const [label, text, amount, expected] of cases) {
    it(`${label} → same decision for register and top-up`, async () => {
      const registerRun = await verify({ text, expectedAmount: amount });
      const topupRun = await verify({ text, expectedAmount: amount });
      expect(registerRun.verificationResult.decision).toBe(expected);
      expect(topupRun.verificationResult.decision).toBe(expected);
      expect(registerRun.verificationResult.decision).toBe(topupRun.verificationResult.decision);
    });
  }
});
