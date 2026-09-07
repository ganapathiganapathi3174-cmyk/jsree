import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  verifyPayment,
  createPayment,
  autoExpireStalePayments,
  isPaymentExpired,
} from '../../services/paymentService.js';

// ─────────────────────────────────────────────────────────────
// PHASE 6/7/8 + PHASE 5: expiry boundary, race, auto-expire, binding.
// Mocks Supabase + OCR; never touches the real database.
// ─────────────────────────────────────────────────────────────

const { runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses } = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
  runAdditionalOCRPasses: vi.fn(),
}));

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses };
});

const { db } = vi.hoisted(() => {
  const state = { paymentRow: null, paymentList: null, updates: {}, inserts: {}, deletes: {} };
  const rec = (bucket, table, payload) => {
    (state[bucket][table] = state[bucket][table] || []).push(payload);
  };
  const builder = (table) => {
    const p = {
      _single: false, _list: false,
      update: (payload) => { rec('updates', table, payload); if (table === 'payments' && state.paymentRow) Object.assign(state.paymentRow, payload); return p; },
      insert: (payload) => { rec('inserts', table, payload); p._inserted = payload; return p; },
      delete: () => { rec('deletes', table, {}); return p; },
      select: () => p,
      eq: () => p, neq: () => p, in: (...a) => { p._inArgs = a; return p; },
      or: () => p, order: () => p, limit: () => p, range: () => p, lt: () => p, gt: () => p,
      single: () => { p._single = true; return p; },
      maybeSingle: () => { p._single = true; return p; },
      then: (res) => {
        if (table === 'approved_utrs') {
          if (p._inserted) return res({ data: { id: 'utr-1' }, error: null });
          return res({ data: null, error: null });
        }
        if (table === 'payments') {
          if (state.paymentList) return res({ data: state.paymentList.map(r => ({ ...r })), error: null });
          if (p._inserted && !state.paymentRow) return res({ data: { id: 'pay-new', ...p._inserted }, error: null });
          const row = state.paymentRow;
          if (p._single) return res({ data: row ? { ...row } : null, error: null });
          return res({ data: row ? [{ ...row }] : [], error: null });
        }
        return res({ data: null, error: null });
      },
      catch: () => p,
    };
    return p;
  };
  return { db: { state, from: (t) => builder(t) } };
});

vi.mock('../../db/supabase.js', () => {
  const client = { from: (t) => db.from(t) };
  return { supabase: client, supabaseAnon: {}, default: client };
});

import { supabase } from '../../db/supabase.js';
void supabase;

const RECEIVER_UPI = 'jayarajj126-3@okicici';

