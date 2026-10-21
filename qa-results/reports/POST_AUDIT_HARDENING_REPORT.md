# POST-AUDIT HARDENING REPORT — ReferralHub (jsree)

**Date:** 2026-10-16
**Repository:** `referral-platform` (branch `main`, HEAD `8b88834` — unchanged, nothing committed)
**Follows:** `qa-results/reports/AUDIT_REPORT_2026-10-16.md`
**Author phase:** post-audit hardening / verification

---

## 1. Executive summary

| Area | Result |
|---|---|
| BUG-2026-10-02 (receipt viewer) | **Fixed** — and found to be broken in *every* deployment, not only cross-origin |
| BUG-2026-10-03 (`/api/cache-stats` info leak) | **Fixed** — now `authenticateToken` + `requireAdmin` |
| Integration suites (live server + live Supabase) | **36 / 37 pass, reproducible** (was 28/37 fresh, 6–16/37 rate-limited) |
| Server vitest (all) | **1167 / 1168 pass** (the 1 red is a pre-existing bcrypt timing flake, §10.6) |
| Legacy `node:test` units | **28 / 28 pass** |
| Client tests (vitest/jsdom) | **15 / 15 pass** (11 existing + 4 new) |
| Client production build | **OK** |
| Business logic / payment verification / approval gates | **Unchanged** |
| Commits, pushes, resets, production-data writes | **None** |

Two of the three known audit follow-ups are closed. The integration flakiness is now
fully explained and fixed at the test layer. **DEFECT-A (admin login) was investigated to
completion in this pass — the intended administrator could not be confirmed and the
configured password does not match the seeded admin row, so per the stop rules NO
configuration change was applied** (evidence: §10, decision: §10.7). All prior uncommitted
work from the earlier session is preserved intact.

---

## 2. Scope & operating rules

Constraints honoured throughout:

- No changes to payment-verification logic, approval gates, verification thresholds or
  any business rule.
- No commits, pushes, deployments, resets or discards.
- Smallest possible diffs; existing conventions followed.
- Any change implying a security-policy or business-logic decision was **stopped and
  raised for approval instead of guessed** (§6).

Work items: verify OCR diff integrity, secure `/api/cache-stats`, fix the `Receipts.jsx`
API base URL, stabilise the integration tests, run full regression + client build,
confirm the git diff preserves prior work, and produce this report.

---

## 3. Production-code changes (2 files, tracked)

### 3.1 BUG-2026-10-03 — `/api/cache-stats` is now admin-only

`server/src/index.js:23` (import) and `server/src/index.js:83-90`.

```diff
-app.get('/api/cache-stats', (req, res) => {
+app.get('/api/cache-stats', authenticateToken, requireAdmin, (req, res) => {
   res.json(cacheStats());
 });
```

`cacheStats()` returns `{ size, keys[] }` where each key is `${userId}:${originalUrl}` —
an unauthenticated response therefore exposes active user ids and the routes they
visited. `PROJECT_LOGIC_REPORT.md:388` already flagged this as a **High**-severity leak.

**Why admin-gating and not removal:** there is **no in-repo consumer** (grep confirms only
`index.js`, docs and `cache.test.js`) and `cacheMiddleware` is never mounted, so the cache
is always empty in production. Replacing the response would be a larger, riskier change;
adding the two existing middlewares is the minimal fix and keeps the endpoint usable for
ops if `cacheMiddleware` is ever mounted. A comment records the rationale and how to
revert if a public consumer is ever introduced.

### 3.2 BUG-2026-10-02 — receipt viewer was broken in *all* deployments

`client/src/pages/user/Receipts.jsx:24-36`.

The audit scoped this to "bypasses `VITE_API_URL`". Investigation shows a **more severe,
universal** defect: `GET /api/receipts/:paymentId/html` is protected by
`authenticateToken` + `requireActiveUser` (`server/src/routes/receipts.js:29`), but
`window.open('/api/receipts/<id>/html')` **cannot attach an `Authorization` header**.
The "View" button therefore returned 401 for every user in every deployment — including
same-origin ones. (The hard-coded `/api` prefix was an additional cross-origin bug.)

Fix — fetch through the shared axios instance (Bearer token **and** correct `baseURL`)
and open the returned HTML as a blob:

