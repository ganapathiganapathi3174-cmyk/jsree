# JSREE — Registration & Payment Flow Repair Report

**Status:** Implemented, tested, and **passed a final read-only pre-commit review (§8)**. **Not committed, not pushed, not deployed.**
**Scope basis:** `docs/operations/REGISTRATION_PAYMENT_FLOW_FAILURE_AUDIT.md`
**Baseline release:** `277a110` (unchanged; no production change of any kind was made)

---

## 1. Confirmed root cause addressed

Two defects, both confirmed by the audit and both now fixed:

| # | Defect | Location |
|---|---|---|
| **F1** | A global Axios response interceptor performed a silent `window.location.href = '/login'` on **every** HTTP 401, while also clearing `token`/`user`. This swallowed the real server error and threw registration straight to Login. | `client/src/utils/api.js` (old lines 27–42) |
| **F2** | `handleGoToPayment()` put `setStep(3)` **after** the `POST /auth/register` and `POST /payments` calls, and its `catch` auto-navigated on `EMAIL_EXISTS`, `MOBILE_EXISTS`, `PAYMENT_EXISTS` and `PENDING_EXISTS`. Any throw meant step 3 never rendered, so `QRPaymentSection` (and its screenshot `<input type="file">`) never mounted. | `client/src/pages/RegisterPage.jsx` (old lines 120–172) |

Because `setStep(3)` was unreachable on failure, the QR + upload screen was never switched on — the components were never broken, just never rendered. This is why ₹120, ₹500 and ₹1,000 all "redirected to Login instead of payment".

---

## 2. Files changed and exact changes

Only the two explicitly allowed files were modified. **No third file was needed.**

### 2.1 `client/src/utils/api.js` (modified)

- Added exported constants `PUBLIC_AUTH_PATHS` (`/auth/register`, `/auth/login`, `/auth/admin-login`) and `PROTECTED_ROUTE_PREFIXES` (`/dashboard`, `/admin`).
- Added exported helpers `isPublicAuthRequest(config)`, `isProtectedRoute(pathname)`.
- Added exported pure function **`classify401(pathname, config)`** returning `'ignore' | 'expire-session'`, so the decision rules are unit-testable without touching `window.location`.
- Rewrote the response error interceptor to:
  1. reject anything that is not a 401 unchanged;
  2. **ignore** a 401 from a public auth request — no redirect, no session clearing, original error preserved;
  3. **ignore** a 401 on any non-protected route (register, login, landing, payment-status, …);
  4. only on a protected route: clear `token`/`user` once and redirect to `/login` (or `/admin/login` under `/admin`), guarded by a module-level `sessionExpiryHandled` flag so a burst of parallel 401s clears and redirects **exactly once**.
- Request interceptor, timeout, `baseURL`, `withCredentials`, `isTimeoutError` and `REQUEST_TIMEOUT_MS` are unchanged.

### 2.2 `client/src/pages/RegisterPage.jsx` (modified)

- Added `recovery` state — an inline, **user-initiated only** action block. Nothing in it navigates on its own.
- Added `inFlightRef` synchronous re-entrancy guard alongside `loading` (React state stays `false` until the next render, so a same-tick double click would otherwise fire two registrations).
- `handleGoToPayment()` rewritten:
  - **No auto-navigation anywhere in the `catch`.** Every failure path preserves step 2, the form and the selected plan.
  - `registeredRef.current = true` is set **immediately after** a successful register response, *before* the token is read — so a missing/unusable token can never trigger a second registration.
  - Missing token → `recovery.kind = 'session'` + toast, **returns before** `POST /payments`.
  - Payment request now reads the token back at call time and passes it explicitly: `api.post('/payments', { plan: String(form.plan) }, { headers: { Authorization: 'Bearer <fresh token>' } })`.
  - `EMAIL_EXISTS` / `MOBILE_EXISTS` / `PAYMENT_EXISTS` → real `err.response.data.message` shown in toast **and** inline `role="alert"`; plan and form untouched; explicit **“Log in to continue”** button (never clicked automatically).
  - `PENDING_EXISTS` → real server message + explicit **“Continue existing payment”** button that uses the existing supported `/payment-status` flow. No second payment request.
  - 401 from `POST /payments` after a successful registration → stale session dropped (`token`/`user` removed), `recovery.kind = 'session'`, message states the account **was created** and that login is required; **no re-registration, no blind retry**.
  - Timeout / network / 500 / unknown → real server message or a useful fallback, `recovery` set, no redirect.
