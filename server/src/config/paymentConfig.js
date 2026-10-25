// ─────────────────────────────────────────────────────────────
// Centralized payment verification configuration.
//
// Every tunable in the verification pipeline lives here so it can be
// adjusted without touching OCR/verification logic:
//   - PAYMENT_PLANS            mapping plan -> { amount, receiverUpi }
//   - PAYMENT_TIME_WINDOW_MINUTES   how recent a screenshot must be
//   - MIN_OCR_CONFIDENCE_APPROVE    auto-approve confidence floor
//
// All values are env-overridable and fall back to production-safe
// defaults. Verified plans (120/500/1000) are enforced by the schema.
// ─────────────────────────────────────────────────────────────

// SINGLE authoritative plan -> amount mapping shared by the register flow
// (paymentService.createPayment) and the top-up flow (topupService). The
// client may only select a plan key; the amount is ALWAYS resolved here so a
// frontend-supplied amount can never bypass server-side pricing.
export const PLAN_AMOUNTS = { '120': 120, '500': 500, '1000': 1000 };

export const RECEIVER_UPI = process.env.ADMIN_UPI_ID || 'jayarajj126-3@okicici';

// Admin-configured receiver (payee) name. Used as a SECONDARY identity gate
// behind the receiver-UPI match (see verificationService). Empty by default:
// when no name is configured the caller must fail safe and route the payment
// to manual review rather than auto-approve. Never hardcode a real name here.
export const RECEIVER_NAME = process.env.ADMIN_RECEIVER_NAME || '';

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

// When enabled, UTRs are re-normalized (strip non-alphanumerics, uppercase)
// BEFORE the approved-UTR duplicate comparison. Off by default: screenshots
// carry their own run, so exact-match dedup keeps working and OCR-garbled
// variants remain separate. Existing behavior is the default.
export const NORMALIZE_UTRS_FOR_DUPLICATE = process.env.NORMALIZE_UTRS_FOR_DUPLICATE === 'true';

// ── Auto-approval switch (B1) ──
// PAYMENT_AUTO_APPROVE=true lets an engine-approved screenshot finalize
// straight through (approve + activate + credit). Any other value — the
// DEFAULT — falls back to external confirmation: an OCR-approved proof is
// parked status='manual_review' with decision='manual_review' and
// ocrDecision='approved' until a human confirms it (the HEAD-era posture).
// No UTR is reserved and no activation/credit runs while parked.
// Read at call time (not module load) so tests and deployments can flip it
// per-invocation without a rebuild.
export function isPaymentAutoApproveEnabled() {
  return process.env.PAYMENT_AUTO_APPROVE === 'true';
}

export const TIMEZONE = 'Asia/Kolkata';
export const IST_UTC_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// Verification time budget (bounded OCR execution).
//
// One verification attempt gets at most this much wall-clock time for ALL
// OCR work (primary pass, additional passes and the three amount-recovery
// stages). When the budget runs out the attempt fails closed with
// OCR_TIMEOUT — an inconclusive, retryable outcome that can NEVER read as an
// approval. The default sits comfortably below the 180 s HTTP request
// timeout (middleware/requestTimeout) so every request receives a real
// response instead of a gateway timeout. Measured post-optimization latency
// is ~8-16 s typical / ~60-90 s worst case locally (see audit-latency.mjs).
// ─────────────────────────────────────────────────────────────
export const OCR_VERIFICATION_BUDGET_MS = Number(process.env.OCR_VERIFICATION_BUDGET_MS || 120000);

// ─────────────────────────────────────────────────────────────
// Amount-recovery budgets (the OCR stages that try to read an amount the
// primary pass dropped).
//
// Measured with server/src/scripts/audit-recovery-stages.mjs over 8 receipt
// variants, running each stage in isolation:
//
//   stage        hits   jobs   idle-ms   loaded-ms
//   probe         4/8    100     0.5-2.8      ~4.0
//   deep          7/8    224     0.2-5.7     ~19.0
//   currency      0/8    384     5.2-6.1     ~22.3
//   full_scan     3/8    328     0.4-4.2     ~11.2
//
// The DEEP stage is the proven recovery stage (it recovers the large-font
// ₹-corrupted amounts the cheap probe misses), so it must never be cut on a
// busy host. The defaults below leave ~30% headroom over the WORST measured
// stage under load, so no proven stage is truncated on a loaded machine,
// while a pathological image can no longer spend the whole request budget.
//
//   OCR_AMOUNT_RECOVERY_BUDGET_MS — wall-clock budget for the TARGETED
//     recovery phase (top-region probe → deep region → currency region).
//     60 s covers the worst measured targeted chain (4.0 + 19.0 + 22.3 =
//     45.3 s under load) with headroom. When it runs out the expensive
//     full-height scan is skipped and an unreadable amount is reported as
//     manual_review (AMOUNT_NOT_DETECTED) instead of burning more time.
//   OCR_RECOVERY_STAGE_BUDGET_MS — cap for a SINGLE recovery stage, so one
//     pathological stage cannot consume the entire recovery budget.
//
// Both are strictly below OCR_VERIFICATION_BUDGET_MS (120 s) < the 180 s HTTP
// request timeout < the 240 s client timeout.
// ─────────────────────────────────────────────────────────────
export const OCR_AMOUNT_RECOVERY_BUDGET_MS = Number(process.env.OCR_AMOUNT_RECOVERY_BUDGET_MS || 60000);
export const OCR_RECOVERY_STAGE_BUDGET_MS = Number(process.env.OCR_RECOVERY_STAGE_BUDGET_MS || 25000);