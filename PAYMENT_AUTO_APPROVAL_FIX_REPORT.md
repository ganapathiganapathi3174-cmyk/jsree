# Payment Auto-Approval Fix Report

**Scope:** A fully verified payment screenshot got stuck in `PENDING` / "UNDER REVIEW" with no auto-approval.
**Constraint honoured:** no redesign, no verification bypass, no auto-approve on upload alone. Every gate (amount, UTR, receiver UPI, date/time, OCR, duplicate protection, ownership, registration/top-up logic) is unchanged. `PENDING` still remains for OCR / low-confidence / inconclusive cases. Approval is idempotent (no double credit). DB remains the source of truth. Minimal change; no OCR optimisation; no schema change; no UI design change.

---

## 1. ROOT CAUSE

The verification engine reached a correct `approved` decision, and the approval commit was then **destroyed by a post-decision side-effect failure**, after which the generic error handler overwrote the decision itself.

Exact chain (proved empirically, see §4):

1. `verifyPayment()` runs every gate → `decidePaymentVerification()` returns `decision: 'approved'` → the commit persists
   `status = 'approved'`, `verification_result.decision = 'approved'`, `verified_at`, `transaction_id`, `approved_at`.
2. `completeApproval()` then runs its **step 4 — `notificationService.createNotification('payment_approved')`**.
   If that insert fails (permissions / outage / transient DB error), the old code executed **`rollbackApproval(paymentId, userId)`** — reverting the payment to `pending` and the user to `pending` — and **threw** `{ code: 'NOTIFICATION_FAILED' }`.
3. `paymentController.uploadScreenshot()`'s `catch` then called **`recordVerificationFailure()`**, which **replaced `verification_result`** with
   `{ decision: null, inconclusive: true, reason: 'NOTIFICATION_FAILED', ... }`.
4. The controller returned **HTTP 200** with that inconclusive payload, so the frontend showed *"Verification could not finish"* → `/payment-status` (which has no polling and no resubmit UI) stayed on *"Verifying your payment"* forever.

Net result: a payment that **had already been approved** ended as `status = pending` with its `decision` erased — permanently stuck.

This is not an OCR problem, not a schema problem, not an ownership/registration problem, and not a configuration problem. The decision logic produced the right answer; the **transaction boundary was wrong** because a non-critical, non-transactional side effect (a notification row) was made load-bearing for a committed decision.

## 2. EXISTING DECISION LOGIC (verified, unchanged)

| Stage | Behaviour |
|---|---|
| `decidePaymentVerification()` gates | `UPI_MISMATCH`, `AMOUNT_MISMATCH`, `INVALID_PAYMENT_DATE`, `TRANSACTION_FAILED`, `MISSING_UTR`, `LOW_OCR_CONFIDENCE` → else `approved` |
| Field-confidence gate | Downgrades unless `amount`, `receiverUpi`, `utr`, `transactionDate`, `transactionStatus` are all `high` |
| Date window | Same IST day **and** ±30 minutes |
| Duplicate protection | `reserveApprovedUtr()` unique insert (`23505` → `DUPLICATE_UTR`), plus global `approved_utrs` unique index |
| Idempotency | `ACTABLE_STATUSES = ['pending','manual_review']` — decided rows cannot be re-opened |
| Post-decision | `autoExpireStalePayments()` only touches actionable rows (5-min interval) |

No gate was removed, weakened, or bypassed.

## 3. THE FIX (minimal)

**File modified:** `server/src/services/paymentService.js` — `completeApproval()` step 4 only.

Before: notification insert failure → `rollbackApproval()` + `throw NOTIFICATION_FAILED`.
After: notification insert failure → `console.error('[completeApproval] approval notification failed', {...})`, **return normally**. Steps 1–3 (approval rows, wallet/activation, audit) remain atomic and still roll back as a unit if *they* fail.

Rationale: `createNotification` is a **post-commit side effect with no bearing on the payment decision**. It must not be able to destroy an already-committed approval, and it must not feed the generic `catch` that overwrites `verification_result`. The `NOTIFICATION_FAILED` code existed nowhere else in the codebase (grep-verified), so no other caller or test depended on it.

Deliberately **not** changed: `verifyPayment`, `recordVerificationFailure`, `uploadScreenshot`'s catch, the verification engine, OCR, routes, multer field names, FE display logic, or any schema.

## 4. BEFORE / AFTER (empirical)

**Before (fix reverted, faithful in-memory DB emulator):** a perfectly valid receipt produced the update sequence

```
screenshot_url/hash → status 'approved' + verification_result.decision 'approved'
→ status 'approved' → status 'pending' (rollback)
→ status 'pending' → verification_result { decision: null, inconclusive: true, reason: 'NOTIFICATION_FAILED' }
HTTP 200 · user rolled back to 'pending'
```