- Step 2 UI: new inline `role="alert"` block rendering `recovery.message` plus the contextual action button; plan click clears `recovery`; Back/Next row unchanged.
- Unchanged: step 1, step 3, `handleSubmit`, `QRPaymentSection` props, `registeredRef` re-runnable payment semantics.

### 2.3 New test files (added)

- `client/src/pages/RegisterPageRecovery.test.jsx` — 14 tests
- `client/src/utils/apiInterceptor.test.js` — 9 tests

### 2.4 Explicitly NOT changed

No backend file, no `server/**`, no migration, no SQL, no RPC, no wallet/payment/approval logic, no `QRPaymentSection.jsx`, no UPI/QR/receiver config, no `.env`, no Render/Vercel variable, no V2 engine file, no existing test file.

---

## 3. Before / after registration flow

**Before**

```
Step 2 → Next
  → POST /auth/register
      ├─ 409 EMAIL/MOBILE_EXISTS → toast + navigate('/login')   ← form & plan lost
      ├─ other throw              → toast only
      └─ ok → store token
  → POST /payments
      ├─ 401  → api.js interceptor → silent window.location.href = '/login'  ← no toast, no diagnosis
      ├─ 409 PAYMENT_EXISTS  → toast + navigate('/login')       ← form & plan lost
      ├─ 409 PENDING_EXISTS  → toast + navigate('/payment-status')
      ├─ other throw          → toast only, stay on step 2, no guidance
      └─ ok → setStep(3) → QR + upload
```
Any throw ⇒ `setStep(3)` never runs ⇒ QR/upload never mounts ⇒ user lands on Login.

**After**

```
Step 2 → Next  (inFlightRef + loading guard; double click = 1 submission)
  → POST /auth/register
      ├─ ok  → registeredRef = true (before token read) → store token/user
      │        └─ no token → stop, inline "account created, log in" + button, plan kept
      ├─ 409 EMAIL/MOBILE_EXISTS → real message inline + toast, plan/form kept,
      │                            explicit "Log in to continue" (user must click)
      └─ other → real message inline + toast, plan/form kept, NO redirect
  → POST /payments  (explicit fresh Bearer token)
      ├─ 401  → drop stale session, inline "account created — log in to continue",
      │         NO re-registration, NO blind retry, plan kept
      ├─ 409 PAYMENT_EXISTS  → real message, plan kept, explicit login action
      ├─ 409 PENDING_EXISTS  → real message, plan kept,
      │                        explicit "Continue existing payment" → existing /payment-status flow
      ├─ timeout/network/500 → real message, plan/form kept, NO redirect
      └─ ok → setStep(3) → QRPaymentSection mounts → screenshot input usable
```

---

## 4. Test results (exact counts)

All numbers are real command output from this workspace. Tests are fully mocked; **no real account was created and no real payment was submitted.**
Counts below are from the **final run after the pre-commit review (§8)**, which added 9 more tests.

### Client suite (full)

| | Before repair | After repair |
|---|---|---|
| Test files | 6 | **8** |
| Tests passed | 20 | **52** |
| Tests failed | 0 | **0** |
| Skipped | 0 | 0 |
| Exit code | 0 | **0** |

`npx vitest run` (client): **Test Files 8 passed (8) — Tests 52 passed (52)**

### New focused tests

`client/src/pages/RegisterPageRecovery.test.jsx` — **14 passed / 0 failed**

