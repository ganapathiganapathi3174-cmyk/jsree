import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDirectTopup, computeTopupSummary, TOPUP_RECEIVED_REQUIRED } from '../../services/topupService.js';

const { supabaseMock, walletCreditBatch, runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery } = vi.hoisted(() => {
  if (!process.env.ADMIN_RECEIVER_NAME) {
    process.env.ADMIN_RECEIVER_NAME = 'Jayaraj';
  }
  // These suites assert straight-through auto-approval: enable it explicitly.
  // Production default (unset) is the secure external-confirmation fallback.
  process.env.PAYMENT_AUTO_APPROVE = 'true';
  return {
    supabaseMock: { from: vi.fn(), storage: { from: vi.fn() } },
    walletCreditBatch: vi.fn(),
    runOCR: vi.fn(),
    runAmountRecoveryOCR: vi.fn(),
    runAdditionalOCRPasses: vi.fn(),
    runDeepAmountRecovery: vi.fn(),
  };
});

vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock }));
vi.mock('../../services/walletService.js', () => ({ default: { creditBatch: walletCreditBatch } }));
vi.mock('../../services/verificationService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runScreenshotVerification: vi.fn() };
});
vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery };
});

let chains;
beforeEach(() => {
  vi.clearAllMocks();
  walletCreditBatch.mockResolvedValue([{ credited: true }, { credited: true }]);
  runAmountRecoveryOCR.mockResolvedValue([]);
  runAdditionalOCRPasses.mockResolvedValue([]);
  runDeepAmountRecovery.mockResolvedValue([]);
  chains = {};
  supabaseMock.from.mockImplementation((table) => chains[table] || makeFallbackChain());
  supabaseMock.storage.from.mockReturnValue({
    upload: vi.fn().mockResolvedValue({ data: null, error: null }),
    getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/proof.png' } }),
  });
});

function makeFallbackChain() {
  const obj = { single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }) };
  for (const m of ['select', 'eq', 'in', 'insert', 'update', 'limit', 'order', 'maybeSingle']) obj[m] = vi.fn(() => obj);
  return obj;
}

function makeUsersChain(callResults) {
  const obj = { select: vi.fn(() => obj), eq: vi.fn(() => obj), single: vi.fn() };
  (callResults || []).forEach(r => obj.single.mockResolvedValueOnce(r));
  obj.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
  return obj;
}

function makeTopupsChain({ singles = [], approvalSelect } = {}) {
  const updateObj = {
    eq: vi.fn(() => updateObj),
    in: vi.fn(() => updateObj),
    select: vi.fn(() => Promise.resolve(approvalSelect || { data: [], error: null })),
  };
  const obj = {
    insert: vi.fn(() => obj),
    select: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    neq: vi.fn(() => obj),
    in: vi.fn(() => obj),
    limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
    single: vi.fn(),
    update: vi.fn(() => updateObj),
  };
  singles.forEach(r => obj.single.mockResolvedValueOnce(r));
  obj.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
  return obj;
}

function makeWalletChain(limitResult) {
  const obj = { select: vi.fn(() => obj), eq: vi.fn(() => obj), limit: vi.fn(() => Promise.resolve(limitResult || { data: [], error: null })) };
  return obj;
}

const SENDER = { data: { id: 'sender-1', referred_by: 'sponsor-1', current_plan: 120 }, error: null };
const RECEIVER = { data: { id: 'sponsor-1', full_name: 'Sponsor', status: 'active' }, error: null };
const NO_PENDING = { data: null, error: { code: 'PGRST116' } };
const RECEIVER_UPI = 'jayarajj126-3@okicici';

const VALID_IMAGE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

