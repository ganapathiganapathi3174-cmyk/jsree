# FINAL PRODUCTION RELEASE REPORT

**Release commit:** `277a110f1a1d6ab2c90cee7cf78af3ae6917f0f6`
**Message:** `feat: finalize payment verification v2 production readiness`
**Date:** 2026-11-16
**Repo:** `https://github.com/ganapathiganapathi3174-cmyk/jsree.git` (branch `main`)
**Prior HEAD:** `57ae855bf04bb3806c9c9706540fe95d80d474ef` (= previous `origin/main`)

---

## 1. VERDICT

# **PARTIALLY RELEASED**

| Gate | Result |
|---|---|
| Local code recovery + V2 rebuild committed | **PASS** |
| Full test suite — 0 assertion failures | **PASS** |
| Client production build | **PASS** |
| Release pushed to `main` | **PASS** — `57ae855..277a110` |
| Frontend (Vercel) deployed + verified live | **PASS** |
| Backend (Render) deployed | **UNVERIFIED** — no render CLI / API token in workspace |
| Production DB migration **015** applied | **FAIL / BLOCKED** — approval **A** + `DATABASE_URL` required |
| Receiver (payee) name gate configured | **FAIL** — approval **B** (`ADMIN_RECEIVER_NAME`) required |

**Why not FULLY RELEASED:** migration `015_atomic_wallet_credits.sql` is not applied in production, so
`credit_wallets_atomic` does not exist and wallet crediting cannot complete. This is **not** a regression
introduced by this release — see §5.

**Why not BLOCKED:** every local gate passed, the release was committed and pushed, and the frontend is
verified live serving the current source. The outstanding items are operator approvals, not code defects.

---

## 2. PHASE RESULTS

| Phase | Status | Evidence |
|---|---|---|
| 0 — read reports, inspect repo/engine/migrations | DONE | V2 engine 15 files / 46 exports, `BROKEN_COUNT=0`; migrations 001–021 |
| 1 — redaction | DONE | 30 project-ref + 7 UPI replacements; residual scan = 0 project ref, 0 UPI in docs |
| 2 — server-side amount derivation | PASS | `PLAN_AMOUNTS` (120/500/1000) is single authority; client cannot supply an amount |
| 3 — exactly-once wallet credit | PASS | guarded status flip → UTR reserve → atomic credit → revert on failure; 6 files / 65 tests pass |
| 4 — migration verification | **BLOCKER** | §5 |
| 5 — env config inventory | DONE | §6 |
| 6 — full testing | PASS | §4 |
| 7 — route regression | PASS | §7 |
| 8 — backup + recovery | PASS (with limits) | §8 |
| 9 — staging review + commit | DONE | §3 |
| 10 — deploy | PARTIAL | Vercel verified; Render unverified |
| 11 — live verification | PASS | §7 |
| 12 — this report | DONE | — |

---

## 3. STAGING REVIEW (Phase 9)

Staged with **explicit paths only** — `git add -A` was never used.

| Status | Count | Notes |
|---|---|---|
| Modified (`M`) | 24 | 15 V2 engine wiring + 2 restored gap tests + `api.test.js` + 7 redaction files |
| Deleted (`D`) | 43 | old engine / services / scripts / superseded tests |
| Added (`A`) | 11 | V2 `index.js` + V2 tests + docs |
| Renamed (`R`) | 14 | git detected old → V2 engine renames |
| **Total staged** | **92** | |
| Not staged | 1 | `referral-platform` gitlink — **deliberately excluded** (Option C retained) |

**Pre-commit secret scan of the staged diff:**

| Pattern | Hits |
|---|---|
| JWT (`eyJ…`) | **0** |
| Private keys | **0** |
| Service-role key literal | **0** |
| Supabase project ref | **0** added (3 removed — that is the redaction working) |
| `postgres://` credential-shaped | 2 added — both `<PROJECT_REF>` + placeholder password (instruction templates) |
| Receiver UPI VPA | 3 added lines (V2 comments + test fixtures) — see §9 |

**Reconciliation:** Phase 15 recorded 59 deletions; Phase 17 restored 2 gap tests
(`payment-timezone`, `private-screenshot-storage`) → 57; Phase 1 redaction added 7 modified files.
24 + 43 + 11 + 14 = 92. Nothing unexplained.

**Dangling imports:** no live file imports any deleted path (`BROKEN_COUNT = 0`; only stale
documentation comments mention `ocrService`, and `ocr.js` imports `./ocrExtraction.js`).

