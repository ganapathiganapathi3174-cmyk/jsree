import { describe, it, expect, vi } from 'vitest';
import {
  extractAmounts, extractUPIs, extractDateTimes, extractTransactionStatus,
  matchAmount, matchUPIWithRecovery,
} from '../../services/ocrService.js';
import fs from 'fs';
import { isPaymentExpired } from '../../services/paymentService.js';
import { RECEIVER_UPI, PAYMENT_TIME_WINDOW_MINUTES } from '../../config/paymentConfig.js';
import * as paymentConfig from '../../config/paymentConfig.js';

// ─────────────────────────────────────────────────────────────
// HARDENING AUDIT ROUND 2 — extended matrices + tampering + parity.
// Pure-function level. Findings triaged in-report; no prod changes.
// ─────────────────────────────────────────────────────────────

const UPI = 'jayarajj126-3@okicici';

describe('AUDIT-2 decimals and thousand variants', () => {
  const cases = [
    ['₹120.00', 120], ['₹ 1,000', 1000], ['Rs. 1,000', 1000],
    ['INR 1,000', 1000], ['Rupees One Thousand Only', 1000],
    ['₹1,000', 1000], ['Rs.120.00', 120], ['INR 500.00', 500],
  ];
  for (const [text, expected] of cases) {
    it(`extracts ${expected} from "${text}"`, () => {
      expect(extractAmounts(text)).toContain(expected);
    });
  }
});

describe('AUDIT-2 larger genuine amounts never satisfy smaller plans', () => {
  const pairs = [['21000', 1000], ['21500', 1500], ['22000', 2000], ['25000', 5000], ['21200', 1200]];
  for (const [text, expected] of pairs) {
    it(`"${text}" ≠ ₹${expected}`, () => {
      expect(matchAmount(extractAmounts(text), expected)).toBe(false);
    });
  }
});

describe('AUDIT-2 12h/24h/seconds variants keep hasTime', () => {
  // NOTE: entries keep the RAW 12-hour clock; AM/PM applies at conversion.
  const cases = [
    ['08-09-2026 09:36 PM', 9, 36, 'PM'], ['08.09.2026 09:36 PM', 9, 36, 'PM'],
    ['9:05 AM, 08 Sep 2026', 9, 5, 'AM'], ['09:05:30 AM, 08 Sep 2026', 9, 5, 'AM'],
    ['21:36 08/09/2026', 21, 36, null], ['08/09/2026 21:36:15', 21, 36, null],
    ['9:36 pm, 8 sep 2026', 9, 36, 'pm'],
  ];
  for (const [line, h, m, ap] of cases) {
    it(`"${line}" → ${h}:${m} ${ap || '24h'} with time`, () => {
      const timed = extractDateTimes(line).filter(e => e.hasTime);
      expect(timed.length).toBeGreaterThan(0);
      expect(timed[0].hour).toBe(h);
      expect(timed[0].minute).toBe(m);
      expect((timed[0].ampm || null)?.toUpperCase() ?? null).toBe(ap?.toUpperCase() ?? null);
    });
  }
});

describe('AUDIT-2 cross-line with labels and orders', () => {
  it('label lines do not break pairing (date then time)', () => {
    const entries = extractDateTimes('DATE\n08 Sep 2026\nTIME\n09:36 AM');
    expect(entries.some(e => e.hasTime && e.hour === 9 && e.minute === 36)).toBe(true);
  });

  it('time line BEFORE date line pairs (bank-receipt layout)', () => {
    const entries = extractDateTimes('09:36 AM\n08 Sep 2026');
    expect(entries.some(e => e.hasTime && e.hour === 9 && e.minute === 36)).toBe(true);
  });

  it('unrelated times on other lines do not attach to the date', () => {
    const entries = extractDateTimes('08 Sep 2026\nReference: 625024266060');
    expect(entries.every(e => !e.hasTime)).toBe(true);
  });
});

describe('AUDIT-2 UPI spacing and corruption', () => {
  it('spaces around @ are tolerated', () => {
    expect(extractUPIs('UPI ID: jayarajj126-3 @ okicici')).toContain(UPI);
  });

  it('exact + truncation recovery intact', () => {
    expect(matchUPIWithRecovery([UPI], UPI).method).toBe('exact');
    expect(matchUPIWithRecovery(['jayarajj126-3@okicic'], UPI).method).toBe('ocr_recovery_truncation');
  });

  const hostile = ['jayarajj126-3@okicicix', 'jjayarajj126-3@okicici', 'jayarajj1263-@okicici', 'jayarajj126-3@okicicici', 'jayaraj@okicici'];
  for (const bad of hostile) {
    it(`rejects "${bad}"`, () => {
      expect(matchUPIWithRecovery([bad], UPI).match).toBe(false);
    });
  }
});

describe('AUDIT-2 status case and spacing', () => {
  for (const s of ['MONEY SENT', 'money  sent', 'Payment  Successful', 'TRANSFERRED SUCCESSFULLY', '  Paid  ']) {
    it(`"${s}" → success`, () => {
      expect(extractTransactionStatus(s).status).toBe('success');
    });
  }
  for (const s of ['FAILED', 'Transaction  Declined', 'payment reversed', '  PENDING  ']) {
    it(`"${s}" → not success`, () => {
      expect(extractTransactionStatus(s).status).not.toBe('success');
    });
  }
});

describe('AUDIT-2 membership/topup parity (one engine, one config)', () => {
  it('both services wire the SAME shared modules (no forked engine/config)', () => {
    const svcDir = new URL('../../services/', import.meta.url);
    const read = (f) => fs.readFileSync(new URL(f, svcDir), 'utf8');
    for (const f of ['paymentService.js', 'topupService.js']) {
      const src = read(f);
      expect(src).toContain("from './verificationService.js'");
      expect(src).toContain("from '../config/paymentConfig.js'");
    }
    // No second OCR/decision implementation anywhere outside ocrService.
    expect(read('topupService.js')).not.toMatch(/function\s+(extract|match|decide)\w*(Amount|UPI|Date|UTR|Verification)/);
  });

  it('single 30-minute window constant', () => {
    expect(PAYMENT_TIME_WINDOW_MINUTES).toBe(30);
    expect(paymentConfig.PAYMENT_PLANS['120'].receiverUpi).toBe(RECEIVER_UPI);
  });

  it('shared fail-closed expiry helper', () => {
    expect(isPaymentExpired({ expires_at: new Date(Date.now() + 60000).toISOString() })).toBe(false);
    expect(isPaymentExpired({})).toBe(true);
  });
});
