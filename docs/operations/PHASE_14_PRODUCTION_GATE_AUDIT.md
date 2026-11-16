# JSREE — Phase 14: Production Gate Audit

**Date:** 15 Nov 2026
**Basis:** `docs/operations/PHASE_13_PGLITE_BACKUP_VALIDATION.md` + fresh read-only inspection.
**Mode:** STRICTLY READ-ONLY. No production mutation, migration, Storage/Auth change,
Render/Vercel change, commit, push, or deploy was performed.

---

## 1. Executive verdict

# 🔴 BLOCKED

The workspace **cannot** certify production readiness. Two independent classes of
blocker exist:

1. **Release-integrity blocker (hard):** the entire Phase 1–13 rebuild
   (payment verification **V2** engine, its callers, its tests, this document set)
   is **uncommitted local working-tree state**. `origin/main` — and therefore the
   deployed production build — still ships the **old** engine.
2. **Production-state blocker (hard):** no production fact (migration state,
   dashboard env values, Storage bucket state, health) can be verified from this
   workspace. The single highest-risk item — migration **015**, which backs the
   *only* wallet-credit code path — is **unverified** and **absent from the most
   recent backup**.

The verdict becomes **CONDITIONAL** once §8 blockers R1–R5 have read-only evidence,
and **READY** only when R1–R9 are closed with the operator evidence listed in §10.

---

## 2. Gate status summary

| Gate | Status | One-line reason |
|---|---|---|
| **A — Backup & Recovery** | 🟡 **CONDITIONAL** | Checksum/consistency PASS 3×; PGlite vs 17.12/Supabase clearly separated; **Auth + Storage + roles not covered** — recovery plan documented but untested |
| **B — Database Migrations** | 🔴 **BLOCKED** | Production state of 015–021 is **UNVERIFIED**; 016 has **no detector at all**; must not be inferred from dump/commit message |
| **C — Payment Readiness** | 🔴 **BLOCKED** | Wallet credit depends on unverified 015; `ADMIN_RECEIVER_NAME` unset; `payment_verifications` never written |
| **D — Deployment & GitHub** | 🔴 **BLOCKED** | 80 uncommitted entries; V2 engine **not in HEAD**; `VITE_API_URL` unverifiable; 6 failed test files |

---

## 3. Gate A — Backup and Recovery 🟡 CONDITIONAL

### Evidence

| Check | Result |
|---|---|
| Backup path | `C:\Users\pavi\Desktop\jsree-backup\production-backup-20261114-213603.sql` |
| Size | 213,581 bytes / 2,260 lines |
| SHA-256 recomputed (this phase) | `CA80B33651CAEE9E0344B2156ACE7EE5404BEED7CA56744F932131749E019E29` |
| Sidecar `.sha256` expected | `CA80B33651CAEE9E0344B2156ACE7EE5404BEED7CA56744F932131749E019E29` |
| Match | **MATCH** (3rd independent verification; also verified pre- and post-cleanup in Phase 13) |
| Phase 13 report consistency | Report contains identical checksum, `213,581`, `PARTIAL PASS`, `PostgreSQL 18.3`, `17.12` — **consistent, no drift** |
| Backup present inside repo / tracked by git | **0** matching files, **0** tracked matches — backup is **outside** the repository and cannot be pushed |

### PGlite vs PostgreSQL 17.12 / Supabase — the distinction (explicit)

| Claim | Status |
|---|---|
| Backup restores losslessly into a vanilla PostgreSQL-family engine | ✅ **PROVEN** — 160/160 statements, 17 tables, 595 rows, 6 functions, 7 triggers, 17 FKs |
| Backup restores on **PostgreSQL 17.12** (`pg_restore`/`psql`) | ❌ **NOT PROVEN** — no PG binaries; PGlite is **18.3** |
| Backup restores into the **live Supabase project** | ❌ **NOT PROVEN** — no production access attempted |
| Supabase-managed roles/grants/ownership reproduced | ❌ **NOT PROVEN** — dump contains 0 `CREATE ROLE`/`GRANT`/`REVOKE` |
| Storage objects recoverable from this backup | ❌ **IMPOSSIBLE** — 0 `storage.` references |
| Auth (`auth.users`) recoverable from this backup | ❌ **IMPOSSIBLE** — 0 `auth.` references |

### Missing coverage — safe recovery plan

