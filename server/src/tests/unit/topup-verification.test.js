import { describe, it, expect, vi, beforeEach } from 'vitest';
import { decidePaymentVerification as sharedDecide } from '../../services/verificationService.js';
import { decidePaymentVerification as paymentDecide } from '../../services/paymentService.js';
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
  supabaseMock.from.mockImplementation((table) => chains[table] || {});
});

function makeTopupsChain(selectResult) {
  // topups: update(payload).eq(id).in(statuses).select() -> selectResult (approved)
  //         update(payload).eq(id).in(statuses)           -> { error }    (rejected)
  const obj = {
    update: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    in: vi.fn(() => obj),
    select: vi.fn(() => Promise.resolve(selectResult || { data: [], error: null })),
  };
  return obj;
}

function makeWalletChain(limitResult) {
  // wallet_transactions: select('id').eq(...).eq(...).limit(1) -> limitResult
  const obj = {
    select: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    limit: vi.fn(() => Promise.resolve(limitResult || { data: [], error: null })),
  };
  return obj;
}

const topup = { id: 'topup-1', sender_id: 'sender-1', amount: 120 };
const approved = { decision: 'approved', reason: null };
const time = new Date('2026-08-18T12:00:00.000Z');

// ─────────────────────────────────────────────────────────────
// TOP-UP DECISION MATRIX (same shared engine as registration payments)
//   Final rule: approved = upiMatch && dateValid (+ OCR confidence gate)
//   Amount is not part of the decision (amountMatch is ignored).
//   UTR has ZERO influence; it is never an input.
// ─────────────────────────────────────────────────────────────
describe('Top-up verification decision engine', () => {
  it('T1: correct UPI + correct amount + valid date + NO UTR -> APPROVED', () => {
    const { decision, reason } = sharedDecide({ upiMatch: true, amountMatch: true, dateValid: true });
    expect(decision).toBe('approved');
    expect(reason).toBeNull();
  });

  it('T2: correct UPI + correct amount + valid date + duplicate UTR -> APPROVED', () => {
    // UTR is not even a parameter of the engine — duplicate/missing/random
    // UTR cannot influence the decision.
    const { decision } = sharedDecide({ upiMatch: true, amountMatch: true, dateValid: true });
    expect(decision).toBe('approved');
  });

  it('T3: correct UPI + correct amount + valid date + random UTR -> APPROVED', () => {
    const { decision } = sharedDecide({ upiMatch: true, amountMatch: true, dateValid: true });
    expect(decision).toBe('approved');
  });

  it('T4: wrong UPI -> REJECTED (UPI_MISMATCH)', () => {
    const { decision, reason } = sharedDecide({ upiMatch: false, amountMatch: true, dateValid: true });
    expect(decision).toBe('rejected');
    expect(reason).toBe('UPI_MISMATCH');
  });

  it('T5: wrong amount -> APPROVED (amount removed from the decision)', () => {
    const { decision, reason } = sharedDecide({ upiMatch: true, amountMatch: false, dateValid: true });
    expect(decision).toBe('approved');
    expect(reason).toBeNull();
  });

  it('T6: invalid date/time -> REJECTED (INVALID_PAYMENT_DATE)', () => {
    const { decision, reason } = sharedDecide({ upiMatch: true, amountMatch: true, dateValid: false });
    expect(decision).toBe('rejected');
    expect(reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('T7: top-up uses the SAME engine as registration payments', () => {
    expect(sharedDecide).toBe(paymentDecide);
  });
});

// ─────────────────────────────────────────────────────────────
// TOP-UP BALANCE CREDIT — approval credits exactly once, idempotent
// via top-up record status (NOT UTR).
// ─────────────────────────────────────────────────────────────
describe('Top-up balance credit', () => {
  it('approved -> status approved + sender wallet credited exactly once', async () => {
    chains.topups = makeTopupsChain({ data: [{ id: topup.id, status: 'approved' }], error: null });
    chains.wallet_transactions = makeWalletChain({ data: [], error: null });

    const result = await applyTopupVerification(topup, approved, time);

    expect(result.credited).toBe(true);
    expect(result.alreadyProcessed).toBe(false);
    expect(result.pendingClaim).toBe(true);
    expect(walletCredit).toHaveBeenCalledTimes(1);
    expect(walletCredit).toHaveBeenCalledWith('sender-1', 120, expect.any(String), 'topup-1', 'topup_sender');

    // The guarded update used the atomic WHERE status IN (...) transition.
    const updateCall = chains.topups.update.mock.calls[0];
    expect(updateCall[0].status).toBe('approved');
  });

  it('rejected decision (e.g. UPI_MISMATCH) -> status rejected, no credit', async () => {
    chains.topups = makeTopupsChain();

    const result = await applyTopupVerification(topup, { decision: 'rejected', reason: 'UPI_MISMATCH' }, time);

    expect(result.credited).toBe(false);
    expect(walletCredit).not.toHaveBeenCalled();

    const updatePayload = chains.topups.update.mock.calls[0][0];
    expect(updatePayload.status).toBe('rejected');
    expect(updatePayload.rejection_reason).toBe('UPI_MISMATCH');
  });

  it('rejected UPI_MISMATCH -> status rejected, no credit', async () => {
    chains.topups = makeTopupsChain();

    const result = await applyTopupVerification(topup, { decision: 'rejected', reason: 'UPI_MISMATCH' }, time);

    expect(result.credited).toBe(false);
    expect(walletCredit).not.toHaveBeenCalled();
  });

  it('rejected INVALID_PAYMENT_DATE -> status rejected, no credit', async () => {
    chains.topups = makeTopupsChain();

    const result = await applyTopupVerification(topup, { decision: 'rejected', reason: 'INVALID_PAYMENT_DATE' }, time);

    expect(result.credited).toBe(false);
    expect(walletCredit).not.toHaveBeenCalled();
  });

  it('same top-up record cannot credit balance twice (status already transitioned)', async () => {
    // First submission: transition succeeds, no prior credit -> credits sender.
    chains.topups = makeTopupsChain({ data: [{ id: topup.id, status: 'approved' }], error: null });
    chains.wallet_transactions = makeWalletChain({ data: [], error: null });
    const first = await applyTopupVerification(topup, approved, time);
    expect(first.credited).toBe(true);
    expect(first.pendingClaim).toBe(true);
    expect(walletCredit).toHaveBeenCalledTimes(1);

    // Second submission (concurrent/retry): guarded UPDATE returns 0 rows
    // because the record is already 'approved' -> no credit.
    chains.topups = makeTopupsChain({ data: [], error: null });
    const second = await applyTopupVerification(topup, approved, time);
    expect(second.alreadyProcessed).toBe(true);
    expect(second.credited).toBe(false);
    expect(walletCredit).toHaveBeenCalledTimes(1);
  });

  it('defense in depth: existing wallet_transaction for the top-up blocks a second credit', async () => {
    // Transition succeeds but a wallet_transaction with reference_id=topup.id
    // already exists (e.g. from a previous partial run) -> no credit.
    chains.topups = makeTopupsChain({ data: [{ id: topup.id, status: 'approved' }], error: null });
    chains.wallet_transactions = makeWalletChain({ data: [{ id: 'wallet-txn-1' }], error: null });

    const result = await applyTopupVerification(topup, approved, time);

    expect(result.credited).toBe(false);
    expect(walletCredit).not.toHaveBeenCalled();
  });
});
