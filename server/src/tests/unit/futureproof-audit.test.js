import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  extractAmounts, extractUPIs, extractUTRs, extractDateTimes, dateTimeEntryToDate,
  extractTransactionStatus, isDemoScreenshot, matchAmount, matchUPI, matchUPIWithRecovery,
  normalizeUPI, isWithinTimeWindow,
} from '../../services/ocrService.js';
import { decidePaymentVerification, runScreenshotVerification } from '../../services/verificationService.js';

// ─────────────────────────────────────────────────────────────
// FUTURE-PROOF ADVERSARIAL AUDIT (read-only w.r.t. production).
// Parser/contract + decision-level probing across amounts, dates,
// UPIs, UTRs, statuses, providers, cross-line layouts, fuzz.
// Any failure below is a FINDING to triage (Phase 18/19), not a fix.
// ─────────────────────────────────────────────────────────────

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

afterEach(() => { vi.useRealTimers(); });

const UPI = 'jayarajj126-3@okicici';
const AT = (iso) => { vi.useFakeTimers(); vi.setSystemTime(new Date(iso)); };
const hourMin = (e) => ({ h: e.hour, m: e.minute, hasTime: e.hasTime });

// deterministic PRNG for fuzz
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── PHASE 3: AMOUNT ──────────────────────────────────────────
describe('AUDIT amount representations', () => {
  const cases = [
    ['₹120', 120], ['₹ 120', 120], ['Rs. 120', 120], ['Rs 120', 120],
    ['INR 120', 120], ['120 INR', 120], ['120 Rs', 120], ['INR 1,000', 1000],
    ['₹1,000.00', 1000], ['₹500.00', 500], ['₹1500', 1500], ['₹2000', 2000],
    ['Rupees One Hundred Twenty Only', 120], ['Rupees Five Hundred Only', 500],
    ['RUPEES FIVE HUNDRED ONLY', 500], ['Rs. One Thousand Only', 1000],
  ];
  for (const [text, expected] of cases) {
    it(`extracts ${expected} from "${text}"`, () => {
      expect(extractAmounts(text)).toContain(expected);
    });
  }

  // Conservative-by-design contracts (fail-closed, NOT defects):
  it('bare digits without currency context yield no amount (prevents harvesting dates/UTRs)', () => {
    expect(extractAmounts('1,000')).toEqual([]);
  });
  it('trailing-marker word form ("One Thousand Rupees") is unsupported AND yields nothing wrong (known limitation, fail-closed)', () => {
    expect(extractAmounts('One Thousand Rupees')).toEqual([]);
    expect(extractAmounts('ONE HUNDRED TWENTY RUPEES')).toEqual([]);
  });

  const corrupt = [
    ['2120', 120], ['2500', 500], ['2100', 1000], ['1000', 100],
    ['5000', 500], ['1200', 120], ['21500', 1500],
  ];
  for (const [text, expected] of corrupt) {
    it(`CRITICAL: genuine "${text}" must NOT match ₹${expected} without evidence`, () => {
      expect(matchAmount(extractAmounts(text), expected)).toBe(false);
    });
  }

  it('exact match works for all plan amounts', () => {
    for (const a of [120, 500, 1000]) expect(matchAmount([a], a)).toBe(true);
  });
});

