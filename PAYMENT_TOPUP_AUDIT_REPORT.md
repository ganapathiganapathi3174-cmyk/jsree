# PAYMENT & TOP-UP PAYMENT AUDIT REPORT

Scope: registration payment flow and top-up payment flow (frontend + backend + verification engine).
Method: full code trace of every hop, targeted verification of every business rule, execution of the
full test suites before and after changes.
Constraints honoured: no commit, no push, no deploy, no production data touched, no fake data created.
Verification logic, UPI/UTR rules, the 30-minute window, status machine, approval rules, wallet rules,
referral/plan rules, DB schema and API contracts were **not** changed.

---

## 1. Executive Summary

Both flows are structurally sound: the same OCR decision engine runs for registration payments and
top-ups, expiry is enforced server-side before and after OCR, duplicate proof/UTR reuse is blocked by
unique indexes, and wallet credits are idempotent.

**19 issues were found: 4 were defects with a provable, minimal fix (all 4 fixed), 15 are documented
in §8 with no code change** because fixing them requires a product/flow decision, a config redesign,
or would alter payment/verification behaviour.

The four defects that were fixed:

| # | Severity | Area | Symptom |
|---|----------|------|---------|
| 1 | High | Registration FE | "Create New Payment Request", Back→Next and post-payment-failure retry were all dead (silent no-op) |
| 2 | Medium (security) | Payments API | `GET /payments/:id/status` and `POST /payments/:id/verify` accepted any authenticated caller (missing ownership check) |
| 3 | Medium | Top-up FE | A rejected proof was announced with a **success** toast ("Topup rejected" shown as success) |
| 4 | Low | Top-up FE | The Screenshot link was rendered twice per row |

Verification rules executed exactly as designed; no rule was found to be skipped, weakened or
mis-wired. Money-side invariants (UTR uniqueness, per-user credit idempotency, screenshot-hash
reuse) hold.

---

## 2. Registration Payment Flow

1. **`client/src/pages/RegisterPage.jsx`** — 3-step wizard.
   - Step 1 (identity) → Step 2 (plan) → Step 3 (payment).
   - `handleGoToPayment` (line 85): `POST /auth/register {name,email,mobile,password,referralCode,plan}`
     → stores `token`/`user` in `localStorage` → `POST /payments { plan: String(form.plan) }`
     → `setPaymentData` → `setStep(3)`.
   - Step 3 renders `QRPaymentSection` with `amount={form.plan}`, `upiId={serverUpi}`
     (`serverUpi` starts as the `ADMIN_UPI` constant and is replaced by
     `GET /config/public → receiver_upi`, lines 20–31), `expiresAt={paymentData.expires_at}`,
     `onVerify={handleSubmit}`, `onRecreate={handleGoToPayment}`.
   - `handleSubmit` (line 124): `POST /payments/:id/screenshot` (multipart, field `screenshot`) then
     branches on `verification.status`:
     - `approved` → refresh `GET /users/profile` → toast → `/dashboard`
     - `rejected` → `friendlyRejectionMessage(reason)` error toast → `/payment-status`
     - anything else (inconclusive / OCR failure) → toast → `/payment-status`
     - `PAYMENT_EXPIRED` → `setPaymentData(null)`; timeout → error toast; other → error toast.
2. **`client/src/components/QRPaymentSection.jsx`** — QR/URI generation, amount selector, client-side
   file gate (JPG/PNG/WEBP, ≤5 MB), countdown from `expires_at`, `handleVerify` blocks expired or
   missing screenshot, and renders `onRecreate` only when the request has expired.
3. **`server/src/routes/payments.js`** — `POST /:paymentId/screenshot` → `authenticateToken` →
   `uploadScreenshot` (multer memory storage, 5 MB, `fileFilter`) → `handleUploadError`
   (`LIMIT_FILE_SIZE` → 400 `FILE_TOO_LARGE`, other filter errors → 400 `INVALID_FILE_TYPE`).
   No `requireActiveUser` here: registration users are still `pending` and must be able to upload.
4. **`server/src/controllers/paymentController.js` → `uploadScreenshot`**:
   `NO_FILE` guard → `paymentService.uploadScreenshot(paymentId, file, userId)` →
   `paymentService.verifyPayment(paymentId, file.buffer)`; if verification throws, the error is
   recorded with `recordVerificationFailure` (fail-closed record, **status untouched so the user can
   resubmit**) and the HTTP response is still `200` with an inconclusive `verification`.