| Spec requirement | Test | Result |
|---|---|---|
| 1. success → step 3 + QR visible | advances to step 3 with a populated payment and a usable upload input | ✅ |
| 2. ₹120 → QR shows ₹120 | ₹120 plan reaches the QR screen showing ₹120 | ✅ |
| 3. ₹500 → QR shows ₹500 | ₹500 plan reaches the QR screen showing ₹500 | ✅ |
| 4. ₹1,000 → QR shows ₹1,000 | ₹1,000 plan reaches the QR screen showing ₹1,000 | ✅ |
| 5. EMAIL_EXISTS | shows the real server message, keeps the plan and offers an explicit login | ✅ |
| 6. MOBILE_EXISTS | shows the real server message, keeps the plan and offers an explicit login | ✅ |
| 7. PAYMENT_EXISTS | shows the server message and preserves the plan (1 register, 1 payment) | ✅ |
| 8. PENDING_EXISTS | offers the existing pending-payment flow instead of a second request | ✅ |
| 9. payment 401 after registration | a 401 from the payment request does not repeat registration | ✅ |
| 10. missing token | a missing token after registration stops before payment and explains recovery | ✅ |
| 11. generic 500 / network | keeps the form, the plan and does not redirect to Login / keeps the form and the plan | ✅ |
| 14. repeated clicks | repeated Next clicks register and create a payment only once | ✅ |

Plus: *sends the freshly stored Bearer token on the payment request* (spec §3.A) — ✅

`client/src/utils/apiInterceptor.test.js` — **18 passed / 0 failed**

| Spec requirement | Test | Result |
|---|---|---|
| 12. protected dashboard 401 | clears the expired session and redirects a dashboard 401 to /login | ✅ |
| 12. admin 401 | redirects an admin route 401 to /admin/login | ✅ |
| 12. no redirect on non-401 | does not redirect on a non-401 failure | ✅ |
| 12. single redirect | redirects only once for a burst of parallel 401s | ✅ |
| 13. public auth 401 | does not redirect or clear the session when a public auth endpoint returns 401 | ✅ |
| 13. public endpoint 401 | never redirects merely because a public endpoint returns 401 | ✅ |
| error preservation | preserves the original error body so the page can show the real message | ✅ |
| non-protected route | ignores a 401 on any non-protected route | ✅ |
| decision table | `classify401` maps requests to the right action | ✅ |
| §8.1 route coverage | finds the full route table (regression guard on the parser itself) | ✅ |
| §8.3 all 12 user routes | classifies every protected user route as session-expiring | ✅ |
| §8.3 all 11 admin routes | classifies every protected admin route as session-expiring | ✅ |
| §8.3 all public routes | never treats a public route as session-expiring | ✅ |
| §8.2 login screens | does not expire a session while standing on the login screens | ✅ |
| §8.4 guard lifecycle | resets after a successful response so a later expiry is still handled | ✅ |
| §8.4 guard not armed | a public-route 401 does not arm the expiry guard | ✅ |
| §8.6 bearer token | sends the latest stored token on every request | ✅ |
| §8.6 explicit header | an explicit Authorization header matches what the interceptor would send | ✅ |

### Existing tests — untouched and still passing

| File | Tests | Result |
|---|---|---|
| `client/src/pages/RegisterPage.test.jsx` | 5 | ✅ passed |
| `client/src/pages/RegistrationPaymentFlow.test.jsx` | 1 | ✅ passed |
| `client/src/pages/AuthForms.test.jsx` | 4 | ✅ passed |
| `client/src/pages/user/TopUps.test.jsx` | 3 | ✅ passed |
| `client/src/pages/user/Receipts.test.jsx` | 3 | ✅ passed |
| `client/src/utils/api.test.js` | 4 | ✅ passed |
| **Total pre-existing** | **20** | **20 passed / 0 failed** |

No existing assertion was deleted, relaxed or downgraded.

### Server regression (no server code changed)

`npx vitest run` (server, offline test env): **Test Files 6 failed | 40 passed (46) — Tests 397 passed | 5 skipped (402), 0 failed.**

Identical to the pre-repair baseline recorded in `FINAL_PRODUCTION_RELEASE_REPORT.md` (46 files / 397 passed / 5 skipped / exit 1 caused by 6 "hollow" files that use the wrong runner — no assertion failures). Exit code 1 is the known baseline condition, **not** caused by this change.

---

## 5. Build result

Final run (after the §8 pre-commit review):

```
vite v5.4.21 building for production...
✓ 1759 modules transformed.
dist/index.html                 1.90 kB
dist/assets/index-sC8Nw-uy.css  53.17 kB │ gzip: 10.79 kB
dist/assets/index-CBSfv1cL.js  493.11 kB │ gzip: 142.48 kB
✓ built in 4.61s
BUILD_EXIT=0
```

