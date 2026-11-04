import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Server-side receiver identity — configured BEFORE the engine modules load.
vi.hoisted(() => {
  process.env.ADMIN_RECEIVER_NAME = 'Jayaraj';
  process.env.ADMIN_UPI_ID = 'jayarajj126-3@okicici';
});

const { runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery } = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
  runAdditionalOCRPasses: vi.fn(),
  runDeepAmountRecovery: vi.fn(),
}));

// Provider control hook: PAYMENT_PROVIDER_MOCK_TIMEOUT is a static config
// const, so a timeout scenario is injected by overriding verifyTransaction.
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
  const client = { from: (t) => db.from(t), storage: { from: () => ({ upload: async () => ({ error: null }), getPublicUrl: () => ({ data: { publicUrl: 'https://x/p.png' } }) }) } };
  return { supabase: client, supabaseAnon: {}, default: client };
});

import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  paymentVerificationEngine,
  statusForOutcome,
  decidePaymentVerification,
  reserveApprovedUtr,
  ENGINE_ID,
} from '../../services/paymentVerification/index.js';
import { resolveApprovalOutcome } from '../../services/paymentVerification/providerVerification.js';

const RECEIVER_UPI = 'jayarajj126-3@okicici';

const VALID_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// Receipt timestamp rendered in Asia/Kolkata, `minutesBeforeUpload` before now.
function istDateLine(minutesBeforeUpload, offsetMs = 0) {
  const ist = new Date(Date.now() - minutesBeforeUpload * 60000 + offsetMs + 5.5 * 3600000);
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

const verify = (text, reqOverrides = {}, opts = {}) =>
  paymentVerificationEngine.verify({
    imageBuffer: opts.imageBuffer || VALID_IMAGE,
    purpose: opts.purpose || 'registration',
    paymentRequest: request(reqOverrides),
    serverTime: opts.serverTime,
    timeoutMs: 5000,
  });

function mockReceipt(text, confidence = 90) {
  runOCR.mockResolvedValue({ text, confidence });
  runAmountRecoveryOCR.mockResolvedValue([]);
  runAdditionalOCRPasses.mockResolvedValue([]);
  runDeepAmountRecovery.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  // Secure production defaults unless a case opts in explicitly.
  delete process.env.PAYMENT_AUTO_APPROVE;
  delete process.env.PAYMENT_PROVIDER_MODE;
  providerCtl.override = null;
  for (const key of Object.keys(db.store)) db.store[key] = [];
  mockReceipt(receipt());
});

afterEach(() => {
  delete process.env.PAYMENT_AUTO_APPROVE;
  delete process.env.PAYMENT_PROVIDER_MODE;
  providerCtl.override = null;
});

