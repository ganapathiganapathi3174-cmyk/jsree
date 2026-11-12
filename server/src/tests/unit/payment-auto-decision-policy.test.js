import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Deterministic payment decision policy — production defaults configured
// BEFORE the engine modules load: no provider (mode none), no receiver-name
// secondary gate override, sender policy default ('reject').
vi.hoisted(() => {
  process.env.ADMIN_RECEIVER_NAME = 'Jayaraj';
  process.env.ADMIN_UPI_ID = 'jayarajj126-3@okicici';
  delete process.env.PAYMENT_PROVIDER_MODE; // -> 'none'
  delete process.env.SENDER_NAME_POLICY; // -> 'reject'
  delete process.env.PAYMENT_AUTO_APPROVE; // legacy switch (removed)
});

const { runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery } = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
  runAdditionalOCRPasses: vi.fn(),
  runDeepAmountRecovery: vi.fn(),
}));

// Provider control hook: tests inject definitive/technical provider answers.
const providerCtl = vi.hoisted(() => ({ override: null }));

vi.mock('../../services/paymentProviderService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    verifyTransaction: (...args) =>
      providerCtl.override ? providerCtl.override(...args) : actual.verifyTransaction(...args),
  };
});

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery };
});

const { db } = vi.hoisted(() => {
  const store = { approved_utrs: [], payments: [], topups: [], users: [] };
  const builder = (table) => {
    const p = {
      _op: 'select', _single: false, _limit: null, _filters: [], _payload: null,
      select() { return p; },
      insert(payload) { p._op = 'insert'; p._payload = payload; return p; },
      update(payload) { p._op = 'update'; p._payload = payload; return p; },
      delete() { p._op = 'delete'; return p; },
      eq(col, val) { p._filters.push(r => r[col] === val); return p; },
      neq(col, val) { p._filters.push(r => r[col] !== val); return p; },
      in(col, vals) { p._filters.push(r => vals.includes(r[col])); return p; },
      limit(n) { p._limit = n; return p; },
      single() { p._single = true; return p; },
      maybeSingle() { p._single = true; return p; },
      then(onRes, onRej) {
        const respond = (out) => Promise.resolve(out).then(onRes, onRej);
        const rows = store[table] || (store[table] = []);
        const matched = rows.filter(r => p._filters.every(f => f(r)));
        if (p._op === 'insert') {
          const items = Array.isArray(p._payload) ? p._payload : [p._payload];
          const inserted = [];
          for (const item of items) {
            if (table === 'approved_utrs' && rows.some(r => r.utr === item.utr)) {
              return respond({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
            }
            const row = { id: `${table}-${rows.length + 1}`, ...item };
            rows.push(row);
            inserted.push(row);
          }
          return respond({ data: p._single ? inserted[0] : (inserted || null), error: null });
        }
        if (p._op === 'update') {
          for (const row of matched) Object.assign(row, p._payload);
          return respond({ data: p._single ? (matched[0] ? { ...matched[0] } : null) : matched, error: null });
        }
        if (p._op === 'delete') {
          for (const row of matched) rows.splice(rows.indexOf(row), 1);
          return respond({ data: null, error: null });
        }
        const projected = (p._limit ? matched.slice(0, p._limit) : matched).map(r => ({ ...r }));
        if (p._single) {
          return respond(projected[0]
            ? { data: projected[0], error: null }
            : { data: null, error: { code: 'PGRST116', message: 'No rows found' } });
        }
        return respond({ data: projected, error: null });
      },
      catch(fn) { return p.then(undefined, fn); },
    };
    return p;
  };
  return { db: { store, from: (t) => builder(t) } };
});

vi.mock('../../db/supabase.js', () => {
  const client = {
    from: (t) => db.from(t),
    storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/p.png' } }) }) },
  };
  return { supabase: client, supabaseAnon: {}, default: client };
});

import {
  paymentVerificationEngine,
  ENGINE_ID,
} from '../../services/paymentVerification/index.js';
import { resolveApprovalOutcome } from '../../services/paymentVerification/providerVerification.js';
import { SENDER_NAME_POLICY } from '../../config/paymentConfig.js';

const RECEIVER_UPI = 'jayarajj126-3@okicici';

const VALID_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWj9awAAAABJRU5ErkJggg==',
  'base64'
);

function istDateLine(minutesBeforeUpload) {
  const ist = new Date(Date.now() - minutesBeforeUpload * 60000 + 5.5 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  let h = ist.getUTCHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${pad(ist.getUTCDate())}/${pad(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()}, ${h}:${pad(ist.getUTCMinutes())} ${ap}`;
}

function receipt(overrides = {}) {
  const {
    status = 'Payment Successful',
    amount = '₹120',
    to = 'To Jayaraj',
    upi = RECEIVER_UPI,
    dateLine = istDateLine(2),
    utr = 'T7GHD240824',
    from = 'From: Rahul Verma',
  } = overrides;
  const lines = [status, amount, to, upi, `Date: ${dateLine}`];
  if (utr) lines.push(`UPI transaction ID: ${utr}`);
  if (from !== null) lines.push(from);
  return lines.join('\n');
}

const request = (overrides = {}) => ({
  type: 'registration',
  expectedAmount: 120,
  paymentId: 'pay-1',
  userId: 'user-1',
  receiverName: 'Jayaraj',
  receiverUpi: RECEIVER_UPI,
  ...overrides,
});

const verify = (text, reqOverrides = {}, opts = {}) => {
  runOCR.mockResolvedValue({ text, confidence: 90 });
  runAmountRecoveryOCR.mockResolvedValue([]);
  runAdditionalOCRPasses.mockResolvedValue([]);
  runDeepAmountRecovery.mockResolvedValue([]);
  return paymentVerificationEngine.verify({
    imageBuffer: opts.imageBuffer || VALID_IMAGE,
    purpose: opts.purpose || 'registration',
    paymentRequest: request(reqOverrides),
    serverTime: opts.serverTime,
    timeoutMs: 5000,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PAYMENT_PROVIDER_MODE;
  providerCtl.override = null;
  for (const key of Object.keys(db.store)) db.store[key] = [];
});

afterEach(() => {
  delete process.env.PAYMENT_PROVIDER_MODE;
  providerCtl.override = null;
});

// ─────────────────────────────────────────────────────────────
// 1. resolveApprovalOutcome — the deterministic provider matrix
// ─────────────────────────────────────────────────────────────
describe('resolveApprovalOutcome — provider policy matrix', () => {
  it('mode none (production): all gates passed -> APPROVED (screenshot policy)', async () => {
    const r = await resolveApprovalOutcome({ transactionId: 'T7GHD240824', matchedAmount: 120 });
    expect(r.outcome).toBe('APPROVED');
    expect(r.reason).toBe(null);
    expect(r.provider).toMatchObject({ available: false, verified: false, provider: 'none' });
  });

  it('mode mock + provider confirms -> APPROVED', async () => {
    process.env.PAYMENT_PROVIDER_MODE = 'mock';
    const r = await resolveApprovalOutcome({ transactionId: 'T7GHD240824', matchedAmount: 120 });
    expect(r.outcome).toBe('APPROVED');
    expect(r.provider).toMatchObject({ verified: true, provider: 'mock' });
  });

  it('mode mock + DEFINITIVE negative -> REJECTED (invalid transaction reference)', async () => {
    process.env.PAYMENT_PROVIDER_MODE = 'mock';
    providerCtl.override = async () => ({
      available: true, verified: false, status: 'NOT_FOUND', provider: 'mock',
      checkedAt: new Date().toISOString(),
    });
    const r = await resolveApprovalOutcome({ transactionId: 'T7GHD240824', matchedAmount: 120 });
    expect(r.outcome).toBe('REJECTED');
    expect(r.reason).toBe('PROVIDER_TRANSACTION_NOT_FOUND');
  });

  it('mode mock + provider TIMEOUT -> retryable no-decision, never fraud, never approval', async () => {
    process.env.PAYMENT_PROVIDER_MODE = 'mock';
    providerCtl.override = async () => ({
      available: true, verified: false, status: 'TIMEOUT', provider: 'mock',
      checkedAt: new Date().toISOString(),
    });
    const r = await resolveApprovalOutcome({ transactionId: 'T7GHD240824', matchedAmount: 120 });
    expect(r.outcome).toBe('PENDING_VERIFICATION');
    expect(r.reason).toBe('PROVIDER_UNAVAILABLE');
  });

  it('mode mock + provider ERROR -> retryable no-decision', async () => {
    process.env.PAYMENT_PROVIDER_MODE = 'mock';
    providerCtl.override = async () => ({
      available: true, verified: false, status: 'PROVIDER_ERROR', provider: 'mock',
      checkedAt: new Date().toISOString(),
    });
    const r = await resolveApprovalOutcome({ transactionId: 'T7GHD240824', matchedAmount: 120 });
    expect(r.outcome).toBe('PENDING_VERIFICATION');
    expect(r.reason).toBe('PROVIDER_UNAVAILABLE');
  });

  it('mode mock + provider UNAVAILABLE -> never APPROVED', async () => {
    process.env.PAYMENT_PROVIDER_MODE = 'mock';
    providerCtl.override = async () => ({
      available: false, verified: false, status: 'UNAVAILABLE', provider: 'mock',
      checkedAt: new Date().toISOString(),
    });
    const r = await resolveApprovalOutcome({ transactionId: 'T7GHD240824', matchedAmount: 120 });
    expect(r.outcome).not.toBe('APPROVED');
    expect(r.outcome).toBe('PENDING_VERIFICATION');
    expect(r.reason).toBe('PROVIDER_UNAVAILABLE');
  });
});

// ─────────────────────────────────────────────────────────────
// 2. engine.verify — production defaults (mode none)
// ─────────────────────────────────────────────────────────────
describe('engine.verify — deterministic production decisions (mode none)', () => {
  it('fully valid receipt -> APPROVED with ready-to-persist verificationResult', async () => {
    const out = await verify(receipt());
    expect(out.outcome).toBe('APPROVED');
    expect(out.approved).toBe(true);
    expect(out.verificationResult).toMatchObject({
      decision: 'approved',
      status: 'APPROVED',
      reason: null,
      utr: 'T7GHD240824',
      engine: ENGINE_ID,
    });
  });

  it('wrong amount -> REJECTED AMOUNT_MISMATCH (definite failure)', async () => {
    const out = await verify(receipt({ amount: '₹250' }));
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('AMOUNT_MISMATCH');
    expect(out.verificationResult.decision).toBe('rejected');
  });

  it('wrong receiver UPI -> REJECTED UPI_MISMATCH (definite failure)', async () => {
    const out = await verify(receipt({ upi: 'attacker@paytm' }));
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('UPI_MISMATCH');
  });

  it('failed transaction status -> REJECTED TRANSACTION_FAILED', async () => {
    const out = await verify(receipt({ status: 'Payment Failed' }));
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('TRANSACTION_FAILED');
  });

  it('OCR crash -> inconclusive OCR_FAILED (technical: no decision, never fraud)', async () => {
    runOCR.mockRejectedValue(Object.assign(new Error('tesseract died'), { code: 'OCR_FAILED' }));
    const out = await paymentVerificationEngine.verify({
      imageBuffer: VALID_IMAGE,
      purpose: 'registration',
      paymentRequest: request(),
      timeoutMs: 5000,
    });
    expect(out.outcome).toBe('PENDING_VERIFICATION');
    expect(out.inconclusive).toBe(true);
    expect(out.approved).toBe(false);
    expect(out.reason).toBe('OCR_FAILED');
    expect(out.verificationResult?.decision).not.toBe('rejected');
  });

  it('unreadable screenshot -> inconclusive OCR_UNREADABLE (never a rejection)', async () => {
    const out = await verify('');
    expect(out.outcome).toBe('PENDING_VERIFICATION');
    expect(out.inconclusive).toBe(true);
    expect(out.approved).toBe(false);
    expect(['OCR_UNREADABLE', 'OCR_EXTRACTION_FAILED', 'OCR_FAILED']).toContain(out.reason);
  });

  it('low OCR confidence on a perfect receipt -> REJECTED LOW_OCR_CONFIDENCE', async () => {
    runOCR.mockResolvedValue({ text: receipt(), confidence: 10 });
    const out = await paymentVerificationEngine.verify({
      imageBuffer: VALID_IMAGE,
      purpose: 'registration',
      paymentRequest: request(),
      timeoutMs: 5000,
    });
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('LOW_OCR_CONFIDENCE');
  });

  it('duplicate reference already approved -> REJECTED DUPLICATE_TRANSACTION', async () => {
    db.store.approved_utrs.push({ utr: 'T7GHD240824', reference_type: 'payment', reference_id: 'other-pay' });
    const out = await verify(receipt());
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('DUPLICATE_TRANSACTION');
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Sender (payer) name — default 'reject', explicit 'review' opt-in
// ─────────────────────────────────────────────────────────────
describe('sender payer name policy (Rule B)', () => {
  it('production default policy is reject (no manual-review parking)', () => {
    expect(SENDER_NAME_POLICY).toBe('reject');
  });

  it('default policy: complete payer mismatch -> REJECTED SENDER_NAME_MISMATCH', async () => {
    const out = await verify(receipt({ from: 'From: Someone Else Entirely' }), {
      expectedPayerName: 'Rahul Verma',
    });
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('SENDER_NAME_MISMATCH');
  });

  it("explicit senderPolicy='review' opt-in: mismatch -> MANUAL_REVIEW (only path that parks)", async () => {
    const out = await verify(receipt({ from: 'From: Someone Else Entirely' }), {
      expectedPayerName: 'Rahul Verma',
      senderPolicy: 'review',
    });
    expect(out.outcome).toBe('MANUAL_REVIEW');
    expect(out.verificationResult.decision).toBe('manual_review');
    expect(out.verificationResult.reason).toBe('SENDER_NAME_MISMATCH');
  });

  it('unreadable payer line is advisory only — still APPROVED', async () => {
    const out = await verify(receipt({ from: null }), { expectedPayerName: 'Rahul Verma' });
    expect(out.outcome).toBe('APPROVED');
    expect(out.approved).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Receiver name gate — applies only when configured
// ─────────────────────────────────────────────────────────────
describe('receiver name gate (requirement: only when evidence is available)', () => {
  it('no receiver name configured -> gate skipped, other gates still decide', async () => {
    const out = await verify(receipt(), { receiverName: '' });
    expect(out.outcome).toBe('APPROVED');
    expect(out.checks.receiverName).toMatchObject({ passed: null, skipped: true, reason: 'RECEIVER_NAME_NOT_CONFIGURED' });
    expect(out.nameDiagnostics?.enabled).toBe(false);
  });

  it('configured name + confident mismatch -> REJECTED RECEIVER_NAME_MISMATCH', async () => {
    const out = await verify(receipt({ to: 'To Someone Else' }));
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('RECEIVER_NAME_MISMATCH');
  });

  it('configured name + name absent from receipt -> inconclusive (no decision, resubmittable)', async () => {
    // Receipt has a "To <upi>" line but no readable payee name.
    const text = [
      'Payment Successful', '₹120', RECEIVER_UPI,
      `Date: ${istDateLine(2)}`, 'UPI transaction ID: T7GHD240824', 'From: Rahul Verma',
    ].join('\n');
    const out = await verify(text);
    expect(out.inconclusive).toBe(true);
    expect(out.approved).toBe(false);
    expect(out.reason).toBe('RECEIVER_NAME_UNREADABLE');
    expect(out.outcome).toBe('PENDING_VERIFICATION');
  });
});

// ─────────────────────────────────────────────────────────────
// 5. Every supported plan amount auto-decides correctly
// ─────────────────────────────────────────────────────────────
describe('supported plan amounts (₹120 / ₹500 / ₹1,000)', () => {
  it('valid ₹120 payment -> APPROVED', async () => {
    const out = await verify(receipt({ amount: '₹120' }));
    expect(out.outcome).toBe('APPROVED');
    expect(out.approved).toBe(true);
  });

  it('valid ₹500 payment -> APPROVED', async () => {
    const out = await verify(receipt({ amount: '₹500' }), { expectedAmount: 500 });
    expect(out.outcome).toBe('APPROVED');
    expect(out.approved).toBe(true);
    expect(out.checks.amount?.passed).toBe(true);
  });

  it('valid ₹1,000 payment -> APPROVED', async () => {
    const out = await verify(receipt({ amount: '₹1,000' }), { expectedAmount: 1000 });
    expect(out.outcome).toBe('APPROVED');
    expect(out.approved).toBe(true);
    expect(out.checks.amount?.passed).toBe(true);
  });

  it('amount paid for a DIFFERENT plan -> REJECTED AMOUNT_MISMATCH', async () => {
    const out = await verify(receipt({ amount: '₹120' }), { expectedAmount: 500 });
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('AMOUNT_MISMATCH');
    expect(out.approved).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// 6. Screenshot integrity — tampered evidence is a definite rejection
// ─────────────────────────────────────────────────────────────
describe('tampered screenshot handling', () => {
  it('payload corruption behind valid PNG magic bytes -> REJECTED IMAGE_INTEGRITY_FAILED before any OCR', async () => {
    const tampered = Buffer.from(VALID_IMAGE);
    // Keep the 8-byte PNG signature so the file LOOKS like a PNG, then
    // destroy the IHDR chunk that follows (classic tamper/truncate attack).
    tampered.fill(0xff, 8, Math.min(tampered.length, 40));
    runOCR.mockImplementation(() => { throw new Error('OCR must not run on a tampered image'); });

    const out = await paymentVerificationEngine.verify({
      imageBuffer: tampered,
      purpose: 'registration',
      paymentRequest: request(),
      timeoutMs: 5000,
    });

    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('IMAGE_INTEGRITY_FAILED');
    expect(out.approved).toBe(false);
    expect(runOCR).not.toHaveBeenCalled();
  });
});