| Missing component | Risk if a restore is attempted | Safe recovery plan (operator, requires authorization) |
|---|---|---|
| **Storage objects** (`payments` screenshots, `avatars`) | `screenshot_url` values point at deleted objects; OCR re-verification and admin proof views fail | 1) Take a Supabase **project-level** backup/PITR point (the only artifact covering object bytes). 2) Separately export both buckets (Dashboard → Storage → download, or S3-tier stream to encrypted offsite). 3) Record bucket flags (`payments.public`, `avatars.public`) and `storage.objects` policies. 4) After restore, re-run 021's post-apply verification (`public=false`, `remaining_read_policies=0`). **No export or permission change performed in this phase.** |
| **Supabase Auth** (`auth.users`, identities, sessions) | `public.users` rows restore but **no one can log in** | Take the project-level backup above; restore `auth` schema from the same artifact. Record that a bare SQL restore leaves credentials unusable until `auth` is restored or passwords re-provisioned. |
| **Roles / grants / revokes** | Objects owned by the wrong role; RPCs callable by unintended roles | Re-apply 014 and 020 (both contain the `REVOKE`/`GRANT` pairs for SECURITY DEFINER RPCs) after any bare restore, via the guarded applier. |
| **`storage.buckets` metadata** | Bucket may not exist after a bare restore; 021 will raise `BUCKET_NOT_FOUND` | Recreate buckets explicitly (payments private, avatars public) before running 021. |
| **Non-`public` schemas (`auth`, `realtime`, `extensions`, `storage`)** | Incomplete system | Prefer project-level restore over bare SQL restore for any real DR event. |

**Gate A verdict:** the artifact is *authentic and internally consistent*; it is
**not** a complete disaster-recovery artifact. A recovery plan exists on paper but
has **never been executed** → **NOT VERIFIED**.

**Rule confirmed:** no production backup was uploaded to any external service or to
GitHub (0 backup files inside the repo, 0 tracked).

---

## 4. Gate B — Database Migrations 🔴 BLOCKED

Migrations **015–021 inspected** (file contents only — **no migration executed**).

| File | LOC | Tables | Functions | Policies | SECURITY DEFINER | DML stmts | Tool detector |
|---|---:|---:|---:|---:|---:|---:|---|
| 015 `atomic_wallet_credits` | 103 | 0 | 1 | 0 | 1 | 2 | ✅ present |
| 016 `payment_validation_engine` | 59 | 0 | 0 | 0 | 0 | 0 | ❌ **absent** |
| 017 `payment_verification_history` | 56 | 1 | 0 | 0 | 0 | 0 | ✅ present |
| 018 `complete_user_deletion` | 200 | 1 | 1 | 0 | 2 | 19 | ✅ present |
| 019 `enable_rls_core_tables` | 96 | 0 | 0 | 1 | 0 | 0 | ✅ present |
| 020 `admin_delete_topup_retains_utrs` | 72 | 0 | 1 | 0 | 1 | 2 | ✅ present |
| 021 `private_payments_bucket` | 72 | 0 | 0 | 1 | 0 | 2 | ✅ present |

### State classification — **no production state inferred**

Per the audit rule, production state is **not** inferred from local files, from the
PGlite restore, or from a commit message.

| Migration | **Production state (authoritative)** | Non-authoritative local signals (recorded, *not* used as confirmation) |
|---|---|---|
| **015** | **UNVERIFIED** | 14 Nov dump: `credit_wallets_atomic` **absent**; commit `57ae855` does not mention 015 |
| **016** | **UNVERIFIED — and unverifiable by tool** | Detector does not exist in `migrationState.mjs` → guarded applier **cannot** skip/refuse correctly; requires a manual read-only SQL probe |
| **017** | **UNVERIFIED** | dump contains `payment_verifications` table; commit claims applied |
| **018** | **UNVERIFIED** | dump `admin_delete_user` matches all three 018 post-conditions (`approved_utrs` not deleted, `audit_logs` not deleted, `actor_id = NULL` present) + archive table exists |
| **019** | **UNVERIFIED** | dump shows `ENABLE ROW LEVEL SECURITY` on 17/17 tables (019 has exactly 17) |
| **020** | **UNVERIFIED** | dump `admin_delete_topup` has **no** `DELETE FROM approved_utrs`; the 009 body **does** — consistent with 020 |
| **021** | **UNVERIFIED** | bucket state lives in `storage`, **absent from the dump**; last direct observation (11 Nov) was `public=true` |

> The 11 Nov `MIGRATION_ROLLOUT_CHECKLIST.md` states 017/018/021 NOT APPLIED,
> 019 PARTIAL. The 14 Nov dump *appears* newer. **Both are local artifacts.**
> Only a read-only probe against `<PROJECT_REF>` settles this.

### Migration 015 — prerequisites and production execution risks

**Prerequisites (present in the dumped schema):**
- `users.wallet_balance` ✅
- `wallet_transactions` table + unique/ledger structure ✅
- roles `anon`, `authenticated`, `service_role` ✅ (Supabase-managed; **absent** on vanilla PG — proven in Phase 13)

**Why 015 is the #1 risk — it is not optional:**

- `walletService.creditBatch()` is implemented **solely** as
  `supabase.rpc('credit_wallets_atomic', …)`; it throws on any RPC error.