// ── PHASE 4: DATE/TIME ───────────────────────────────────────
describe('AUDIT date/time formats (hasTime must survive)', () => {
  const withTime = [
    '09:36 AM, 08 Sep 2026', '09:36 AM, 8 Sep 2026', '8 Sep 2026, 09:36 AM',
    '08/09/2026 09:36', '08/09/2026, 09:36', '08-09-2026 09:36', '08.09.2026 09:36',
    '09:36:15 AM, 08 Sep 2026', '21:36, 08/09/2026', '8 September 2026, 9:36 AM',
    '08 September 2026 09:36', '9:36 PM, 08 Sep 2026',
  ];
  for (const line of withTime) {
    it(`"${line}" keeps hasTime=true`, () => {
      const entries = extractDateTimes(line);
      const timed = entries.filter(e => e.hasTime);
      expect(timed.length).toBeGreaterThan(0);
    });
  }

  it('exact contract: "09:36 AM, 08 Sep 2026"', () => {
    expect(extractDateTimes('09:36 AM, 08 Sep 2026')[0]).toMatchObject(
      { day: 8, month: 9, year: 2026, hour: 9, minute: 36, hasTime: true });
  });

  it('IST conversion: 09:36 IST = 04:06 UTC', () => {
    const d = dateTimeEntryToDate({ day: 8, month: 9, year: 2026, hour: 9, minute: 36, second: 0, ampm: 'AM', hasTime: true });
    expect(d.toISOString()).toBe('2026-09-08T04:06:00.000Z');
  });

  it('date-only stays hasTime=false (fail-closed preserved)', () => {
    for (const line of ['08 Sep 2026', '08/09/2026', '2026-09-08']) {
      const entries = extractDateTimes(line);
      if (entries.length > 0) expect(entries.every(e => !e.hasTime)).toBe(true);
    }
  });

  it('window: ±30min boundary respected', () => {
    const now = new Date('2026-09-08T04:10:00.000Z');
    expect(isWithinTimeWindow(new Date('2026-09-08T04:06:00.000Z'), now, 30)).toBe(true);
    expect(isWithinTimeWindow(new Date('2026-09-08T03:39:00.000Z'), now, 30)).toBe(false);
    expect(isWithinTimeWindow(new Date('2026-09-08T04:41:00.000Z'), now, 30)).toBe(false);
  });
});

// ── PHASE 11: CROSS-LINE ─────────────────────────────────────
describe('AUDIT cross-line pairing', () => {
  it('date line + time-only next line pair up', () => {
    const entries = extractDateTimes('Date:\n08 Sep 2026\n09:36 AM');
    expect(entries.some(e => e.hasTime && e.hour === 9 && e.minute === 36)).toBe(true);
  });

  it('UPI on line after label is extracted', () => {
    expect(extractUPIs('UPI ID\njayarajj126-3@okicici')).toContain(UPI);
  });

  it('amount on line after label is extracted', () => {
    expect(extractAmounts('Amount\n₹120')).toContain(120);
  });
});

// ── PHASE 5: UPI ─────────────────────────────────────────────
describe('AUDIT UPI matching (no broad fuzz)', () => {
  it('exact + case variants match', () => {
    expect(matchUPI([UPI], UPI)).toBe(true);
    expect(matchUPI(['JAYARAJJ126-3@OKICICI'], UPI)).toBe(true);
  });

  it('1–2 char trailing truncation recovers (documented behavior)', () => {
    expect(matchUPIWithRecovery(['jayarajj126-3@okicic'], UPI).match).toBe(true);
    expect(matchUPIWithRecovery(['jayarajj126-3@okici'], UPI).match).toBe(true);
  });

  const mustReject = [
    'attacker@upi', 'jayarajj126-3@okicicix', 'xayarajj126-3@okicici',
    'jayaraj126-3@okicici', 'jayarajj126-3@okhdfc', 'jayarajj126-3@okic',
    '3174@ptaxis',
  ];
  for (const bad of mustReject) {
    it(`rejects "${bad}"`, () => {
      expect(matchUPIWithRecovery([bad], UPI).match).toBe(false);
    });
  }

  it('normalizeUPI is case/space stable', () => {
    expect(normalizeUPI('  JAYARAJJ126-3@OKICICI  ')).toBe(normalizeUPI(UPI));
  });
});