---

## 4. TEST RESULTS (Phase 6) — measured, not inferred

### 4.1 `node --test` (the 5 files vitest cannot collect)

| File | tests | pass | fail | skipped | exit |
|---|---|---|---|---|---|
| `unit/cache.test.js` | 6 | 6 | 0 | 0 | 0 |
| `unit/helpers.test.js` | 14 | 14 | 0 | 0 | 0 |
| `unit/pagination.test.js` | 8 | 8 | 0 | 0 | 0 |
| `integration/business-rules.test.js` | 15 | 11 | **0** | 4 (ENV) | 0 |
| `integration/api.test.js` | 22 | 14 | 1 (ENV) | 7 (ENV) | 1 |

The single `api.test.js` failure is `POST /auth/admin-login` — the documented environment case
(needs a live DB admin row; `ADMIN_EMAIL`/`ADMIN_PASSWORD_HASH` are not available offline).
It is identical to the Phase 16/17 measured baseline.

**Assertion failures = 0.**

> **Transient note:** an earlier run of these two files returned 429 cascades. Root cause was the
> long-lived ambient test server's in-memory 15-minute rate-limit window
> (`express-rate-limit`, auth max 20 / admin-login max 10) being exhausted by repeated runs in one
> session — **not** a product defect. After the window reset both files returned to baseline
> (`business-rules` 11/0/4, exit 0). No test was modified, skipped or weakened to achieve this.

### 4.2 vitest (full server suite)

- **46 files** — 40 passed, **6 reported failed (all hollow)**, `fail 0`
- **397 tests passed, 5 skipped**, exit 1
- The 6 hollow failures are the `node:test` files above (wrong runner), plus the live-DB suite —
  documented in Phase 16 §7. **No assertion failure.**

### 4.3 Client

- vitest: **6 files / 20 tests passed / exit 0**
- `vite build`: **exit 0** (~2.9 s)

### 4.4 Syntax

- `node --check` over all existing `.js/.mjs/.cjs`: **141 files, 0 errors**
  (`.jsx` is excluded — node cannot parse JSX; Vite build proves client syntax)

### 4.5 Financial suites (exactly-once)

**6 files / 65 tests / all pass / exit 0.**

---

## 5. MIGRATION STATE (Phase 4) — THE PRIMARY BLOCKER

### 5.1 Evidence

| Source | Finding |
|---|---|
| Live read-only catalog probe (14 Nov, `PRODUCTION_BACKUP_AND_FINAL_SAFETY_REPORT.md`) | `015 → applied:false` (`credit_wallets_atomic` **absent**); `017–021 → applied:true` |
| 14 Nov verified backup (213,581 B) | contains no `credit_wallets_atomic` |
| `supabase/migrations/015_atomic_wallet_credits.sql` | the **only** definition of `credit_wallets_atomic` |
| This workspace | **no** `DATABASE_URL`, **no** `SUPABASE_URL`, **no** `SUPABASE_ACCESS_TOKEN`, no `psql`/`pg_dump` |

### 5.2 Is this a regression introduced by this release? **NO**

`server/src/services/walletService.js` is **byte-identical** to the previous HEAD and calls
`supabase.rpc('credit_wallets_atomic', …)` in both. Production therefore had the same gap **before**
this release: top-up wallet credits already failed and parked as
`manual_review` + `WALLET_CREDIT_FAILED`. Deploying V2 changes nothing here — it neither fixes nor
worsens it.

### 5.3 Consequence

Until 015 is applied, verified payments/top-ups cannot credit a wallet automatically; they park for
operator action. **Applying 015 requires approval A + a `DATABASE_URL`.** It was not attempted:
no credentials exist in this workspace, and no destructive or production DB operation was performed.

---

## 6. ENVIRONMENT CONFIG INVENTORY (Phase 5)

### 6.1 `render.yaml`