- `credit_wallets_atomic` is created **only** by 015 (grep across all 22 migrations).
- Callers:
  - `topupService.js:677` → `creditTopupWallets()` → **blocking** on top-up approval
  - `paymentService.js:177` → referral bonus → wrapped in `try { } catch { /* non-blocking */ }`
- Consequence **if 015 is unapplied in production:** `applyTopupVerification`
  performs the guarded `status → completed` UPDATE **first**, then calls
  `creditTopupWallets`, which throws → **record says `completed`, wallet never
  credited**, and every retry re-enters the same path. Registration approval still
  succeeds (referral bonus is non-blocking); **top-up does not.**

**Production execution risks when 015 is eventually applied:**
- It is `SECURITY DEFINER` with `search_path = public` — correct shape, but a
  wrong `search_path` at apply time would create a hijackable function.
- It `REVOKE`s from `PUBLIC`/`anon`/`authenticated` and `GRANT`s `service_role`
  only; on a target lacking those roles the apply **fails** (observed: `role "anon" does not exist`).
- `CREATE OR REPLACE` is idempotent, but a *differently shaped* pre-existing
  function makes the detector return `error` and the applier **refuses** — that is
  the designed safety behaviour and must not be bypassed.
- Must be applied in one transaction under advisory lock `717017` via
  `apply-migration-guarded.mjs`, **after** a fresh backup.

**Gate B verdict:** no migration may be marked applied. **BLOCKED** pending
read-only probes (§10, approval **A**).

---

## 5. Gate C — Payment Production Readiness 🔴 BLOCKED

### 5.1 Flows verified (code + route inspection only; **no test payment created**)

**Registration payment flow**
```
POST /api/auth/register
POST /api/payments                    (validatePayment)
POST /api/payments/:paymentId/screenshot  (uploadScreenshot + deduplicateProofUpload)
POST /api/payments/:paymentId/verify
GET  /api/payments/:paymentId/status
GET  /api/payments/:paymentId/screenshot   (owner/admin proxy)
```
Approval path: guarded `status → approved` UPDATE (`.in('status', ACTABLE_STATUSES)`)
→ user `pending → active` with rollback on failure → referral side-effects
(non-blocking) → `audit_logs`.

**Top-up flow**
```
GET  /api/topups
POST /api/topups/:topupId/proof
POST /api/topups/direct                (direct sponsor top-up)
POST /api/topups/claim
GET  /api/topups/:topupId/proof
```
Approval path: OCR decision → guarded `status → completed` UPDATE (only the winner
of the guarded flip proceeds) → expiry re-check → atomic UTR reservation →
`creditTopupWallets()` (**requires 015 — see §4**).

**Plan eligibility — confirmed `₹120 / ₹500 / ₹1,000`**
- `paymentConfig.js:18` → `PLAN_AMOUNTS = { '120': 120, '500': 500, '1000': 1000 }`
- `paymentService.js:42` → identical local map; unknown plan → `INVALID_PLAN`
- `configService.js` defaults → `plans: { '120': 120, '500': 500, '1000': 1000 }`
- Production `payment_config` dump row `plans` present (5 config rows total)
- Top-up eligibility gate → `PLAN_NOT_ELIGIBLE` (`topupService.js:44,100`)

### 5.2 Receiver configuration — `ADMIN_RECEIVER_NAME=Jayaraj` ❌ NOT CONFIRMED

| Evidence | Finding |
|---|---|
| Production `payment_config.receiver_name` (14 Nov dump) | **empty** (`""`, 2-byte JSONB value) |
| `resolveReceiverIdentity()` precedence | DB value → else `process.env.ADMIN_RECEIVER_NAME` → else `''` |
| `nameConfigured` | `receiverName.length >= 2` → **false** when both are empty |
| `render.yaml` | key declared, `sync: false` → **value lives only in the Render dashboard** |
| Local `.env` | **does not exist** (only `.env.example`, placeholder `Your Receiver Name`) |
| `.env.example` | `ADMIN_RECEIVER_NAME=Your Receiver Name` — **not** `Jayaraj` |
| Behaviour when unconfigured | Gate 7 is **skipped and disclosed** (`passed: null`, `skipped: true`, `reason: RECEIVER_NAME_NOT_CONFIGURED`, admin UI renders **N/A**) — *never* a silent pass; all other mandatory gates still apply |
| Repo's own checklist | `DEPLOYMENT_ENV_VERIFICATION_CHECKLIST.md:23` → **BLOCKED — decision required**; `PRE_DEPLOYMENT_SAFETY_REPORT.md` → Blocker 1, set value **`Jayaraj`** |

**Conclusion:** the *requirement* is real and documented; the *value* is **unverified**.
Two acceptable postures: (a) set `ADMIN_RECEIVER_NAME = Jayaraj` in Render → payee-name
gate **ON**, or (b) explicitly accept gate-OFF with `RECEIVER_NAME_NOT_CONFIGURED = N/A`
recorded on every verification. **Silence is not an option** — it is the undocumented
third state.

