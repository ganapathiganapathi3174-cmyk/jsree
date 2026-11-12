import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyTopupVerification } from '../../services/topupService.js';

// ─────────────────────────────────────────────────────────────
// TOP-UP CONCURRENCY RACE (production hardening P1).
//
// The audit proved a race in applyTopupVerification's reconcile path:
// a LOSING concurrent submit (guarded flip returns 0 rows) credited the
// wallet unconditionally while the WINNING request was still running its
// expiry / duplicate-UTR gates and could yet roll the row back to
// rejected — putting money behind a rejected record.
//
// These tests reproduce the exact race shapes against a faithful
// in-memory Supabase emulator (guarded UPDATE matches WHERE, 0-row
// update does not mutate, UNIQUE(utr) enforces 23505):
//   A. winner heading for PAYMENT_EXPIRED  -> loser must NOT credit
//   B. winner heading for DUPLICATE_UTR    -> loser must NOT credit
//   C. winner finished safely (reserved)   -> loser credits idempotently
//   D. winner crashed before its reserve   -> loser fails safe, no credit
//   E. same top-up double-submit           -> exactly ONE successful credit
// ─────────────────────────────────────────────────────────────

const { walletCreditBatch, db } = vi.hoisted(() => {
  const store = {
    payments: [], users: [], topups: [],
    wallet_transactions: [], approved_utrs: [],
    notifications: [], referrals: [], audit_logs: [],
  };
  const state = { store, updates: {}, inserts: {}, results: {} };
  const rec = (bucket, table, payload) => {
    (state[bucket][table] = state[bucket][table] || []).push(payload);
  };

  const builder = (table) => {
    const p = {
      _op: 'select', _filters: [], _payload: null, _single: false, _limit: null,
      _isInsert: false,
      update: (payload) => { p._op = 'update'; p._payload = payload; return p; },
      insert: (payload) => { p._op = 'insert'; p._payload = payload; p._isInsert = true; rec('inserts', table, payload); return p; },
      delete: () => { p._op = 'delete'; return p; },
      select: () => p,
      eq: (col, val) => { p._filters.push(r => r[col] === val); return p; },
      neq: (col, val) => { p._filters.push(r => r[col] !== val); return p; },
      in: (col, vals) => { p._filters.push(r => Array.isArray(vals) && vals.includes(r[col])); return p; },
      lt: (col, val) => { p._filters.push(r => r[col] != null && r[col] < val); return p; },
      gt: (col, val) => { p._filters.push(r => r[col] != null && r[col] > val); return p; },
      or: () => p,
      order: () => p,
      limit: (n) => { p._limit = n; return p; },
      range: () => p,
      single: () => { p._single = true; return p; },
      maybeSingle: () => { p._single = true; return p; },
      then: (onRes, onRej) => {
        const respond = (out) => Promise.resolve(out).then(onRes, onRej);
        const rows = store[table] || (store[table] = []);
        const matched = rows.filter(r => p._filters.every(f => f(r)));

        if (p._op === 'update') {
          rec('updates', table, p._payload);
          for (const row of matched) Object.assign(row, p._payload);
          if (p._single) {
            return respond(matched[0]
              ? { data: { ...matched[0] }, error: null }
              : { data: null, error: { code: 'PGRST116', message: 'No rows found' } });
          }
          return respond({ data: matched.map(r => ({ ...r })), error: null });
        }

        if (p._op === 'insert') {
          const payload = Array.isArray(p._payload) ? p._payload : [p._payload];
          const inserted = [];
          for (const item of payload) {
            if (table === 'approved_utrs' && store.approved_utrs.some(r => r.utr === item.utr)) {
              return respond({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
            }
            const row = { id: `${table}-${rows.length + 1}`, created_at: new Date().toISOString(), ...item };
            rows.push(row);
            inserted.push(row);
          }
          const data = p._single ? inserted[0] : inserted;
          return respond({ data: data || null, error: null });
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
      catch: (fn) => p.then(undefined, fn),
    };
    return p;
  };

  return {
    walletCreditBatch: vi.fn(),
    db: { state, from: (t) => builder(t) },
  };
});

vi.mock('../../db/supabase.js', () => {
  const client = { from: (t) => db.from(t), storage: { from: () => ({ upload: vi.fn(), getPublicUrl: () => ({ data: { publicUrl: 'https://x/p.png' } }), remove: vi.fn() }) } };
  return { supabase: client, supabaseAnon: {}, default: client };
});
vi.mock('../../services/walletService.js', () => ({ default: { creditBatch: walletCreditBatch } }));
vi.mock('../../services/auditService.js', () => ({ logAction: vi.fn(async () => ({})) }));

const time = new Date('2026-08-18T12:00:00.000Z');
const future = () => new Date(Date.now() + 30 * 60000).toISOString();
const past = () => new Date(Date.now() - 60000).toISOString();

function seedCompletedTopup({ utr, expires_at = future(), reserveOwn = false, id = 'top-race' } = {}) {
  db.state.store.topups.push({
    id,
    sender_id: 'sender-1',
    receiver_id: 'recv-1',
    amount: 120,
    status: 'completed',
    expires_at,
    verification_result: utr ? { decision: 'approved', reason: null, utr } : null,
  });
  if (reserveOwn && utr) {
    db.state.store.approved_utrs.push({ utr, reference_type: 'topup', reference_id: id });
  }
}

function topupRow(id = 'top-race') {
  return db.state.store.topups.find(t => t.id === id);
}

function topupUpdates(status) {
  return (db.state.updates.topups || []).filter(u => u.status === status);
}

const approvedWith = (utr) => ({ decision: 'approved', reason: null, utr, amountMatch: true, upiMatch: true, dateValid: true });

beforeEach(() => {
  vi.clearAllMocks();
  db.state.store.topups = [];
  db.state.store.approved_utrs = [];
  db.state.store.wallet_transactions = [];
  db.state.updates = {};
  db.state.inserts = {};
  // Idempotent-by-reference credit mock: first batch for a reference
  // credits, later batches for the SAME reference report no-op — the
  // same contract credit_wallets_atomic enforces in the database.
  const creditedRefs = new Set();
  walletCreditBatch.mockImplementation(async (entries) => {
    const ref = entries[0].referenceId;
    const first = !creditedRefs.has(ref);
    creditedRefs.add(ref);
    return entries.map(() => ({ credited: first }));
  });
});

describe('P1 race: the losing concurrent submit never credits a record the winner may reject', () => {
  it('A. winner heading for PAYMENT_EXPIRED: loser drives the rejection, credits nothing', async () => {
    // Winner already flipped to completed but its expiry gate has not landed
    // yet (or it crashed pre-gate). The window is over — the loser must
    // refuse to credit and terminate the record as expired.
    seedCompletedTopup({ utr: 'RACEEXP', expires_at: past() });

    const outcome = await applyTopupVerification(
      { id: 'top-race', sender_id: 'sender-1', receiver_id: 'recv-1', amount: 120, expires_at: past() },
      approvedWith('RACEEXP'),
      time
    );

    expect(outcome.credited).toBe(false);
    expect(outcome.reason).toBe('PAYMENT_EXPIRED');
    expect(walletCreditBatch).not.toHaveBeenCalled();
    expect(topupUpdates('rejected').some(u => u.rejection_reason === 'PAYMENT_EXPIRED')).toBe(true);
    expect(topupRow().status).toBe('rejected');
    expect(db.state.store.approved_utrs).toHaveLength(0);
  }, 10000);

  it('B. winner heading for DUPLICATE_UTR: loser observes the rollback and credits nothing', async () => {
    // The winner's atomic reserve collides (foreign UTR) and it rolls the
    // row back to rejected while the loser is polling. The loser must
    // follow the rollback — never credit, never re-decide.
    seedCompletedTopup({ utr: 'RACEDUP' });
    setTimeout(() => {
      const row = topupRow();
      if (row && row.status === 'completed') {
        Object.assign(row, { status: 'rejected', rejection_reason: 'DUPLICATE_UTR' });
      }
    }, 100);

    const outcome = await applyTopupVerification(
      { id: 'top-race', sender_id: 'sender-1', receiver_id: 'recv-1', amount: 120, expires_at: future() },
      approvedWith('RACEDUP'),
      time
    );

    expect(outcome.credited).toBe(false);
    expect(outcome.alreadyProcessed).toBe(true);
    expect(walletCreditBatch).not.toHaveBeenCalled();
    expect(topupRow().status).toBe('rejected');
    // The loser must not have written any status of its own.
    expect(topupUpdates('manual_review')).toHaveLength(0);
  }, 10000);

  it('C. winner finished safely (UTR reserved): loser reconciles the credit idempotently', async () => {
    seedCompletedTopup({ utr: 'RACESAFE', reserveOwn: true });

    const outcome = await applyTopupVerification(
      { id: 'top-race', sender_id: 'sender-1', receiver_id: 'recv-1', amount: 120, expires_at: future() },
      approvedWith('RACESAFE'),
      time
    );

    expect(outcome.alreadyProcessed).toBe(true);
    expect(outcome.credited).toBe(true);
    expect(walletCreditBatch).toHaveBeenCalledTimes(1);
    expect(topupRow().status).toBe('completed');
    expect(topupUpdates('rejected')).toHaveLength(0);
    expect(topupUpdates('manual_review')).toHaveLength(0);
  }, 10000);

  it('D. winner crashed between flip and reserve: loser fails safe to manual_review, no credit', async () => {
    // Completed + UTR recorded but the atomic reservation never landed.
    // Crediting here would break "reserve before credit" — park instead.
    seedCompletedTopup({ utr: 'RACECRASH' });

    const outcome = await applyTopupVerification(
      { id: 'top-race', sender_id: 'sender-1', receiver_id: 'recv-1', amount: 120, expires_at: future() },
      approvedWith('RACECRASH'),
      time
    );

    expect(outcome.credited).toBe(false);
    expect(outcome.reason).toBe('UTR_RESERVATION_MISSING');
    expect(walletCreditBatch).not.toHaveBeenCalled();
    expect(topupRow().status).toBe('manual_review');
    expect(topupRow().rejection_reason).toBe('UTR_RESERVATION_MISSING');
    expect(topupUpdates('manual_review')).toHaveLength(1);
  }, 10000);
});

describe('P1 race: same top-up double-submit resolves to exactly one successful processor', () => {
  it('E. two concurrent applies on one top-up -> exactly one credits the wallets', async () => {
    db.state.store.topups.push({
      id: 'top-double',
      sender_id: 'sender-1',
      receiver_id: 'recv-1',
      amount: 120,
      status: 'created',
      expires_at: future(),
    });
    const arg = { id: 'top-double', sender_id: 'sender-1', receiver_id: 'recv-1', amount: 120, expires_at: future() };

    const [first, second] = await Promise.all([
      applyTopupVerification(arg, approvedWith('DBLRACE1'), time),
      applyTopupVerification(arg, approvedWith('DBLRACE1'), time),
    ]);

    // Exactly one request owns the guarded flip, and exactly one credit
    // succeeds (idempotent-by-reference) — regardless of micro-ordering.
    expect([first.alreadyProcessed, second.alreadyProcessed].filter(v => v === false)).toHaveLength(1);
    expect([first.credited, second.credited].filter(Boolean)).toHaveLength(1);
    expect(walletCreditBatch).toHaveBeenCalledTimes(2);
    expect(topupRow('top-double').status).toBe('completed');
    expect(db.state.store.approved_utrs).toHaveLength(1);
    expect(db.state.store.approved_utrs[0]).toMatchObject({ utr: 'DBLRACE1', reference_type: 'topup', reference_id: 'top-double' });
    // Terminal state is single-valued: never rejected, never parked.
    expect(topupUpdates('rejected')).toHaveLength(0);
    expect(topupUpdates('manual_review')).toHaveLength(0);
  }, 10000);

  it('E2. sequential replay after completion: second apply is a no-op credit', async () => {
    db.state.store.topups.push({
      id: 'top-replay',
      sender_id: 'sender-1',
      receiver_id: 'recv-1',
      amount: 120,
      status: 'created',
      expires_at: future(),
    });
    const arg = { id: 'top-replay', sender_id: 'sender-1', receiver_id: 'recv-1', amount: 120, expires_at: future() };

    const first = await applyTopupVerification(arg, approvedWith('REPLAY1'), time);
    const second = await applyTopupVerification(arg, approvedWith('REPLAY1'), time);

    expect(first.credited).toBe(true);
    expect(second.alreadyProcessed).toBe(true);
    expect(second.credited).toBe(false);
    expect(walletCreditBatch).toHaveBeenCalledTimes(2);
    expect(db.state.store.approved_utrs).toHaveLength(1);
    expect(topupRow('top-replay').status).toBe('completed');
  }, 10000);
});
