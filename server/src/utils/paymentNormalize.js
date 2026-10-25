// ─────────────────────────────────────────────────────────────
// Centralized payment-data normalization + IST date helpers.
//
// Single source of truth for how UPI screenshot text is normalized so
// OCR extraction, verification and the approved-UTR duplicate gate all
// compare the same canonical values. Times are interpreted as an
// Asia/Kolkata (UTC+05:30) wall clock and converted to the correct
// absolute UTC instant — never comparing IST clock text against UTC.
// ─────────────────────────────────────────────────────────────

import { IST_UTC_OFFSET_MS, TIMEZONE, PLAN_AMOUNTS } from '../config/paymentConfig.js';

export { IST_UTC_OFFSET_MS, TIMEZONE, PLAN_AMOUNTS };

// ─────────────────────────────────────────────────────────────
// Authoritative plan → amount resolution (Rule A).
//
// The CLIENT only ever selects a plan key. The amount is ALWAYS resolved
// server-side from the single configured plan table (config/paymentConfig),
// so a frontend-supplied amount can never bypass server-side pricing.
//
// Accepts a plan key ('120') or the plan amount itself (120 / '120') — the
// top-up flow posts the amount, the register flow posts the plan key. Any
// value that is not a configured plan resolves to null and the caller MUST
// reject it (never fall back to a client-provided number).
// ─────────────────────────────────────────────────────────────
export function resolvePlanAmount(plan) {
  if (plan === null || plan === undefined || plan === '') return null;
  const key = String(plan).trim();
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(PLAN_AMOUNTS, key)) return PLAN_AMOUNTS[key];
  // Numeric forms: 120, '120', 120.0, ' 120 '
  const numeric = Number(key);
  if (Number.isFinite(numeric) && Object.prototype.hasOwnProperty.call(PLAN_AMOUNTS, String(numeric))) {
    return PLAN_AMOUNTS[String(numeric)];
  }
  return null;
}

// True when the value is a configured plan amount (used by the top-up flow
// to reject an amount that is not one of the published plans).
export function isConfiguredPlanAmount(amount) {
  return resolvePlanAmount(amount) !== null;
}

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

// Calendar day key (YYYY-MM-DD) of an instant, in the configured timezone.
// Two instants share a key exactly when they fall on the same IST calendar
// day — the comparison Rule C (transaction date == current India date) is
// built on. Never uses the server machine's local timezone.
export function istCalendarDayKey(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return null;
  const { year, month, day } = istWallClockParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Number of IST calendar days between two instants:
//   0  → same IST calendar day
//  -1  → `a` is the previous IST calendar day
//   1  → `a` is the next IST calendar day
// Returns null when either instant is invalid.
export function istCalendarDayDiff(a, b) {
  const ka = istCalendarDayKey(a);
  const kb = istCalendarDayKey(b);
  if (!ka || !kb) return null;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${ka}T00:00:00Z`) - Date.parse(`${kb}T00:00:00Z`)) / MS_PER_DAY);
}