### 5.3 UTR uniqueness & exactly-once wallet credit ✅ (code-level)

| Protection | Mechanism | Evidence |
|---|---|---|
| UTR uniqueness (global) | `reserveApprovedUtr()` = atomic `INSERT … ON CONFLICT` against the `approved_utrs` **UNIQUE** index (migration 007) — never SELECT-then-INSERT | `paymentService.js:350,351,520,521` |
| Duplicate rejection | re-lookup confirms the conflicting row belongs to a **different** reference → `DUPLICATE_UTR` | `paymentService.js:521+`, `topupService.js:734+` |
| Registration approval exactly-once | guarded `.in('status', ACTABLE_STATUSES)` UPDATE; 0 rows → re-read → `PAYMENT_PENDING`/idempotent no-op | `paymentService.js:88–99` |
| Manual approve/reject exactly-once | same guarded-transition pattern; concurrent winner → idempotent return | `paymentService.js:567,762,777` |
| Top-up credit exactly-once | guarded `status → completed` flip decides the sole winner; concurrency-loser path refuses to credit blind and instead requires UTR-safety proof, else drives `rejected` / `manual_review` (`UTR_RESERVATION_MISSING`) | `topupService.js:445–545` |
| Ledger backstop | existing `wallet_transactions` row with `reference_id = topup.id` blocks re-credit | `topupService.js:455` |
| Atomic credit | `credit_wallets_atomic` (015) — **applies all credits in one transaction** | `walletService.js:25–44` |
| Upload replay | `screenshot_hash` SHA-256 duplicate rejection | `paymentService.js:306–315`, `topupService.js:194–203` |

⚠️ These protections are only *effective* if 015 exists (§4) and are only
*validated* against a DB (integration suites are offline-blocked, §6).

### 5.4 Failure handling & financial audit history ⚠️ PARTIAL

**Present and evidenced:**
- `audit_logs` written for: `create_payment`, `upload_screenshot`, `verify_payment`,
  `verification_failed`, `approve_payment`, `reject_payment`, `manual_review_approve`,
  `manual_review_reject`, `auto_expire_payment`, `auto_expire_topup`, `delete_payment_registration`,
  `update_payment_config`, `hard_delete_user`, `register`, `login`, `admin_login`.
- Column-level history on `payments`: `verification_result`, `rejection_reason`,
  `verified_at`, `approved_at`, `rejected_at`.
- Ledger history in `wallet_transactions` (`balance_after`, `reference_id`, `reference_type`).
- Failure taxonomy surfaced to users (`RECEIVER_NAME_*`, `AMOUNT_MISMATCH`,
  `PAYMENT_EXPIRED`, `DUPLICATE_UTR`, `OCR_*`, `LOW_OCR_CONFIDENCE`…).
- Fail-closed paths: expired request → `PAYMENT_EXPIRED`; manual review requires a
  recorded reason (`REVIEW_REASON_REQUIRED`).

**Gap found:**
- **`payment_verifications` (created by 017) is never written by application code.**
  The only references to it in the entire server tree are three lines in
  `migrationState.mjs` (the detector). `paymentVerificationHistoryService.js` is
  **deleted in the working tree** and no replacement writer exists.
  → The append-only per-verification audit table would be **empty forever**, while
  `verify-rollout-017-018-019.sql` and the checklist assume it carries history.
  Tests touching it are only `migration-state-detector` / `admin-delete-migration`
  (existence checks), not write-path tests.

### 5.5 OCR cannot prove bank settlement — **explicit statement**

> **OCR screenshot validation cannot prove actual bank settlement.**

- `PAYMENT_PROVIDER_MODE` is fixed to **`none`** in `render.yaml`.
- `paymentProviderService.js:11` — *"A screenshot displaying `Completed` is NOT
  evidence that money moved."*
- `paymentConfig.js:67` — *"screenshot alone cannot prove bank settlement when no
  live provider is configured."*
- `mode: none` → `verifyTransaction()` returns `{ available:false }`; `mock` is
  **refused** when `NODE_ENV=production` (degrades to `none`).
- Verification therefore rests on: screenshot OCR + amount + receiver UPI + date
  window + duplicate-UTR ledger. Approval of a fully-gated screenshot is the
  **deterministic documented policy**, and it is **not** a settlement guarantee.
- Any move to `live` requires `PAYMENT_PROVIDER_VERIFY_URL`,
  `PAYMENT_PROVIDER_API_KEY` (+ timeout) and a full provider regression re-run.

**Gate C verdict:** flows, plan set, UTR uniqueness and exactly-once logic are
**code-verified**; receiver-name value, 015 availability, and verification-history
writes are **not** → **BLOCKED**.

---

