import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractDateTimes } from '../../services/ocrService.js';
import { runScreenshotVerification } from '../../services/verificationService.js';

// ─────────────────────────────────────────────────────────────
// DEBUG-ONLY diagnostic: genuine Paytm ₹120 receipt (UTR 625024266060)
// wrongly rejected with INVALID_PAYMENT_DATE.
//
// Production OCR text captured verbatim from the failing receipt.
// runOCR is mocked to replay it deterministically; every verification
// stage is asserted independently so the FIRST failing gate is obvious.
// ─────────────────────────────────────────────────────────────

const CAPTURED_OCR_TEXT = [
  'Money Sent Successfully',
  'Rupees One Hundred Twenty Only',
  '(2) JSREE payment',
  'TT ee ne J RN lO ee',
  'To: Jeyaraj Alagar IA',
  '',
  'UPI ID:',
  'jayarajj126-3@okicici',
  'From: Jeyaraj Alagar 9',
  'UPI ID: ******3174@ptaxis',
  'Indian Overseas Bank -',
  '0327',
  'UPI Ref No: 625024266060',
  '09:36 AM, 08 Sep 2026',
  '',
  'PAYTI | mig LIPID | Pwo oane',
].join('\n');

const { runOCR } = vi.hoisted(() => ({ runOCR: vi.fn() }));

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runOCR,
    runAmountRecoveryOCR: vi.fn(async () => []),
    runAdditionalOCRPasses: vi.fn(async () => []),
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DEBUG case 625024266060 — parser stage', () => {
  it('extractDateTimes keeps the time on "09:36 AM, 08 Sep 2026"', () => {
    const entries = extractDateTimes('09:36 AM, 08 Sep 2026');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ day: 8, month: 9, year: 2026, hour: 9, minute: 36, hasTime: true });
  });

  it('does not regress other receipt layouts', () => {
    expect(extractDateTimes('7:50 PM, 26/8/2026')[0]).toMatchObject({ hasTime: true, hour: 7, minute: 50 });
    expect(extractDateTimes('8 Oct 2026, 4:40 pm')[0]).toMatchObject({ hasTime: true, hour: 4, minute: 40 });
    expect(extractDateTimes('08 Sep 2026')[0]).toMatchObject({ hasTime: false });
  });
});

describe('DEBUG case 625024266060 — per-stage gate assertions', () => {
  async function runCase() {
    runOCR.mockResolvedValue({ text: CAPTURED_OCR_TEXT, confidence: 72 });
    return runScreenshotVerification({
      imageBuffer: Buffer.from('case-625024266060'),
      expectedAmount: 120,
      receiverUpi: 'jayarajj126-3@okicici',
    });
  }

  it('STAGE amount: raw ₹120 → normalized 120 → matched', async () => {
    const { verificationResult: v } = await runCase();
    expect(v.detected.amount).toBe(120);
    expect(v.amountMatch).toBe(true);
    expect(v.checks.amount.passed).toBe(true);
  });

  it('STAGE receiver UPI: expected present among candidates → matched exact', async () => {
    const { verificationResult: v } = await runCase();
    expect(v.extractedUPIs).toContain('jayarajj126-3@okicici');
    expect(v.upiMatch).toBe(true);
    expect(v.upiDiagnostics.matchMethod).toBe('exact');
  });

  it('STAGE transaction status: "Money Sent Successfully" → success', async () => {
    const { verificationResult: v } = await runCase();
    expect(v.transactionStatus.status).toBe('success');
    expect(v.checks.transactionStatus.passed).toBe(true);
  });

  it('STAGE UTR: 625024266060 extracted and valid', async () => {
    const { verificationResult: v, utr } = await runCase();
    expect(utr).toBe('625024266060');
    expect(v.detected.utr).toBe('625024266060');
    expect(v.checks.utr.passed).toBe(true);
  });

  it('STAGE date/time: 09:36 AM 08 Sep 2026 parsed WITH time component', async () => {
    const { verificationResult: v } = await runCase();
    expect(v.detected.date).toContain('09:36 AM');
    expect(v.hasTimeComponent).toBe(true);
    const withTime = v.extractedDateTimes.find(e => e.hasTime);
    expect(withTime).toMatchObject({ day: 8, month: 9, year: 2026, hour: 9, minute: 36 });
  });

  it('FINAL: receipt verified 4 minutes after payment → APPROVED (was INVALID_PAYMENT_DATE)', async () => {
    // Server clock 09:40 IST = 04:10 UTC; receipt 09:36 IST → inside window.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-08T04:10:00.000Z'));
    const { verificationResult: v } = await runCase();
    expect(v.dateValid).toBe(true);
    expect(v.decision).toBe('approved');
    expect(v.reason).toBeNull();
  });
});
