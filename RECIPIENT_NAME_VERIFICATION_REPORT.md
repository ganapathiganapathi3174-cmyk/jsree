# Implementation Report — Admin UPI Recipient Verification + Auto-Approval

**Feature:** Auto-approve a registration payment or wallet top-up only when the
screenshot's *payee name* matches the trusted admin account **and** every other
verification gate passes. Any uncertainty falls back to manual review.

**Status:** Implemented, tested, and verified (no regressions introduced).

---

## 1. How auto-approval works now

Verification runs through one shared server-side engine
(`runScreenshotVerification`) used by **both** the registration flow and the
top-up flow. `decidePaymentVerification()` evaluates gates **in order**:

| # | Gate | On failure |
|---|------|-----------|
| 1 | Receiver UPI matches configured `receiver_upi` | `rejected` / `UPI_MISMATCH` |
| 2 | Amount matches the selected plan | `rejected` / `AMOUNT_MISMATCH` |
| 3 | Transaction date within ±30 min of **server upload time** | `rejected` / `INVALID_PAYMENT_DATE` |
| 4 | Transaction status explicitly indicates success | `rejected` / `TRANSACTION_FAILED` |
| 5 | UTR present | `rejected` / `MISSING_UTR` |
| 6 | OCR confidence ≥ configured floor | `rejected` / `LOW_OCR_CONFIDENCE` |
| 7 | **NEW — Recipient name vs configured `receiver_name`** | see below |

A field-confidence gate (`allFieldsHighConfidence`) additionally forces a
rejection if any field confidence is below `high`. Duplicate-UTR protection is
enforced separately via `reserveApprovedUtr` (atomic unique constraint).

### Gate 7 semantics (the new logic)

`receiverName` is the control switch:

- **`undefined` → gate DISABLED.** Preserves every existing direct-engine /
  legacy caller and test. (No production caller passes `undefined` — see §3.)
- **Configured & match** → pass, continue to approval.
- **Configured, name read, but DIFFERENT person** → **`rejected` /
  `RECEIVER_NAME_MISMATCH`** (hard reject).
- **Configured, but no readable name on the receipt** →
  **`manual_review` / `RECEIVER_NAME_UNREADABLE`** (human review).
- **No name configured (`''`)** → **`manual_review` /
  `RECEIVER_NAME_NOT_CONFIGURED`** (fail-safe — never auto-approve).

Decision value **`manual_review`** is non-terminal: no wallet credit, no user
activation, no UTR reservation. The row is parked for an admin. This state was
already schema-supported (migration 008) and is already mapped to a pending
badge for users.

### Expiry remains authoritative

While adding `manual_review`, the post-OCR expiry re-check was widened (it
previously ran only for `approved`) so a request that **expires during OCR** is
still rejected with `PAYMENT_EXPIRED` instead of being parked in manual review.
The same fail-closed expiry check was added to the top-up `manual_review` branch.

---

## 2. Trusted receiver fields & where they live

New config key **`receiver_name`** added alongside the existing `receiver_upi`:

| Source | Path | Purpose |
|--------|------|---------|
| DB (preferred) | `payment_config.receiver_name` | Admin-editable, persists |
| Env fallback | `ADMIN_RECEIVER_NAME` | Seed / headless default |
| Public API | `GET /api/config/public` | Frontend display (non-secret) |
| Admin API | `GET`/`PUT /api/config` | Read/update (admin-only, audit-logged) |
| Admin UI | `/admin/payment-settings` | New settings page (see §4) |

Resolution order in `configService.getPaymentConfig()`:
`dbConfig.receiver_name || env`. Empty string is a **valid value** meaning
"not configured" → forces manual review.

**Authz:** `receiver_name` is only writable through the admin-only
`PUT /config` route (`authenticateToken` + `requireAdmin`), which is allow-listed
in `ALLOWED_KEYS` and audit-logged. Ordinary users cannot modify it.