// ─────────────────────────────────────────────────────────────
// 1. Four-state outcome contract + approval policy
// ─────────────────────────────────────────────────────────────
describe('outcome contract + approval policy', () => {
  it('1. auto-approve ON + provider confirmed -> APPROVED (verificationResult ready to persist)', async () => {
    process.env.PAYMENT_AUTO_APPROVE = 'true';
    process.env.PAYMENT_PROVIDER_MODE = 'mock';

    const out = await verify(receipt());

    expect(out.outcome).toBe('APPROVED');
    expect(out.approved).toBe(true);
    expect(out.inconclusive).toBe(false);
    expect(out.verificationResult).toMatchObject({
      decision: 'approved',
      status: 'APPROVED',
      reason: null,
      utr: 'T7GHD240824',
      engine: ENGINE_ID,
    });
    expect(ENGINE_ID).toBe('paymentVerificationEngine/v2');
    expect(out.provider).toMatchObject({ available: true, verified: true, provider: 'mock' });
  });

  it('2. auto-approve OFF (production default) -> PENDING_VERIFICATION, never an approval', async () => {
    const out = await verify(receipt());

    expect(out.outcome).toBe('PENDING_VERIFICATION');
    expect(out.approved).toBe(false);
    expect(out.reason).toBe('EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED');
    expect(out.verificationResult).toMatchObject({
      decision: 'manual_review',
      ocrDecision: 'approved',
      status: 'PENDING_VERIFICATION',
      reason: 'EXTERNAL_PAYMENT_CONFIRMATION_REQUIRED',
    });
  });

  it('3. auto-approve ON but no provider configured -> PENDING_PROVIDER_VERIFICATION (OCR alone can never approve)', async () => {
    process.env.PAYMENT_AUTO_APPROVE = 'true';

    const out = await verify(receipt());

    expect(out.outcome).toBe('PENDING_VERIFICATION');
    expect(out.reason).toBe('PENDING_PROVIDER_VERIFICATION');
    expect(out.approved).toBe(false);
  });

  it('4. provider timeout fails safe to PENDING_PROVIDER_VERIFICATION, never approval', async () => {
    process.env.PAYMENT_AUTO_APPROVE = 'true';
    process.env.PAYMENT_PROVIDER_MODE = 'mock';
    providerCtl.override = async () => ({
      available: true,
      verified: false,
      status: 'TIMEOUT',
      provider: 'mock',
      checkedAt: new Date().toISOString(),
    });

    const out = await verify(receipt());

    expect(out.outcome).toBe('PENDING_VERIFICATION');
    expect(out.reason).toBe('PENDING_PROVIDER_VERIFICATION');
    expect(out.approved).toBe(false);
    expect(out.provider).toMatchObject({ verified: false, status: 'TIMEOUT' });
  });

  it('5. statusForOutcome maps every outcome onto the public four-state contract', () => {
    expect(statusForOutcome({ approved: true })).toBe('APPROVED');
    expect(statusForOutcome({ approved: false, review: true })).toBe('MANUAL_REVIEW');
    expect(statusForOutcome({ approved: false, inconclusive: true })).toBe('PENDING_VERIFICATION');
    expect(statusForOutcome({ approved: false, inconclusive: false, review: false })).toBe('REJECTED');
  });

  it('6. resolveApprovalOutcome never returns APPROVED without a confirmed provider response', async () => {
    process.env.PAYMENT_AUTO_APPROVE = 'true'; // provider mode stays 'none'
    const r = await resolveApprovalOutcome({ transactionId: 'T7GHD240824', matchedAmount: 120 });
    expect(r.outcome).toBe('PENDING_VERIFICATION');
    expect(r.reason).toBe('PENDING_PROVIDER_VERIFICATION');
  });
});