Client production build **succeeded, exit code 0**.
(Earlier run in the same session produced `index-DsZ9j6ug.js`; the hash changed only because `api.js` was amended during §8.)

---

## 6. Remaining limitations

1. **Not verified in a real browser against live production.** All results above are from mocked-API automated tests. Live end-to-end confirmation of the three plans still requires a real browser session against `https://jsree.vercel.app` **after** a separate, explicitly approved deployment.
2. **F9 from the audit remains not fully verified** — which of the three sinks (`:156`, `:165`, `api.js:37`) the original reporter hit cannot be determined without their console/network log. The repair closes all three, so the distinction no longer matters for the fix, only for the historical record.
3. **No resume-after-login mechanism was invented.** The selected plan survives within the page session (state preserved across the error), but is *not* carried through a real `/login` round-trip — there is no tested resume flow in the codebase, and per instructions one was not fabricated. After logging in, the user re-selects the plan.
4. **`PENDING_EXISTS` now requires one explicit click** instead of auto-navigating to `/payment-status`. This is intentional (auto-navigation was part of the defect) but is a small UX change.
5. **Backend, migration 015, `ADMIN_RECEIVER_NAME`, and `PAYMENT_PROVIDER_MODE` are unchanged and still carry the limitations recorded in `FINAL_PRODUCTION_RELEASE_REPORT.md`.** This repair fixes only the frontend navigation bug.
6. The `referral-platform` nested gitlink shows as dirty (11 nested files) — pre-existing, deliberately excluded, untouched by this work.

---

## 7. Confirmation — no production mutation

| Check | Result |
|---|---|
| Backend source changed | ❌ none — `git status -- server/` empty |
| Database / migration / SQL / RPC changed | ❌ none |
| Wallet or payment-approval logic changed | ❌ none |
| V2 payment validation engine changed | ❌ none |
| QR / receiver UPI configuration changed | ❌ none |
| `QRPaymentSection.jsx` changed | ❌ none (`git diff` empty) |
| Render / Vercel environment variables changed | ❌ none |
| Existing tests deleted or weakened | ❌ none (only additions) |
| Secrets / JWT / service keys / UPI ids in diff | ❌ none (pattern scan of diff: 0 hits) |
| Real production account created | ❌ none |
| Real payment submitted | ❌ none |
| `git commit` | ❌ not performed |
| `git push` | ❌ not performed |
| Deployment (Vercel / Render) | ❌ not performed |
| Production DB mutation | ❌ not performed |

**Working tree state:** 2 modified source files (`client/src/utils/api.js`, `client/src/pages/RegisterPage.jsx`), 2 new test files, plus the previously written untracked `docs/operations/REGISTRATION_PAYMENT_FLOW_FAILURE_AUDIT.md`.

**STOPPED here per instruction — awaiting separate approval before any commit, push or deployment.**

---

## 8. Final read-only pre-commit review

Scope: read App.jsx and the route table, re-verify 401 handling, add tests only where a gap existed, re-run the full client suite and production build. **No backend, database, V2 engine, QR configuration, wallet logic or environment variable was touched.** Two frontend-only corrections were made to `client/src/utils/api.js` (§8.2 R1/R2) and are called out explicitly below.

### 8.1 Protected route inventory (from App.jsx)

29 `<Route>` entries total:

| Class | Count | Paths |
|---|---|---|
| Public | 5 | `/`, `/register`, `/login`, `/payment-status`, `/admin/login` |
| Wildcard | 1 | `*` → `NotFound` |
| Protected user | 12 | `/dashboard`, `/dashboard/profile`, `/dashboard/payment`, `/dashboard/topups`, `/dashboard/referrals`, `/dashboard/plan-change`, `/dashboard/chat`, `/dashboard/history`, `/dashboard/wallet`, `/dashboard/notifications`, `/dashboard/receipts`, `/dashboard/security` |
| Protected admin | 11 | `/admin`, `/admin/users`, `/admin/payments`, `/admin/topups`, `/admin/inactive-users`, `/admin/plan-changes`, `/admin/chat`, `/admin/audit-logs`, `/admin/financial-reports`, `/admin/suspicious-activity`, `/admin/payment-settings` |

