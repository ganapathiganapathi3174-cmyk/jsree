import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeUtr, reserveApprovedUtr, releaseApprovedUtr } from '../../services/verificationService.js';
import { applyPaymentUtrPolicy } from '../../services/paymentService.js';
import { applyTopupVerification } from '../../services/topupService.js';

const { supabaseMock, walletCredit } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
  walletCredit: vi.fn(),
}));

vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock }));
vi.mock('../../services/walletService.js', () => ({ default: { credit: walletCredit } }));

let chains;
beforeEach(() => {
  vi.clearAllMocks();
  chains = {};
  supabaseMock.from.mockImplementation((table) => chains[table] || makeUtrsChain({ insertResult: { data: { utr: 'X' }, error: null } }));
});

function makeUtrsChain({ insertResult }) {
  const obj = {
    insert: vi.fn(() => obj),
    select: vi.fn(() => obj),
    maybeSingle: vi.fn(() => Promise.resolve(insertResult)),
    delete: vi.fn(() => obj),
    eq: vi.fn(() => obj),
  };
  return obj;
}

function makeTopupsChain(selectResult) {
  const obj = {
    update: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    in: vi.fn(() => obj),
    select: vi.fn(() => Promise.resolve(selectResult || { data: [], error: null })),
  };
  return obj;
}

function makeWalletChain(limitResult) {
  const obj = {
    select: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    limit: vi.fn(() => Promise.resolve(limitResult || { data: [], error: null })),
  };
  return obj;
}

const time = new Date('2026-08-18T12:00:00.000Z');

// ─────────────────────────────────────────────────────────────
// Approved-UTR duplicate protection.
//
// Rule: normal OCR decision is unchanged (approved = upi && amount && date).
// ADDITIONALLY an extracted UTR that was already APPROVED (payment or
// top-up) rejects the request with DUPLICATE_UTR — no activation, no credit.
// Rejected/pending/failed/cancelled UTRs never block; missing UTRs skip.
// Concurrency is atomic via the unique approved_utrs.utr constraint.
// ─────────────────────────────────────────────────────────────

describe('A: normalizeUtr + reserveApprovedUtr (shared helper)', () => {
  it('A1: normalizeUtr strips whitespace and uppercases', () => {
    expect(normalizeUtr(' abc 123 ')).toBe('ABC123');
    expect(normalizeUtr(' ab c\r\n12 3')).toBe('ABC123');
    expect(normalizeUtr(null)).toBeNull();
    expect(normalizeUtr('')).toBeNull();
    expect(normalizeUtr('   ')).toBeNull();
  });

  it('A2: reserve a NEW UTR -> reserved (not duplicate)', async () => {
    chains.approved_utrs = makeUtrsChain({ insertResult: { data: { utr: 'ABC123' }, error: null } });
    const result = await reserveApprovedUtr('ABC123', 'payment', 'pay-1');

    expect(result.reserved).toBe(true);
    expect(result.duplicate).toBe(false);
    expect(chains.approved_utrs.insert).toHaveBeenCalledWith({
      utr: 'ABC123', reference_type: 'payment', reference_id: 'pay-1',
    });
  });

  it('A3: reserve a DUPLICATE UTR (unique violation 23505) -> duplicate, not reserved', async () => {
    chains.approved_utrs = makeUtrsChain({ insertResult: { data: null, error: { code: '23505' } } });
    const result = await reserveApprovedUtr('ABC123', 'payment', 'pay-2');

    expect(result.reserved).toBe(false);
    expect(result.duplicate).toBe(true);
    expect(result.utr).toBe('ABC123');
  });

  it('A4: empty/whitespace UTR is skipped entirely (no DB call)', async () => {
    chains.approved_utrs = makeUtrsChain({ insertResult: { data: { utr: 'X' }, error: null } });
    const result = await reserveApprovedUtr('   ', 'payment', 'pay-3');

    expect(result.reserved).toBe(false);
    expect(result.duplicate).toBe(false);
    expect(result.utr).toBeNull();
    expect(chains.approved_utrs.insert).not.toHaveBeenCalled();
  });
});