5. **`server/src/services/paymentService.js`**:
   - `createPayment` (line 160): amount from `PLAN_AMOUNTS`; blocks an existing
     `pending|manual_review` (409 `PENDING_EXISTS`) and `approved` (409 `PAYMENT_EXISTS`);
     sets `expires_at = now + PAYMENT_TIME_WINDOW_MINUTES`, `upi_id`/`receiver_upi = RECEIVER_UPI`.
   - `uploadScreenshot` (line 190): ownership (`payment.user_id !== userId` → 403 `UNAUTHORIZED`),
     submittable statuses `pending|manual_review`, **expiry gate** (410 `PAYMENT_EXPIRED`),
     SHA-256 screenshot hash vs previously **approved** rows (409 `DUPLICATE_SCREENSHOT`),
     storage upload, then `screenshot_url` + `screenshot_hash` saved.
   - `verifyPayment` (line 278): loads row, requires a screenshot, requires `ACTABLE_STATUSES`
     (`pending|manual_review`), **expiry gate pre-OCR**, runs `runScreenshotVerification`,
     applies the approved-UTR reservation policy (`applyPaymentUtrPolicy` → duplicate UTR becomes
     `rejected/DUPLICATE_UTR`), **re-checks expiry post-OCR before commit** (releases the UTR and
     rejects with `PAYMENT_EXPIRED`), writes the status with a guarded
     `update(...).in('status', ACTABLE_STATUSES)` + post-write `RACE_CONDITION` check, then either
     `completeApproval` (atomic user activation, with rollback to `pending` + UTR release on failure)
     or a non-blocking `payment_rejected` notification.
   - `autoExpireStalePayments` (line 644): sweeps expired `payments` (`pending|manual_review`) to
     `rejected/PAYMENT_EXPIRED` with notification + audit log.
6. **Admin** (`routes/admin.js`, `adminController.js`): list, approve, reject, delete, bulk-approve
   (delegates to `paymentService.approvePayment`), bulk-reject (direct `pending → rejected` update).

Status machine (payments, enforced by DB CHECK): `pending | processing | approved | rejected |
manual_review`. Only `pending|manual_review` are actionable; `manual_review` is exposed to the
frontend as `pending` so the user can resubmit.

---

## 3. Top-Up Payment Flow