// ─────────────────────────────────────────────────────────────
// 2. Definitive gate rejections (evidence contradicts the request)
// ─────────────────────────────────────────────────────────────
describe('definitive rejections', () => {
  it('7. amount mismatch -> REJECTED AMOUNT_MISMATCH', async () => {
    mockReceipt(receipt({ amount: '₹250' }));
    const out = await verify(receipt({ amount: '₹250' }));
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('AMOUNT_MISMATCH');
    expect(out.success).toBe(true);
  });

  it('8. wrong receiver UPI -> REJECTED UPI_MISMATCH', async () => {
    const text = receipt({ upi: 'attacker@paytm' });
    mockReceipt(text);
    const out = await verify(text);
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('UPI_MISMATCH');
  });

  it('9. stale transaction (>30 min) -> REJECTED INVALID_PAYMENT_DATE with TRANSACTION_TOO_OLD variant', async () => {
    const text = receipt({ dateLine: istDateLine(45) });
    mockReceipt(text);
    const out = await verify(text);
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('INVALID_PAYMENT_DATE');
    expect(out.details?.variantCode || out.details?.variant).toMatch(/TRANSACTION_TOO_OLD|INVALID_PAYMENT_DATE_TOO_OLD/);
  });

  it('10. future transaction beyond clock-skew tolerance -> REJECTED FUTURE_TRANSACTION_TIMESTAMP variant', async () => {
    const text = receipt({ dateLine: istDateLine(-10) }); // 10 minutes in the future
    mockReceipt(text);
    const out = await verify(text);
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('INVALID_PAYMENT_DATE');
    expect(out.details?.variantCode || out.details?.variant).toMatch(/FUTURE_TRANSACTION_TIMESTAMP|INVALID_PAYMENT_DATE_FUTURE/);
  });

  it('11. missing UTR -> REJECTED MISSING_UTR (a reference can never be optional)', async () => {
    const text = receipt({ utr: null });
    mockReceipt(text);
    const out = await verify(text);
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('MISSING_UTR');
  });

  it('12. non-success transaction status -> REJECTED TRANSACTION_FAILED', async () => {
    const text = receipt({ status: 'Payment Failed' });
    mockReceipt(text);
    const out = await verify(text);
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('TRANSACTION_FAILED');
  });

  it('13. demo/sample screenshot -> REJECTED DEMO_SCREENSHOT', async () => {
    const text = receipt() + '\nDEMO screenshot for illustration';
    mockReceipt(text);
    const out = await verify(text);
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('DEMO_SCREENSHOT');
  });

  it('14. corrupt (non-image) upload -> REJECTED IMAGE_INTEGRITY_FAILED before any OCR', async () => {
    runOCR.mockRejectedValue(new Error('OCR must not run for a corrupt file'));
    const out = await verify('ignored', {}, { imageBuffer: Buffer.from('not-an-image-at-all') });
    expect(out.success).toBe(false);
    expect(out.inconclusive).toBe(false);
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('IMAGE_INTEGRITY_FAILED');
    expect(runOCR).not.toHaveBeenCalled();
  });

  it('15. different payee name -> REJECTED RECEIVER_NAME_MISMATCH (amount match is not enough)', async () => {
    const text = receipt({ to: 'To Rahul Sharma' });
    mockReceipt(text);
    const out = await verify(text);
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('RECEIVER_NAME_MISMATCH');
  });

  it('16. partially-read payee name stays PENDING (inconclusive) — never approve, never accuse', async () => {
    const text = receipt({ to: 'To Jayaraj' });
    mockReceipt(text);
    const out = await verify(text, { receiverName: 'Jayaraj Alagar' });
    // Incomplete evidence is inconclusive: the user can resubmit a clearer
    // screenshot. It must NOT become a rejection (no accusation) and must
    // never become an approval.
    expect(out.outcome).toBe('PENDING_VERIFICATION');
    expect(out.inconclusive).toBe(true);
    expect(out.reason).toBe('RECEIVER_NAME_INCOMPLETE');
    expect(out.approved).toBe(false);
  });

  it('17. duplicate reference already approved elsewhere -> REJECTED (DUPLICATE_TRANSACTION / topup DUPLICATE_UTR)', async () => {
    db.store.approved_utrs.push({ utr: 'T7GHD240824', reference_type: 'payment', reference_id: 'other-pay' });

    const reg = await verify(receipt(), {}, { purpose: 'registration' });
    expect(reg.outcome).toBe('REJECTED');
    expect(reg.reason).toBe('DUPLICATE_TRANSACTION');

    const top = await verify(receipt(), {}, { purpose: 'topup' });
    expect(top.outcome).toBe('REJECTED');
    expect(top.reason).toBe('DUPLICATE_UTR');
  });
});

