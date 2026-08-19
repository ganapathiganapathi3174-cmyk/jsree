// ─────────────────────────────────────────────────────────────
// Centralized payment-data normalization + IST date helpers.
//
// Single source of truth for how UPI screenshot text is normalized so
// OCR extraction, verification and the approved-UTR duplicate gate all
// compare the same canonical values. Times are interpreted as an
// Asia/Kolkata (UTC+05:30) wall clock and converted to the correct
// absolute UTC instant — never comparing IST clock text against UTC.
// ─────────────────────────────────────────────────────────────

import { IST_UTC_OFFSET_MS, TIMEZONE } from '../config/paymentConfig.js';

export { IST_UTC_OFFSET_MS, TIMEZONE };

export function normalizeAmount(text) {
  if (typeof text === 'number') return text;
  if (!text) return null;
  const cleaned = String(text).replace(/[,\s]/g, '').trim();
  const match = cleaned.match(/(\d+(?:\.\d{1,2})?)/);
  if (!match) return null;
  return parseFloat(match[1]);
}

export function normalizeUpiId(upi) {
  if (!upi) return null;
  return String(upi).replace(/\s+/g, '').toLowerCase().trim();
}

// Canonical UTR form for duplicate comparisons: strip spaces/dashes/dots,
// uppercase. "abc 123-de4" -> "ABC123DE4".
export function normalizeUtrValue(utr) {
  if (utr === null || utr === undefined) return null;
  const normalized = String(utr).replace(/[\s.\-_,]/g, '').toUpperCase().trim();
  return normalized || null;
}

const MONTH_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

export function monthNumber(name) {
  if (!name) return null;
  const key = String(name).toLowerCase().slice(0, 3);
  return MONTH_MAP[key] !== undefined ? MONTH_MAP[key] + 1 : null;
}

// Build an absolute Date by interpreting a DD/MM/YYYY [HH:MM[:SS][AM|PM]]
// wall clock as Asia/Kolkata. Returns null on structural invalidity.
export function buildIstDate({ day, month, year, hour = 0, minute = 0, second = 0 }) {
  if (year < 100) year += year > 50 ? 1900 : 2000;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const d = new Date(asUtc - IST_UTC_OFFSET_MS);
  if (isNaN(d.getTime())) return null;

  // Structural guard: the intended IST wall clock must round-trip exactly.
  const roundTrip = new Date(d.getTime() + IST_UTC_OFFSET_MS);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day ||
    roundTrip.getUTCHours() !== hour ||
    roundTrip.getUTCMinutes() !== minute
  ) return null;

  return d;
}

// ISO date string of an IST wall-clock reading (same instant as buildIstDate).
export function istWallClockParts(date) {
  const shifted = new Date(date.getTime() + IST_UTC_OFFSET_MS);
  const d = shifted.getUTCDate();
  const m = shifted.getUTCMonth() + 1;
  const y = shifted.getUTCFullYear();
  const hh = shifted.getUTCHours();
  const mm = shifted.getUTCMinutes();
  return { day: d, month: m, year: y, hour: hh, minute: mm };
}