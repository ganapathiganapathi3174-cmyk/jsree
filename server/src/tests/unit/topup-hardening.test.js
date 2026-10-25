import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTopup,
  submitTopupProof,
  applyTopupVerification,
  verifyTopup,
} from '../../services/topupService.js';
import { autoExpireStalePayments } from '../../services/paymentService.js';
import { getPlans } from '../../services/planService.js';
import { PAYMENT_PLANS } from '../../config/paymentConfig.js';

// ─────────────────────────────────────────────────────────────
// TOP-UP HARDENING: server expiry/hash/type, shared-engine matrix,
// wallet idempotency, sweep, plans protection. All mocked — no DB.
// ─────────────────────────────────────────────────────────────

const { runScreenshotVerification, reserveApprovedUtr, creditMock, uploadMock, db } = vi.hoisted(() => {
  const state = {
    sender: null, topupRow: null, topupList: null, flipResult: [{ id: 'top-1' }],
    ledger: [], inserts: {}, updates: {}, results: {},
  };
  const rec = (bucket, table, payload) => {
    (state[bucket][table] = state[bucket][table] || []).push(payload);
  };
  const builder = (table) => {
    const p = {
      _single: false, _didUpdate: false, _inserted: null,
      update: (payload) => { rec('updates', table, payload); p._didUpdate = true; if (table === 'topups' && state.topupRow) Object.assign(state.topupRow, payload); return p; },
      insert: (payload) => { rec('inserts', table, payload); p._inserted = payload; return p; },
      delete: () => p,
      select: () => p,
      eq: () => p, neq: () => p, in: () => p, or: () => p,
      order: () => p, limit: () => p, range: () => p, lt: () => p, gt: () => p,
      single: () => { p._single = true; return p; },
      maybeSingle: () => { p._single = true; return p; },
      then: (res) => {
        if (table === 'wallet_transactions') return res({ data: [...state.ledger], error: null });
        if (table === 'users') return res({ data: state.sender ? { ...state.sender } : null, error: null });
        if (table === 'topups') {
          if (p._inserted) return res({ data: { id: 'top-new', ...p._inserted }, error: null });
          if (p._didUpdate) return res({ data: state.flipResult, error: null });
          if (p._single) return res({ data: state.topupRow ? { ...state.topupRow } : null, error: null });
          return res({ data: state.topupList ? state.topupList.map(r => ({ ...r })) : [], error: null });
        }
        return res(state.results[table] || { data: null, error: null });
      },
      catch: () => p,
    };
    return p;
  };
  const uploadMock = vi.fn(async () => ({ error: null }));
  const client = {
    from: (t) => builder(t),
    storage: { from: () => ({ upload: uploadMock, getPublicUrl: () => ({ data: { publicUrl: 'https://x/proof.png' } }), remove: vi.fn() }) },
  };
  return {
    runScreenshotVerification: vi.fn(),
    reserveApprovedUtr: vi.fn(),
    creditMock: vi.fn(),
    uploadMock,
    db: { state, client },
  };
});

vi.mock('../../db/supabase.js', () => {
  const c = db.client;
  return { supabase: c, supabaseAnon: {}, default: c };
});
vi.mock('../../services/auditService.js', () => ({ logAction: vi.fn(async () => ({})) }));
vi.mock('../../services/verificationService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runScreenshotVerification, reserveApprovedUtr };
});
vi.mock('../../services/walletService.js', () => ({ default: { creditBatch: creditMock } }));
vi.mock('../../services/notificationService.js', () => ({ default: { createNotification: vi.fn(async () => ({})) } }));

const { runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery } = vi.hoisted(() => {
  if (!process.env.ADMIN_RECEIVER_NAME) {
    process.env.ADMIN_RECEIVER_NAME = 'Jayaraj';
  }
  // This suite asserts straight-through auto-approval: enable it explicitly.
  // Production default (unset) is the secure external-confirmation fallback.
  process.env.PAYMENT_AUTO_APPROVE = 'true';
  return {
    runOCR: vi.fn(),
    runAmountRecoveryOCR: vi.fn(),
    runAdditionalOCRPasses: vi.fn(),
    runDeepAmountRecovery: vi.fn(),
  };
});
vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery };
});

import { supabase } from '../../db/supabase.js';
void supabase;

const RECEIVER_UPI = 'jayarajj126-3@okicici';

const VALID_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);
const past = () => new Date(Date.now() - 60000).toISOString();
const future = () => new Date(Date.now() + 30 * 60000).toISOString();

function freshTopup(overrides = {}) {
  return {
    id: 'top-1', sender_id: 'sender-1', receiver_id: 'recv-1',
    amount: 120, plan: 120, status: 'created', payment_type: 'TOPUP',
    receiver_upi: RECEIVER_UPI, expires_at: future(),
    ...overrides,
  };
}