1. **`client/src/pages/user/TopUps.jsx`**
   - Loads `GET /topups` → `data` + `summary` (received/sent split by `receiver_id`/`sender_id`).
   - Payment card: amount buttons (`planAmounts` = the user's plan only when it is 120/500/1000),
     optional "Attach screenshot to Pending Top-Up" selector, then `QRPaymentSection`
     (`verifyLabel="Verify Payment"`, **no `upiId` prop → falls back to the `ADMIN_UPI` constant**).
   - `handleTopupVerify(file)`:
     - no eligible pending record → `POST /topups/direct` (multipart: `screenshot`, `amount`,
       optional `receiverId = summary.sponsorId`)
     - eligible record → `POST /topups/:id/proof` (multipart: `screenshot`)
     - then `load()` to refresh the list.
   - Received tab "Submit Proof" button (only for `status === 'payment_pending'`) opens the proof
     modal → `POST /topups/:id/proof` with `screenshot` + `reference_id`.
2. **`server/src/routes/topups.js`** — `GET /`, `GET /:topupId`, `POST /:topupId/proof`,
   `POST /direct`, `POST /claim`; all `authenticateToken` + `requireActiveUser`
   (top-ups require an active account, unlike the registration upload).
   Route ordering is safe: `/:topupId/proof` cannot capture `/direct` or `/claim`.
3. **`server/src/controllers/topupController.js`**
   - `getTopupDetails` enforces sender/receiver/admin → 403 `UNAUTHORIZED` (the ownership pattern the
     payment endpoints were missing — see Bug 2).
   - `submitProof` → `topupService.submitTopupProof(topupId, file, userId)`;
     `directTopup` → `topupService.createDirectTopup({senderId, amount, receiverId, file})`.
   - Success is HTTP 200/201 with `{message, data:{topupId, credited}}`; verification **rejections are
     also HTTP 200** (the request completed, the decision was "rejected").
4. **`server/src/services/topupService.js`**
   - `createDirectTopup` (line 69): amount must be in `PLAN_AMOUNTS` **and** equal the sender's
     `current_plan`; receiver = explicit `receiverId` or `sender.referred_by`
     (`NO_SPONSOR` 400 / `RECEIVER_NOT_FOUND` 404 / `RECEIVER_INACTIVE` 400); reuses an existing
     submittable record for the (sender, receiver) pair instead of creating a duplicate, otherwise
     `createTopup` with `expires_at = now + 30 min`; no file → `{created:true, credited:false}`,
     with a file → `uploadAndVerifyTopupProof`.
   - `uploadAndVerifyTopupProof` (line 152): **expiry gate** (410 `PAYMENT_EXPIRED`), screenshot hash
     vs already **completed** top-ups (409 `DUPLICATE_SCREENSHOT`), storage upload, save
     `screenshot_url`/`screenshot_hash`, then the **same** `runScreenshotVerification` engine
     (`expectedAmount = topup.amount`, `receiverUpi = RECEIVER_UPI`), then `applyTopupVerification`.
   - `applyTopupVerification`: approved-UTR reservation first (already-reserved UTR →
     `rejected/DUPLICATE_UTR`), guarded status flip (`created|payment_pending → completed|rejected`
     with `.in(...)` so a concurrent attempt cannot double-act), then
     `creditSenderOnce` + `creditReceiverOnce`.
   - `creditSenderOnce` / `creditReceiverOnce`: each checks `wallet_transactions`
     `(user_id, reference_type, reference_id)` for an existing row before inserting → **exactly-once
     per user per top-up**, by design (code comments, commits `c19c110` / `106cf84`).
   - `submitTopupProof` (line 52): ownership (`sender_id !== userId` → 403), submittable statuses
     `created|payment_pending` (400 `TOPUP_NOT_SUBMITTABLE`), then the same upload/verify path.
   - `computeTopupSummary`: completed received top-ups vs `TOPUP_RECEIVED_REQUIRED` (= 2) →
     `mustTopup`.
5. **Expiry sweeper**: `autoExpireStalePayments` also sweeps `topups` in `created|payment_pending`
   past `expires_at` → `rejected/PAYMENT_EXPIRED` + notification (`paymentService.js:698-737`).

Status machine (top-ups, DB CHECK): `created | payment_pending | proof_submitted |
verification_pending | completed | rejected | manual_review`. The flow only ever writes
`created`, `completed`, `rejected` (plus the legacy values referenced by dead admin paths — §8.6).

---

## 4. Payment Verification Logic

Both flows call the same engine, `runScreenshotVerification`
(`server/src/services/verificationService.js`).

**Inputs**: `imageBuffer` or the stored `screenshotUrl`, `expectedAmount`, `receiverUpi`.

**OCR layer** (`ocrService.js`): shared Tesseract worker, provider-agnostic pattern extraction for
amounts, UPIs, UTRs, dates/times and transaction status.

**Evidence rules (unchanged, all re-verified):**

- `matchAmount` — extracted amount must equal expected within 0.01.
- **Currency-corruption recovery** (`verifyAmountWithCurrencyRecovery`) — 12 preprocessing strategies
  over the amount region + strip OCR; accepts only when a strategy reproduces the exact expected
  amount adjacent to a currency symbol. Bare-digit matching is deliberately removed (no false
  positives from phone numbers/UTR fragments).
- `matchUPIWithRecovery` — exact normalized match, then conservative recovery only: 1–2 character
  trailing truncation (high confidence) or masked-suffix with identical domain and ≥4-char local part
  (medium). Substitutions/transpositions are never recovered.
- **Time window** — `isSameIstDay(date, verificationTime)` **and**
  `isWithinTimeWindow(date, verificationTime, PAYMENT_TIME_WINDOW_MINUTES)`:
  the shipped production rule is *same IST day + symmetric ±30 min*
  (`verificationService.js:287-296`). A forward-only helper
  (`isWithinForwardWindow`, `ocrService.js:1128`) exists and is covered by tests, but the production
  path deliberately does not use it — the code comment documents that forward-only rejected every
  genuine receipt. Not modified (§8.13).
- **Transaction status** must be an explicit `success`.
- **UTR** must be present (`MISSING_UTR`).

**Decision engine** (`decidePaymentVerification`), gates in order, first failure wins:

1. `UPI_MISMATCH` → 2. `AMOUNT_MISMATCH` → 3. `INVALID_PAYMENT_DATE` →
4. `TRANSACTION_FAILED` → 5. `MISSING_UTR` → 6. `LOW_OCR_CONFIDENCE`
   (`ocrConfidence >= MIN_OCR_CONFIDENCE_APPROVE`, undefined fails closed) → `approved`.

**Post-decision field-confidence gate**: even an `approved` decision is downgraded to
`rejected/LOW_FIELD_CONFIDENCE` unless **all five** fields (amount, receiver UPI, UTR, date, status)
are `high` confidence (`verificationService.js:349-368`).

**Post-decision financial gates:**
- Approved-UTR reservation via `INSERT ... ON CONFLICT` on `approved_utrs.utr` (migration 007) —
  race-safe, applies to payments *and* top-ups; duplicate → `DUPLICATE_UTR` rejection.
- Expiry re-checked **after** OCR and **before** commit (payments), and **before** upload (top-ups).
- Status writes are guarded with `.in('status', ACTABLE|SUBMITTABLE)` plus a post-write
  `RACE_CONDITION` check; approval failures roll the payment back to `pending` and release the UTR.

**Where the rules come from (verified, not changed):** verification reads **environment**
configuration (`config/paymentConfig.js`: `ADMIN_UPI_ID`/`RECEIVER_UPI`, `PAYMENT_TIME_WINDOW_MINUTES`,
`MIN_OCR_CONFIDENCE_APPROVE`). The admin-editable `payment_config` rows served by
`GET /api/config/public` (`receiver_upi`, `payment_window_minutes`, `min_ocr_confidence`) are **not**
read by the verification path — see §8.3 / §8.4.

**Money invariants verified:** `wallet_transactions` partial unique index
`(user_id, reference_type, reference_id)` blocks per-user double credit; `approved_utrs` unique index
blocks concurrent same-UTR approvals; screenshot hashes block proof reuse against
approved (payments) / completed (top-ups) rows; `walletService.debit` has no caller, so there is no
spend path that could double-spend a credited balance.

---

## 5. Bugs Found

### Bug 1 — Registration payment retry/recreate was a silent no-op (High)

- **Severity:** High (user-facing dead end on the primary conversion path)
- **File:** `client/src/pages/RegisterPage.jsx`
- **Function:** `handleGoToPayment` (line 85)
- **Root cause:** the function began with `if (registeredRef.current) return;`. That flag is set to
  `true` after the first successful `POST /auth/register`, so every later invocation returned before
  issuing `POST /payments`. Consequences: (a) the "Create New Payment Request" button rendered by
  `QRPaymentSection` on expiry did nothing; (b) Back → Next on step 2 did nothing; (c) after a
  `PAYMENT_EXPIRED` upload (which clears `paymentData`) the step-3 screen stayed forever on the
  "Setting up payment request..." placeholder, because re-entering never created a payment; (d) a
  payment-creation failure right after registration could never be retried.
- **Fix:** guard re-entrancy with `if (loading) return;` (the same flag that disables the Next button
  and the recreate button) and wrap only the registration block in `if (!registeredRef.current) { ... }`,
  so registration still runs exactly once while `POST /payments` stays callable on every attempt.
  No request shape, endpoint, state or UI change.
- **Test:** `client/src/pages/RegisterPage.test.jsx` →
  *"recreates the payment request without re-registering (dead-button regression)"* — reaches step 3
  with an expired request, clicks **Create New Payment Request**, asserts `POST /payments` is issued a
  second time and `POST /auth/register` still exactly once. The 4 pre-existing tests in the file still
  pass.

### Bug 2 — Missing ownership check on payment status and manual verification (Medium, security/IDOR)

- **Severity:** Medium (authorisation defect; impact limited by UUIDv4 unpredictability of `paymentId`)
- **File:** `server/src/controllers/paymentController.js`, `server/src/routes/payments.js`
- **Function:** `getPaymentStatus`, `verifyPaymentManual` (routes lines 11–12)
- **Root cause:** both routes only used `authenticateToken`. Unlike `paymentService.uploadScreenshot`
  (which checks `payment.user_id !== userId`) and `topupController.getTopupDetails` (which checks
  sender/receiver/admin), these two handlers performed no ownership check, so any authenticated user
  holding another user's payment UUID could (a) read that payment's `verification_result`
  (OCR evidence, extracted UTR, checks) via `GET /payments/:paymentId/status`, and (b) trigger a full
  re-verification via `POST /payments/:paymentId/verify` — which mutates status, reserves a UTR and can
  flip a live `pending` payment to `rejected`. The frontend never calls either endpoint.
- **Fix:** added `paymentService.requirePaymentOwner(paymentId, requester)` (selects `user_id`, throws
  `PAYMENT_NOT_FOUND` for a missing row and `UNAUTHORIZED` for a non-owner/non-admin) and called it as
  the first statement of both handlers; `getPaymentStatus` now maps `UNAUTHORIZED → 403` (it previously
  mapped *every* error to 404) and `verifyPaymentManual` maps `UNAUTHORIZED → 403`. Verification runs
  only after the gate passes. Mirrors the existing `topupController` ownership pattern; no endpoint,
  response shape or business rule changed for legitimate owners.
- **Test:** `server/src/tests/unit/payment-ownership.test.js` (new, 7 tests) — service-level owner /
  non-owner / admin / missing-row cases, plus controller-level `403 UNAUTHORIZED` for both endpoints and
  proof that `verifyPaymentManual` touches the database only once (the ownership lookup) when the
  caller is not the owner.

### Bug 3 — A rejected top-up proof was announced as a success (Medium)

- **Severity:** Medium (user is told a refused payment succeeded, so they never retry)
- **File:** `client/src/pages/user/TopUps.jsx`
- **Function:** `handleProof`, `handleTopupVerify`
- **Root cause:** `topupController.submitProof` / `directTopup` return **HTTP 200** for a verification
  that completed with a `rejected` decision (the HTTP call succeeded; the decision is in
  `message`/`data.credited`). `handleProof` discarded the response and always toasted
  `'Proof submitted!'`, and `handleTopupVerify` always toasted `res.data.message` / a fixed success
  string through `toast.success` — so the server's own `'Topup rejected'` (and
  `'Topup rejected: duplicate UTR...'`) was shown as a green success toast.