describe('B: payment UTR policy (applyPaymentUtrPolicy)', () => {
  it('B5: approved decision + NEW UTR -> payment approved + UTR reserved', async () => {
    chains.approved_utrs = makeUtrsChain({ insertResult: { data: { utr: 'ABC123' }, error: null } });

    const { newStatus, reason, reservedUtr } = await applyPaymentUtrPolicy('pay-1', { decision: 'approved', utr: 'ABC123' });

    expect(newStatus).toBe('approved');
    expect(reason).toBeNull();
    expect(reservedUtr).toBe('ABC123');
  });

  it('B6: approved decision + NO UTR -> approved with NO reservation', async () => {
    chains.approved_utrs = makeUtrsChain({ insertResult: { data: null, error: null } });

    const { newStatus, reason, reservedUtr } = await applyPaymentUtrPolicy('pay-1', { decision: 'approved', utr: null });

    expect(newStatus).toBe('approved');
    expect(reason).toBeNull();
    expect(reservedUtr).toBeNull();
    expect(chains.approved_utrs.insert).not.toHaveBeenCalled();
  });

  it('B7: UTR seen only on a REJECTED payment -> approved (rejected records never block)', async () => {
    // The UTR is NOT present in approved_utrs (only approved records live
    // there), so the reservation succeeds and approval proceeds.
    chains.approved_utrs = makeUtrsChain({ insertResult: { data: { utr: 'REJECTED123' }, error: null } });

    const { newStatus, reason } = await applyPaymentUtrPolicy('pay-5', { decision: 'approved', utr: 'REJECTED123' });

    expect(newStatus).toBe('approved');
    expect(reason).toBeNull();
  });

  it('B8: UTR already APPROVED (top-up cross-flow) -> rejected DUPLICATE_UTR, nothing reserved', async () => {
    chains.approved_utrs = makeUtrsChain({ insertResult: { data: null, error: { code: '23505' } } });

    const { newStatus, reason, reservedUtr } = await applyPaymentUtrPolicy('pay-6', { decision: 'approved', utr: 'SHARED123' });

    expect(newStatus).toBe('rejected');
    expect(reason).toBe('DUPLICATE_UTR');
    expect(reservedUtr).toBeNull();
  });

  it('B9: rejected OCR decision (e.g. wrong UPI) never attempts a reservation', async () => {
    chains.approved_utrs = makeUtrsChain({ insertResult: { data: { utr: 'X' }, error: null } });

    const { newStatus, reason, reservedUtr } = await applyPaymentUtrPolicy('pay-7', { decision: 'rejected', utr: 'IRRELEVANT9' });

    expect(newStatus).toBe('rejected');
    expect(reason).toBeNull(); // consumer derives UPI_MISMATCH etc.; policy touches nothing
    expect(reservedUtr).toBeNull();
    expect(chains.approved_utrs.insert).not.toHaveBeenCalled();
  });

  it('B10: concurrency — same UTR submitted twice -> exactly one approves, other DUPLICATE_UTR', async () => {
    // Two different payments, same UTR, near-simultaneously. The UNIQUE
    // constraint lets exactly one reserve succeed; the loser collides (23505).
    chains.approved_utrs = makeUtrsChain({ insertResult: { data: { utr: 'RACE1' }, error: null } });
    const first = await applyPaymentUtrPolicy('pay-A', { decision: 'approved', utr: 'RACE1' });
    expect(first.newStatus).toBe('approved');
    expect(first.reservedUtr).toBe('RACE1');

    chains.approved_utrs = makeUtrsChain({ insertResult: { data: null, error: { code: '23505' } } });
    const second = await applyPaymentUtrPolicy('pay-B', { decision: 'approved', utr: 'RACE1' });
    expect(second.newStatus).toBe('rejected');
    expect(second.reason).toBe('DUPLICATE_UTR');
    expect(second.reservedUtr).toBeNull();
  });
});