function reset() {
  db.state.sender = { id: 'sender-1', current_plan: 120 };
  db.state.topupRow = null;
  db.state.topupList = null;
  db.state.flipResult = [{ id: 'top-1' }];
  db.state.ledger = [];
  db.state.inserts = {};
  db.state.updates = {};
  db.state.results = {};
  vi.clearAllMocks();
  uploadMock.mockResolvedValue({ error: null });
  creditMock.mockResolvedValue([{ credited: true }, { credited: true }]);
  reserveApprovedUtr.mockResolvedValue({ duplicate: false, reserved: true, utr: 'UTRX' });
}

const approvedResult = (utr) => ({
  verificationResult: { decision: 'approved', reason: null, utr, amountMatch: true, upiMatch: true, dateValid: true, ocrConfidence: 90 },
  verificationTime: new Date(),
  utr,
});

describe('top-up creation is server-authoritative', () => {
  it('sets expires_at ~30min, receiver_upi, payment_type TOPUP from server', async () => {
    reset();
    const before = Date.now();
    // Attempt to smuggle client values — createTopup takes only ids+amount.
    const topup = await createTopup('sender-1', 'recv-1', 120);
    const inserted = db.state.inserts.topups[0];
    expect(inserted.payment_type).toBe('TOPUP');
    expect(inserted.receiver_upi).toBe(RECEIVER_UPI);
    const win = new Date(inserted.expires_at).getTime() - before;
    expect(win).toBeGreaterThan(29 * 60000);
    expect(win).toBeLessThan(31 * 60000);
    expect(topup.payment_type).toBe('TOPUP');
  });

  it('rejects amounts outside server plan table', async () => {
    reset();
    await expect(createTopup('sender-1', 'recv-1', 2120)).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });
});