- **Fix:** added `announceProofResult(message, fallback)` which routes the server message to
  `toast.error` when it reports a rejection and to `toast.success` otherwise, and used it for all three
  call sites (proof modal, direct upload, pending-record upload). Only the toast type changed; no
  request, status handling or refresh behaviour was touched.
- **Test:** `client/src/pages/user/TopUps.test.jsx` (new) →
  *"reports a rejected proof as an error toast, not a success toast"* and
  *"reports an approved proof as a success toast"* (regression guard for the happy path).

### Bug 4 — Duplicate Screenshot link rendered per top-up row (Low)

- **Severity:** Low (cosmetic/UX defect in the payment list)
- **File:** `client/src/pages/user/TopUps.jsx`
- **Function:** the top-up list renderer (`list.map`, formerly lines 188–196)
- **Root cause:** the identical `{t.screenshot_url && <a ...>Screenshot</a>}` block was present twice
  per row (before and after the conditional "Submit Proof" button), so every row with a screenshot
  rendered two identical links.
- **Fix:** removed the second duplicate block; the first one is unchanged.
- **Test:** `client/src/pages/user/TopUps.test.jsx` →
  *"renders exactly one Screenshot link per top-up row"*.

---

## 6. Changes Made

**Modified (5):**

- `client/src/pages/RegisterPage.jsx` — Bug 1: re-entrancy guard switched from `registeredRef` to
  `loading`; registration wrapped in `if (!registeredRef.current)`; `POST /payments` always runs.