## 6. Gate D — Deployment and GitHub Readiness 🔴 BLOCKED

### 6.1 Git state

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD | `57ae855bf04bb3806c9c9706540fe95d80d474ef` |
| `origin/main` | `57ae855bf04bb3806c9c9706540fe95d80d474ef` (**identical**) |
| Ahead / behind | **0 / 0** — last commit is already pushed |
| Latest commit | `fix: apply migrations 017-021 to production and harden 021 portability` |
| Working tree | **80 entries, none staged** — 15 modified, 59 deleted, 6 untracked |
| Remote | `origin → https://github.com/ganapathiganapathi3174-cmyk/jsree.git` |

### 6.2 ⛔ The release-integrity blocker

| Question | Answer | Evidence |
|---|---|---|
| Is `paymentVerificationV2/` in `HEAD`? | **NO — 0 tracked files** | `git ls-files server/src/services/paymentVerificationV2/` → empty |
| Is the old engine in `HEAD`? | **YES — 14 tracked files** | `git ls-files server/src/services/paymentVerification/` → 14 |
| Which engine does **HEAD** import? | `./paymentVerification/index.js` (**old**) | `git show HEAD:server/src/services/paymentService.js` |
| Which engine does the **working tree** import? | `./paymentVerificationV2/index.js` (**new**) | `paymentService.js:13,19,26` |
| Are the V2 tests in `HEAD`? | **NO — 0** | `git ls-files …paymentVerificationV2*` → empty |
| Deployment source | commit `57ae855` (per repo checklist §F: Vercel deployment created 5 s after it, aliased to `jsree.vercel.app`; Render health PASS) | `DEPLOYMENT_ENV_VERIFICATION_CHECKLIST.md:65–69` |

**Conclusion:** production runs the **old** engine; the Phase 1–13 rebuild exists
only on this machine. The 59 deletions (old engine + obsolete tests) and the
untracked `paymentVerificationV2/` are **one atomic change-set**. Committing
`paymentService.js`/`topupService.js` **without** `paymentVerificationV2/` yields
`Cannot find module './paymentVerificationV2/index.js'` in production.

### 6.3 Deployment configuration review

**Render (`render.yaml`)** — infra-only blueprint, secrets `sync: false`:
`rootDir: server`, `npm ci || npm install`, `npm start` → `node src/index.js`,
health `/api/health`, `NODE_VERSION 22`, `NODE_ENV production`,
`CLIENT_URL https://jsree.vercel.app`, `PAYMENT_PROVIDER_MODE none`.
✅ Start/build/health/engine all consistent with `server/package.json`
(`start = node src/index.js`, `engines.node >= 22`).

**Vercel (root `vercel.json`)** — build `npm --prefix client run build`,
output `client/dist`, SPA rewrite `/:path*` → `/index.html`.
⚠️ **There is no `/api` proxy** (confirmed in both root and `client/vercel.json`).

### 6.4 Environment variables (names only — **no secret values printed**)

**Declared in `render.yaml`:** `NODE_VERSION`, `NODE_ENV`, `CLIENT_URL`,
`JWT_EXPIRES_IN`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_UPI_ID`,
`ADMIN_RECEIVER_NAME`, `PAYMENT_PROVIDER_MODE`, `DATABASE_URL`.

**Referenced in code, absent from `render.yaml` — all have safe code defaults:**

| Variable | Default | Risk if unset |
|---|---|---|
| `PAYMENT_TIME_WINDOW_MINUTES` | `30` | low |
| `MIN_OCR_CONFIDENCE_APPROVE` | `55` | low |
| `PAYMENT_CLOCK_SKEW_TOLERANCE_SECONDS` | `120` | low |
| `NORMALIZE_UTRS_FOR_DUPLICATE` | `false` | medium (duplicate-detection strictness) |
| **`SENDER_NAME_POLICY`** | **`reject`** | **medium — payer-name mismatch hard-rejects by default; not declared in `render.yaml`** |
| `OCR_VERIFICATION_BUDGET_MS` | `120000` | low |
| `OCR_RECOVERY_STAGE_BUDGET_MS` | `25000` | low |
| `OCR_AMOUNT_RECOVERY_BUDGET_MS` | (code default) | low |
| `PAYMENT_PROVIDER_VERIFY_URL` / `_API_KEY` / `_TIMEOUT_MS` / `_MOCK_TIMEOUT` | n/a while mode `none` | required only for `live` |
| `QA_SEED_PASSWORD` | none — script hard-fails | test-only, must stay unset in production |
| `PORT` | injected by Render | none |
| `PATH` / `SYSTEMROOT` | OS | none |

**Dashboard-only (value unknown from workspace) — BLOCKED, confirm by operator:**
`SUPABASE_URL` (project ref must equal `<PROJECT_REF>`),
`SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `JWT_SECRET` (≥32 chars),
`ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_UPI_ID`,
**`ADMIN_RECEIVER_NAME`**, `DATABASE_URL`.