All 23 protected routes are wrapped in `<ProtectedRoute>` (`adminOnly` on the 11 admin ones). `ProtectedRoute.jsx` itself is unchanged and still enforces token/user presence, admin role and pending-status redirect.

**Important correction to the review request:** there are **no `/user/*` routes** in this application. The paths named in the request (`/user/dashboard`, `/user/profile`, `/user/wallet`, `/user/topups`, referrals) are actually `/dashboard`, `/dashboard/profile`, `/dashboard/wallet`, `/dashboard/topups`, `/dashboard/referrals`. The string `/user/` appears only in *import* paths (`./pages/user/Dashboard`), never in a route or a navigation target — confirmed by a repository-wide scan.

### 8.2 `PROTECTED_ROUTE_PREFIXES` coverage — PASS after two corrections

`PROTECTED_ROUTE_PREFIXES = ['/dashboard', '/admin']` correctly covers all 23 protected routes (the `/dashboard` prefix covers every `/dashboard/*` child; `/admin` covers every `/admin/*` child including `/admin` itself).

**Finding R1 — FIXED.** `/admin/login` also starts with `/admin`, so it was being classified as *protected*. A 401 from any ordinary API call made while standing on the admin login screen would have cleared the session and hard-reloaded the page — a spurious redirect on a public screen, contrary to requirement 5. Fixed by adding `PUBLIC_ROUTE_PATHS = ['/login', '/admin/login']` and excluding those exact paths at the top of `isProtectedRoute()`.

**Finding R2 — FIXED.** `sessionExpiryHandled` had **no reset path**. It only ever cleared because `window.location.href = ...` happens to force a full document reload. `LoginPage.jsx:23` and `AdminLoginPage.jsx:23` use SPA `navigate(...)`, which does **not** reload — so in any future where the redirect becomes an SPA navigation, the flag would be stuck at `true` and **every subsequent session expiry would be silently swallowed**. Fixed by resetting `sessionExpiryHandled = false` in the response success handler (any 2xx means the session is valid again).

Both corrections are in the allowed file (`client/src/utils/api.js`). No other source file changed.

### 8.3 401 handling on every protected route

Verified programmatically for all 12 user and all 11 admin routes (source-derived test, §8.8):

- `isProtectedRoute(path) === true` for all 23.
- `classify401(path, { url: '/users/profile' }) === 'expire-session'`.
- `classify401(path, { url: '/payments' }) === 'expire-session'`.
- `/dashboard/wallet`, `/dashboard/topups`, `/dashboard/referrals`, `/dashboard/profile` behave identically to `/dashboard`.
- Admin routes expire to `/admin/login`; user routes expire to `/login` (branch at `api.js:84`).
- Non-protected routes (`/`, `/register`, `/login`, `/payment-status`, `/admin/login`, `*`) are always `'ignore'`.

### 8.4 `sessionExpiryHandled` lifecycle — correct after R2

| Event | Effect |
|---|---|
| 401 on a public route / public auth request | guard **not** armed; session untouched; original error preserved |
| 401 on a protected route | armed → `token`/`user` cleared → one redirect → subsequent 401s in the same burst ignored |
| Any successful (2xx) response | guard **reset** — so a later real expiry is handled again |
| Burst of parallel 401s | exactly one redirect (asserted) |

This is now explicit rather than an accident of `window.location` reloading the document.

### 8.5 Public registration / login / payment-status / recovery flows

- **Registration** (`/register`): `POST /auth/register` is a public auth request → `'ignore'` on every 401; no session clearing; the RegisterPage `catch` shows the real message.
- **Login** (`/login`) and **Admin login** (`/admin/login`): public auth requests → `'ignore'`; and the screens themselves are now excluded from `isProtectedRoute` (R1). Successful login uses SPA `navigate('/dashboard')` / `navigate('/admin')` and does not depend on the interceptor at all.
- **Payment status** (`/payment-status`): public route → `'ignore'`. It does **not** rely on the global interceptor — `PaymentStatusPage.jsx:119-124` implements its own `logout()` (clears storage + `navigate('/login')`) and `:185` renders an explicit **“Go to Login”** button; its data loads are wrapped in their own `.catch`.
- **Payment recovery** (the new inline `role="alert"` block): every action is an explicit user click — “Log in to continue” → `/login`, “Continue existing payment” → `/payment-status`. Nothing navigates on its own.

