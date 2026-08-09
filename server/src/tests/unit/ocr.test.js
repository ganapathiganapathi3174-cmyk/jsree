import { describe, it, expect } from 'vitest';
import {
  normalizeAmount,
  normalizeUPI,
  normalizeUTR,
  parsePaymentDate,
  extractAmounts,
  extractUPIs,
  extractUTRs,
  extractDates,
  matchAmount,
  matchUPI,
  isWithinTimeWindow,
} from '../../services/ocrService.js';

describe('OCR Service - Amount Extraction', () => {
  it('extracts amount with ₹ prefix', () => {
    const result = extractAmounts('You paid ₹120 to merchant');
    expect(result).toContain(120);
  });

  it('extracts amount with Rs. prefix', () => {
    const result = extractAmounts('Rs.500 sent successfully');
    expect(result).toContain(500);
  });

  it('extracts amount with INR prefix', () => {
    const result = extractAmounts('INR 1000 debited');
    expect(result).toContain(1000);
  });

  it('extracts amount with ₹ prefix and decimal', () => {
    const result = extractAmounts('₹120.00 paid');
    expect(result).toContain(120);
  });

  it('extracts amount after "amount" keyword', () => {
    const result = extractAmounts('Amount: 500');
    expect(result).toContain(500);
  });

  it('extracts plain number amount between 50-10000', () => {
    const result = extractAmounts('Payment of 750 completed');
    expect(result).toContain(750);
  });

  it('extracts amount with comma separator', () => {
    const result = extractAmounts('₹1,000 paid');
    expect(result).toContain(1000);
  });

  it('returns empty array for no amounts', () => {
    const result = extractAmounts('No payment info here');
    expect(result).toEqual([]);
  });

  it('normalizes amount string to number', () => {
    expect(normalizeAmount('₹120')).toBe(120);
    expect(normalizeAmount('Rs.500')).toBe(500);
    expect(normalizeAmount('1,000')).toBe(1000);
    expect(normalizeAmount('120.50')).toBe(120.5);
  });
});

describe('OCR Service - UPI Extraction', () => {
  it('extracts UPI ID with @ symbol', () => {
    const result = extractUPIs('Paid to jayarajj126-3@okicici');
    expect(result).toContain('jayarajj126-3@okicici');
  });

  it('normalizes UPI to lowercase', () => {
    const result = extractUPIs('JAYARAJJ126-3@OKICICI');
    expect(result).toContain('jayarajj126-3@okicici');
  });

  it('extracts UPI after "to" keyword', () => {
    const result = extractUPIs('Sent to user@upi');
    expect(result).toContain('user@upi');
  });

  it('returns empty for no UPI', () => {
    const result = extractUPIs('No UPI info');
    expect(result).toEqual([]);
  });

  it('normalizes UPI string', () => {
    expect(normalizeUPI('JAYARAJJ126-3@OKICICI')).toBe('jayarajj126-3@okicici');
    expect(normalizeUPI('user @ upi')).toBe('user@upi');
  });
});

describe('OCR Service - UTR Extraction', () => {
  it('extracts UTR after "UTR" keyword', () => {
    const result = extractUTRs('UTR: 123456789012');
    expect(result).toContain('123456789012');
  });

  it('extracts UTR after "Transaction ID"', () => {
    const result = extractUTRs('Transaction ID: TXN9876543210');
    expect(result).toContain('TXN9876543210');
  });

  it('extracts UTR after "Ref No"', () => {
    const result = extractUTRs('Ref No: 1234567890');
    expect(result).toContain('1234567890');
  });

  it('extracts 10-14 digit number as UTR', () => {
    const result = extractUTRs('Payment done 12345678901234');
    expect(result).toContain('12345678901234');
  });

  it('normalizes UTR by removing spaces', () => {
    const result = extractUTRs('UTR: 1234 5678 9012');
    expect(result).toContain('123456789012');
  });

  it('returns empty for no UTR', () => {
    const result = extractUTRs('No transaction info');
    expect(result).toEqual([]);
  });

  it('normalizes UTR string', () => {
    expect(normalizeUTR('1234 5678 9012')).toBe('123456789012');
    expect(normalizeUTR('ABC-123-DEF')).toBe('ABC-123-DEF');
  });
});

describe('OCR Service - Date Extraction', () => {
  it('extracts DD/MM/YYYY format', () => {
    const result = extractDates('Date: 15/06/2025');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].getDate()).toBe(15);
    expect(result[0].getMonth()).toBe(5);
    expect(result[0].getFullYear()).toBe(2025);
  });

  it('extracts DD-MM-YYYY format', () => {
    const result = extractDates('Date: 15-06-2025');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].getDate()).toBe(15);
  });

  it('extracts DD.MM.YYYY format', () => {
    const result = extractDates('Date: 15.06.2025');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].getDate()).toBe(15);
  });

  it('handles 2-digit year', () => {
    const result = extractDates('Date: 15/06/25');
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].getFullYear()).toBe(2025);
  });

  it('returns empty for no dates', () => {
    const result = extractDates('No date here');
    expect(result).toEqual([]);
  });

  it('parses Indian DD/MM/YYYY correctly (not MM/DD/YYYY)', () => {
    const result = parsePaymentDate('25/12/2025');
    expect(result).not.toBeNull();
    expect(result.getDate()).toBe(25);
    expect(result.getMonth()).toBe(11);
  });
});

describe('OCR Service - Matching Functions', () => {
  it('matchAmount returns true for matching amounts', () => {
    expect(matchAmount([120, 500], 120)).toBe(true);
    expect(matchAmount([120.0, 500.0], 120)).toBe(true);
  });

  it('matchAmount returns false for non-matching amounts', () => {
    expect(matchAmount([100, 200], 120)).toBe(false);
    expect(matchAmount([], 120)).toBe(false);
  });

  it('matchUPI returns true for matching UPI', () => {
    expect(matchUPI(['jayarajj126-3@okicici'], 'jayarajj126-3@okicici')).toBe(true);
    expect(matchUPI(['JAYARAJJ126-3@OKICICI'], 'jayarajj126-3@okicici')).toBe(true);
  });

  it('matchUPI returns false for non-matching UPI', () => {
    expect(matchUPI(['other@upi'], 'jayarajj126-3@okicici')).toBe(false);
    expect(matchUPI([], 'jayarajj126-3@okicici')).toBe(false);
  });
});

describe('OCR Service - Time Window', () => {
  it('returns true for date within window', () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 5 * 60 * 1000);
    expect(isWithinTimeWindow(recent, now, 30)).toBe(true);
  });

  it('returns false for date outside window', () => {
    const now = new Date();
    const old = new Date(now.getTime() - 60 * 60 * 1000);
    expect(isWithinTimeWindow(old, now, 30)).toBe(false);
  });

  it('returns false for future date', () => {
    const now = new Date();
    const future = new Date(now.getTime() + 5 * 60 * 1000);
    expect(isWithinTimeWindow(future, now, 30)).toBe(false);
  });

  it('returns false for null date', () => {
    expect(isWithinTimeWindow(null, new Date(), 30)).toBe(false);
  });
});