describe('C: top-up flow (applyTopupVerification)', () => {
  const topup = { id: 'topup-1', sender_id: 'sender-1', amount: 120 };

  it('C11: approved + NEW UTR -> completed + credited exactly once + UTR reserved', async () => {
    chains.topups = makeTopupsChain({ data: [{ id: topup.id, status: 'completed' }], error: null });
    chains.wallet_transactions = makeWalletChain({ data: [], error: null });
    chains.approved_utrs = makeUtrsChain({ insertResult: { data: { utr: 'TOP123' }, error: null } });

    const result = await applyTopupVerification(topup, { decision: 'approved', reason: null, utr: 'TOP123' }, time);

    expect(result.credited).toBe(true);
    expect(walletCredit).toHaveBeenCalledTimes(1);
    expect(walletCredit).toHaveBeenCalledWith('sender-1', 120, expect.any(String), 'topup-1', 'topup');
    expect(chains.approved_utrs.insert).toHaveBeenCalledWith({
      utr: 'TOP123', reference_type: 'topup', reference_id: 'topup-1',
    });
  });

  it('C12: UTR already approved for a PAYMENT (cross-flow) -> topup rejected DUPLICATE_UTR, NO credit', async () => {
    chains.topups = makeTopupsChain({ data: [{ id: topup.id, status: 'completed' }], error: null });
    chains.wallet_transactions = makeWalletChain({ data: [], error: null });
    chains.approved_utrs = makeUtrsChain({ insertResult: { data: null, error: { code: '23505' } } });

    const result = await applyTopupVerification(topup, { decision: 'approved', reason: null, utr: 'SHARED123' }, time);

    expect(result.credited).toBe(false);
    expect(result.reason).toBe('DUPLICATE_UTR');
    expect(walletCredit).not.toHaveBeenCalled();

    // Top-up was completed by the atomic transition, then rolled to rejected.
    const rejectCalls = chains.topups.update.mock.calls.filter(([payload]) => payload.status === 'rejected');
    expect(rejectCalls.length).toBe(1);
    expect(rejectCalls[0][0].rejection_reason).toBe('DUPLICATE_UTR');
  });

  it('C13: same top-up double-submitted -> balance credited exactly once', async () => {
    chains.topups = makeTopupsChain({ data: [{ id: topup.id, status: 'completed' }], error: null });
    chains.wallet_transactions = makeWalletChain({ data: [], error: null });
    chains.approved_utrs = makeUtrsChain({ insertResult: { data: { utr: 'DBL1' }, error: null } });

    const first = await applyTopupVerification(topup, { decision: 'approved', reason: null, utr: 'DBL1' }, time);
    expect(first.credited).toBe(true);
    expect(walletCredit).toHaveBeenCalledTimes(1);

    // Second submit: guarded transition returns 0 rows (already completed) ->
    // alreadyProcessed, no credit, and no additional reservation attempt.
    chains.approved_utrs.insert.mockClear();
    chains.topups = makeTopupsChain({ data: [], error: null });
    const second = await applyTopupVerification(topup, { decision: 'approved', reason: null, utr: 'DBL1' }, time);
    expect(second.alreadyProcessed).toBe(true);
    expect(second.credited).toBe(false);
    expect(walletCredit).toHaveBeenCalledTimes(1);
    expect(chains.approved_utrs.insert).not.toHaveBeenCalled();
  });

  it('C14: same UTR used by a SECOND top-up -> second rejected DUPLICATE_UTR, no credit', async () => {
    const topup2 = { id: 'topup-2', sender_id: 'sender-2', amount: 120 };

    chains.topups = makeTopupsChain({ data: [{ id: topup2.id, status: 'completed' }], error: null });
    chains.wallet_transactions = makeWalletChain({ data: [], error: null });
    chains.approved_utrs = makeUtrsChain({ insertResult: { data: null, error: { code: '23505' } } });

    const result = await applyTopupVerification(topup2, { decision: 'approved', reason: null, utr: 'TOP123' }, time);

    expect(result.credited).toBe(false);
    expect(result.reason).toBe('DUPLICATE_UTR');
    expect(walletCredit).not.toHaveBeenCalled();
  });
});