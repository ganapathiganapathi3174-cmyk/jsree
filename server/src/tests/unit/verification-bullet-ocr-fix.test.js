import { describe, it, expect, vi, beforeEach } from 'vitest';

// GPay masks the payee VPA as "••••26-3@okicici". Tesseract OCRs those
// bullets as letters/zeros ("ee26-3@okicici", "es0026-3@okicici", ...).
// Before the fix, matchUPIWithRecovery only stripped literal bullet/dot
// chars, so a genuine payment was hard-rejected as UPI_MISMATCH. These
// tests pin the real production sample (21 Oct 2026, UTR 5636813885,
// ₹120, payee JEYARAJ ALAGAR) and the security boundaries around the fix.

const { runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery, verifyAmountWithCurrencyRecovery } =
  vi.hoisted(() => ({
    runOCR: vi.fn(),
    runAmountRecoveryOCR: vi.fn(),
    runAdditionalOCRPasses: vi.fn(),
    runDeepAmountRecovery: vi.fn(),
    verifyAmountWithCurrencyRecovery: vi.fn(),
  }));

vi.mock('../../services/ocrService.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, runOCR, runAmountRecoveryOCR, runAdditionalOCRPasses, runDeepAmountRecovery, verifyAmountWithCurrencyRecovery };
});

vi.mock('../../db/supabase.js', () => {
  const client = { from: () => { throw new Error('no db in unit test'); } };
  return { supabase: client, supabaseAnon: {}, default: client };
});

import { matchUPIWithRecovery, extractUPIs } from '../../services/ocrService.js';
import { runScreenshotVerification } from '../../services/verificationService.js';

const RECEIVER_UPI = 'jayarajj126-3@okicici';

describe('OCR-corrupted GPay mask bullets: masked-suffix recovery', () => {
  const corruptedVariants = [
    ['ee26-3@okicici', 'bullets read as "ee" (real production sample)'],
    ['es0026-3@okicici', 'bullets read as "es00"'],
    ['eeee26-3@okicici', 'bullets read as "eeee"'],
    ['e026-3@okicici', 'bullets read as "e0"'],
    ['o026-3@okicici', 'bullets read as "o0"'],
    ['0026-3@okicici', 'bullets read as "00"'],
  ];
  for (const [candidate, label] of corruptedVariants) {
    it(`${label}: "${candidate}" -> masked_suffix match`, () => {
      const result = matchUPIWithRecovery([candidate], RECEIVER_UPI);
      expect(result.match).toBe(true);
      expect(result.method).toBe('masked_suffix');
    });
  }

  it('real candidate list from the production sample screenshot -> matches', () => {
    // Verbatim extractedUPIs from running the live engine on the user's
    // screenshot (Downloads, 21 Oct 2026 13:17 IST).
    const candidates = [
      'ee26-3@okicici', 'esscan73@okaxis', 'eeee26-3@okicici',
      'eeean73@okaxis', 'payment@completed', 'es0026-3@okicici', '+sean73@okaxis',
    ];
    const result = matchUPIWithRecovery(candidates, RECEIVER_UPI);
    expect(result.match).toBe(true);
    expect(result.method).toBe('masked_suffix');
  });

  it('clean masked suffix still matches (no regression)', () => {
    const result = matchUPIWithRecovery(['26-3@okicici'], RECEIVER_UPI);
    expect(result.match).toBe(true);
    expect(result.method).toBe('masked_suffix');
  });

  it('exact full UPI still matches via exact method (no regression)', () => {
    const result = matchUPIWithRecovery([RECEIVER_UPI], RECEIVER_UPI);
    expect(result.match).toBe(true);
    expect(result.method).toBe('exact');
  });

  it('corrupted bullets with WRONG suffix -> no match', () => {
    const result = matchUPIWithRecovery(['es0099-9@okicici'], RECEIVER_UPI);
    expect(result.match).toBe(false);
  });

  it('corrupted bullets with wrong domain -> no match', () => {
    const result = matchUPIWithRecovery(['ee26-3@okaxis'], RECEIVER_UPI);
    expect(result.match).toBe(false);
  });

  it('sender UPI with corruption noise (okaxis) -> no match', () => {
    const result = matchUPIWithRecovery(['esscan73@okaxis', '+sean73@okaxis'], RECEIVER_UPI);
    expect(result.match).toBe(false);
  });

  it('garbage @-token "payment@completed" -> no match', () => {
    const result = matchUPIWithRecovery(['payment@completed'], RECEIVER_UPI);
    expect(result.match).toBe(false);
  });

  it('noise-stripped suffix shorter than 4 chars -> no match (MIN_MASKED_LOCAL_PART)', () => {
    const result = matchUPIWithRecovery(['ee9-3@okicici'], RECEIVER_UPI);
    expect(result.match).toBe(false);
  });

  it('attacker UPI on same domain, unrelated local part -> no match', () => {
    const result = matchUPIWithRecovery(['attacker@okicici'], RECEIVER_UPI);
    expect(result.match).toBe(false);
  });

  it('extractUPIs still normalizes literal-bullet form (no regression)', () => {
    const upis = extractUPIs('To: \u2022\u2022\u2022\u202226-3@okicici on Google Pay');
    expect(upis).toContain('26-3@okicici');
  });
});