### 8.6 Bearer token handling vs. the request interceptor

- The request interceptor (`api.js:48-54`) reads `localStorage.getItem('token')` **on every request**, so it always sends the latest stored token.
- `RegisterPage.handleGoToPayment` reads the same source at call time and passes an explicit `Authorization` header. The two are always the same value; the explicit header is belt-and-braces and makes the intent auditable.
- Asserted: with tokens `first-token` → `second-token` → removed, the wire header is `['Bearer first-token', 'Bearer second-token', undefined]`.
- Asserted: an explicit `Bearer fresh-token` header survives to the adapter unchanged.
- The register request itself intentionally carries no token (none exists yet) and the payment request always carries the token registration just wrote.

### 8.7 Login recovery UX

- No automatic navigation on any error path — all three recovery actions require a click.
- Duplicate identity and approved-payment conflicts → one **“Log in to continue”** button; a second account can never be created (backend rejects, and `registeredRef` is set only on a genuine 2xx).
- Pending payment → **“Continue existing payment”** → the existing, already-tested `/payment-status` flow; no second `POST /payments`.
- Form and plan are preserved: asserted by a Back → Next round-trip that re-reads the typed fields and re-asserts `aria-pressed` on the chosen plan.
- 401 after registration → stale session dropped, message states the account **was** created, login offered, `registeredRef` stays `true` so registration is never repeated.

### 8.8 Test coverage of the actual protected routes

The route list is **derived from `App.jsx` itself** at test time (regex over the real route table), not hard-coded, so it cannot silently drift:

1. `finds the full route table` — asserts 29 routes, 23 protected, and the exact 6-entry public list (parser regression guard).
2. `classifies every protected user route as session-expiring` — enumerates and asserts all 12 `/dashboard*` paths.
3. `classifies every protected admin route as session-expiring` — enumerates and asserts all 11 `/admin*` paths.
4. `never treats a public route as session-expiring` — iterates every non-protected path from App.jsx.
5. `does not expire a session while standing on the login screens` — R1 regression guard.

No existing test was modified, deleted or weakened (`git diff -- 'client/src/**/*.test.*'` is empty).

### 8.9 Re-run results

| Command | Result |
|---|---|
| `npx vitest run` (client) | **Test Files 8 passed (8) — Tests 52 passed (52)**, 0 failed, exit 0 |
| `npm run build` (client) | `index-CBSfv1cL.js` 493.11 kB, **BUILD_EXIT=0** |
| `npx vitest run` (server, no server code changed) | **46 files — Tests 397 passed / 5 skipped / 0 failed**, exit 1 (6 known hollow wrong-runner files; identical to the pre-repair baseline) |
| `git status -- server/` | empty — no backend change |
| `git diff --name-only -- client/` | `client/src/pages/RegisterPage.jsx`, `client/src/utils/api.js` only |
| `git diff` secret/UPI pattern scan | 0 hits |

### 8.10 Final readiness verdict

**READY TO COMMIT (frontend-only) — pending separate approval.**

- Root cause (F1 silent global 401 redirect, F2 unreachable `setStep(3)`) is addressed.
- All 23 actual protected routes are covered by `PROTECTED_ROUTE_PREFIXES` and verified by source-derived tests.
- Public registration, login, admin login, payment-status and payment recovery flows are unaffected or improved.
- Session-expiry behaviour on protected routes is preserved, now with an explicit, tested reset path.
- Bearer token handling is correct and tested at both the interceptor and call-site level.
- 52 client tests pass, 0 fail; production build succeeds; server baseline unchanged.
- Nothing is committed, pushed, deployed, or written to any database.

**Remaining (unchanged from §6):** live browser verification against production still requires a separate approved deployment; no resume-after-login plan-carry mechanism was invented; `PENDING_EXISTS` now needs one explicit click; migration 015 / `ADMIN_RECEIVER_NAME` / `PAYMENT_PROVIDER_MODE` remain as documented in `FINAL_PRODUCTION_RELEASE_REPORT.md`.

**STOPPED here — awaiting approval before any commit, push or deployment.**