- `client/src/pages/RegisterPage.test.jsx` — added the dead-button regression test.
- `client/src/pages/user/TopUps.jsx` — Bugs 3 and 4: `announceProofResult` used by all three proof
  call sites; duplicate Screenshot anchor removed.
- `server/src/controllers/paymentController.js` — Bug 2: `requirePaymentOwner` called first in
  `getPaymentStatus` and `verifyPaymentManual`; `403 UNAUTHORIZED` mapping added to both.
- `server/src/services/paymentService.js` — Bug 2: new `requirePaymentOwner` helper (13 lines).

**Added (2):**

- `server/src/tests/unit/payment-ownership.test.js` — 7 regression tests for the ownership gate.
- `client/src/pages/user/TopUps.test.jsx` — 3 regression tests for the toast outcome and duplicate link.

Untracked files left exactly as found: `PROJECT_LOGIC_REPORT.md` (previous deliverable),
`server/src/tests/unit/diagnostic-full-verification.test.mjs` (pre-existing, must not be committed).
**Nothing was committed, pushed or deployed.**

---

## 7. Tests

Commands executed from the repository root (PowerShell):

```
# server — baseline BEFORE any fix
cd server; npx vitest run            -> saved to $env:TEMP\audit-before.txt

# client (edits + new FE tests)
cd client; npx vitest run            -> saved to $env:TEMP\audit-client.txt

# server — after fixes + new ownership test
cd server; npx vitest run            -> saved to $env:TEMP\audit-after.txt and audit-after2.txt

# isolating the pre-existing flaky suite
cd server; npx vitest run src/tests/unit/seed-default-users.test.js
```