```jsx
const res = await api.get(`/receipts/${paymentId}/html`, { responseType: 'text' });
const url = URL.createObjectURL(new Blob([res.data], { type: 'text/html' }));
window.open(url, '_blank');
setTimeout(() => URL.revokeObjectURL(url), 60000);
```

The server API contract is unchanged (same Bearer-authenticated GET). The blob URL is
revoked after 60s to avoid a leak, and a `react-hot-toast` error is shown on failure
(project convention, already a dependency) so failures are no longer silent.

---

## 4. Test changes (4 files)

### 4.1 New regression tests

| File | Tests | Covers |
|---|---|---|
| `server/src/tests/integration/cache-stats-auth.test.js` | 5 | `/api/cache-stats` auth: public `/health`, no token → 401 `TOKEN_REQUIRED`, bad token → 401 `TOKEN_INVALID`, non-admin → 403 `ADMIN_REQUIRED`, admin → 200 `{size, keys}` |
| `client/src/pages/user/Receipts.test.jsx` | 4 | list renders; View fetches `/receipts/:id/html` with `responseType:'text'` and opens a blob (guards against the old `/api/...` `window.open`); failure → toast + no navigation; blob URL revoked |

The server test boots its **own** server instance on an ephemeral port (healthy within
~1 s) and is **strictly read-only** against the database: it signs JWTs with the server's
own `JWT_SECRET` for rows that already exist — nothing is created, updated or deleted.

### 4.2 Integration-suite stabilisation

`server/src/tests/integration/{api,business-rules}.test.js` + new
`server/src/tests/integration/_helpers.mjs`.

Root cause of the former flakiness (three independent causes, none of them product bugs
except the admin one below):

1. **Two stale login expectations.** `api.test.js` logged in a hard-coded seeded account
   (`[REDACTED]`) and expected success, contradicting confirmed **BUG-012**
   behaviour. `authService.login()` order is now verified line-by-line
   (`server/src/services/authService.js:107-161`): not-found / deleted / inactive are
   checked first, then the **password (126-129)**, then admin-role (131) and **only then**
   `status === 'pending'` → 403 `PAYMENT_NOT_APPROVED` (138-154). The tests now assert
   exactly that, on this run's own freshly-registered user, so they are self-contained:
   pending user login → 403 `PAYMENT_NOT_APPROVED`; wrong password → 401
   `INVALID_CREDENTIALS` (password is checked before the pending gate).
2. **No admin fixture / silent passes.** Admin-dependent tests called
   `POST /auth/admin-login` inline and did `if (!token) return;`, which **silently passed**
   while hiding the failure. Admin capability is now resolved once via `_helpers.mjs`,
   which signs a JWT for the **existing** active admin row (read-only), and
   admin/approval-dependent assertions use `t.skip(...)` with an explicit
   `ENV:` reason instead of vanishing silently.
3. **Rate-limit budget.** A single full pass consumes roughly a dozen of the 20-requests/15-min auth
   limiter and ≈55 of the 100/15-min global limiter (`server/src/index.js:47-61`). Two
   back-to-back passes cannot fit in one window against the same process. This is an
   environmental constraint, not a test defect — see §5 for the documented procedure.

`api.test.js` also gained best-effort cleanup (soft-delete of the account it creates) and
fully randomised per-run email/mobile, so repeated runs against the shared database stay
independent.

---

## 5. Verification results

| # | Suite | Command | Result |
|---|---|---|---|
| 1 | Server vitest, all files | `npx vitest run` (server/) | **1167 / 1168 pass** (1 = §10.6 flake) |
| 2 | Legacy `node:test` units | `node --env-file=.env --test src/tests/unit/{cache,helpers,pagination}.test.js` | **28 / 28 pass** |
| 3 | Integration — fresh server, run A | `node --test src/tests/integration/{api,business-rules}.test.js` | **36 / 37 pass** |
| 4 | Integration — same server, run B | idem | 29/37 — 7 tests tripped the auth/global rate limiter (environmental) + the same 1 known-defect red |
| 5 | Integration — fresh server, run C | idem (restarted server) | **36 / 37 pass** (identical to run A) |
| 6 | Client vitest | `npx vitest run` (client/) | **15 / 15 pass** |
| 7 | Client production build | `npm run build` (client/) | **OK** (1750 modules, built in 26.2s) |

Notes:

- Runs A and C are **identical** (same single failure), demonstrating the suite is now
  deterministic. The procedure is: **restart the server before an integration pass** so
  its in-memory rate-limit counters start clean.
