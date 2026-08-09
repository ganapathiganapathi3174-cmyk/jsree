# BUG TRACKER — ReferralHub Platform

## Summary

| Severity | Found | Fixed | Remaining |
|----------|-------|-------|-----------|
| P0 BLOCKER | 0 | 0 | 0 |
| P1 CRITICAL | 6 | 6 | 0 |
| P2 HIGH | 6 | 6 | 0 |
| P3 MEDIUM | 0 | 0 | 0 |
| P4 LOW | 0 | 0 | 0 |
| **TOTAL** | **12** | **12** | **0** |

---

## P1 CRITICAL BUGS

### BUG-001: RegisterPage never uploads screenshot
- **Module:** Frontend — `RegisterPage.jsx`
- **Issue:** `handleSubmit` sends only JSON to `/auth/register`, screenshot file is collected but silently discarded
- **Impact:** Payment screenshot never reaches server
- **Root Cause:** No FormData upload — only `api.post('/auth/register', payload)` with JSON
- **Fix:** Chained three API calls: register → createPayment → uploadScreenshot (as FormData)
- **Regression Test:** E2E test Phase 3 — upload succeeds, verification returns
- **Status:** FIXED

### BUG-002: paymentController.uploadScreenshot missing userId
- **Module:** Backend — `paymentController.js:34`
- **Issue:** `paymentService.uploadScreenshot(paymentId, req.file)` — missing 3rd arg `req.user.id`
- **Impact:** Ownership check always fails (undefined !== uuid), upload returns 403
- **Root Cause:** Controller only passed 2 args, service expects 3
- **Fix:** Changed to `paymentService.uploadScreenshot(paymentId, req.file, req.user.id)`
- **Regression Test:** E2E test Phase 3 — upload succeeds with correct user
- **Status:** FIXED

### BUG-003: verifyPayment never called after upload
- **Module:** Backend — `paymentController.js`
- **Issue:** After upload, controller returns success without calling verification
- **Impact:** Payment stays `pending` forever, no auto-approve/reject
- **Root Cause:** No verification trigger in controller
- **Fix:** Controller now calls `paymentService.verifyPayment(paymentId, req.file.buffer)` after upload
- **Regression Test:** E2E test Phase 3 — verification decision returned
- **Status:** FIXED

### BUG-004: verifyPayment only saves result JSON, never sets status
- **Module:** Backend — `paymentService.js:103-105`
- **Issue:** `verifyPayment` saves `verification_result` and `verified_at` but never sets `status`
- **Impact:** No auto-approve/reject, payment stuck in pending
- **Root Cause:** Missing status update in verifyPayment
- **Fix:** Now sets `status: 'approved'` or `status: 'rejected'` based on verification decision
- **Regression Test:** E2E test Phase 4 — DB status = approved after verification
- **Status:** FIXED

### BUG-005: OCR runs on URL instead of image buffer
- **Module:** Backend — `paymentService.js:62-64`
- **Issue:** `Tesseract.recognize(payment.screenshot_url, 'eng')` — tries to OCR from Supabase URL
- **Impact:** Tesseract may fail fetching from URL, OCR unreliable
- **Root Cause:** Using URL instead of buffer
- **Fix:** Now passes `imageBuffer` directly to Tesseract via `runOCR(buffer)`
- **Regression Test:** E2E test Phase 2 — OCR returns text with 68-71% confidence
- **Status:** FIXED

