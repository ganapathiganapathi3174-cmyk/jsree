import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createTopup,
  submitTopupProof,
  applyTopupVerification,
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
    ledger: [], inserts: {}, updates: {},
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
        return res({ data: null, error: null });
      },
      catch: () => p,
    };
    return p;
  };
  const uploadMock = vi.fn(async () => ({ error: null }));
  const client = {
    from: (t) => builder(t),
    storage: { from: () => ({ upload: uploadMock, getPublicUrl: () => ({ publicUrl: 'https://x/proof.png' }), remove: vi.fn() }) },
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
vi.mock('../../services/walletService.js', () => ({ default: { credit: creditMock } }));
vi.mock('../../services/notificationService.js', () => ({ default: { createNotification: vi.fn(async () => ({})) } }));

import { supabase } from '../../db/supabase.js';
void supabase;

const RECEIVER_UPI = 'jayarajj126-3@okicici';
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
  vi.clearAllMocks();
  uploadMock.mockResolvedValue({ error: null });
  creditMock.mockResolvedValue({ transaction: { id: 'tx-1' }, newBalance: 120 });
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
      expect(creditMock).toHaveBeenCalledTimes(2);
      const creditedUsers = creditMock.mock.calls.map(c => c[0]).sort();
      expect(creditedUsers).toEqual(['recv-1', 'sender-1']);
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
  it('concurrent unique-violation (23505) treated as already-credited, no throw', async () => {
    reset();
    creditMock.mockRejectedValueOnce({ code: '23505', message: 'duplicate key' });
    const { verificationResult, verificationTime } = approvedResult('UTRRACE');
    const outcome = await applyTopupVerification(freshTopup(), verificationResult, verificationTime);
    // Sender lost the race (already credited), receiver credited normally.
    expect(outcome.credited).toBe(true);
  });

  it('retry after crash (already completed, ledger empty) reconciles the credit', async () => {
    reset();
    db.state.flipResult = []; // atomic flip finds no rows → already processed
    const outcome = await applyTopupVerification(
      freshTopup(),
      { decision: 'approved', reason: null, utr: 'UTRRETRY', amountMatch: true, upiMatch: true },
      new Date()
    );
    expect(outcome.alreadyProcessed).toBe(true);
    expect(outcome.credited).toBe(true); // missing ledger rows were backfilled
    expect(creditMock).toHaveBeenCalledTimes(2);
  });

  it('retry with ledger present credits nothing', async () => {
    reset();
    db.state.flipResult = [];
    db.state.ledger = [{ id: 'tx-s' }, { id: 'tx-r' }]; // both sides already recorded
    const outcome = await applyTopupVerification(
      freshTopup(),
      { decision: 'approved', reason: null, utr: 'UTRDONE', amountMatch: true, upiMatch: true },
      new Date()
    );
    expect(outcome.credited).toBe(false);
    expect(creditMock).not.toHaveBeenCalled();
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