function istLine(minutesBefore = 2) {
  const ist = new Date(Date.now() - minutesBefore * 60000 + 5.5 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  let h = ist.getUTCHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${pad(ist.getUTCDate())}/${pad(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()}, ${h}:${pad(ist.getUTCMinutes())} ${ap}`;
}

function receiptText(amount, upi, utr) {
  return [
    'Payment Successful',
    `\u20B9${amount}`,
    'To Jayaraj',
    upi,
    `Date: ${istLine()}`,
    `UPI transaction ID: ${utr}`,
  ].join('\n');
}

function mockApprovedReceipt(amount, utr) {
  runOCR.mockResolvedValue({ text: receiptText(amount, RECEIVER_UPI, utr), confidence: 90 });
}

const FUTURE_EXPIRY = new Date(Date.now() + 30 * 60000).toISOString();
const CREATED_TOPUP = { data: { id: 'topup-new-1', sender_id: 'sender-1', receiver_id: 'sponsor-1', amount: 120, plan: 120, status: 'created', expires_at: FUTURE_EXPIRY }, error: null };
const PENDING_TOPUP = { data: { id: 'pending-1', sender_id: 'sender-1', receiver_id: 'sponsor-1', amount: 120, plan: 120, status: 'created', expires_at: FUTURE_EXPIRY }, error: null };
const fakeFile = { buffer: VALID_IMAGE, mimetype: 'image/png', originalname: 'proof.png' };

function installHappyChains({ approvalSelect }) {
  chains.users = makeUsersChain([SENDER, RECEIVER, SENDER]);
  chains.topups = makeTopupsChain({ singles: [NO_PENDING, NO_PENDING, CREATED_TOPUP], approvalSelect });
  chains.wallet_transactions = makeWalletChain();
  chains.audit_logs = { insert: vi.fn().mockReturnValue({}) };
}

// ─────────────────────────────────────────────────────────────
// DIRECT TOP-UP (no pre-existing sponsor request required)
// ─────────────────────────────────────────────────────────────
describe('createDirectTopup', () => {
  it('D1: engine-verified screenshot completes a new sponsor top-up and credits both wallets', async () => {
    installHappyChains({ approvalSelect: { data: [{ id: 'topup-new-1', status: 'completed' }], error: null } });
    mockApprovedReceipt(120, 'TDIRECT001');

    const result = await createDirectTopup({ senderId: 'sender-1', amount: 120, file: fakeFile });

    expect(result.credited).toBe(true);
    expect(result.manualReview).toBe(false);
    expect(result.topupId).toBe('topup-new-1');
    expect(chains.topups.insert).toHaveBeenCalledWith(expect.objectContaining({
      sender_id: 'sender-1', receiver_id: 'sponsor-1', amount: 120, status: 'created',
    }));
    expect(walletCreditBatch).toHaveBeenCalledTimes(1);
    expect(walletCreditBatch).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'sender-1', amount: 120, referenceId: 'topup-new-1', referenceType: 'topup' }),
      expect.objectContaining({ userId: 'sponsor-1', amount: 120, referenceId: 'topup-new-1', referenceType: 'topup' }),
    ]);
  });

  it('D2: a pending request is reused and verified through the engine (credited once)', async () => {
    chains.users = makeUsersChain([SENDER, RECEIVER, SENDER]);
    chains.topups = makeTopupsChain({ singles: [PENDING_TOPUP], approvalSelect: { data: [{ id: 'pending-1', status: 'completed' }], error: null } });
    chains.wallet_transactions = makeWalletChain();
    chains.audit_logs = { insert: vi.fn().mockReturnValue({}) };
    mockApprovedReceipt(120, 'TDIRECT002');

    const result = await createDirectTopup({ senderId: 'sender-1', amount: 120, file: fakeFile });

    expect(result.topupId).toBe('pending-1');
    expect(result.credited).toBe(true);
    expect(chains.topups.insert).not.toHaveBeenCalled();
    expect(walletCreditBatch).toHaveBeenCalledTimes(1);
  });

  it('D3: no sponsor (no referred_by) -> NO_SPONSOR error', async () => {
    chains.users = makeUsersChain([{ data: { id: 'sender-1', referred_by: null }, error: null }]);
    await expect(createDirectTopup({ senderId: 'sender-1', amount: 120 })).rejects.toMatchObject({ code: 'NO_SPONSOR' });
  });

  it('D4: engine UPI mismatch -> record rejected, NO credit, NO completed count', async () => {
    chains.users = makeUsersChain([SENDER, RECEIVER, SENDER]);
    chains.topups = makeTopupsChain({ singles: [PENDING_TOPUP] });
    chains.wallet_transactions = makeWalletChain();
    chains.audit_logs = { insert: vi.fn().mockReturnValue({}) };
    runOCR.mockResolvedValue({ text: receiptText(120, 'attacker@paytm', 'TBADUPI001'), confidence: 90 });

    const result = await createDirectTopup({ senderId: 'sender-1', amount: 120, file: fakeFile });

    expect(result.credited).toBe(false);
    expect(walletCreditBatch).not.toHaveBeenCalled();
    expect(result.reason).toBe('UPI_MISMATCH');
    expect(result.message).toBe('Topup rejected: the screenshot shows a different recipient');
    expect(chains.topups.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'rejected', rejection_reason: 'UPI_MISMATCH' }));
  });

  it('D5: no screenshot -> creates a pending record (credit later via proof flow)', async () => {
    chains.users = makeUsersChain([SENDER, RECEIVER, SENDER]);
    chains.topups = makeTopupsChain({ singles: [NO_PENDING, NO_PENDING, CREATED_TOPUP] });
    chains.audit_logs = { insert: vi.fn().mockReturnValue({}) };

    const result = await createDirectTopup({ senderId: 'sender-1', amount: 120, file: null });

    expect(result.created).toBe(true);
    expect(result.credited).toBe(false);
    expect(result.topupId).toBe('topup-new-1');
    expect(runOCR).not.toHaveBeenCalled(); // no screenshot -> no engine run
  });

  it('D6: explicit receiverId bypasses the referred_by lookup', async () => {
    chains.users = makeUsersChain([SENDER, RECEIVER, SENDER]);
    chains.topups = makeTopupsChain({ singles: [PENDING_TOPUP] });
    chains.audit_logs = { insert: vi.fn().mockReturnValue({}) };

    const result = await createDirectTopup({ senderId: 'sender-1', amount: 120, receiverId: 'sponsor-1', file: null });

    expect(result.topupId).toBe('pending-1');
    expect(result.created).toBe(true);
    expect(chains.topups.insert).not.toHaveBeenCalled();
  });

  it('D7: invalid amount -> INVALID_AMOUNT', async () => {
    await expect(createDirectTopup({ senderId: 'sender-1', amount: 999 })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
  });

  it('D8: receiver not found or inactive -> rejected', async () => {
    chains.users = makeUsersChain([SENDER, { data: null, error: { code: 'PGRST116' } }]);
    await expect(createDirectTopup({ senderId: 'sender-1', amount: 120 })).rejects.toMatchObject({ code: 'RECEIVER_NOT_FOUND' });

    chains.users = makeUsersChain([SENDER, { data: { id: 'sponsor-1', full_name: 'Sponsor', status: 'inactive' }, error: null }]);
    await expect(createDirectTopup({ senderId: 'sender-1', amount: 120 })).rejects.toMatchObject({ code: 'RECEIVER_INACTIVE' });
  });
});

// ─────────────────────────────────────────────────────────────
// RECEIVED-TOP-UP COUNT / MUST-TOP-UP RULE
// ─────────────────────────────────────────────────────────────
describe('computeTopupSummary (received top-ups rule)', () => {
  const row = (over) => ({ id: `t-${Math.random().toString(36).slice(2, 8)}`, status: 'completed', amount: 120, sender_id: 's-x', ...over });

  it('C1: 0 completed received top-ups -> no must-top-up', async () => {
    chains.users = makeUsersChain([{ data: { id: 'user-1', referred_by: null }, error: null }]);
    const s = await computeTopupSummary([
      row({ status: 'created' }), row({ status: 'payment_pending' }),
      row({ status: 'rejected' }), row({ status: 'manual_review' }), row({ status: 'failed' }),
    ], 'user-1');
    expect(s.receivedCompletedCount).toBe(0);
    expect(s.remaining).toBe(2);
    expect(s.mustTopup).toBe(false);
  });

  it('C2: 1 completed -> no must-top-up yet, 1 remaining', async () => {
    chains.users = makeUsersChain([{ data: { id: 'user-1', referred_by: null }, error: null }]);
    const s = await computeTopupSummary([row({ status: 'completed' }), row({ status: 'rejected' })], 'user-1');
    expect(s.receivedCompletedCount).toBe(1);
    expect(s.remaining).toBe(1);
    expect(s.mustTopup).toBe(false);
  });

  it('C3: 2 completed from DIFFERENT senders -> must-top-up (reached 2)', async () => {
    chains.users = makeUsersChain([{ data: { id: 'user-1', referred_by: null }, error: null }]);
    const s = await computeTopupSummary([row({ sender_id: 'a' }), row({ sender_id: 'b' })], 'user-1');
    expect(s.receivedCompletedCount).toBe(2);
    expect(s.remaining).toBe(0);
    expect(s.mustTopup).toBe(true);
  });

  it('C4: rejected/pending/failed never count (even with an amount present)', async () => {
    chains.users = makeUsersChain([{ data: { id: 'user-1', referred_by: null }, error: null }]);
    const s = await computeTopupSummary([
      row({ status: 'rejected', amount: 500 }), row({ status: 'pending', amount: 120 }),
      row({ status: 'failed', amount: 1000 }), row({ status: 'created', amount: null }),
    ], 'user-1');
    expect(s.receivedCompletedCount).toBe(0);
    expect(s.mustTopup).toBe(false);
  });

  it('C5: 3 completed received -> still must-top-up (>= 2)', async () => {
    chains.users = makeUsersChain([{ data: { id: 'user-1', referred_by: null }, error: null }]);
    const s = await computeTopupSummary([row({ sender_id: 'a' }), row({ sender_id: 'b' }), row({ sender_id: 'c' })], 'user-1');
    expect(s.mustTopup).toBe(true);
  });

  it('C6: required constant is 2', () => {
    expect(TOPUP_RECEIVED_REQUIRED).toBe(2);
  });
});
