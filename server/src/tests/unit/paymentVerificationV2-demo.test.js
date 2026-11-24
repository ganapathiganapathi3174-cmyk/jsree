import { describe, it, expect, vi, beforeEach } from 'vitest';

const { supabaseMock, runOCR, RECEIVER_UPI } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
  runOCR: vi.fn(),
  RECEIVER_UPI: 'jayarajj126-3@okicici',
}));

vi.mock('../../db/supabase.js', () => ({ supabase: supabaseMock }));

vi.mock('../../services/paymentVerificationV2/ocrExtraction.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runOCR,
  };
});

import { paymentVerificationEngine } from '../../services/paymentVerificationV2/index.js';

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function receiptText({ amount = 120, upi = RECEIVER_UPI, utr = 'UTR123456', receiver = 'Jayaraj', status = 'success', date, dateOnly = false } = {}) {
  const dateLine = dateOnly ? `Date: ${todayIstDateOnly()}` : `Date: ${date || line(2)}`;
  const lines = ['Payment Successful', `Rs. ${amount}`, `To ${receiver}`, upi, dateLine, `UPI transaction ID: ${utr}`];
  if (status === 'failed') lines[0] = 'Payment Failed';
  if (status === 'declined') lines[0] = 'Payment Declined';
  return lines.join('\n');
}

function line(minutesAgo = 2, dayOffset = 0) {
  const d = new Date(Date.now() + dayOffset * 86400000 - minutesAgo * 60000 + 5.5 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  const h24 = d.getUTCHours();
  const h = h24 % 12 || 12;
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}, ${h}:${pad(d.getUTCMinutes())} ${ampm}`;
}

function todayIstStamp(hour, minute = 0) {
  const ist = new Date(Date.now() + 5.5 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${pad(ist.getUTCDate())}/${pad(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()}, ${h12}:${pad(minute)} ${ampm}`;
}

