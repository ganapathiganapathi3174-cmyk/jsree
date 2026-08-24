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

const topup = { id: 'topup-1', sender_id: 'sender-1', receiver_id: 'receiver-1', amount: 120 };
const approved = { decision: 'approved', reason: null };
const time = new Date('2026-08-18T12:00:00.000Z');

// ─────────────────────────────────────────────────────────────
// TOP-UP DECISION MATRIX (same shared engine as registration payments)
//   Final rule: approved = upiMatch && dateValid (+ OCR confidence gate)
//   Amount is not part of the decision (amountMatch is ignored).
//   UTR has ZERO influence; it is never an input.
// ─────────────────────────────────────────────────────────────
describe('Top-up verification decision engine', () => {
  it('T1: all conditions pass -> APPROVED', () => {
    const { decision, reason } = sharedDecide({
      upiMatch: true, amountMatch: true, dateValid: true,
      utrPresent: true, transactionStatusOk: true, ocrConfidence: 90,
    });
    expect(decision).toBe('approved');
    expect(reason).toBeNull();
  });

  it('T2: wrong UPI -> REJECTED (UPI_MISMATCH)', () => {
    const { decision, reason } = sharedDecide({
      upiMatch: false, amountMatch: true, dateValid: true,
      utrPresent: true, transactionStatusOk: true, ocrConfidence: 90,
    });
    expect(decision).toBe('rejected');
    expect(reason).toBe('UPI_MISMATCH');
  });

  it('T3: wrong amount -> REJECTED (AMOUNT_MISMATCH)', () => {
    const { decision, reason } = sharedDecide({
      upiMatch: true, amountMatch: false, dateValid: true,
      utrPresent: true, transactionStatusOk: true, ocrConfidence: 90,
    });
    expect(decision).toBe('rejected');
    expect(reason).toBe('AMOUNT_MISMATCH');
  });

  it('T4: invalid date/time -> REJECTED (INVALID_PAYMENT_DATE)', () => {
    const { decision, reason } = sharedDecide({
      upiMatch: true, amountMatch: true, dateValid: false,
      utrPresent: true, transactionStatusOk: true, ocrConfidence: 90,
    });
    expect(decision).toBe('rejected');
    expect(reason).toBe('INVALID_PAYMENT_DATE');
  });

  it('T5: missing UTR -> REJECTED (MISSING_UTR)', () => {
    const { decision, reason } = sharedDecide({
      upiMatch: true, amountMatch: true, dateValid: true,
      utrPresent: false, transactionStatusOk: true, ocrConfidence: 90,
    });
    expect(decision).toBe('rejected');
    expect(reason).toBe('MISSING_UTR');
  });

  it('T6: failed transaction -> REJECTED (TRANSACTION_FAILED)', () => {
    const { decision, reason } = sharedDecide({
      upiMatch: true, amountMatch: true, dateValid: true,
      utrPresent: true, transactionStatusOk: false, ocrConfidence: 90,
    });
    expect(decision).toBe('rejected');
    expect(reason).toBe('TRANSACTION_FAILED');
  });

  it('T7: low OCR confidence -> REJECTED (LOW_OCR_CONFIDENCE)', () => {
    const { decision, reason } = sharedDecide({
      upiMatch: true, amountMatch: true, dateValid: true,
      utrPresent: true, transactionStatusOk: true, ocrConfidence: 30,
    });
    expect(decision).toBe('rejected');
    expect(reason).toBe('LOW_OCR_CONFIDENCE');
  });

  it('T8: top-up uses the SAME engine as registration payments', () => {
    expect(sharedDecide).toBe(paymentDecide);
  });
});

// ─────────────────────────────────────────────────────────────
// TOP-UP BALANCE CREDIT — approval credits exactly once, idempotent
// via top-up record status (NOT UTR).
// ─────────────────────────────────────────────────────────────
describe('Top-up balance credit', () => {
  it('approved -> status completed + both wallets credited exactly once', async () => {
    chains.topups = makeTopupsChain({ data: [{ id: topup.id, status: 'completed' }], error: null });
    chains.wallet_transactions = makeWalletChain({ data: [], error: null });

    const result = await applyTopupVerification(topup, approved, time);

    expect(result.credited).toBe(true);
    expect(result.alreadyProcessed).toBe(false);
    expect(result.pendingClaim).toBe(false);
    expect(walletCredit).toHaveBeenCalledTimes(2);
    expect(walletCredit).toHaveBeenCalledWith('sender-1', 120, expect.any(String), 'topup-1', 'topup');
    expect(walletCredit).toHaveBeenCalledWith('receiver-1', 120, expect.any(String), 'topup-1', 'topup');

    // The guarded update used the atomic WHERE status IN (...) transition.
    const updateCall = chains.topups.update.mock.calls[0];
    expect(updateCall[0].status).toBe('completed');
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
    // First submission: transition succeeds, no prior credit -> credits both.
    chains.topups = makeTopupsChain({ data: [{ id: topup.id, status: 'completed' }], error: null });
    chains.wallet_transactions = makeWalletChain({ data: [], error: null });
    const first = await applyTopupVerification(topup, approved, time);
    expect(first.credited).toBe(true);
    expect(first.pendingClaim).toBe(false);
    expect(walletCredit).toHaveBeenCalledTimes(2);

    // Second submission (concurrent/retry): guarded UPDATE returns 0 rows
    // because the record is already 'completed' -> no credit.
    chains.topups = makeTopupsChain({ data: [], error: null });
    const second = await applyTopupVerification(topup, approved, time);
    expect(second.alreadyProcessed).toBe(true);
    expect(second.credited).toBe(false);
    expect(walletCredit).toHaveBeenCalledTimes(2);
  });

  it('defense in depth: existing wallet_transaction for the top-up blocks a second credit', async () => {
    // Transition succeeds but wallet_transactions already exist for sender+receiver -> no credit.
    chains.topups = makeTopupsChain({ data: [{ id: topup.id, status: 'completed' }], error: null });
    chains.wallet_transactions = makeWalletChain({ data: [{ id: 'existing-tx' }], error: null });


    const result = await applyTopupVerification(topup, approved, time);

    expect(result.credited).toBe(false);
    expect(walletCredit).not.toHaveBeenCalled();
  });
});