**Highest-risk Vercel variable:** **`VITE_API_URL`**
- `client/src/utils/api.js:14` → `baseURL: import.meta.env.VITE_API_URL || '/api'`
- Neither `vercel.json` proxies `/api`.
- → if unset or relative, the SPA calls `https://jsree.vercel.app/api/*`, which the
  catch-all rewrite serves as `index.html` → **every API call fails in production**.
- Must be an absolute URL ending in `/api`, set as a **build-time** variable.
- Only `VITE_API_URL` / `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` may exist as
  `VITE_*` (public by design); no service-role/JWT/admin secret may be prefixed `VITE_`.

### 6.5 Test and build evidence (fresh, this phase, offline)

**Server** — `npx vitest run` (placeholder Supabase env, 15 Nov 2026, 47.15 s):
```
Test Files   6 failed | 38 passed (44)
Tests      380 passed | 5 skipped (385)
```

**Client** — `npx vitest run` (40.54 s): `Test Files 6 passed (6)`, `Tests 20 passed (20)`.
**Client build** — `npx vite build` (16.51 s): `✓ 1759 modules transformed`,
`dist/assets/index-*.js 490.13 kB (gzip 141.75 kB)`, CSS 53.17 kB, `index.html` 1.90 kB.

**Stale / incomplete test results (all 6 server failures):**

| File | Failure | Classification |
|---|---|---|
| `src/tests/integration/api.test.js` | **`No test suite found in file`** | 🟠 **stale/incomplete — file registers zero tests** |
| `src/tests/integration/business-rules.test.js` | **`No test suite found in file`** | 🟠 **stale/incomplete — file registers zero tests** |
| `src/tests/unit/cache.test.js` | **`No test suite found in file`** | 🟠 **stale/incomplete — file registers zero tests** |
| `src/tests/unit/helpers.test.js` | **`No test suite found in file`** | 🟠 **stale/incomplete — file registers zero tests** |
| `src/tests/unit/pagination.test.js` | **`No test suite found in file`** | 🟠 **stale/incomplete — file registers zero tests** |
| `src/tests/integration/cache-stats-auth.test.js` | `fixture missing: no non-admin user row found` | 🔵 environmental — requires a live database |

> 5 of 6 "failing" files are **hollow**: they contain no tests at all. They must
> either be restored or removed; as-is they produce a permanently red suite and
> hide regressions. All 3 integration suites are offline-blocked (live DB needed).

**Coverage that is genuinely green:** 380 server unit tests (incl. the V2 engine
19/19 and real-OCR 2/2 from Phase 10) + 20 client tests + production client build.

**Never claim success without evidence:** no live-probe, smoke-test, or deployment
verification was performed in this phase.

### 6.6 Repository hygiene

| Item | Status |
|---|---|
| `.env` tracked | ✅ **none** (only 3 `.env.example`) |
| Production backup inside repo | ✅ **none** (0 matches, 0 tracked) |
| `referral-platform_snapshot_*.zip` (3.15 MB) | ✅ ignored |
| `client/dist/` | ✅ ignored |
| **`referral-platform` gitlink** | ⚠️ mode `160000` @ `8982086`, **`.gitmodules` ABSENT**, nested `.git` present → unresolvable gitlink; `git status` shows it permanently modified |
| **`eng.traineddata`** | ⚠️ tracked **twice** (root + `server/`), 5,199,098 bytes each ≈ **10.4 MB** in every clone |
| `qa-results/screenshots/*.png` | ⚠️ tracked screenshots (118 KB each) |

---

## 7. Confirmed facts vs unverified assumptions

### ✅ Confirmed (evidence-backed, re-verifiable)

1. Backup SHA-256 `CA80B336…9E019E29`, 213,581 bytes — MATCH (3 independent checks).
2. Backup restores losslessly into PGlite/PostgreSQL **18.3**: 160/160 statements,
   17 tables, 595 rows, 6 functions, 7 triggers, 17 FKs, `credit_wallets_atomic` absent.
3. Backup covers **only** `public` — 0 `storage.`, 0 `auth.`, 0 role/grant statements.
4. `PLAN_AMOUNTS` = **120 / 500 / 1000** in three independent places.
5. UTR uniqueness = atomic `INSERT … ON CONFLICT` on `approved_utrs` UNIQUE (007).
6. Exactly-once = guarded status transitions + ledger backstop (code-verified).
7. `creditWallets` has exactly **one** implementation: RPC `credit_wallets_atomic` (015).
8. `payment_config.receiver_name` is **empty** in the 14 Nov dump.
9. `PAYMENT_PROVIDER_MODE=none` in `render.yaml`; `mock` refused in production.
10. HEAD == origin/main == `57ae855`, 0 ahead / 0 behind.
11. V2 engine: **0** tracked files; old engine: **14** tracked files in HEAD.
12. Working tree has **80** uncommitted entries (15 M / 59 D / 6 `??`), none staged.
13. Fresh: server 380 passed / 5 skipped / 6 failed files; client 20 passed; client build ✅.
14. 5 of 6 failing server files contain **no test suite**.
15. No `.env` and no production backup is tracked or present in the repo.
16. No `/api` proxy in either `vercel.json`.