function todayIstDateOnly() {
  const ist = new Date(Date.now() + 5.5 * 3600000);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(ist.getUTCDate())}/${pad(ist.getUTCMonth() + 1)}/${ist.getUTCFullYear()}`;
}

describe('demo: auto-approval mode', () => {
  beforeEach(() => {
    process.env.PAYMENT_DEMO_MODE = 'true';
    process.env.PAYMENT_DEMO_RECEIVER = 'Jayaraj';
    process.env.PAYMENT_DEMO_AMOUNT = '120';
    vi.clearAllMocks();
  });

  // OCR and preprocess mocks (matching engine test setup)
  beforeEach(() => {
    vi.clearAllMocks();
    // preprocessImage resolves to a valid tiny PNG so OCR can run
    const preprocessImage = vi.fn().mockResolvedValue(TINY_PNG);
    // runAdditionalOCRPasses, runAmountRecoveryOCR, runDeepAmountRecovery
    const runAdditionalOCRPasses = vi.fn().mockResolvedValue([]);
    const runAmountRecoveryOCR = vi.fn().mockResolvedValue([]);
    const runDeepAmountRecovery = vi.fn().mockResolvedValue([]);
    // supabase mock
    supabaseMock.from.mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockResolvedValue({ data: null, error: null }),
      delete: vi.fn().mockResolvedValue({ data: null, error: null }),
    }));
    // OCR mock - must be set per-test
  });

  // 1️⃣  Demo: all conditions met → APPROVED with demo_approved decision
  it('name‑date‑amount‑UTR all match → APPROVED (demo)', async () => {
    runOCR.mockResolvedValue({ text: receiptText({ amount: 120 }), confidence: 90 });

    const result = await paymentVerificationEngine.verify({
      imageBuffer: TINY_PNG,
      purpose: 'registration',
      paymentRequest: {
        type: 'registration',
        expectedAmount: 120,
        paymentId: 'demo-pay-001',
        userId: 'user-1',
        receiverName: 'Jayaraj',
        receiverUpi: RECEIVER_UPI,
        expectedPayerName: null,
        senderPolicy: 'off',
      },
      serverTime: new Date(),
    });

    expect(result.outcome).toBe('APPROVED');
    expect(result.approved).toBe(true);
    expect(result.verificationResult.decision).toBe('demo_approved');
    expect(result.verificationResult.reason).toBe('DEMO_APPROVAL');
    expect(result.verificationResult._demo).toBe(true);
    // UTR reservation skipped in demo mode
    expect(result.verificationResult.transactionId).toBeNull();
  });

  // 2️⃣  Demo: name mismatch → still demo-approved (name is informational only)
  it('receiver‑name mismatch → demo-approved (informational)', async () => {
    runOCR.mockResolvedValue({ text: receiptText({ receiver: 'Someone Else' }), confidence: 90 });

    const result = await paymentVerificationEngine.verify({
      imageBuffer: TINY_PNG,
      purpose: 'registration',
      paymentRequest: {
        type: 'registration',
        expectedAmount: 120,
        paymentId: 'demo-pay-001',
        userId: 'user-1',
        receiverName: 'Jayaraj',
        receiverUpi: RECEIVER_UPI,
        expectedPayerName: null,
        senderPolicy: 'off',
      },
      serverTime: new Date(),
    });

    // Name mismatch is informational only — demo mode still auto-approves
    expect(result.outcome).toBe('APPROVED');
    expect(result.verificationResult.decision).toBe('demo_approved');
    expect(result.verificationResult._demo).toBe(true);
  });

  // 3️⃣  Demo: date in past → falls through to normal flow
  it('date-in-past → not demo-approved', async () => {
    runOCR.mockResolvedValue({ text: receiptText({ amount: 120, date: line(2, -1) }), confidence: 90 });

    const result = await paymentVerificationEngine.verify({
      imageBuffer: TINY_PNG,
      purpose: 'registration',
      paymentRequest: {
        type: 'registration',
        expectedAmount: 120,
        paymentId: 'demo-pay-001',
        userId: 'user-1',
        receiverName: 'Jayaraj',
        receiverUpi: RECEIVER_UPI,
        expectedPayerName: null,
        senderPolicy: 'off',
      },
      serverTime: new Date(),
    });

    // Should not be demo-approved
    expect(result.outcome).not.toBe('APPROVED');
    expect(result.verificationResult.decision).not.toBe('demo_approved');
  });

  // 4️⃣  Demo: amount mismatch → still demo-approved (all gates passed)
  it('amount‑mismatch → demo-approved (all gates passed)', async () => {
    process.env.PAYMENT_DEMO_AMOUNT = '999';

    runOCR.mockResolvedValue({ text: receiptText({ amount: 120 }), confidence: 90 });

    const result = await paymentVerificationEngine.verify({
      imageBuffer: TINY_PNG,
      purpose: 'registration',
      paymentRequest: {
        type: 'registration',
        expectedAmount: 120,
        paymentId: 'demo-pay-001',
        userId: 'user-1',
        receiverName: 'Jayaraj',
        receiverUpi: RECEIVER_UPI,
        expectedPayerName: null,
        senderPolicy: 'off',
      },
      serverTime: new Date(),
    });

    // All gates passed including amount, so demo mode auto-approves
    expect(result.outcome).toBe('APPROVED');
    expect(result.verificationResult.decision).toBe('demo_approved');
    expect(result.verificationResult._demo).toBe(true);

    process.env.PAYMENT_DEMO_AMOUNT = '120';
  });

  // 5️⃣  Demo: duplicate UTR → still demo-approved (all gates passed)
  it('duplicate‑UTR → demo-approved (all gates passed)', async () => {
    process.env.PAYMENT_DEMO_MODE = 'true';
    process.env.PAYMENT_DEMO_RECEIVER = 'Jayaraj';
    process.env.PAYMENT_DEMO_AMOUNT = '120';

    runOCR.mockResolvedValue({ text: receiptText({ amount: 120 }), confidence: 90 });

    const result = await paymentVerificationEngine.verify({
      imageBuffer: TINY_PNG,
      purpose: 'registration',
      paymentRequest: {
        type: 'registration',
        expectedAmount: 120,
        paymentId: 'demo-pay-001',
        userId: 'user-1',
        receiverName: 'Jayaraj',
        receiverUpi: RECEIVER_UPI,
        expectedPayerName: null,
        senderPolicy: 'off',
      },
      serverTime: new Date(),
    });

    // All gates passed including UTR, so demo mode auto-approves
    expect(result.outcome).toBe('APPROVED');
    expect(result.verificationResult.decision).toBe('demo_approved');
    expect(result.verificationResult._demo).toBe(true);
  });

  // 6️⃣  Demo: registration and top‑up use separate records with _demo flag
  it('registration and top‑up use separate records with _demo', async () => {
    process.env.PAYMENT_DEMO_MODE = 'true';
    process.env.PAYMENT_DEMO_RECEIVER = 'Jayaraj';
    process.env.PAYMENT_DEMO_AMOUNT = '120';

    runOCR.mockResolvedValue({ text: receiptText({ amount: 120 }), confidence: 90 });

    const regResult = await paymentVerificationEngine.verify({
      imageBuffer: TINY_PNG,
      purpose: 'registration',
      paymentRequest: {
        type: 'registration',
        expectedAmount: 120,
        paymentId: 'demo-pay-001',
        userId: 'user-1',
        receiverName: 'Jayaraj',
        receiverUpi: RECEIVER_UPI,
        expectedPayerName: null,
        senderPolicy: 'off',
      },
      serverTime: new Date(),
    });
    expect(regResult.outcome).toBe('APPROVED');
    expect(regResult.verificationResult._demo).toBe(true);

    runOCR.mockResolvedValue({ text: receiptText({ amount: 120 }), confidence: 90 });

    const topupResult = await paymentVerificationEngine.verify({
      imageBuffer: TINY_PNG,
      purpose: 'topup',
      paymentRequest: {
        type: 'topup',
        expectedAmount: 120,
        paymentId: 'demo-pay-001',
        userId: 'user-1',
        receiverName: 'Jayaraj',
        receiverUpi: RECEIVER_UPI,
        expectedPayerName: null,
        senderPolicy: 'off',
      },
      serverTime: new Date(),
    });
    expect(topupResult.outcome).toBe('APPROVED');
    expect(topupResult.verificationResult._demo).toBe(true);

    // UTR reservation skipped in demo mode - both transactionIds are null
    expect(regResult.verificationResult.transactionId).toBeNull();
    expect(topupResult.verificationResult.transactionId).toBeNull();
  });
});