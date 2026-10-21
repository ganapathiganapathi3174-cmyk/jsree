# AUDIT REPORT — ReferralHub Platform (jsree)

**Date:** 2026-10-16 · **Scope:** `referral-platform/` (server + client) · **Branch:** `main` @ `8b88834` + 4 uncommitted service files

---

## 1. Executive summary

Full read-only audit of the stack (Express/Supabase backend, React/Vite client), baseline of every test suite, live end-to-end API verification against the running server + live Supabase, and one verified defect fixed.

| Metric | Result |
|---|---|
| Endpoints mapped | **82** (16 routers + 2 inline) |
| DB tables / indexes / RPCs | **15** / **47** (7 unique) / **6** |
| Server unit+integration tests (vitest) | **1158 / 1158 pass** (was 1157/1158) |
| Legacy `node --test` suites | **28 / 28 pass** |
| Client tests (vitest/jsdom) | **11 / 11 pass** |
| Client production build | **OK** (447 kB JS, 4.3 s) |
| Verified defects found | **1 P1** (fixed) + 1 P2 + 4 P3 (documented, not code-changed) |
| Business logic preserved | **Yes** — single 1-line regex fix, no rule/workflow/contract changes |

---

## 2. Architecture & feature map (condensed)

**Frontend:** React 18 + Vite + Tailwind, `BrowserRouter` in `src/App.jsx`. Public: `/`, `/register`, `/login`, `/payment-status`, `/admin/login`. 12 user pages under `/dashboard/*` (ProtectedRoute: token+user, non-admin, `status==='active'`, else → `/payment-status`). 10 admin pages under `/admin/*` (`adminOnly`). API layer = single axios instance `client/src/utils/api.js` (baseURL `VITE_API_URL || '/api'`, Bearer token from `localStorage.token`, 401 → clear storage + redirect, 120 s timeout).

**Backend:** Express ESM, mounts all routers under `/api` in `server/src/index.js`. Middleware order: helmet → cors (allow-list incl. `https://*.vercel.app`) → cookie-parser → json/urlencoded 10 MB → general rate limit (100/15 min) → auth rate limit (20/15 min on login/admin-login/register). JWT bearer auth (`authenticateToken`), `requireAdmin`, `requireActiveUser` gate (BUG-012) on dashboard/wallet/referrals/topups/plans/receipts. Background job: `autoExpireStalePayments()` every 5 min.

**Payment verification pipeline:** `POST /payments/:id/screenshot` → multer (5 MB, image only) → `paymentService.verifyPayment` → `verificationService.runScreenshotVerification` (Tesseract OCR + sharp preprocess) → gates: receiver UPI (exact / truncated / GPay masked-suffix) → exact amount → **±30 min freshness window measured from server-side upload time** → explicit success status → UTR present → OCR confidence ≥ 55 → duplicate-UTR reservation via `approved_utrs` (`INSERT … ON CONFLICT`, concurrency-safe) → status `approved|rejected` + user activation (referral/wallet/notification side effects, atomic RPC `approve_initial_payment`).

**Top-ups** use the identical verification engine with `referenceType:'topup'` and a two-phase claim flow (`proof_submitted → approved → completed`).

**Database:** 15 tables, no RLS (app-layer security), 4 SECURITY DEFINER RPCs (`approve_initial_payment`, `delete_pending_registration`, `admin_delete_user`, `admin_delete_topup`), DB-level wallet idempotency index `(user_id, reference_type, reference_id) WHERE reference_id IS NOT NULL`.

**Third-party:** Supabase (Postgres + Storage buckets `payments`, `avatars`), tesseract.js, sharp, bcryptjs, jsonwebtoken. No external payment gateway (UPI-screenshot OCR model).