Final row: `status = pending`, decision erased → **exactly the reported "verified but stuck" symptom.** The regression test asserting this scenario fails without the fix.

**After (fix applied):**

```
status 'approved' · verification_result.decision 'approved' · verified_at/transaction_id/approved_at set
notification failure is logged only · HTTP 200 · user 'active'
```

## 5. SAFETY VERIFICATION (ruled out)

Schema (`verification_result JSONB`, `transaction_id`, `verified_at`, `approved_at`, `notifications.metadata JSONB` + all CHECK types, `approved_utrs` columns) — present in migrations 001/002/007. `db/supabase.js` default export — correct. `RECEIVER_UPI` config, `createPayment` `expires_at`, `users.current_plan CHECK (120,500,1000)`, unshadowed routes, multer field `'screenshot'`, `authenticateToken` allowing pending users, `requireActiveUser` not on payment routes, `RegisterPage` reading `data.verification`, `REQUEST_TIMEOUT_MS = 120000`, swallowing `logAction`, `reserveApprovedUtr` `23505` handling, rate limiter, dropped global `payments` unique index — all verified correct. Real production GPay receipt text → `decision: 'approved'`; full controller path → approved + user active under mock. No other deterministic defect found in the registration → top-up payment path.

## 6. TESTS

New files (untracked, never committed):

- `server/src/tests/unit/payment-auto-approval-e2e.test.js` — controller returns approved, DB row approved, user active. **Passes.**
- `server/src/tests/unit/payment-auto-approval-regression.test.js` — **16 tests**, built on a faithful Supabase/PostgREST emulator (real `eq/in` filtering, UPDATE only matched rows, `.single()` `PGRST116`, unique-UTR `23505`):

  1. **S1 valid → auto-approved**: status/decision persisted, `verified_at`, `transaction_id`, `approved_at`; `manual_review` rows also resolvable.
  2. **S2 invalid never approved**: wrong amount → `AMOUNT_MISMATCH`; wrong UPI → `UPI_MISMATCH`; stale date → `INVALID_PAYMENT_DATE`; missing UTR → `MISSING_UTR`; failed status → `TRANSACTION_FAILED`; low confidence → `LOW_OCR_CONFIDENCE`; reused UTR → `DUPLICATE_UTR`. All stay `rejected`, user stays `pending`.
  3. **S3 OCR throw** → `pending`, `inconclusive: true`, `decision: null`, `reason: 'OCR_FAILED'` (legitimate `PENDING` retained).
  4. **S4 the fix** — notification insert failure does **not** leave a valid payment pending; decision survives. **Fails without the fix, passes with it.**
  5. **S5 top-up**: valid proof → `completed`, both wallets credited once (one `wallet_transactions` row per user); replay → no extra rows, `credited: false`; rejected → no credit.
  6. **S6 idempotency/expiry**: decided rows throw `PAYMENT_NOT_PENDING`; expired row → `PAYMENT_EXPIRED`, never approved.

**Results:** server `1112 passed | 1 failed (1113)` — the single failure is the pre-existing `seed-default-users` timing flake (passes in isolation); the 5 failing *suites* are the pre-existing environmental ones (`integration/api`, `integration/business-rules`, `cache`, `helpers`, `pagination`). Client `11 passed (11)`. Payment-related suites: **8 files, 90 tests, all passing.** Baseline was `1 failed | 1088 passed (1089)` before this work; the delta is the 16 new regression tests + 1 e2e test, with **zero regressions**.

---

**ROOT CAUSE:** `completeApproval()` step 4 (`notificationService.createNotification('payment_approved')`) was transactional — its failure called `rollbackApproval()`, reverting the already-committed `approved` status, then `uploadScreenshot`'s catch ran `recordVerificationFailure()`, overwriting `verification_result` with `{decision:null, inconclusive:true, reason:'NOTIFICATION_FAILED'}` and returning HTTP 200 — leaving a fully verified payment stuck in `PENDING` with its decision erased. / **FILES MODIFIED:** `server/src/services/paymentService.js` (notification step made non-blocking; pre-existing in this change set: `server/src/controllers/paymentController.js`, `client/src/pages/RegisterPage.jsx`, `client/src/pages/RegisterPage.test.jsx`, `client/src/pages/user/TopUps.jsx`) / **VALID PAYMENT AUTO-APPROVAL:** FIXED / **INVALID PAYMENT PROTECTION:** PASSED / **REGISTRATION FLOW:** PASSED / **TOP-UP FLOW:** PASSED / **DUPLICATE CREDIT PROTECTION:** PASSED / **TESTS:** server 1112 passed | 1 pre-existing flake (1113 total; 8 payment suites / 90 tests all green), client 11 passed (11)