describe('Production sample end-to-end (mocked OCR, real decision engine)', () => {
  // Verbatim primary-pass text shape from the real screenshot's OCR run.
  const sampleReceiptText = () => [
    'Google Pay',
    'To Jayaraj',
    '+91 \u2022\u2022\u2022\u2022\u2022\u2022 4780',
    '\u20B9120',
    'JSREE payment',
    'Completed',
    '21 Oct 2026, 1:11 pm',
    'Indian Bank 7393',
    'UPI transaction ID',
    '5636813885',
    'To: JEYARAJ ALAGAR',
    'ee26-3@okicici on Google Pay',
    'From: Mr Purusothaman Raja (Indian Bank)',
    'esscan73@okaxis on Google Pay',
    'Google transaction ID',
    'CICAgPi-Ib37WA',
  ].join('\n');

  const NOW = new Date('2026-10-21T13:17:00+05:30');

  beforeEach(() => {
    vi.clearAllMocks();
    runOCR.mockResolvedValue({ text: sampleReceiptText(), confidence: 78 });
    runAdditionalOCRPasses.mockResolvedValue([]);
    runAmountRecoveryOCR.mockResolvedValue([]);
    runDeepAmountRecovery.mockResolvedValue([]);
    verifyAmountWithCurrencyRecovery.mockResolvedValue({ verified: false, method: 'no_evidence', evidence: '' });
  });

  it('all strong gates pass; with payee name configured -> approved', async () => {
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      receiverName: 'JEYARAJ ALAGAR',
      now: NOW,
      referenceId: 't1',
      referenceType: 'payment',
    });
    expect(verificationResult.upiMatch).toBe(true);
    expect(verificationResult.amountMatch).toBe(true);
    expect(verificationResult.dateValid).toBe(true);
    expect(verificationResult.decision).toBe('approved');
  });

  it('empty receiver_name (current production config) -> manual_review, NEVER silent approve', async () => {
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      receiverName: '',
      now: NOW,
      referenceId: 't2',
      referenceType: 'payment',
    });
    expect(verificationResult.upiMatch).toBe(true);
    expect(verificationResult.decision).toBe('manual_review');
    expect(verificationResult.reason).toBe('RECEIVER_NAME_NOT_CONFIGURED');
  });

  it('different payee name on receipt -> rejected RECEIVER_NAME_MISMATCH', async () => {
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      receiverName: 'SOMEONE ELSE',
      now: NOW,
      referenceId: 't3',
      referenceType: 'payment',
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('RECEIVER_NAME_MISMATCH');
  });

  it('wrong amount -> still rejected AMOUNT_MISMATCH (fix does not weaken amount gate)', async () => {
    runOCR.mockResolvedValue({
      text: sampleReceiptText().replace('\u20B9120', '\u20B9500'),
      confidence: 78,
    });
    runAmountRecoveryOCR.mockResolvedValue([500]);
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      receiverName: 'JEYARAJ ALAGAR',
      now: NOW,
      referenceId: 't4',
      referenceType: 'payment',
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('AMOUNT_MISMATCH');
  });

  it('amount dropped by primary pass -> recovery called WITH expectedAmount', async () => {
    runOCR.mockResolvedValue({
      text: sampleReceiptText().replace('\u20B9120\n', ''),
      confidence: 78,
    });
    runAmountRecoveryOCR.mockResolvedValue([120]);
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      receiverName: 'JEYARAJ ALAGAR',
      now: NOW,
      referenceId: 't5',
      referenceType: 'payment',
    });
    expect(runAmountRecoveryOCR).toHaveBeenCalledWith(expect.anything(), 120);
    expect(verificationResult.amountMatch).toBe(true);
    expect(verificationResult.decision).toBe('approved');
  });

  it('complete primary pass -> additional full-page OCR passes are SKIPPED (latency fix)', async () => {
    await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      receiverName: 'JEYARAJ ALAGAR',
      now: NOW,
      referenceId: 't6',
      referenceType: 'payment',
    });
    expect(runAdditionalOCRPasses).not.toHaveBeenCalled();
  });

  it('primary pass missing amount -> additional passes still run (recall preserved)', async () => {
    runOCR.mockResolvedValue({
      text: sampleReceiptText().replace('\u20B9120\n', ''),
      confidence: 78,
    });
    runAmountRecoveryOCR.mockResolvedValue([120]);
    await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      receiverName: 'JEYARAJ ALAGAR',
      now: NOW,
      referenceId: 't7',
      referenceType: 'payment',
    });
    expect(runAdditionalOCRPasses).toHaveBeenCalled();
  });

  it('OCR confidence below floor -> still rejected LOW_OCR_CONFIDENCE', async () => {
    runOCR.mockResolvedValue({ text: sampleReceiptText(), confidence: 40 });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      receiverName: 'JEYARAJ ALAGAR',
      now: NOW,
      referenceId: 't8',
      referenceType: 'payment',
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('LOW_OCR_CONFIDENCE');
  });

  it('wrong UPI on receipt -> still rejected UPI_MISMATCH (security gate intact)', async () => {
    runOCR.mockResolvedValue({
      text: sampleReceiptText().replaceAll('ee26-3@okicici', 'attacker99@okicici').replaceAll('es0026-3@okicici', ''),
      confidence: 78,
    });
    const { verificationResult } = await runScreenshotVerification({
      imageBuffer: Buffer.from('img'),
      expectedAmount: 120,
      receiverUpi: RECEIVER_UPI,
      receiverName: 'JEYARAJ ALAGAR',
      now: NOW,
      referenceId: 't9',
      referenceType: 'payment',
    });
    expect(verificationResult.decision).toBe('rejected');
    expect(verificationResult.reason).toBe('UPI_MISMATCH');
  });
});