- The one failing test in runs A/C is `POST /auth/admin-login - should login admin`
  (§6, DEFECT-A). It is **deliberately left red with a diagnostic message** rather than
  skipped or weakened.
- Under `npx vitest run`, 5 files report "no test suite" — the pre-existing
  `node:test`-vs-vitest runner mismatch (AUDIT BUG-2026-10-06), unchanged.
- `seed-default-users.test.js` reported a 5 s timeout only while three heavy suites ran
  in parallel; run in isolation it is **9 / 9 pass**, confirming CPU contention, not a
  regression.

---

## 6. Defects found — BLOCKED, need your approval

### DEFECT-A (P1 in this environment) — admin login is unusable · **NO CHANGE APPLIED**

**Investigated 2026-10-16 (Option-A verification pass). Outcome: identity and credential
alignment could NOT be verified — no configuration change was made. Details and evidence in
§10.**

`server/src/services/authService.js:182-226`.

`adminLogin()` looks the admin up by `ADMIN_EMAIL` and, when no row matches, auto-inserts
one with the **hard-coded `referral_code: 'ADMIN001'`** (line 221). In the shared
database an admin row already exists under a **different email** (`[REDACTED]`)
holding `ADMIN001`, so the insert violates the unique constraint, returns `null`, and the
endpoint answers:

```
{"success":false,"code":"ADMIN_LOGIN_FAILED","message":"Cannot read properties of null (reading 'id')"}
```

`Admin@123` **does** match `ADMIN_PASSWORD_HASH` in `server/.env` (verified with bcrypt);
the failure is the missing row lookup + the unhandled `null`, not the password.

Two components remain: (i) a **configuration/identity conflict** between the documented
administrator (`[REDACTED]`) and an undocumented live row (`[REDACTED]`) that
squats the fixed `ADMIN001` code, and (ii) a **code-fragility defect** (unhandled `null` →
misleading 500 instead of a clear error).

Options — each still needs your decision; none has been implemented:

- **(a) Config:** point `ADMIN_EMAIL` at the existing row (`[REDACTED]`). **Not
  applied** — that identity is not documented anywhere in the project and the configured
  password does not match that row's stored hash (§10.1, §10.3). Would also adopt an
  operationally-observed-but-undocumented account as the platform administrator.
- **(b) Error-handling only:** guard the insert result and throw a clear
  `ADMIN_PROVISIONING_FAILED` error. No policy change. *Still available, needs approval.*
- **(c) Auth policy:** fall back to an existing admin row when the email does not match, or
  make `ADMIN001` non-fixed. *Changes auth behaviour — must be your call.*
- **(d) Data:** free `ADMIN001` on the stray row, or align that row's email with
  `ADMIN_EMAIL`. **Prohibited in this pass** (no modifying/deleting user records) — needs
  explicit authorisation.

**Why it matters beyond tests:** if production `ADMIN_EMAIL` does not match the admin row
in the production database, **admin login is broken in production too.** render.yaml sets
`ADMIN_EMAIL` with `sync: false`, i.e. the production value is entered in the Render
dashboard and is not visible in this repo — it must be verified before release (§10.4).

### DEFECT-B (P2, design) — receipt HTML is not link-shareable

Because `GET /api/receipts/:id/html` requires a Bearer token, receipts can never be opened
via a plain link/new tab (the root cause of BUG-2026-10-02). The client fix works, but if
receipts ever need to be shared, downloaded or embedded, a short-lived signed URL would be
the right approach. Out of scope for this pass.

### Not changed (security control)

The per-process rate limits (100/15-min global, 20/15-min auth) were **not** altered — they
are a deliberate security control. The integration procedure was adjusted around them
instead.

---

## 7. Business-logic preservation confirmation

- Payment verification, UTR/UPI extraction and matching, approval gates, expiry and
  wallet-crediting logic are **byte-for-byte unchanged** by this phase.
- Diffs reviewed: `server/src/index.js` contains **only** the auth import + the route
  protection; `client/src/pages/user/Receipts.jsx` contains **only** the viewer fix.
- `server/src/services/ocrService.js` was re-verified: its diff contains **only** (i) the
  prior session's `labeledRe` (OCR-split alphanumeric UTR) change and (ii) the earlier
  glue-rule fix `\s+` → `[ \t]+` with its explanatory comment. Nothing else.