### ❓ Unverified assumptions (must not be treated as true)

| # | Assumption | Why unverified | How to verify |
|---|---|---|---|
| U1 | Migrations 015–021 applied in production | commit message + dump are **local artifacts** | read-only SQL/REST probe of `<PROJECT_REF>` |
| U2 | `ADMIN_RECEIVER_NAME = Jayaraj` set in Render | dashboard-only, `sync: false` | Render → Environment |
| U3 | `VITE_API_URL` points at the Render backend with `/api` | build-time dashboard value | Vercel → Environment + prod network tab |
| U4 | `JWT_SECRET` ≥32 chars, keys non-empty | never printed, dashboard-only | Render → Environment (existence only) |
| U5 | Supabase project ref == `<PROJECT_REF>` | dashboard-only | Render → Environment |
| U6 | `payments` bucket is private | 021 state absent from dump; last obs. `public=true` | read-only `GET /storage/v1/object/public/payments/<path>` → expect 404 |
| U7 | Render health `200` + Vercel alias live **for current code** | no probe performed | operator `GET /api/health` |
| U8 | Integration/idempotency suites pass | need an **isolated** Supabase project | repo checklist **F2** |
| U9 | Admin password correct / rotated | dashboard-only | repo checklist **F1** |
| U10 | Supabase DB password rotated after echo incident | no Management-API token | repo checklist **F3** |

---

## 8. Remaining blockers, ordered by risk

| # | Risk | Blocker | Impact | Class |
|---|---|---|---|---|
| **R1** | 🔴 **Critical — financial** | Migration **015** state unverified; `credit_wallets_atomic` absent from the 14 Nov backup; sole wallet-credit path | Top-up approval flips `status→completed` **then throws** → record `completed`, wallet uncredited, retries loop | Production DB |
| **R2** | 🔴 **Critical — release** | **80 uncommitted entries**; V2 engine (0 files) + its tests not in HEAD while callers already import it; old engine still in HEAD | Pushing partial changes = production crash (`Cannot find module './paymentVerificationV2/index.js'`); pushing nothing = production keeps the **old** engine | Git |
| **R3** | 🔴 **Critical — security** | `021_private_payments_bucket` state unverified; last direct observation `payments.public = true` (HTTP 200 on a customer screenshot) | Customer payment screenshots remain publicly fetchable by capability URL | Storage |
| **R4** | 🟠 **High — availability** | `VITE_API_URL` unverifiable; no `/api` proxy in `vercel.json` | If unset/relative, **all** frontend API calls return `index.html` | Vercel |
| **R5** | 🟠 **High — verification integrity** | `ADMIN_RECEIVER_NAME` value unknown; DB `receiver_name` empty; `.env.example` placeholder | Payee-name gate silently in **N/A** posture instead of the declared `Jayaraj` decision | Render |
| **R6** | 🟠 **High — audit** | `payment_verifications` (017) has **no application writer**; `paymentVerificationHistoryService.js` deleted with no replacement | Append-only per-verification history stays empty; rollout SQL/checklist assume it is populated | Code |
| **R7** | 🟡 **Medium — evidence** | 5 test files contain **no test suite**; 3 integration suites offline-blocked | Permanently red suite masks real regressions; no DB-backed idempotency proof | Tests |
| **R8** | 🟡 **Medium — tooling** | Migration **016** has **no detector** in `migrationState.mjs` | Guarded applier cannot SKIP/REFUSE correctly for 016; blind re-run risk | Tooling |
| **R9** | 🟡 **Medium — config transparency** | 8 dashboard-only env values unverifiable; `SENDER_NAME_POLICY` undeclared (defaults to `reject`); repo items **F1/F2/F3** open | Unstated strict payer-name behaviour; no verified admin credential, no isolated test DB, no password rotation | Ops |
| **R10** | 🟢 **Low — hygiene** | `referral-platform` gitlink with **no `.gitmodules`**; `eng.traineddata` tracked twice (10.4 MB); tracked QA screenshots | Permanent "modified" status; repo bloat; possible submodule confusion on clone | Git |

---

## 9. Recommended safe execution order for the next phase

> Every step below is **operator-gated**. Nothing runs automatically.

1. **Read-only production probe (no writes).** Record, for `<PROJECT_REF>`:
   existence of `credit_wallets_atomic`, `payment_verifications`,
   `deleted_user_financial_records`; `relrowsecurity` on the 17 core tables;
   `admin_delete_user` / `admin_delete_topup` body markers; `storage.buckets.public`
   for `payments`. **→ closes U1, U6, and downgrades R1/R3.**