Full endpoint/table inventories: see agent maps produced during Phase 1 (82 endpoints; every route's middleware, controller and service call chain).

---

## 3. Baseline (Phase 2) — before any change

| Suite | Command | Baseline result |
|---|---|---|
| Server vitest (all) | `npx vitest run` (server/) | 1157/1158 tests pass; **1 fail**: `payment-validation-matrix.test.js > GPay-masked UPI (suffix form)`; 5 files reported as "no test suite" |
| The 5 "no test suite" files | `node --test src/tests/unit/{cache,helpers,pagination}.test.js` | **28/28 pass** with `JWT_SECRET` set — they use `node:test`, not vitest (runner mismatch, not failures) |
| Integration (live server + live Supabase) | `node --test src/tests/integration/{api,business-rules}.test.js` | **28 pass / 9 fail**, flaky: results change run-to-run |
| Client | `npm test` (client/) | **11/11 pass** |
| Client build | `npm run build` | **OK** |
| Pre-existing uncommitted work | `git status` | 4 modified services (verification window, debug logging, OCR UTR spacing) + 1 new test file — **preserved untouched** |

### Integration-suite flakiness (root cause, not a product bug)
The in-memory rate limiter (100 req/15 min global, 20/15 min on auth) is per server process, and the suite writes to the **live shared Supabase DB** with repeated registers. A second run inside the same window turns most assertions into 429 cascades (measured: 6 pass/16 fail on a rate-limited server vs 28/9 on a fresh server). Additionally `api.test.js` still expects `pending` users to be able to `POST /auth/login` — that expectation predates BUG-012 (now correctly 403 `PAYMENT_NOT_APPROVED`). **Recommendation:** run integration tests only against a fresh server + isolated test DB, and update those two stale login expectations (requires approval — left unchanged).

---

## 4. Bug triage

### BUG-2026-10-01 — P1 — FIXED · Masked UPI glued to preceding line → genuine payment rejected
- **Affected:** `server/src/services/ocrService.js` → `extractUPIs()` (used by every payment + top-up verification).
- **Repro:** OCR text of a GPay receipt where the masked receiver UPI sits on the line after the UTR:
  `…\nUPI transaction ID\nT7GHD123456\n26-3@okicici\n…`
- **Expected:** candidate `26-3@okicici` matches receiver via `masked_suffix` → approved.
- **Actual:** glue regex `.replace(/(\w{2,})\s+(\d{2,}-?\d+@\w+)/g,'$1$2')` treats `\n` as `\s+` and fuses the token → `t7ghd12345626-3@okicici` → `UPI_MISMATCH` → **false rejection of a valid payment** (evidence: `[VERIFICATION DEBUG]` line in baseline run, `upiDetected:"t7ghd12345626-3@okicici"`, `upiMatch:false`).
- **Root cause:** same class of bug already fixed and documented in `extractUTRs` ("joining across it glued the UTR to the next line's date") but still present in `extractUPIs`. Committed at HEAD (BUG-011 regex), pre-existing; exposed by the new `payment-validation-matrix.test.js`.
- **Fix (minimal):** `\s+` → `[ \t]+` in that single glue rule (line 290), so OCR splits are still rejoined within a line but never across a line break.
- **Files changed:** `server/src/services/ocrService.js` (1 regex + comment).
- **Regression:** full OCR/UPI/verification subset 745/745 pass; full vitest 1158/1158 pass (previously 1157/1158).

### Documented, NOT code-changed (need approval / out of scope)
| ID | Sev | Finding |
|---|---|---|
| BUG-2026-10-02 | P2 | `client/src/pages/user/Receipts.jsx` opens receipt HTML with hard-coded `window.open('/api/receipts/…')`, bypassing `VITE_API_URL` — breaks in any deployment where the API is on another origin. Minimal fix: use `api.defaults.baseURL`. |
| BUG-2026-10-03 | P3 | `GET /api/cache-stats` is unauthenticated and returns cache keys (some contain user ids) — info leak. Minimal fix: apply `requireAdmin`. |
| BUG-2026-10-04 | P3 | `api.test.js` login expectations predate BUG-012 (pending user must get 403, not 200) — stale test, not product bug. |
| BUG-2026-10-05 | P3 | Dead/unused code: `registrationStatusService.js`, `cacheMiddleware`/`paginate` middleware and `validateTopup`/`validateChatMessage`/`sanitize`/`optionalAuth` never wired; paginated endpoints re-implement `page`/`limit` with no max cap in some routes. |
| BUG-2026-10-06 | P3 | 5 test files use `node:test` while the project runner is vitest — they are mis-reported as failing suites under `npx vitest run`. Minimal fix: rename to `*.node-test.js` and exclude from vitest `include`, or port to vitest. |

---

## 5. Test matrix & execution results (after fix)

| # | Area | Method | Result |
|---|---|---|---|
| 1 | Server vitest, all 38 collectible files | `npx vitest run` | **1158/1158 pass** |
| 2 | OCR/UPI/verification/gPay/expiry subset | `npx vitest run` (8 files) | **745/745 pass** |
| 3 | Legacy node:test units (cache/helpers/pagination) | `node --test` + `JWT_SECRET` | **28/28 pass** |
| 4 | Integration: auth/payments/notifications/wallet/referral-tiers/security/export/receipts/admin bulk (live server :5000 + live Supabase) | `node --test` on fresh server | **28/37 pass** (9 fail — flakiness + 2 stale expectations, §3; R1–R9 gate rules all pass, R11/R12 authz pass) |
| 5 | Client unit tests | `npm test` | **11/11 pass** |
| 6 | Client production build | `npm run build` | **OK** |
| 7 | Live smoke | `GET /api/health` | `{"success":true,…}` |
| 8 | Approval gate E2E (register → pending → blocked dashboard/wallet/referrals/topups/receipts → login 403 → admin approve → active) | business-rules integration R1–R9 | **PASS** (all 9, fresh-server run) |

**Not executed (environment limitations):** browser/UI E2E (no Playwright in repo — not added without approval); real OCR on real payment screenshots (only synthetic/mock OCR text tested); production deployment verification (Railway/Vercel/Supabase cloud not touched). No real payments, emails or customer data were used.

---

## 6. Security findings (non-destructive review)

- **Good:** bcrypt cost 12; JWT bearer with lazy secret; admin/user role separation enforced server-side (`requireAdmin` + RBAC inside `admin_delete_user`/`admin_delete_topup` RPCs); pending/inactive users hard-blocked server-side (BUG-012); duplicate-UTR enforcement is atomic (unique index + ON CONFLICT); wallet double-credit impossible at DB level; multer restricted to image types + 5 MB; CORS allow-list; helmet; auth rate limiting; secrets only in `.env` (names inspected, values never printed).
- **Risks:** `GET /api/cache-stats` unauthenticated (BUG-2026-10-03); no RLS on any table (API-layer only); `approve_initial_payment` RPC does not re-check `p_admin_id` role internally (callers do); no per-account login rate limit (only per-IP global).

## 7. Files modified

| File | Change | Reason |
|---|---|---|
| `server/src/services/ocrService.js` | 1 regex: glue rule `\s+` → `[ \t]+` + comment | BUG-2026-10-01 (false UPI_MISMATCH on masked UPI) |

No other files touched. Pre-existing uncommitted work from the prior session (verification ±30-min window, debug logging, OCR UTR spacing, new test matrix) preserved as-is.

## 8. Business-logic preservation confirmation

- No workflow, calculation, permission, status-transition, API contract, payment-verification rule or DB relationship was changed.
- The one fix narrows an OCR *text-preparation* artifact only: candidates that previously were corrupted now survive to the same matching gates; **no gate was weakened or bypassed**.

## 9. Release-readiness assessment

**Ready with caveats.** All executable automated suites pass (1158 vitest + 28 node:test + 11 client) and the core approval-gate business rules verify live end-to-end. Before the next release, address: (a) BUG-2026-10-02 if the API is ever served from a different origin than the frontend, (b) BUG-2026-10-03 (trivial), (c) integration-test isolation + the 2 stale login expectations so CI can run them reliably.