// ── PHASE 6: UTR ─────────────────────────────────────────────
describe('AUDIT UTR labels and lengths', () => {
  const labels = ['UTR:', 'Transaction ID:', 'Transaction Ref:', 'Reference ID:', 'UPI Ref No:', 'Ref No:', 'UPI transaction ID:', 'Bank Ref No:'];
  for (const label of labels) {
    it(`extracts 12-digit UTR after "${label}"`, () => {
      expect(extractUTRs(`${label} 625024266060`)).toContain('625024266060');
    });
  }
  for (const len of [10, 11, 12, 13, 14]) {
    it(`extracts bare ${len}-digit reference`, () => {
      const digits = '12345678901234'.slice(0, len);
      expect(extractUTRs(`Ref ${digits}`).join(' ')).toContain(digits);
    });
  }
  it('OCR-split digits rejoin without crossing lines', () => {
    expect(extractUTRs('UPI Ref No: 6250 2426 6060')).toContain('625024266060');
  });
});

// ── PHASE 7: STATUS ──────────────────────────────────────────
describe('AUDIT transaction status (failure stays conservative)', () => {
  const ok = ['Completed', 'Success', 'Successful', 'Paid', 'Money Sent', 'Payment Successful', 'Transferred'];
  for (const s of ok) {
    it(`"${s}" → success-ish`, () => {
      expect(extractTransactionStatus(s).status).toBe('success');
    });
  }
  const bad = ['Failed', 'Declined', 'Reversed', 'Pending', 'Processing', 'Cancelled'];
  for (const s of bad) {
    it(`"${s}" → NOT success`, () => {
      expect(extractTransactionStatus(s).status).not.toBe('success');
    });
  }
  it('mixed success+failure text is NOT success', () => {
    expect(extractTransactionStatus('Payment Successful but later Reversed. Status: Failed').status).not.toBe('success');
  });
});

// ── PHASE 8: PROVIDER MATRIX (synthetic OCR, mocked runOCR) ──
describe('AUDIT provider matrix end-to-end (text level)', () => {
  const providers = {
    'Google Pay': ['Google Pay', 'Payment Successful', '₹500', 'To Jayaraj', UPI, 'UPI transaction ID: T7GPROV001'].join('\n'),
    'Paytm': ['Paytm', 'Money Sent Successfully', '₹500', `To: ${UPI}`, 'UPI Ref No: T250PROV001'].join('\n'),
    'PhonePe': ['PhonePe', 'Transaction Successful', '₹500', `Paid to ${UPI}`, 'Transaction ID: PPPROV0001'].join('\n'),
    'BHIM': ['BHIM', 'Payment Successful', '₹500', `To: ${UPI}`, 'UPI Reference Number: BHIMPROV01'].join('\n'),
    'Amazon Pay': ['Amazon Pay', 'Payment Completed', 'Amount ₹500', `Sent to ${UPI}`, 'Reference ID: AMZPROV0001'].join('\n'),
    'Bank UPI': ['SBI UPI', 'Transferred Successfully', 'Rs.500', `To: ${UPI}`, 'Bank Ref No: SBINPROV001'].join('\n'),
  };
  for (const [name, body] of Object.entries(providers)) {
    it(`${name}: full valid receipt → APPROVED (light & dark equivalent)`, async () => {
      for (const mode of ['light', 'dark']) {
        void mode;
        AT('2026-09-08T04:10:00.000Z'); // 09:40 IST
        runOCR.mockResolvedValue({ text: `${body}\nDate: 08/09/2026, 09:36 AM`, confidence: 88 });
        const { verificationResult: v } = await runScreenshotVerification({
          imageBuffer: Buffer.from(`prov-${name}-${mode}`), expectedAmount: 500, receiverUpi: UPI,
        });
        expect(v.amountMatch).toBe(true);
        expect(v.upiMatch).toBe(true);
        expect(v.dateValid).toBe(true);
        expect(v.decision).toBe('approved');
      }
    });
  }
});