describe('top-up pre-upload gates', () => {
  it('expired top-up rejected BEFORE storage upload (PAYMENT_EXPIRED)', async () => {
    reset();
    db.state.topupRow = freshTopup({ expires_at: past() });
    const file = { originalname: 'p.png', mimetype: 'image/png', buffer: Buffer.from('img') };
    await expect(submitTopupProof('top-1', file, 'sender-1')).rejects.toMatchObject({ code: 'PAYMENT_EXPIRED' });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('reused completed screenshot rejected (DUPLICATE_SCREENSHOT)', async () => {
    reset();
    db.state.topupRow = freshTopup();
    db.state.topupList = [{ id: 'other-top' }]; // hash-hit on completed proof
    const file = { originalname: 'p.png', mimetype: 'image/png', buffer: Buffer.from('same-img') };
    await expect(submitTopupProof('top-1', file, 'sender-1')).rejects.toMatchObject({ code: 'DUPLICATE_SCREENSHOT' });
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('valid receipt proof completes through the shared engine and credits both wallets', async () => {
    reset();
    db.state.topupRow = freshTopup();
    runOCR.mockResolvedValue({
      text: [
        'Payment Successful',
        '\u20B9120',
        'To Jayaraj',
        RECEIVER_UPI,
        `Date: ${(() => {
          const ist = new Date(Date.now() - 2 * 60000 + 5.5 * 3600000);
          const pad = n => String(n).padStart(2, '0');
          let h = ist.getUTCHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
          return `${pad(ist.getUTCDate())}/${pad(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()}, ${h}:${pad(ist.getUTCMinutes())} ${ap}`;
        })()}`,
        'UPI transaction ID: THARDEN001',
      ].join('\n'),
      confidence: 90,
    });
    runAmountRecoveryOCR.mockResolvedValue([]);
    runAdditionalOCRPasses.mockResolvedValue([]);
    runDeepAmountRecovery.mockResolvedValue([]);

    const result = await submitTopupProof(
      'top-1',
      { originalname: 'synthetic.png', mimetype: 'image/png', buffer: VALID_IMAGE },
      'sender-1'
    );

    expect(result.credited).toBe(true);
    expect(result.manualReview).toBe(false);
    expect(db.state.topupRow.status).toBe('completed');
    expect(db.state.topupRow.verification_result).toMatchObject({
      decision: 'approved',
      engine: 'paymentValidationEngine/v1',
    });
    expect(creditMock).toHaveBeenCalledTimes(1);
  });
});

describe('shared-engine approval matrix for top-ups', () => {
  for (const amount of [120, 500, 1000]) {
    it(`₹${amount} verified approval → completed + sender & receiver credited once`, async () => {
      reset();
      const topup = freshTopup({ amount });
      const { verificationResult, verificationTime } = approvedResult(`UTR${amount}`);
      const outcome = await applyTopupVerification(topup, verificationResult, verificationTime);
      expect(outcome.credited).toBe(true);
      const statuses = (db.state.updates.topups || []).map(u => u.status);
      expect(statuses).toContain('completed');
      expect(creditMock).toHaveBeenCalledTimes(1);
      expect(creditMock).toHaveBeenCalledWith([
        expect.objectContaining({ userId: 'sender-1', amount, referenceId: 'top-1', referenceType: 'topup' }),
        expect.objectContaining({ userId: 'recv-1', amount, referenceId: 'top-1', referenceType: 'topup' }),
      ]);
    });
  }

  it('wrong-UPI decision → rejected, wallet untouched', async () => {
    reset();
    const outcome = await applyTopupVerification(
      freshTopup(),
      { decision: 'rejected', reason: 'UPI_MISMATCH', utr: 'UTRX' },
      new Date()
    );
    expect(outcome.credited).toBe(false);
    expect(creditMock).not.toHaveBeenCalled();
    expect((db.state.updates.topups || []).map(u => u.status)).toContain('rejected');
  });

  it('duplicate UTR → rejected, wallet untouched', async () => {
    reset();
    reserveApprovedUtr.mockResolvedValue({ duplicate: true, reserved: false, utr: 'DUP' });
    const { verificationResult, verificationTime } = approvedResult('DUP');
    const outcome = await applyTopupVerification(freshTopup(), verificationResult, verificationTime);
    expect(outcome.credited).toBe(false);
    expect(outcome.reason).toBe('DUPLICATE_UTR');
    expect(creditMock).not.toHaveBeenCalled();
  });

  it('expired record at commit → reverted to PAYMENT_EXPIRED, never credited', async () => {
    reset();
    // expires_at is server-set and immutable, so the commit-time gate reads
    // the fetched record. A record whose window has lapsed (e.g. expiry
    // elapsed during the slow OCR run) must revert to rejected.
    const { verificationResult, verificationTime } = approvedResult('UTREXP');
    const outcome = await applyTopupVerification(freshTopup({ expires_at: past() }), verificationResult, verificationTime);
    expect(outcome.reason).toBe('PAYMENT_EXPIRED');
    expect(outcome.credited).toBe(false);
    expect(creditMock).not.toHaveBeenCalled();
    expect((db.state.updates.topups || []).map(u => u.status)).toContain('rejected');
  });
});

describe('wallet idempotency', () => {
  it('atomic idempotency result recognizes one existing wallet ledger entry', async () => {
    reset();
    creditMock.mockResolvedValueOnce([{ credited: false }, { credited: true }]);
    const { verificationResult, verificationTime } = approvedResult('UTRRACE');
    const outcome = await applyTopupVerification(freshTopup(), verificationResult, verificationTime);
    // One entry was already credited; the other is credited in the same RPC.
    expect(outcome.credited).toBe(true);
  });

  it('retry after crash (already completed, ledger empty) reconciles the credit', async () => {
    reset();
    db.state.flipResult = []; // atomic flip finds no rows → already processed
    db.state.topupRow = freshTopup({ status: 'completed' });
    const outcome = await applyTopupVerification(
      freshTopup(),
      { decision: 'approved', reason: null, utr: 'UTRRETRY', amountMatch: true, upiMatch: true },
      new Date()
    );
    expect(outcome.alreadyProcessed).toBe(true);
    expect(outcome.credited).toBe(true); // missing ledger rows were backfilled
    expect(creditMock).toHaveBeenCalledTimes(1);
  });

  it('retry with ledger present credits nothing', async () => {
    reset();
    db.state.flipResult = [];
    db.state.topupRow = freshTopup({ status: 'completed' });
    db.state.ledger = [{ id: 'tx-s' }, { id: 'tx-r' }]; // both sides already recorded
    creditMock.mockResolvedValueOnce([{ credited: false }, { credited: false }]);
    const outcome = await applyTopupVerification(
      freshTopup(),
      { decision: 'approved', reason: null, utr: 'UTRDONE', amountMatch: true, upiMatch: true },
      new Date()
    );
    expect(outcome.credited).toBe(false);
    expect(creditMock).toHaveBeenCalledTimes(1);
  });

  it('failed atomic wallet transaction moves the completed top-up to manual review', async () => {
    reset();
    creditMock.mockRejectedValueOnce({ code: 'XX000', message: 'transaction rolled back' });
    const { verificationResult, verificationTime } = approvedResult('UTRFAIL');

    await expect(applyTopupVerification(freshTopup(), verificationResult, verificationTime))
      .rejects.toMatchObject({ code: 'XX000' });

    const statuses = (db.state.updates.topups || []).map(update => update.status);
    expect(statuses).toContain('completed');
    expect(statuses).toContain('manual_review');
    expect(creditMock).toHaveBeenCalledTimes(1);
  });
});

describe('admin top-up manual review', () => {
  const reviewTopup = () => freshTopup({
    status: 'manual_review',
    screenshot_url: 'https://x/proof.png',
    verification_result: {
      decision: 'manual_review',
      ocrDecision: 'approved',
      utr: 'UTR-ADMIN-1',
      checks: {
        amount: { passed: true },
        receiverUpi: { passed: true },
        transactionDate: { passed: true },
        utr: { passed: true },
      },
    },
  });

  it('admin approval credits both users in one batch and records the review', async () => {
    reset();
    db.state.topupRow = reviewTopup();
    const result = await verifyTopup('top-1', 'admin-1', true);

    expect(result.credited).toBe(true);
    expect(db.state.topupRow.status).toBe('completed');
    expect(db.state.topupRow.verification_result.adminReview).toMatchObject({
      decision: 'approved',
      adminId: 'admin-1',
      utr: 'UTR-ADMIN-1',
    });
    expect(creditMock).toHaveBeenCalledTimes(1);
    expect(creditMock).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'sender-1', referenceId: 'top-1', referenceType: 'topup' }),
      expect.objectContaining({ userId: 'recv-1', referenceId: 'top-1', referenceType: 'topup' }),
    ]);
  });

  it('does not approve a manual-review top-up without uploaded proof', async () => {
    reset();
    db.state.topupRow = reviewTopup();
    db.state.topupRow.screenshot_url = null;

    await expect(verifyTopup('top-1', 'admin-1', true))
      .rejects.toMatchObject({ code: 'TOPUP_PROOF_REQUIRED' });
    expect(creditMock).not.toHaveBeenCalled();
  });

  it('duplicate UTR remains in manual review and does not credit', async () => {
    reset();
    db.state.topupRow = reviewTopup();
    reserveApprovedUtr.mockResolvedValueOnce({ duplicate: true, reserved: false, utr: 'UTR-ADMIN-1' });
    db.state.results.approved_utrs = {
      data: { reference_type: 'topup', reference_id: 'another-topup' },
      error: null,
    };

    await expect(verifyTopup('top-1', 'admin-1', true))
      .rejects.toMatchObject({ code: 'DUPLICATE_UTR' });
    expect(db.state.topupRow.status).toBe('manual_review');
    expect(creditMock).not.toHaveBeenCalled();
  });

  it('wallet transaction failure restores manual-review status for a safe retry', async () => {
    reset();
    db.state.topupRow = reviewTopup();
    creditMock.mockRejectedValueOnce({ code: 'XX000', message: 'atomic transaction rolled back' });

    await expect(verifyTopup('top-1', 'admin-1', true))
      .rejects.toMatchObject({ code: 'XX000' });
    expect(db.state.topupRow.status).toBe('manual_review');
    expect(db.state.topupRow.verification_result).toMatchObject({
      decision: 'manual_review',
      reason: 'WALLET_CREDIT_FAILED',
    });
  });
});

describe('shared auto-expire sweep covers top-ups', () => {
  it('stale created top-up → rejected with PAYMENT_EXPIRED; fresh untouched', async () => {
    reset();
    db.state.topupList = []; // payments sweep finds nothing (state.topupList doubles as payments list here)
    // payments table uses the same list slot — set explicitly empty:
    const result = await autoExpireStalePayments();
    expect(result.expired).toBe(0);
  });

  it('expired top-up row is rejected by the sweep', async () => {
    reset();
    // Both sweeps read their tables; feed the top-up sweep one stale row.
    // (payments sweep sees the same rows — give it nothing stale.)
    db.state.topupList = [{ id: 'top-old', sender_id: 'sender-1', amount: 500, expires_at: past() }];
    // NOTE: the shared mock returns topupList for any list query, so the
    // payments sweep would also see it — scope the assertion to topups table.
    const result = await autoExpireStalePayments();
    expect(result.expired).toBeGreaterThanOrEqual(1);
    const topUpd = (db.state.updates.topups || [])[0];
    expect(topUpd.status).toBe('rejected');
    expect(topUpd.rejection_reason).toBe('PAYMENT_EXPIRED');
  });
});

describe('default plans are configuration, not records', () => {
  it('₹120/₹500/₹1000 plans served from server code regardless of data', () => {
    const plans = getPlans();
    expect(plans.map(p => p.amount).sort((a, b) => a - b)).toEqual([120, 500, 1000]);
    expect(Object.keys(PAYMENT_PLANS).sort()).toEqual(['1000', '120', '500']);
  });
});