2. **Dashboard value audit (no redeploy).** Render: `ADMIN_RECEIVER_NAME` decision,
   `VITE_API_URL` (Vercel), `JWT_SECRET`, Supabase keys/ref, `ADMIN_EMAIL`,
   `ADMIN_PASSWORD_HASH`, `DATABASE_URL`. Record **presence/shape only**, never values.
   **→ closes U2–U5, R4, R5.**
3. **If probe shows 015 absent → apply 015 (approval A)** via
   `apply-migration-guarded.mjs 015_atomic_wallet_credits.sql` (one transaction,
   advisory lock `717017`, fresh backup taken first). Then **re-run the probe**.
   **→ closes R1.**
4. **If probe shows 021 absent → apply 021 (approval A)**, then verify
   `public=false` + `remaining_read_policies=0` and the 404 public-object check.
   **→ closes R3.**
5. **Fix the hollow test files (approval: code change)** — restore or delete the 5
   suites with no tests; keep `cache-stats-auth` as the documented live-DB suite.
   **→ closes R7 (partially).**
6. **Add a 016 detector (approval: code change)** so the guarded runner can
   SKIP/REFUSE correctly. **→ closes R8.**
7. **Decide the verification-history question (approval: code change)** — either add
   a `payment_verifications` writer in the V2 path or amend 017's rollout docs.
   **→ closes R6.**
8. **Re-run full evidence:** server vitest, client vitest, client build — expect
   **0 failed files** before any commit.
9. **Atomic commit of the whole rebuild (approval D)** — old-engine deletions +
   `paymentVerificationV2/` + rewired callers + new tests + reports **in one commit**
   (suggested message `feat: finalize payment verification v2 production readiness`).
   Never force-push. **→ closes R2.**
10. **Deploy (approval D)** → verify `/api/health` 200, prod network tab shows the
    Render base URL, one admin login, one screenshot proxy 403/404 for a non-owner.
11. **Close repo items F1/F2/F3** → then update
    `JSREE_FINAL_PRODUCTION_READINESS_REPORT.md` §7 and set this gate to READY.

---

## 10. Explicit operator approvals required before each production action

| Gate | Production action | Approval required | Evidence to record |
|---|---|---|---|
| **A** | Take a fresh production backup | **A-backup** — explicit "take backup on `<PROJECT_REF>`" | file path + SHA-256 + timestamp |
| **A** | Export Storage buckets / change bucket permissions | **A-storage** — explicit, operation-specific | count of objects exported; never the objects themselves |
| **B** | Apply **015** | **A** — "apply `015_atomic_wallet_credits.sql` to `<project ref>`" | detector output pre/post; `credit_wallets_atomic` present; anon/auth EXECUTE=false |
| **B** | Apply **016–021** | **A** — one approval **per file**, plus `MIGRATION_CONFIRM=<filename>` and `ALLOW_NON_TEST_TARGET=I_UNDERSTAND` for a non-test ref | per-file detector result; `verify-rollout-…sql` sections D–J |
| **C** | Set `ADMIN_RECEIVER_NAME` | **B** — "set `ADMIN_RECEIVER_NAME=Jayaraj` in Render" **or** explicit acceptance of the gate-OFF/N-A posture | decision statement only; value never pasted into git |
| **C** | Create any test payment / touch financial rows | **C** — explicitly refused in this phase; needs a dedicated approval + isolated test project (**F2**) | row counts unchanged before/after on production |
| **D** | Change any Render environment variable | **B** — per-variable approval | key name + "set on `<date>`"; **never the value** |
| **D** | Change any Vercel environment variable | **B** — per-variable approval | key name + "set on `<date>`" |
| **D** | `git commit` | **D** — "commit the V2 rebuild atomically" | `git status` clean; suite green |
| **D** | `git push` to `main` | **D** — explicit; **never force-push** | `main` == `origin/main`; no secrets in diff |
| **D** | Deploy / redeploy | **D** — explicit | health 200 + one authenticated call post-deploy |

---

## 11. Attestation — what this phase did NOT do

- ❌ No production mutation, no SQL executed against any database.
- ❌ No migration applied, no migration file modified.
- ❌ No Supabase Storage or Auth change; no bucket export/download; no screenshot access.
- ❌ No Render or Vercel setting changed; no environment variable set or read.
- ❌ No PostgreSQL or other software installed (Phase 13 PGlite workspace already deleted).
- ❌ No `git commit`, no `git push`, no deployment, no force-push.
- ❌ No test payment created; no financial record created or modified.
- ❌ No secret, key, password, hash, or connection string printed.
- ❌ No production backup uploaded to any external service or to GitHub.
- ✅ Application code unchanged; only this report was written.