- All approval-gate rules R1–R15 still verify live end-to-end (36/37, single known-defect
  red).

## 8. Prior work preserved / git state

`git status --short` — branch `main` @ `8b88834`, **no commits**:

```
 M client/src/pages/user/Receipts.jsx            <- this phase
 M server/src/index.js                           <- this phase
 M server/src/services/ocrService.js             <- prior session (preserved)
 M server/src/services/paymentService.js         <- prior session (preserved)
 M server/src/services/topupService.js           <- prior session (preserved)
 M server/src/services/verificationService.js    <- prior session (preserved)
 M server/src/tests/integration/api.test.js      <- this phase
 M server/src/tests/integration/business-rules.test.js  <- this phase
?? client/src/pages/user/Receipts.test.jsx             <- this phase
?? server/src/tests/integration/_helpers.mjs           <- this phase
 ?? server/src/tests/integration/cache-stats-auth.test.js <- this phase
 ?? server/src/tests/unit/admin-login-existing-row.test.js <- this phase (DEFECT-A verification)
 ?? server/__dateprobe.mjs  __dbprobe.mjs  __probe.mjs  <- prior session (preserved)
 ?? server/src/tests/unit/payment-validation-matrix.test.js <- prior session (preserved)
```

## 9. Recommendations / next steps

1. **Decide DEFECT-A.** Investigation is complete (§10) but Option A was **not** applied
   because the intended administrator could not be confirmed as the seeded account and the
   configured password does not match that row's stored hash. Recommended next decision:
   authorise (b)+(d) (guard the insert result, then align/free the stray row), or confirm
   that `[REDACTED]` is in fact the intended administrator. Then verify production
   admin login works.
2. Adopt the integration procedure: **restart the server before an integration pass**;
   expect **36/37** with the single, clearly-labelled admin-login red until DEFECT-A is
   resolved.
3. Optional cleanups already identified by the audit: BUG-2026-10-06 (port the 5
   `node:test` files to vitest so `npx vitest run` reports no "no test suite" files);
   consider DEFECT-B if receipts must be shareable.
4. Review the four `server/src/services/*.js` prior-session changes and the QC probe files
   before committing.

---

## 10. DEFECT-A investigation — administrator identity & credential verification

Performed 2026-10-16 as an **investigation only**. No configuration file, environment
variable, database row or business rule was changed. No credentials are reproduced below.

### 10.1 Identity evidence (which email is the intended administrator?)

| Source | Administrator identity |
|---|---|
| `.env.example` (`ADMIN_EMAIL`) | `[REDACTED]` |
| `README.md` | `[REDACTED]` |
| `server/.env.example` | `[REDACTED]` |
| `server/.env` (local, non-secret key) | `[REDACTED]` |
| `server/src/scripts/production-final-check.js` (hard-codes login checks) | `[REDACTED]` |
| `render.yaml` (`ADMIN_EMAIL`) | value `sync: false` (set in Render dashboard, not in repo) |
| Git history (`git log -S 'ADMIN_EMAIL=[REDACTED]'`) | `55d7844` |
| **Live DB `users` row with `role='admin'`** | **`[REDACTED]`** (id `837d89f3-…`, `referral_code='ADMIN001'`) |
| Code / docs referencing `[REDACTED]` | **none** (searched all tracked + untracked files) |
| `git log -S '[REDACTED]'` | empty |

Every in-repo authoritative source names `[REDACTED]`. The sole live admin row is
`[REDACTED]`, which is referenced **nowhere** in the project and is not created by
any seed script (`server/src/scripts/seedDefaultUsers.js` provisions only QA users
`qa.{120,500,1000}@jsree.local` and never touches admin rows) or migration.

Operational history does show real successful logins to that row — `audit_logs` contains 46
admin actions by it (incl. `admin_login`, `approve_payment`, `delete_payment_registration`,
`hard_delete_user`, `update_user_status_active`; newest `2026-10-16T09:17:15Z`) and
`ip_logs` contains 57 `admin_action` events (newest `2026-10-11`). Because
`logAction(adminUser.id, …, 'admin_login', …)` is reached only **after** a successful
password match and row resolution (`authService.js:230`), these rows prove
`ADMIN_EMAIL` was `[REDACTED]` at some point. This **contradicts** the current,
documented configuration — hence the identity could not be conclusively established.

### 10.2 Verified root cause

