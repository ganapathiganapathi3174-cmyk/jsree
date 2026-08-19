// ─────────────────────────────────────────────────────────────
// Centralized payment verification configuration.
//
// Every tunable in the verification pipeline lives here so it can be
// adjusted without touching OCR/verification logic:
//   - PAYMENT_PLANS            mapping plan -> { amount, receiverUpi }
//   - PAYMENT_TIME_WINDOW_MINUTES   how recent a screenshot must be
//   - MIN_OCR_CONFIDENCE_APPROVE    auto-approve confidence floor
//   - MIN_OCR_CONFIDENCE_MANUAL     manual-review confidence floor
//
// All values are env-overridable and fall back to production-safe
// defaults. Verified plans (120/500/1000) are enforced by the schema.
// ─────────────────────────────────────────────────────────────

const PLAN_AMOUNTS = { '120': 120, '500': 500, '1000': 1000 };

export const RECEIVER_UPI = process.env.ADMIN_UPI_ID || 'jayarajj126-3@okicici';

export const PAYMENT_PLANS = Object.fromEntries(
  Object.entries(PLAN_AMOUNTS).map(([months, amount]) => [
    months,
    { amount, receiverUpi: RECEIVER_UPI },
  ])
);

export function getPlanConfig(months) {
  return PAYMENT_PLANS[String(months)] || null;
}

// Screenshot payment timestamp must fall within this many minutes of the
// server clock, interpreted in the Asia/Kolkata (UTC+05:30) timezone.
export const PAYMENT_TIME_WINDOW_MINUTES = Number(process.env.PAYMENT_TIME_WINDOW_MINUTES || 30);

// Screenshots are UPI receipts; OCR confidence is a quality signal, never a
// security boundary on its own (amount/UPI/date are the security gates).
export const MIN_OCR_CONFIDENCE_APPROVE = Number(process.env.MIN_OCR_CONFIDENCE_APPROVE || 55);
export const MIN_OCR_CONFIDENCE_MANUAL = Number(process.env.MIN_OCR_CONFIDENCE_MANUAL || 35);

// When enabled, UTRs are re-normalized (strip non-alphanumerics, uppercase)
// BEFORE the approved-UTR duplicate comparison. Off by default: screenshots
// carry their own run, so exact-match dedup keeps working and OCR-garbled
// variants remain separate. Existing behavior is the default.
export const NORMALIZE_UTRS_FOR_DUPLICATE = process.env.NORMALIZE_UTRS_FOR_DUPLICATE === 'true';

export const TIMEZONE = 'Asia/Kolkata';
export const IST_UTC_OFFSET_MS = 5.5 * 60 * 60 * 1000;