### BUG-006: Export/receipt services use wrong column names
- **Module:** Backend — `exportService.js`, `paymentReceiptService.js`, `suspiciousActivityService.js`
- **Issue:** Queries `name` (should be `full_name`), `phone` (should be `mobile`), `amount` (should be `expected_amount`), `utr_number` (should be `transaction_id`), `months` (should be `plan`), `users.ip_address` (doesn't exist)
- **Impact:** CSV export, receipts, and suspicious activity detection all fail
- **Root Cause:** Column names don't match database schema
- **Fix:** Updated all column references to match live schema
- **Regression Test:** Syntax check passes, server starts clean
- **Status:** FIXED

---

## P2 HIGH BUGS

### BUG-007: Skeleton.jsx broken import path
- **Module:** Frontend — `components/Skeleton.jsx:1`
- **Issue:** `import { useTheme } from '../../contexts/ThemeContext'` — resolves to non-existent path
- **Impact:** Skeleton component crashes at import
- **Root Cause:** Extra `../` in relative path
- **Fix:** Changed to `'../contexts/ThemeContext'`
- **Regression Test:** Frontend build passes
- **Status:** FIXED

### BUG-008: Receipts.jsx wrong API endpoint
- **Module:** Frontend — `pages/user/Receipts.jsx:17`
- **Issue:** Calls `/receipts/user/my-receipts` but server route is `/receipts/my-receipts`
- **Impact:** Receipts page returns 404, no receipts displayed
- **Root Cause:** Extra `/user` segment in API path
- **Fix:** Changed to `/receipts/my-receipts`
- **Regression Test:** Frontend build passes
- **Status:** FIXED

### BUG-009: helpers.test.js crashes (JWT_SECRET)
- **Module:** Backend — `utils/helpers.js` + `tests/unit/helpers.test.js`
- **Issue:** `helpers.js` calls `process.exit(1)` at module load time if JWT_SECRET not set, vitest doesn't load .env
- **Impact:** Unit tests crash
- **Root Cause:** Top-level process.exit in ESM module
- **Fix:** Changed to lazy getter function `getJWTSecret()` — only called when token operations are used
- **Regression Test:** 35/35 unit tests pass with `$env:JWT_SECRET="test-secret"`
- **Status:** FIXED

### BUG-010: UTR extraction fails for underscore/long UTRs
- **Module:** Backend — `ocrService.js`
- **Issue:** UTR regex `[A-Za-z0-9]{6,20}` doesn't match underscores; length filter `<=20` rejects valid 23-char UTRs
- **Impact:** Valid UTRs not extracted, payment rejected as UTR_NOT_FOUND
- **Root Cause:** Regex character class missing underscore; length limit too low
- **Fix:** Changed to `[A-Za-z0-9_]{6,30}` with `<=30` filter
- **Regression Test:** E2E test Phase 2 — UTR extracted successfully
- **Status:** FIXED

### BUG-011: OCR inserts space mid-UPI breaking UPI match
- **Module:** Backend — `ocrService.js` + `e2e-live-test.js`
- **Issue:** OCR sometimes reads `jayaraji 126-3@okicici` — space splits the UPI between name and digits, existing space-fix regex `(\w)\s+(@\w)` only handles space before `@`
- **Impact:** Legitimate payments rejected with `UPI_MISMATCH`
- **Root Cause:** Space-normalization regex too narrow; doesn't handle space before the digits portion of the VPA
- **Fix:** Added `/(\w{2,})\s+(\d{2,}-?\d+@\w+)/g` pattern to join space-separated UPI segments
- **Regression Test:** E2E test Phase 2 — UPI match now `true` (was `false`); 31/31 E2E tests pass
- **Status:** FIXED

### BUG-012: Users could access dashboard/wallet/referrals before payment approval
- **Module:** Backend + Frontend — `authService.js`, `auth.js` (middleware), `paymentService.js`, `ProtectedRoute.jsx`, `LoginPage.jsx`, `RegisterPage.jsx`
- **Issue:** Registration created the user with `status='pending'`, but login only checked `status='deleted'` — a pending (unpaid/unapproved) user received a normal token and full dashboard/wallet/referral/topup/receipt access
- **Impact:** Business rule violated: users used wallet/topups/referrals without an approved registration payment; rejected/inactive users also gained access
- **Root Cause:** No server-side gate on non-active account status; login returned tokens for `pending` users
- **Fix:**
  - `authService.login` now throws `PAYMENT_NOT_APPROVED` (403) for `pending` users and `ACCOUNT_NOT_ACTIVE` (403) for `inactive`/`suspended`; rejects before issuing a token
  - NEW `requireActiveUser` middleware (403 `PAYMENT_NOT_APPROVED`/`ACCOUNT_NOT_ACTIVE`, admin bypass) applied to `/users/dashboard`, `/wallet/*`, `/referrals/my-code|my-referrals`, `/topups/*`, `/plans/change-request|my-requests`, `/receipts/*`
  - NEW `registrationStatusService.js` — server-side registration state machine (`REGISTRATION_PENDING_PAYMENT` → `PAYMENT_PENDING` → `PAYMENT_APPROVED` → `ACCOUNT_ACTIVE`, etc.)
  - NEW standalone `/payment-status` page (client `PaymentStatusPage.jsx`); `ProtectedRoute` redirects non-active users there; `LoginPage`/`RegisterPage` redirect on `PAYMENT_NOT_APPROVED`
- **Regression Test:** `business-rules.test.js` R1–R10 — pending user blocked from dashboard/wallet/referrals/topups/receipts (403), still reads own payment status (200), login returns 403 with payment data, admin approval activates account; 15/15 PASS
- **Status:** FIXED

---

## P2 HIGH BUGS

## Files Changed

| File | Changes |
|------|---------|
| `client/src/pages/RegisterPage.jsx` | Chains register → createPayment → uploadScreenshot → auto-verify |
| `client/src/components/Skeleton.jsx` | Fixed import path `../../` → `../` |
| `client/src/pages/user/Receipts.jsx` | Fixed API path `/receipts/user/my-receipts` → `/receipts/my-receipts` |
| `server/src/controllers/paymentController.js` | Pass userId, auto-trigger verifyPayment, added verifyPaymentManual |
| `server/src/services/paymentService.js` | Full verifyPayment rewrite with OCR, matching, duplicate UTR check, atomic update |
| `server/src/services/ocrService.js` | NEW — OCR pipeline: sharp preprocess, Tesseract, extraction, fuzzy matching |
| `server/src/services/exportService.js` | Fixed column names: name→full_name, phone→mobile, amount→expected_amount, months→plan |
| `server/src/services/paymentReceiptService.js` | Fixed column names: name→full_name, phone→mobile, amount→expected_amount, utr_number→transaction_id, months→plan |
| `server/src/services/suspiciousActivityService.js` | Fixed users.ip_address → ip_logs.ip_address |
| `server/src/routes/payments.js` | Added POST /:paymentId/verify route |
| `server/src/utils/helpers.js` | Changed JWT_SECRET to lazy getter (no process.exit at import) |
| `server/src/tests/unit/helpers.test.js` | Cleaned up |
| `server/src/tests/unit/ocr.test.js` | NEW — 35 unit tests for OCR extraction |
| `server/src/scripts/e2e-live-test.js` | NEW — 31-test E2E live verification |
| `server/src/scripts/production-final-check.js` | NEW — 25-item production final check (auth, payment, OCR, admin, features, security, build) |
| `supabase/migrations/003_add_utr_constraint.sql` | NEW — Unique index on transaction_id |
| `server/src/middleware/auth.js` | NEW `requireActiveUser` middleware (403 PAYMENT_NOT_APPROVED / ACCOUNT_NOT_ACTIVE, admin bypass) |
| `server/src/services/registrationStatusService.js` | NEW — server-side registration state machine (REGISTRATION_PENDING_PAYMENT → PAYMENT_APPROVED → ACCOUNT_ACTIVE) |
| `server/src/services/authService.js` | Login rejects `pending` (PAYMENT_NOT_APPROVED with payment data) and `inactive`/`suspended` (ACCOUNT_NOT_ACTIVE) |
| `server/src/controllers/authController.js` | Error-map login codes to 403 and attach `error.data` |
| `server/src/services/paymentService.js` | Atomic `completeApproval` (+ rollback) for payment→user→referral→notification; `hasFinancialHistory()`; `deletePayment()` (idempotent, storage + related-data cleanup, compensation on user-delete failure, audit log) |
| `server/src/controllers/adminController.js` | NEW `deletePayment` controller (409 FINANCIAL_HISTORY_EXISTS) |
| `server/src/routes/admin.js` | NEW `DELETE /payments/:paymentId`; bulk-approve now uses atomic `approvePayment` |
| `server/src/routes/users.js, wallet.js, referrals.js, topups.js, plans.js, receipts.js` | `requireActiveUser` applied to gated routes |
| `supabase/migrations/004_registration_transaction.sql` | NEW — `approve_initial_payment` + `delete_pending_registration` RPCs (atomic DB transactions) |
| `client/src/pages/PaymentStatusPage.jsx` | NEW — standalone pending-user payment status page (status banner, screenshot view, logout) |
| `client/src/components/ProtectedRoute.jsx` | Redirects non-active users to `/payment-status` |
| `client/src/pages/LoginPage.jsx` | On PAYMENT_NOT_APPROVED, navigates to `/payment-status` with payment data |
| `client/src/pages/RegisterPage.jsx` | Pending/rejected registrations navigate to `/payment-status` |
| `client/src/App.jsx` | NEW `/payment-status` route |
| `client/src/pages/admin/Payments.jsx` | Delete Registration button + ConfirmDialog ("cannot be undone" + financial-history block message) |
| `server/src/tests/integration/business-rules.test.js` | NEW — 15 regression tests for approval-required + delete lifecycle (R1–R15) |
| `server/src/tests/integration/api.test.js` | Added approval step before wallet/receipts tests; pending-blocked assertion |