**Results**

| Run | Test files | Tests |
|-----|-----------|-------|
| Server baseline (before fixes) | 6 failed \| 33 passed (39) | 1 failed \| 1088 passed (1089) |
| Server after fixes (run 1) | 6 failed \| 34 passed (40) | 5 failed \| 1091 passed (1096) |
| Server after fixes (run 2) | 6 failed \| 34 passed (40) | **1 failed \| 1095 passed (1096)** |
| Client after fixes | **3 passed (3)** | **11 passed (11)** |
| `seed-default-users.test.js` alone | 1 passed | **9 passed (9)** |

- **+7 tests = the 7 new ownership tests, all passing.** Client 11/11 include the 4 pre-existing
  RegisterPage tests, the new dead-button test and the 3 new TopUps tests.
- The same **6 server files fail before and after** and none of them is affected by this audit:
  `cache`, `helpers`, `pagination` fail with *"No test suite found"* (node:test-style files, pre-existing),
  `api`, `business-rules` need a live database (pre-existing), and
  `seed-default-users.test.js` is a pre-existing 5-second-timeout flake — it passed **9/9 in isolation**.
  Run 1 (5 failures in that one file) was pure load noise; run 2 reproduces the baseline exactly
  (1 timeout failure) with all 7 new tests green.
- The diagnostic file `server/src/tests/unit/diagnostic-full-verification.test.mjs` remains untracked
  and untouched.

**No lint/typecheck script exists in this repository** (client and server define only `test`/
`build`/`dev` scripts); vitest is the gate used by this project.

---

## 8. Unfixed Issues

Documented only — no code was changed, because each one needs a product decision, a configuration
consolidation, or would alter payment/verification/flow behaviour.

1. **No retry path after a rejected registration payment (High, FE flow).** After
   `verification.status === 'rejected'` the page navigates to `/payment-status`, which is view-only
   (`PaymentStatus.jsx` has no upload or create action), and the payment row is now `rejected` so
   `POST /payments/:id/screenshot` would return 400 `PAYMENT_NOT_PENDING`. The user's account stays
   `pending` with no in-app way to pay again. Fixing needs a decided retry entry point (e.g. keep the
   user on step 3 and offer "Create New Payment Request" unconditionally) — a flow change, not a
   one-line patch.
2. **Expired-but-not-yet-swept record blocks recreation (Medium, BE).** `createPayment` blocks on
   `status IN ('pending','manual_review')` without looking at `expires_at`, so for up to ~5 minutes
   after the 30-minute window closes (the sweeper is a `setInterval` in `index.js:101-110` and is
   **not run at startup**) a "Create New Payment Request" attempt returns 409 `PENDING_EXISTS`.
   Top-ups behave the same way for `created|payment_pending` (410 `PAYMENT_EXPIRED` on reuse until the
   sweep rejects the row). Bounded and self-healing; fixing it means changing the payment state machine
   or starting the sweeper at boot.
3. **Three sources of truth for the receiver UPI (Medium, config drift).**
   Verification uses env `ADMIN_UPI_ID`/`RECEIVER_UPI` (`config/paymentConfig.js`); the registration QR
   uses DB `payment_config.receiver_upi` served by `GET /api/config/public`; the top-up QR uses the
   hardcoded `ADMIN_UPI` constant in `client/src/utils/constants.js`. If an admin edits
   `receiver_upi` in the DB, the displayed QR pays a different VPA than the verifier expects and every
   payment is rejected with `UPI_MISMATCH`.
