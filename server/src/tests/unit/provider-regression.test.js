import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  runScreenshotVerification,
} from '../../services/verificationService.js';
import {
  applyPaymentUtrPolicy,
} from '../../services/paymentService.js';

const { runOCR, runAmountRecoveryOCR } = vi.hoisted(() => ({
  runOCR: vi.fn(),
  runAmountRecoveryOCR: vi.fn(),
}));

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR };
});

// Supabase mock whose approved_utrs.insert can be toggled between
// success-reserve and unique-violation (duplicate) outcomes.
const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { utrInsertResult: { data: { id: 'u1' }, error: null } },
}));

vi.mock('../../db/supabase.js', () => ({
  supabase: {
    from: vi.fn((table) => {
      if (table === 'approved_utrs') {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn(async () => supabaseMock.utrInsertResult),
            })),
          })),
        };
      }
      return {};
    }),
  },
  supabaseAnon: {},
  default: {},
}));

const RECEIVER_UPI = 'jayarajj126-3@okicici';
// Server clock: 13:00 IST. Receipts are timestamped 12:58 PM IST (2 min
// before upload) — the real-world ordering (pay -> screenshot -> upload).
const NOW = () => new Date('2026-08-24T07:30:00.000Z');

function verify(expectedAmount = 120) {
  return runScreenshotVerification({
    imageBuffer: Buffer.from('img'),
    expectedAmount,
    receiverUpi: RECEIVER_UPI,
    now: NOW(),
  });
}

async function expectApproved(text, expectedAmount = 120) {
  runOCR.mockResolvedValue({ text, confidence: 90 });
  const { verificationResult } = await verify(expectedAmount);
  expect(verificationResult.decision, `reason=${verificationResult.reason}`).toBe('approved');
  return verificationResult;
}

beforeEach(() => {
  vi.clearAllMocks();
  runAmountRecoveryOCR.mockResolvedValue([]);
  supabaseMock.utrInsertResult = { data: { id: 'u1' }, error: null };
});

// ─────────────────────────────────────────────────────────────
// Provider layout regression — identical rules for every provider.
// ─────────────────────────────────────────────────────────────
describe('Multi-provider successful screenshots -> APPROVED', () => {
  it('1. Google Pay successful screenshot', async () => {
    await expectApproved([
      'Google Pay',
      'Payment Successful',
      '\u20B9120',
      'To Jayaraj',
      RECEIVER_UPI,
      'Date: 24/08/2026, 12:58 PM',
      'UPI transaction ID: T7GHD240824',
    ].join('\n'));
  });

  it('2. PhonePe successful screenshot', async () => {
    await expectApproved([
      'PhonePe',
      'Transaction Successful',
      '\u20B9120',
      'Paid to jayarajj126-3@okicici',
      'Aug 24, 2026, 12:58 PM',
      'Transaction ID: PP240824123456',
    ].join('\n'));
  });

  it('3. Paytm "Money Sent Successfully"', async () => {
    const r = await expectApproved([
      'Paytm',
      'Money Sent Successfully',
      '\u20B9120',
      'To: jayarajj126-3@okicici',
      'UPI Ref No: T250824123456',
      '24 Aug 2026, 12:58 PM',
    ].join('\n'));
    // The exact failing screenshot's extracted values:
    expect(r.utr).toBe('T250824123456');
    expect(r.amountMatch).toBe(true);
    expect(r.upiMatch).toBe(true);
    expect(r.dateValid).toBe(true);
    expect(r.transactionStatus.status).toBe('success');
  });

  it('4. Paytm with "UPI Ref No" label and split date/time lines', async () => {
    await expectApproved([
      'Paytm',
      'Money Sent Successfully',
      '\u20B9120',
      'To: jayarajj126-3@okicici',
      'UPI Ref No: T250824999888',
      '24 Aug 2026',
      '12:58 PM',
    ].join('\n'));
  });

  it('5. BHIM successful screenshot', async () => {
    await expectApproved([
      'BHIM',
      'Payment Successful',
      '\u20B9120',
      'To: jayarajj126-3@okicici',
      'UPI Reference Number: BHIM240824001',
      '24 Aug 2026, 12:58 PM',
    ].join('\n'));
  });

  it('6. Bank UPI successful screenshot', async () => {
    await expectApproved([
      'SBI UPI',
      'Transferred Successfully',
      'Rs.120',
      'To: jayarajj126-3@okicici',
      'Bank Ref No: SBIN240824123',
      '24/08/2026, 12:58 PM',
    ].join('\n'));
  });

  it('7. Date and time on separate OCR lines (cross-line pairing)', async () => {
    await expectApproved([
      'Amazon Pay',
      'Payment Completed',
      'Amount \u20B9120',
      'Sent to jayarajj126-3@okicici',
      'Reference ID: AMZ24082412345',
      '24 August 2026',
      '12:58 PM',
    ].join('\n'));
  });

  it('8. Different reference-number labels all extract a usable UTR', async () => {
    const labels = [
      ['UPI Ref No', 'UPI Ref No: REF2408240001'],
      ['UPI Reference Number', 'UPI Reference Number: REF2408240002'],
      ['Transaction ID', 'Transaction ID: TXN2408240003'],
      ['UPI Transaction ID', 'UPI Transaction ID: UTI2408240004'],
      ['Bank Ref No', 'Bank Ref No: BNK24082400005'],
      ['Reference ID', 'Reference ID: RID24082400006'],
      ['Payment Ref', 'Payment Ref: 240824123456'],
      ['Transaction Reference', 'Transaction Reference: TREF240824007'],
    ];
    for (const [name, line] of labels) {
      runOCR.mockResolvedValue({
        text: [
          'Payment Successful',
          '\u20B9120',
          `To: ${RECEIVER_UPI}`,
          line,
          '24 Aug 2026, 12:58 PM',
        ].join('\n'),
        confidence: 90,
      });
      const { verificationResult, utr } = await verify();
      expect(utr, `${name} should extract a UTR`).toBeTruthy();
      expect(verificationResult.decision, `${name} decision`).toBe('approved');
    }
  });

  it('status wording variants all count as success', async () => {
    const wordings = [
      'Completed', 'Successful', 'Payment Successful', 'Money Sent Successfully',
      'Sent Successfully', 'Paid', 'Payment Completed', 'Transferred Successfully',
    ];
    for (const w of wordings) {
      runOCR.mockResolvedValue({
        text: [
          w,
          '\u20B9120',
          `To: ${RECEIVER_UPI}`,
          'UPI Ref No: STW2408240001',
          '24 Aug 2026, 12:58 PM',
        ].join('\n'),
        confidence: 90,
      });
      const { verificationResult } = await verify();
      expect(verificationResult.transactionStatus?.status, `"${w}" status`).toBe('success');
      expect(verificationResult.decision, `"${w}" decision`).toBe('approved');
    }
  });
});