// ─────────────────────────────────────────────────────────────
// 3. Inconclusive evidence (no decision, stays resubmittable)
// ─────────────────────────────────────────────────────────────
describe('inconclusive evidence is never a decision', () => {
  it('18. OCR timeout -> inconclusive PENDING_VERIFICATION (retryable, never approval)', async () => {
    runOCR.mockRejectedValue({ code: 'OCR_TIMEOUT', message: 'budget exhausted' });
    const out = await verify(receipt());
    expect(out.success).toBe(false);
    expect(out.inconclusive).toBe(true);
    expect(out.outcome).toBe('PENDING_VERIFICATION');
    expect(out.code).toBe('OCR_TIMEOUT');
    expect(out.approved).toBe(false);
  });

  it('19. OCR failure -> inconclusive PENDING_VERIFICATION with a retryable code', async () => {
    runOCR.mockRejectedValue({ code: 'OCR_FAILED', message: 'tesseract crashed' });
    const out = await verify(receipt());
    expect(out.success).toBe(false);
    expect(out.inconclusive).toBe(true);
    expect(out.outcome).toBe('PENDING_VERIFICATION');
    expect(['OCR_FAILED', 'OCR_UNREADABLE']).toContain(out.code);
    expect(out.approved).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// 4. Ambiguous identity evidence -> MANUAL_REVIEW (advisory sender gate)
// ─────────────────────────────────────────────────────────────
describe('sender-name gate (Rule B)', () => {
  it('20. payer-name mismatch under policy "review" -> MANUAL_REVIEW, never auto-approved', async () => {
    const text = receipt({ from: 'From: Amit Kumar' });
    mockReceipt(text);
    const out = await verify(text, { expectedPayerName: 'Rahul Verma', senderPolicy: 'review' });
    expect(out.outcome).toBe('MANUAL_REVIEW');
    expect(out.reason).toBe('SENDER_NAME_MISMATCH');
    expect(out.approved).toBe(false);
  });

  it('21. payer-name mismatch under policy "reject" -> definitive REJECTED', async () => {
    const text = receipt({ from: 'From: Amit Kumar' });
    mockReceipt(text);
    const out = await verify(text, { expectedPayerName: 'Rahul Verma', senderPolicy: 'reject' });
    expect(out.outcome).toBe('REJECTED');
    expect(out.reason).toBe('SENDER_NAME_MISMATCH');
  });
});

// ─────────────────────────────────────────────────────────────
// 5. Cross-flow UTR ledger (authoritative duplicate gate)
// ─────────────────────────────────────────────────────────────
describe('approved-UTR ledger', () => {
  it('22. the same UTR cannot be reserved twice across flows (UNIQUE constraint wins the race)', async () => {
    const first = await reserveApprovedUtr('UTRSHARED1', 'payment', 'pay-1');
    expect(first.reserved).toBe(true);
    expect(first.duplicate).toBe(false);

    const second = await reserveApprovedUtr('UTRSHARED1', 'topup', 'top-1');
    expect(second.reserved).toBe(false);
    expect(second.duplicate).toBe(true);
  });

  it('23. clock skew inside the configured tolerance does not reject a fresh receipt', async () => {
    process.env.PAYMENT_AUTO_APPROVE = 'true';
    process.env.PAYMENT_PROVIDER_MODE = 'mock';
    const text = receipt({ dateLine: istDateLine(0, 60000) }); // 60s ahead of upload
    mockReceipt(text);
    const out = await verify(text);
    expect(out.outcome).toBe('APPROVED');
  });
});

// ─────────────────────────────────────────────────────────────
// 6. One engine for both flows (source parity) + flat decision rule
// ─────────────────────────────────────────────────────────────
describe('single shared engine + decision rule', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (f) => fs.readFileSync(path.join(here, '..', '..', 'services', f), 'utf8');

  it('24. registration and top-up flows both call the SAME unified engine', () => {
    for (const f of ['paymentService.js', 'topupService.js']) {
      const src = read(f);
      expect(src).toContain("from './paymentVerification/index.js'");
      expect(src).toContain('paymentVerificationEngine.verify(');
      expect(src).not.toContain('verificationService.js');
      expect(src).not.toContain('paymentValidationService.js');
    }
  });

  it('25. flat decision rule: every mandatory gate must pass, each failure is classified', () => {
    const pass = {
      upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true,
      transactionStatusOk: true, ocrConfidence: 90,
    };
    expect(decidePaymentVerification(pass).decision).toBe('approved');
    expect(decidePaymentVerification({ ...pass, upiMatch: false })).toMatchObject({ decision: 'rejected', reason: 'UPI_MISMATCH' });
    expect(decidePaymentVerification({ ...pass, amountMatch: false })).toMatchObject({ decision: 'rejected', reason: 'AMOUNT_MISMATCH' });
    expect(decidePaymentVerification({ ...pass, amountMatch: false, amountDetected: false })).toMatchObject({ decision: 'manual_review', reason: 'AMOUNT_NOT_DETECTED' });
    expect(decidePaymentVerification({ ...pass, dateValid: false })).toMatchObject({ decision: 'rejected', reason: 'INVALID_PAYMENT_DATE' });
    expect(decidePaymentVerification({ ...pass, transactionStatusOk: false })).toMatchObject({ decision: 'rejected', reason: 'TRANSACTION_FAILED' });
    expect(decidePaymentVerification({ ...pass, utrPresent: false })).toMatchObject({ decision: 'rejected', reason: 'MISSING_UTR' });
    expect(decidePaymentVerification({ ...pass, ocrConfidence: 30 })).toMatchObject({ decision: 'rejected', reason: 'LOW_OCR_CONFIDENCE' });
    expect(decidePaymentVerification({ ...pass, ocrConfidence: undefined })).toMatchObject({ decision: 'rejected', reason: 'LOW_OCR_CONFIDENCE' });
  });
});