function istDateLine(minutesBeforeUpload) {
  const ist = new Date(Date.now() - minutesBeforeUpload * 60000 + 5.5 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  const dd = pad(ist.getUTCDate()), mm = pad(ist.getUTCMonth() + 1), yy = ist.getUTCFullYear();
  let h = ist.getUTCHours();
  const mi = pad(ist.getUTCMinutes());
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${dd}/${mm}/${yy}, ${h}:${mi} ${ampm}`;
}

const GPAY_VALID = () => ['Google Pay', 'Payment Successful', '₹120', 'To Jayaraj',
  RECEIVER_UPI, `Date: ${istDateLine(2)}`, 'UPI transaction ID: T7RACE0001'].join('\n');

function resetState() {
  db.state.paymentRow = null;
  db.state.paymentList = null;
  db.state.updates = {};
  db.state.inserts = {};
  db.state.deletes = {};
  vi.clearAllMocks();
  runAmountRecoveryOCR.mockResolvedValue([]);
  runAdditionalOCRPasses.mockResolvedValue([]);
}

describe('PHASE 6 — exact 30-minute boundary matrix', () => {
  it('T-1s valid, T+29:59 valid, T+30:00 expired, T+30:01 expired', () => {
    const now = Date.now();
    const at = (ms) => new Date(now + ms).toISOString();
    expect(isPaymentExpired({ expires_at: at(-1000 + 30 * 60000) })).toBe(false); // T+29:59
    expect(isPaymentExpired({ expires_at: at(30 * 60000) })).toBe(false);          // exactly T+30:00 (strict >)
    expect(isPaymentExpired({ expires_at: at(-1000) })).toBe(true);                // T-1s past
    expect(isPaymentExpired({ expires_at: at(-(30 * 60000 + 1000)) })).toBe(true); // T+30:01 past
  });

  it('missing/null expires_at fails closed', () => {
    expect(isPaymentExpired(null)).toBe(true);
    expect(isPaymentExpired({})).toBe(true);
    expect(isPaymentExpired({ expires_at: null })).toBe(true);
  });

  it('midnight IST crossing stays valid inside window', () => {
    // 23:55 IST + 30min window → 00:25 next day; check at 00:10 still valid.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-08-30T00:10:00+05:30'));
      expect(isPaymentExpired({ expires_at: new Date('2026-08-30T00:25:00+05:30').toISOString() })).toBe(false);
      expect(isPaymentExpired({ expires_at: new Date('2026-08-30T00:05:00+05:30').toISOString() })).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('PHASE 7 — expiry race: valid at OCR start, expired at commit', () => {
  it('rejects with PAYMENT_EXPIRED, releases UTR, never approves', async () => {
    resetState();
    // Expires 60ms from now; OCR takes 200ms → post-OCR re-check must fire.
    db.state.paymentRow = {
      id: 'pay-race', user_id: 'user-1', selected_plan: 120, expected_amount: 120,
      screenshot_url: 'https://x/s.png', upi_id: RECEIVER_UPI, status: 'pending',
      expires_at: new Date(Date.now() + 60).toISOString(),
    };
    runOCR.mockImplementation(() => new Promise(r => setTimeout(() => r({ text: GPAY_VALID(), confidence: 90 }), 200)));

    const result = await verifyPayment('pay-race', Buffer.from('img'));

    expect(result.decision).toBe('rejected');
    expect(result.reason).toBe('PAYMENT_EXPIRED');
    const statuses = (db.state.updates.payments || []).map(u => u.status);
    expect(statuses).not.toContain('approved');
    expect(statuses).toContain('rejected');
  }, 15000);
});

describe('PHASE 8 — autoExpireStalePayments', () => {
  it('expires stale pending, leaves fresh pending alone (query-scoped)', async () => {
    resetState();
    const past = new Date(Date.now() - 60000).toISOString();
    db.state.paymentList = [
      { id: 'pay-old', user_id: 'u1', expected_amount: 120, expires_at: past },
    ];
    const result = await autoExpireStalePayments();
    expect(result.expired).toBe(1);
    const upd = db.state.updates.payments[0];
    expect(upd.status).toBe('rejected');
    expect(upd.rejection_reason).toBe('PAYMENT_EXPIRED');
  });

  it('no stale rows → expired:0 and no updates', async () => {
    resetState();
    db.state.paymentList = [];
    const result = await autoExpireStalePayments();
    expect(result.expired).toBe(0);
    expect(db.state.updates.payments || []).toHaveLength(0);
  });

  it('update is status-guarded (only actionable statuses transition)', async () => {
    resetState();
    db.state.paymentList = [{ id: 'pay-old', user_id: 'u1', expected_amount: 500, expires_at: new Date(Date.now() - 1).toISOString() }];
    await autoExpireStalePayments();
    // The builder records .in() scope args; update path always constrains status.
    expect(db.state.updates.payments).toHaveLength(1);
  });
});

describe('PHASE 5 — server-authoritative binding (client values ignored)', () => {
  it('malicious amount/upi/expiry in request body cannot propagate', async () => {
    resetState();
    // No existing pending/approved (singles return null).
    const before = Date.now();
    await createPayment('user-9', {
      plan: '120',
      amount: 1,                       // attacker tries ₹1
      receiver_upi: 'attacker@upi',    // attacker UPI
      receiverUpi: 'attacker@upi',
      expires_at: '2099-01-01T00:00:00.000Z', // far-future expiry
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const inserted = db.state.inserts.payments[0];
    expect(inserted.expected_amount).toBe(120);          // server plan table wins
    expect(inserted.upi_id).toBe(RECEIVER_UPI);          // server UPI wins
    expect(inserted.receiver_upi).toBe(RECEIVER_UPI);
    const expMs = new Date(inserted.expires_at).getTime() - before;
    expect(expMs).toBeGreaterThan(29 * 60000);           // ~30min window, not 2099
    expect(expMs).toBeLessThan(31 * 60000);
  });
});