Declares: `NODE_VERSION`, `NODE_ENV=production`, `CLIENT_URL`, `JWT_EXPIRES_IN`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`,
`ADMIN_UPI_ID`, `ADMIN_RECEIVER_NAME`, `PAYMENT_PROVIDER_MODE=none`, `DATABASE_URL`
(all secrets `sync: false` — entered in the Render dashboard, never stored in the repo).

### 6.2 `vercel.json`

`outputDirectory: client/dist`, SPA rewrite `/:path* → /index.html`, **no `/api` proxy** — the client
calls the backend origin directly via `VITE_API_URL`.

### 6.3 Server env vars with production-safe defaults (no Render entry needed)

`PAYMENT_TIME_WINDOW_MINUTES=30`, `PAYMENT_CLOCK_SKEW_TOLERANCE_SECONDS=120`,
`MIN_OCR_CONFIDENCE_APPROVE=55`, `SENDER_NAME_POLICY=reject`, `PAYMENT_PROVIDER_MODE=none`,
`OCR_VERIFICATION_BUDGET_MS=120000`, provider URL/key/timeout, OCR recovery budgets,
`NORMALIZE_UTRS_FOR_DUPLICATE=false`, `RATE_LIMIT_GLOBAL_MAX=100`, `RATE_LIMIT_AUTH_MAX=20`,
`RATE_LIMIT_ADMIN_LOGIN_MAX=10` — all read in `paymentConfig.js` / `app.js` with safe fallbacks.

`QA_SEED_PASSWORD` is required only by the manual `seed:qa-users` script, never at runtime.

### 6.4 Client

`VITE_API_URL` (bundled) and `VITE_DEV`. Live bundle verified to contain
`https://jsree-backend.onrender.com/api` and **no** Supabase URL/key/`eyJ…`.

### 6.5 Live confirmation of a config gap

`GET /api/config/public` → `"receiver_name": ""` — **`ADMIN_RECEIVER_NAME` is not set in Render**,
so the OCR secondary payee-name gate is currently inactive (receiver UPI + amount + date + integrity +
duplicate gates remain mandatory). **Approval B.**

---

## 7. ROUTE REGRESSION + LIVE VERIFICATION (Phases 7 & 11)

### 7.1 Public API (local `:5000` and production `jsree-backend.onrender.com` — identical)

| Route | Local | Production |
|---|---|---|
| `GET /api/health` | 200 | 200 |
| `GET /api/config/public` | 200 | 200 |
| `GET /api/plans` | 200 | 200 |
| `GET /api/referral-tiers/tiers` | 200 | 200 |
| `GET /api/nonexistent` | 404 | 404 |

### 7.2 Authenticated user/admin routes

Covered by the passing integration suites: dashboard, wallet balance/transactions, referrals,
top-ups, receipts, payments, notifications, referral-tiers, security ip-history, export
financial-summary, admin bulk-approve, admin delete/idempotency, financial-history retention.

### 7.3 Frontend SPA (Vercel)

`/`, `/login`, `/register`, `/dashboard`, `/admin`, `/topups`, `/receipts`, `/referrals`, `/wallet`,
`/plans`, `/some-deep/route` → **all 200 `text/html`** (SPA rewrite correct).

### 7.4 Release actually live

- `git ls-remote origin main` = `277a110…` = local HEAD.
- GitHub deployment for `277a110` → **state `success`**, "Deployment has completed",
  alias `https://jsree.vercel.app`.
- Live HTML references `assets/index-DJLBHuMc.js`; its **490,168 B** body contains **all 5**
  distinctive strings taken from the current committed `client/src/pages/user/TopUps.jsx`
  (`Failed to load top-ups`, `A verification for this screenshot is already in progress…`,
  `Failed to submit proof`, `Only completed top-ups count towards the total.`,
  `Top-up is not available for your current plan.`) → the live site serves the current source.
  (Vite content hashes are non-deterministic across runs, so content markers were used instead.)

### 7.5 CORS / security headers (production)

- `Origin: https://evil.example` → **no** `Access-Control-Allow-Origin` (correctly rejected)
- `Origin: https://jsree.vercel.app` → `ACAO=https://jsree.vercel.app` + `credentials=true`
- Headers present: `strict-transport-security`, `content-security-policy`,
  `referrer-policy`, `cross-origin-opener-policy`, `cross-origin-resource-policy`

### 7.6 Pre-deploy boot smoke test

Current source started standalone (`node src/index.js`, free port) → `GET /api/health` **200**,
empty stderr, process stable → V2 wiring does not prevent boot.

---

## 8. BACKUP & RECOVERY (Phase 8)

| Item | Value |
|---|---|
| File | `C:\Users\pavi\Desktop\jsree-backup\production-backup-20261114-213603.sql` |
| Size | 213,581 B |
| SHA-256 (recomputed this phase) | `CA80B33651CAEE9E0344B2156ACE7EE5404BEED7CA56744F932131749E019E29` |
| Recorded in `.sha256` | identical → **MATCH: True** |
| Location | **outside** the repository; never copied in, never committed |
| Scope | public schema only — **no** Auth users, Storage objects, RLS policies or roles |
| Freshness | 14 Nov 2026 — predates this release (no schema change in this release) |