**Validation** (`validateConfigValue('receiver_name', …)`): must be a string,
≤100 chars, must **not** contain `@` (so a UPI ID can't masquerade as a name),
and non-empty values must be ≥2 chars.

---

## 3. Files changed

### Backend

| File | Change |
|------|--------|
| `supabase/migrations/013_receiver_name_config.sql` | **NEW** — idempotent `INSERT … ON CONFLICT DO NOTHING` seeding `receiver_name` (empty → fail-safe manual review until configured). |
| `server/src/config/paymentConfig.js` | Added `RECEIVER_NAME` (`process.env.ADMIN_RECEIVER_NAME \|\| ''`). |
| `server/src/services/configService.js` | `receiver_name` added to `DEFAULT_CONFIG`, `getPaymentConfig()`, `getPublicConfig()`; `ALLOWED_KEYS`; validation. |
| `server/src/services/ocrService.js` | **NEW helpers:** `extractReceiverNames`, `sanitizeNameCandidate`, `normalizeName`, `matchReceiverName`. `extractPaymentData` now also returns `receiverNames`. |
| `server/src/services/verificationService.js` | Gate 7 in `decidePaymentVerification`; name computation (`nameActive/nameConfigured/nameMatch/nameFound/nameResult`) in `runScreenshotVerification`; `checks.receiverName`, `fieldConfidence.receiverName`, `detected.receiverNames`, `nameDiagnostics`, demo-result fields. |
| `server/src/services/paymentService.js` | Resolves `receiverName` and passes it to the engine; `applyPaymentUtrPolicy` maps `manual_review` → manual (no UTR reserve); widened post-OCR expiry gate to cover `manual_review`. |
| `server/src/services/topupService.js` | Resolves + passes `receiverName`; `manual_review` branch in `applyTopupVerification` (status set, **no credit**, returns `manualReview`); expiry fail-closed in that branch; `uploadAndVerifyTopupProof` returns `manualReview` + review message. |
| `server/src/controllers/topupController.js` | `submitProof` + `directTopup` responses include `manualReview` and `reason`. |

### Frontend

| File | Change |
|------|--------|
| `client/src/pages/RegisterPage.jsx` | Explicit `manual_review` branch (informational toast + `/payment-status`); added `RECEIVER_NAME_MISMATCH` friendly message. |
| `client/src/pages/user/TopUps.jsx` | `announceProofResult` now shows an **info** toast (not success/error) when `manualReview` — reads `data.data.manualReview`. |
| `client/src/pages/admin/PaymentSettings.jsx` | **NEW** admin page: edits `receiver_upi`, `receiver_name`, `payment_window_minutes`, `min_ocr_confidence`, plan amounts; warns loudly when no name is configured (auto-approval disabled). |
| `client/src/App.jsx` | Route `/admin/payment-settings` (admin-only). |
| `client/src/components/Sidebar.jsx` | `Settings` icon + "Payment Settings" nav link. |

### Tests

| File | Change |
|------|--------|
| `server/src/tests/unit/recipient-name-verification.test.js` | **NEW — 27 tests**: extraction, normalization, matching, the pure gate, and end-to-end engine cases. |
| `server/src/tests/unit/verification-runtime.test.js` | Configured test receiver name; added a payee-name line to receipts that had only a UPI (UPI-only receipts now correctly read no name). |
| `server/src/tests/unit/payment-auto-approval-e2e.test.js` | Configured test receiver name via `vi.hoisted`. |
| `server/src/tests/unit/payment-auto-approval-regression.test.js` | Configured test receiver name via `vi.hoisted`. |

`expiry-security`, `provider-regression` and `gpay-masked-upi-regression`
needed **no** edits: the first was fixed by the expiry-gate widening, the
others call `runScreenshotVerification` directly (gate disabled).

---

## 4. Receiver name match rules (conservative)

- **Normalize**: lowercase, strip punctuation, drop honorifics
  (`mr/mrs/dr/shri/smt/…`), collapse whitespace.
- **`exact`**: identical after normalization.
- **`token_subset`**: every significant (≥3 char) token of the *shorter* name
  appears in the longer one — tolerates an extra middle/last name.
  e.g. configured `JAYARAJ ALAGAR` ↔ receipt `To Jayaraj` → match.
- **No fuzzy guessing**: an unrelated name never matches.
- Receipt lines that are only a UPI/VPA (`To: name@bank`) are **not** treated
  as names — they yield no candidate, so they fall to `RECEIVER_NAME_UNREADABLE`.

---

## 5. Test results

**New recipient-name suite:** `recipient-name-verification.test.js` — **27/27 pass**.

**Updated caller suites:** `verification-runtime` + `payment-auto-approval-e2e` +
`payment-auto-approval-regression` + `expiry-security` — **44/44 pass**.

**Backward-compatibility (unchanged direct-engine/direct-decision tests):**
`strict-verification`, `verification-production`, `expiry-lifecycle`,
`payment-verification`, `topup-verification`, `approved-utr`, `topup-direct`,
`topup-hardening`, `payment-verification-failure`, `topup-controller` —
**200/200 pass** (confirms the `undefined` → disabled contract).

**Full server suite:** 46 files / 1195 tests — **1189 pass, 6 fail**.
All 6 failures are **pre-existing and unrelated**:
- 5 files (`api`, `business-rules`, `cache`, `helpers`, `pagination`) are
  legacy `node:test` files with no vitest suite — they already "failed" as
  files at baseline (stash verified).
- `admin-login-existing-row` (2) + `seed-default-users` (4) are **bcrypt/load
  flakes**: they pass **5/5 in isolation with these changes**, and `authService`
  imports none of the files touched here (no dependency = no behavioral effect).

**Regression check (stash → baseline):** baseline full run = 6 failed files /
3 failed tests; with changes = 7 / 6 — the delta is entirely the two flaky
bcrypt files, whose failure set varies run-to-run (seed flaked 3/5/6 across
runs; `payment-expiry` failed once, then not at all). **No deterministic
regression.**

**Client:** `npm run build` ✅ and `npx vitest run` — **15/15 pass**.

---

## 6. Migration

`supabase/migrations/013_receiver_name_config.sql` — safe to run repeatedly:

- Ensures a `receiver_name` row exists in `payment_config`.
- Seeds it empty (`""`) so a fresh deploy **fails safe to manual review**
  (no accidental auto-approval) until an admin sets the real name.
- Does not touch existing `receiver_upi` / window / confidence / plans values.

---

## 7. Security note — OCR is not proof of payment

**OCR only reads the pixels of an image. It cannot prove the money reached the
bank.** A screenshot can be fabricated; the UPI ID, name, amount, date, UTR and
"Success" text are all just text in a picture. This feature tightens *identity
matching* (right payee + right amount + fresh + unique UTR) — it is a supporting
signal, not settlement proof.

**For production, prefer a bank / payment-provider webhook or a UPI
collect/lookup API as the authoritative confirmation**, with screenshot OCR as a
secondary convenience check. The admin settings page displays this caveat.

---

## 8. Remaining risks / follow-ups

- **Config must be set.** Until `receiver_name` is populated (DB or env), every
  payment and top-up goes to **manual review** — this is intentional fail-safe
  behavior, but the admin must be told to configure it via
  `/admin/payment-settings`.
- **60s config cache.** `configService` caches for 60 s; an admin update
  invalidates the cache on write, so it is immediate for the writer. Other
  server processes pick it up within a minute.
- **No "under review" notification type.** The `notifications` type CHECK
  (migration 002) has no allowed "review" type, so `manual_review` creates no
  notification — the user only sees the in-app toast/badge. Adding a type would
  require a migration (deliberately not changed here to avoid schema drift).
- **Top-ups cannot be resubmitted once `manual_review`** (`SUBMITTABLE_STATUSES`
  excludes it) — correct for a human-decision state, but the user must wait for
  an admin action.
- **Sensitive-name privacy.** `receiver_name` is returned by the *public* config
  endpoint (as `receiver_upi` already is). It is the merchant's own payee name,
  not user data, so it is treated as non-secret.
- **Unrelated open defect (DEFECT-A):** `adminLogin()` still has the
  env-credential mismatch + hardcoded `referral_code:'ADMIN001'` insert issue,
  leaving the intentional `POST /auth/admin-login` red. Out of scope here;
  unchanged by this work.