- `adminLogin()` (`server/src/services/authService.js:182-239`) compares the submitted
  email to `process.env.ADMIN_EMAIL` and the password to
  `process.env.ADMIN_PASSWORD_HASH` — **env only, never the DB row's hash**.
- It then looks the user up by `ADMIN_EMAIL`. If absent it **inserts** a new admin with the
  fixed `referral_code: 'ADMIN001'` (line 221). Since `ADMIN001` is already held by the
  `[REDACTED]` row, the insert fails its unique constraint → returned `data` is
  `null` → `adminUser.id` at line 228 throws → the endpoint returns
  `500 ADMIN_LOGIN_FAILED "Cannot read properties of null (reading 'id')"`.
- The failure is **not** the password (the configured hash verifies against the expected
  admin password) — it is the missing row + the unhandled `null`.

### 10.3 Credential-alignment probe (booleans only)

Read-only probes (bcrypt comparisons, no values logged):

- `stored_row_hash === ADMIN_PASSWORD_HASH` → **false**
- `bcrypt(<documented admin password>, stored_row_hash)` → **false**
- `bcrypt(<documented admin password>, ADMIN_PASSWORD_HASH)` → **true**

The configured hash matches the **documented** admin password but does **not** match the
`[REDACTED]` row's stored hash. Therefore the configured credential cannot be shown
to belong to the seeded account → the instruction's hard-stop condition was met and
**Option A was not applied.**

### 10.4 Deployment configuration (unresolved)

`render.yaml` declares `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` under `sync: false`, so the
production values are set manually in the Render dashboard and are **not** in this repo.
They must be verified against the production database's admin row before release;
otherwise admin login may be broken in production for the same reason.

### 10.5 Step 3 — isolated verification (no production writes)

Admin-login behaviour was verified in an isolated, mocked-Supabase environment; the shared
database was not written to and no credentials were exposed:

| Command | Result |
|---|---|
| `npx vitest run src/tests/unit/admin-login-existing-row.test.js` (new) | **5/5 pass** |
| `npx vitest run` (server, all 45 files) | **1167/1168 pass** (only red = pre-existing seed flake, §10.6) |
| `npx vitest run` (client) | **15/15 pass** |
| `npm run build` (client) | **OK** (`index-W9mSzhPI.js` 447.49 kB / gzip 128.83 kB) |
| `node --test` legacy units (`cache`,`helpers`,`pagination`) | **28/28 pass** |

New regression `server/src/tests/unit/admin-login-existing-row.test.js` asserts, with a
mocked Supabase client, that when a row already exists for `ADMIN_EMAIL`:

1. correct password → success, JWT role `admin`, and **`insert` is never called** (the
   exact `ADMIN001` conflict condition) — only the SELECT runs;
2. wrong password → `INVALID_CREDENTIALS`, no row lookup, no insert;
3. non-matching email → `INVALID_CREDENTIALS`, no DB access;
4. matching row that is not an admin → `ADMIN_REQUIRED`, no insert;
5. missing admin env pair → `ADMIN_NOT_CONFIGURED`, no DB access.

These complement the existing suite (`auth-role-separation.test.js` CASEs 3–4, which cover
admin login success, auto-provision, and rejection of normal users), `cache-stats-auth.test.js`
(401 without token / 403 for non-admin / 200 for admin on an admin-only endpoint), and the
integration approval-gate rules R10–R15 which all continue to pass live.

### 10.6 Pre-existing test flake (not a regression)

`server/src/tests/unit/seed-default-users.test.js` "stores a real bcrypt hash" intermittently
times out at 5000 ms because it runs bcryptjs (12 rounds) over three users; it passes
reliably when the machine is not loaded (verified: 9/9 alone) and times out under load. It is
timing-sensitive and unrelated to this phase's changes. Consider raising that test's timeout
as a separate housekeeping item.

### 10.7 Decision & unresolved items

- **Configuration change applied: none.** Identity not confirmed + credential not aligned to
  the seeded row ⇒ per the stop rules, no `.env`, `render.yaml`, DB row, or code was changed.
- **Open decisions for the owner:** (i) confirm the intended administrator
  (`[REDACTED]` vs `[REDACTED]`); (ii) if `[REDACTED]`, authorise freeing
  `ADMIN001` / aligning the stray row (data action) and/or the error-handling guard (b);
  (iii) verify the production Render env values against the production admin row.
- No commit was made; git state is unchanged from §8 apart from the one new test file.