**Limits (must be disclosed):** Supabase free tier has **no automated backups**; PGlite 18.3 was the
only validated restore target (never 17.12). A new backup cannot be taken from this workspace —
no `pg_dump`/`psql` and no `DATABASE_URL`.

**Recovery order:** restore SQL → verify SHA-256 → re-apply migrations in order → verify
`credit_wallets_atomic` exists → run the guarded applier for anything outstanding.

---

## 9. RESIDUAL FINDINGS / HONEST DISCLOSURES

1. **Receiver UPI VPA is public in the repository.** It appears in **63 tracked files at HEAD**
   (including `client/src/utils/constants.js`, `README.md`, `.env.example`, migrations and tests),
   and in 3 newly added lines (V2 comments + test fixtures). The Phase 1 mandate — redact it from the
   **safety reports** — was completed. It was **not** removed from source because it is the functional
   payee address the app must compare screenshots against and display to payers; removing it would
   break verification and every financial test. Treat as a payee address, not a credential — but it is
   a residual exposure the operator should decide on.
2. **`PAYMENT_PROVIDER_MODE=none`.** No live bank/UPI settlement verification is configured. A
   screenshot alone cannot conclusively prove bank settlement. This is a documented product
   limitation, not a defect — and must never be described as live verification.
3. **No `.env` / no DB credentials** anywhere in this workspace; every DB-dependent check used either
   a prior live read-only probe or the ambient local test server.
4. **Ambient test server** (`node src/index.js`, PID from 12 Nov) holds the only working DB
   credentials; it was **not** restarted, so its rate-limit counters were left to expire naturally.
5. **`referral-platform`** nested gitlink: recorded SHA == nested HEAD
   (`8982086e…`); only `-dirty` from 11 uncommitted nested files. **Option C retained**, pointer not
   altered, dependency still to be documented in-repo.

---

## 10. CONSOLIDATED APPROVALS / ACTIONS REQUIRED

One list, no partial actions taken:

| # | Approval | What is needed | Why | Consequence if not done |
|---|---|---|---|---|
| **A** | **Apply migration 015** | Explicit approval **+** a `DATABASE_URL` (or `SUPABASE_ACCESS_TOKEN`) | `credit_wallets_atomic` absent in production (§5) | Verified payments/top-ups park as `manual_review` + `WALLET_CREDIT_FAILED`; wallets never credit |
| **B** | **Set `ADMIN_RECEIVER_NAME`** in Render | Operator dashboard action (value: the payee name) | `receiver_name` is `""` live (§6.5) | OCR secondary payee-name gate inactive |
| **C** | **Confirm Render deployment of `277a110`** | Render dashboard, or supply a Render API token / install the render CLI | Not verifiable from this workspace (§1, §10) | Backend may still run the pre-V2 engine while the frontend runs V2 |
| **D** | **Decide on the UPI VPA in source** (§9.1) | Operator decision | Present in 63 files at HEAD | Ongoing exposure of the payee address |
| **E** | **Document the `referral-platform` Option C dependency** in-repo | Doc edit | Mandated decision, documentation outstanding | Dependency undocumented |
| **F** | **Take a fresh production backup** once A is applied | `pg_dump` + credentials | Existing backup predates 015 | No restore point covering the new function |

**Not done on purpose:** no migration applied, no DB/Storage mutation, no Render env change, no
force push, no test deleted or weakened, no secret printed, no `git add -A`, no destructive command.

---

## 11. HOW TO REPRODUCE THE CLAIMS

```bash
# commit + remote
git rev-parse HEAD                       # 277a110f1a1d6ab2c90cee7cf78af3ae6917f0f6
git ls-remote origin main                # same SHA
git status --porcelain                   # only " M referral-platform"

# tests (from server/)
npx vitest run                          # 46 files, 397 passed, 6 hollow, fail 0
node --test src/tests/unit/cache.test.js src/tests/unit/helpers.test.js \
            src/tests/unit/pagination.test.js \
            src/tests/integration/business-rules.test.js \
            src/tests/integration/api.test.js

# backup integrity
Get-FileHash -Algorithm SHA256 'C:\Users\pavi\Desktop\jsree-backup\production-backup-20261114-213603.sql'

# live
curl -s https://jsree.vercel.app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
curl -s https://jsree-backend.onrender.com/api/health
curl -s https://jsree-backend.onrender.com/api/config/public   # receiver_name => ""
```