// ─────────────────────────────────────────────────────────────
// Negative tests — no provider gets a bypass.
// ─────────────────────────────────────────────────────────────
describe('Negative tests — every provider must still reject invalid evidence', () => {
  const base = (over = {}) => [
    over.status ?? 'Money Sent Successfully',
    `\u20B9${over.amount ?? 120}`,
    `To: ${over.upi ?? RECEIVER_UPI}`,
    over.ref ?? 'UPI Ref No: NEG24082400001',
    over.dateLine ?? '24 Aug 2026, 12:58 PM',
  ].join('\n');

  async function expectRejected(text, reason, expectedAmount = 120) {
    runOCR.mockResolvedValue({ text, confidence: 90 });
    const { verificationResult } = await verify(expectedAmount);
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.decision).not.toBe('manual_review');
    if (reason) expect(verificationResult.reason).toBe(reason);
    return verificationResult;
  }

  it('wrong UPI -> rejected', async () => {
    await expectRejected(base({ upi: 'attacker@paytm' }), 'UPI_MISMATCH');
  });

  it('wrong amount -> rejected', async () => {
    await expectRejected(base({ amount: 500 }), 'AMOUNT_MISMATCH');
  });

  it('old transaction (>30 min) -> rejected', async () => {
    await expectRejected(base({ dateLine: '24 Aug 2026, 11:00 AM' }), 'INVALID_PAYMENT_DATE');
  });

  it('previous-day replay -> rejected', async () => {
    await expectRejected(base({ dateLine: '23 Aug 2026, 12:58 PM' }), 'INVALID_PAYMENT_DATE');
  });

  it('failed transaction -> rejected', async () => {
    await expectRejected(base({ status: 'Payment Failed' }), 'TRANSACTION_FAILED');
  });

  it('pending transaction -> rejected', async () => {
    await expectRejected(base({ status: 'Payment Pending' }), 'TRANSACTION_FAILED');
  });

  it('missing transaction/reference ID -> rejected', async () => {
    const text = [
      'Paytm',
      'Money Sent Successfully',
      '\u20B9120',
      `To: ${RECEIVER_UPI}`,
      '24 Aug 2026, 12:58 PM',
    ].join('\n');
    await expectRejected(text, 'MISSING_UTR');
  });

  it('low OCR confidence -> rejected even for a perfect receipt', async () => {
    runOCR.mockResolvedValue({ text: base(), confidence: 30 });
    const { verificationResult } = await verify();
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('LOW_OCR_CONFIDENCE');
  });
});

// ─────────────────────────────────────────────────────────────
// Duplicate UTR protection (unchanged business rule).
// ─────────────────────────────────────────────────────────────
describe('Duplicate UTR protection still enforced', () => {
  it('approved decision with an already-used UTR -> rejected DUPLICATE_UTR', async () => {
    supabaseMock.utrInsertResult = { data: null, error: { code: '23505', message: 'unique violation' } };
    const outcome = await applyPaymentUtrPolicy('p-1', { decision: 'approved', utr: 'USEDUTR123456' });
    expect(outcome.newStatus).toBe('rejected');
    expect(outcome.reason).toBe('DUPLICATE_UTR');
  });

  it('fresh UTR reservation keeps approval intact', async () => {
    const outcome = await applyPaymentUtrPolicy('p-2', { decision: 'approved', utr: 'FRESHUTR123456' });
    expect(outcome.newStatus).toBe('approved');
    expect(outcome.reason).toBeNull();
    expect(outcome.reservedUtr).toBe('FRESHUTR123456');
  });
});