4. **Admin-editable verification knobs are ignored (Low/Medium).**
   `payment_config.payment_window_minutes` and `payment_config.min_ocr_confidence` are served by
   `/config/public` but verification reads env `PAYMENT_TIME_WINDOW_MINUTES` /
   `MIN_OCR_CONFIDENCE_APPROVE`. Editing them in the admin panel changes nothing.
5. **`payment_pending` is never written (Low, dead UI).** No server code sets top-up
   `status = 'payment_pending'`, so the received-tab "Submit Proof" button and its proof modal in
   `TopUps.jsx` (condition `status === 'payment_pending'`) can never render; that proof path
   (`reference_id` input) is unreachable.
6. **Dead admin/legacy top-up paths (Low).** `verifyTopup` / `completeTopup` / `rejectTopup` are not
   wired to any route and only accept `proof_submitted|verification_pending|manual_review` — statuses
   nothing produces; `verifyTopup`'s approve branch also sets the **receiver** to `inactive`
   (`inactive_due_to_referral_condition`), a legacy rule the current flow does not apply.
   `adminController` has only list/delete for top-ups.
7. **`TOPUP_EXISTS` → HTTP 500 (Low).** `topupController.directTopup` has no mapping for
   `TOPUP_EXISTS`, so the concurrent-create race in `createTopup` would return 500 instead of 409.
   Effectively unreachable in normal flow because `createDirectTopup` reuses an existing row first.
8. **`DUPLICATE_UTR` → HTTP 500 (Low).** `adminController.approvePayment` (line 78) and the
   reject/delete siblings have no `DUPLICATE_UTR` mapping. Defensive path only (normal approvals carry
   no UTR).
9. **Bulk actions are inconsistent with single actions (Low, admin).** `bulk-reject` accepts only
   `status === 'pending'`, so `manual_review` rows (shown as "pending" in the UI) are silently
   `skipped`; neither bulk path sends the `payment_rejected` notification that
   `paymentService.rejectPayment` sends.
10. **Admin approval ignores expiry (Low).** `paymentService.approvePayment` gates on
    `ACTABLE_STATUSES` but never calls `isPaymentExpired`, so an admin (including bulk approve) can
    activate a user on a payment whose 30-minute window has closed. Likely an intentional override,
    but it is not documented as one.
11. **Top-up credit crash window (Medium, narrow).** `applyTopupVerification` flips the status to
    `completed` *before* calling `creditSenderOnce`/`creditReceiverOnce`. A transient DB error between
    the flip and the credit leaves a `completed` top-up that is never credited, and a resubmission then
    fails with 400 `TOPUP_NOT_SUBMITTABLE` — the reconciliation branch written for this case is only
    reachable from a concurrent duplicate submission. Recovery requires manual admin action.
12. **Stale decision comment (Low, docs).** `topupService.js:195-198` states "Amount is NOT part of
    that decision"; the shared engine's Gate 2 rejects `AMOUNT_MISMATCH`, so the comment is wrong and
    could mislead future work. Comment-only, not changed.
13. **Dead/duplicated verification helpers (Info).** `verification_attempts` is never written;
    `isWithinForwardWindow` is only exercised by tests (production uses the symmetric ±30-min window);
    `payment_pending`-style statuses in `verifyTopup`/`claimTopup` reference values the current flow
    never writes. Removal would touch the verification module, so it was left alone.
14. **Top-up QR amount can diverge from the record amount (Medium, FE).** `TopUps.jsx` seeds
    `payAmount` from the user's plan and never from `eligibleForProof[0]`, while the target selector
    only re-syncs on an explicit change (`handlePayTargetChange`). After a plan change the QR can show
    ₹120 while the pending record is ₹500. Fixing it requires deriving the default from the selected
    record (a UI-state change beyond the minimal patch scope).
15. **Top-up summary/claim UI is inert (Low).** `computeTopupSummary` hardcodes
    `receivedPendingCount: 0`, `receivedClaimableCount: 0`, `canClaim: false`, so the "ready to claim" /
    "waiting" copy never renders and the `POST /topups/claim` endpoint is never called by the client.

---

AUDIT COMPLETE
BUGS FOUND: 19
BUGS FIXED: 4
FILES MODIFIED: 7
TESTS PASSED: 1106 (server 1095/1096, client 11/11; the single failure is a pre-existing flaky seed timeout that passes 9/9 in isolation)
PAYMENT LOGIC PRESERVED: YES
TOP-UP LOGIC PRESERVED: YES