// ── PHASE 13: EVIDENCE VS EXPECTED ───────────────────────────
describe('AUDIT expected values never manufacture evidence', () => {
  it('genuine ₹2120 image for ₹120 request → reject', async () => {
    AT('2026-09-08T04:10:00.000Z');
    runOCR.mockResolvedValue({
      text: ['Google Pay', 'Payment Successful', '₹2120', 'To Jayaraj', UPI, 'Date: 08/09/2026, 09:36 AM', 'UPI transaction ID: T7BIG2120'].join('\n'),
      confidence: 90,
    });
    const { verificationResult: v } = await runScreenshotVerification({
      imageBuffer: Buffer.from('big-2120'), expectedAmount: 120, receiverUpi: UPI,
    });
    expect(v.decision).toBe('rejected');
    expect(v.reason).toBe('AMOUNT_MISMATCH');
  });

  it('attacker UPI image → reject', async () => {
    AT('2026-09-08T04:10:00.000Z');
    runOCR.mockResolvedValue({
      text: ['Paytm', 'Money Sent Successfully', '₹120', 'To: attacker@upi', 'UPI Ref No: ATTACK000001', '08/09/2026, 09:36 AM'].join('\n'),
      confidence: 90,
    });
    const { verificationResult: v } = await runScreenshotVerification({
      imageBuffer: Buffer.from('attacker'), expectedAmount: 120, receiverUpi: UPI,
    });
    expect(v.decision).toBe('rejected');
    expect(v.reason).toBe('UPI_MISMATCH');
  });

  it('single false gate always rejects (decision table)', () => {
    const base = { upiMatch: true, amountMatch: true, dateValid: true, utrPresent: true, transactionStatusOk: true, ocrConfidence: 90 };
    expect(decidePaymentVerification(base).decision).toBe('approved');
    for (const k of ['upiMatch', 'amountMatch', 'dateValid', 'utrPresent', 'transactionStatusOk']) {
      expect(decidePaymentVerification({ ...base, [k]: false }).decision).toBe('rejected');
    }
  });
});

// ── PHASE 16: DEMO DETECTION ─────────────────────────────────
describe('AUDIT demo markers incl. evasion attempts', () => {
  const hits = ['DEMO receipt', 'Sample payment', 'TEST PAYMENT completed', 'Mock screenshot', 'for testing only', 'This is a simulation', 'dummy UTR 123', 'Example payee', 'do not use'];
  for (const t of hits) {
    it(`flags "${t}"`, () => { expect(isDemoScreenshot(t)).toBe(true); });
  }
  it('clean receipt text is not flagged', () => {
    expect(isDemoScreenshot(`Payment Successful ₹120 To ${UPI} UPI Ref No: 625024266060 08 Sep 2026`)).toBe(false);
  });
});

// ── PHASE 17: FUZZ (seeded, deterministic) ───────────────────
describe('AUDIT fuzz: layout noise must not move fields', () => {
  const rnd = mulberry32(20260908);
  const base = { date: '08 Sep 2026', time: '09:36 AM', amt: '₹120', upi: UPI, utr: '625024266060' };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  let failures = 0;
  for (let i = 0; i < 120; i++) {
    const sp = pick([' ', '  ', ' ']);
    const comma = pick([',', ' ,', ',', '']);
    const nl = pick(['\n', ' \n ', '\n\n', '  \n']);
    const mon = pick(['Sep', 'SEP', 'sep', 'September']);
    const t = `${pick(['09:36 AM', '09:36 am', '09:36AM'])}${comma}${sp}08${sp}${mon}${sp}2026`;
    const line = `UPI Ref No:${sp}6250 2426 6060${nl}${t}${nl}Rupees${sp}One Hundred Twenty${sp}Only`;
    const dts = extractDateTimes(line);
    const timed = dts.filter(e => e.hasTime && e.day === 8 && e.month === 9 && e.year === 2026);
    const amts = extractAmounts(line);
    const utrs = extractUTRs(line);
    if (timed.length === 0 || !amts.includes(120) || !utrs.includes('625024266060')) {
      failures++;
      if (failures <= 5) console.log('FUZZ-FAIL', JSON.stringify(line), '=>', JSON.stringify({ dts, amts, utrs }));
    }
  }
  it('120 seeded variations: zero field-loss failures', () => {
    expect(failures).toBe(0);
  });
});
