# JSREE_FINAL_PRODUCTION_READINESS_REPORT

**Date:** 11 November 2026 — Post-remediation final audit
**Scope:** Full remediation of the Final Production Launch Readiness Audit findings.
**Method:** Read-only live probes + code fixes + offline test suites + isolated-safe QA runs. No production migration was executed; no dashboard value is claimed verified.

---

## 1. Original audit findings (11 Nov 2026 morning)

| ID | Finding | Severity |
|----|---------|----------|
| A1 | Migration 017 NOT applied (`payment_verifications` absent) | HIGH |
| A2 | Migration 018 NOT applied — live `admin_delete_user` = 009 (frees `approved_utrs`, deletes `audit_logs`, no financial archive) | CRITICAL |
| A3 | Migration 019 partially applied (core-15 RLS on; lines 52–53 skipped) | HIGH |
| A4 | Migration 020 unknown — `admin_delete_topup` may still free UTRs | HIGH |
| A5 | `payments` storage bucket PUBLIC — real customer screenshot fetched unauthenticated (200, image/png, 1.27 MB) | HIGH |
| A6 | Receiver-name config read from two different sources; unconfigured gate silently skipped; stale `.env.example` comment | MEDIUM |
| A7 | Admin password login unverifiable (no plaintext; `ADMIN_PASSWORD_HASH` only); disabled-admin had NO status check | MEDIUM |
| A8 | Rate limiting: shared-NAT risk, no admin-specific bucket, in-memory store undocumented | MEDIUM |
| A9 | `VITE_API_URL` / Render secrets not verifiable from workspace (dashboard-only) | BLOCKED |
| A10 | Integration suites + live idempotency double-run not testable against prod DB | NOT TESTED |

---

## 2. Code changes made (issue → fix → coverage)

| # | Issue | Fix | File(s) | Coverage |
|---|-------|-----|---------|----------|
| C1 | 018 deleted audit rows on user delete | `UPDATE audit_logs SET actor_id = NULL` (rows preserved, FK detached); returns `auditLogsPreserved` count; storage-path regexp now handles public AND private URL shapes | `supabase/migrations/018_complete_user_deletion.sql` | `admin-delete-migration.test.js` (new assertions) |
| C2 | 019 un-runnable when 017/018 absent | `ALTER TABLE IF EXISTS` on the two re-assert lines | `019_enable_rls_core_tables.sql` | state probe (019 partial→idempotent) |
| C3 | 020 storage-path regexp public-only | Same dual-shape regexp | `020_admin_delete_topup_retains_utrs.sql` | static |
| C4 | Bucket public; no migration existed | **New `021_private_payments_bucket.sql`**: flip `payments` to private + delete anon/authenticated SELECT policies on that bucket + post-apply verification SELECTs | `supabase/migrations/021_private_payments_bucket.sql` | `migration-state-detector.test.js` |
| C5 | Uploads stored permanent public URLs | `privateObjectUrl()` helper stores `/object/<bucket>/<path>` (no `/public/`); `getPublicUrl` no longer used for payment proofs | `utils/helpers.js`, `paymentService.js`, `topupService.js` | `private-screenshot-storage.test.js` |
| C6 | OCR re-verification fetched raw URL (breaks when private) | `verifyPayment` now reads bytes via `storage.download()` (service role); direct `fetch` of screenshot URLs removed | `paymentService.js` | `private-screenshot-storage.test.js` (fetch spy = 0 calls) |
| C7 | Receiver identity two sources | New `resolveReceiverIdentity()` in configService (DB → env, validated, trimmed, lazy env defaults) — used by BOTH flows; env defaults no longer frozen at module load; `resetPaymentConfigCache()` exported | `configService.js`, `paymentService.js`, `topupService.js` | `receiver-name-single-source.test.js` |
| C8 | Unconfigured name gate silently skipped | Explicit disclosure: `checks.receiverName = { passed: null, skipped: true, reason: 'RECEIVER_NAME_NOT_CONFIGURED' }` → admin UI renders **N/A** (never PASS); `nameDiagnostics.enabled=false` | `decisionEngine.js` | `payment-auto-decision-policy.test.js` (updated) |
| C9 | Disabled admin could still log in | `adminLogin` refuses `status !== 'active'` → `ADMIN_DISABLED` | `authService.js` | `admin-login-hardening.test.js` |
| C10 | No admin-specific rate bucket; limits hardcoded | Separate `adminLoginLimiter` 10/15min/IP; env-overridable `RATE_LIMIT_GLOBAL_MAX` / `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_ADMIN_LOGIN_MAX` (defaults unchanged: 100/20/10); in-memory single-instance limitation documented in code | `app.js` | `admin-login-hardening.test.js` (11th request → 429) |
| C11 | Guarded applier hardcoded to 017 only | Generic per-migration **state detection** (`migrationState.mjs`): applied → SKIP; unexpected state → REFUSE; apply in transaction; same probe re-run as post-verify or ROLLBACK | `apply-migration-guarded.mjs`, `migrationState.mjs` (new) | `migration-state-detector.test.js` (all 5 migrations) |
| C12 | Stale/misleading comments | configService receiver_name comment corrected (disclosure, not manual review) | `configService.js` | — |

No mock payment success introduced. No automatic approval switch introduced. No client UI changes (Navy & Purple preserved). No features/routes removed (all 29 routes intact).

---

## 3. Files modified (13) & created (8+1)

**Modified:** `server/src/app.js`, `server/src/services/authService.js`, `server/src/services/configService.js`, `server/src/services/paymentService.js`, `server/src/services/topupService.js`, `server/src/services/paymentVerification/decisionEngine.js`, `server/src/utils/helpers.js`, `server/src/scripts/apply-migration-guarded.mjs`, `supabase/migrations/018…`, `supabase/migrations/019…`, `supabase/migrations/020…`, `supabase/verify-rollout-017-018-019.sql` (+ Sections I/J), `server/src/tests/unit/payment-auto-decision-policy.test.js`, `server/src/tests/unit/admin-delete-migration.test.js`.

**Created:** `supabase/migrations/021_private_payments_bucket.sql`, `server/src/scripts/migrationState.mjs`, `server/src/tests/unit/{private-screenshot-storage, migration-state-detector, admin-login-hardening, receiver-name-single-source}.test.js`, `supabase/MIGRATION_ROLLOUT_CHECKLIST.md`, `DEPLOYMENT_ENV_VERIFICATION_CHECKLIST.md`, this report.

---

## 4. Status matrix (PASS / FAIL / BLOCKED / NOT TESTED / N/A)

| Area | Status | Evidence |
|------|--------|----------|
| **DB migration status** 017/018/019/020/021 | **BLOCKED** | Files repaired + guarded runner + checklist ready; **not executed** (operator approval + backup required). Live state: 017 no, 018 no, 019 partial, 020 unknown, 021 no |
| UTR retention (018/020 code) | **PASS** (code) | Migrations retain `approved_utrs`; static tests `admin-delete-migration`, `admin-delete-topup-retention` |
| Financial history retention | **PASS** (code) | 018 archives payments/topups/wallet before delete; audit rows preserved (C1) |
| **Storage security** | **PASS** (code) / live flip **BLOCKED** | 021 ready; proxy ownership checks tested; live bucket still public until 021 applied |
| Screenshot authorization | **PASS** | Owner/admin/other-user/missing/path tests (`private-screenshot-storage`, `screenshot-proxy-access`, cors-app) |
| Payment verification policy | **PASS** | OCR+UTR+amount+date+duplicate gates preserved; no auto-approve switch; MANUAL_REVIEW preserved; limitations documented (checklist §D) |
| Receiver-name single source | **PASS** | `resolveReceiverIdentity` tests; explicit N/A disclosure |
| Wallet/UTR protection | **PASS** (offline) | Existing suites: duplicate UTR, approve idempotency, concurrency races, atomic credit, topup claim — all green; **live double-run NOT TESTED** (prod mutation) |
| Admin authentication | **PASS** (offline) | correct/incorrect/missing/disabled/non-admin/expired/forged token + rate bucket; **live password check BLOCKED** (operator) |
| Rate limiting | **PASS** | defaults unchanged; admin bucket 10/15m verified live (10×400 → 429); NAT/shared-store limitation documented |
| Render configuration | **BLOCKED** (dashboard rows) | config-as-code + local health/CORS PASS; secrets/project-ref/receiver-name = operator checklist |
| Vercel configuration | **BLOCKED** (`VITE_API_URL`) | root rewrites PASS; build-time env must be confirmed (checklist §B) |
| Unit tests (vitest) | **PASS** | **1705 passed, 0 failed** (1 pre-existing flaky boundary test passes isolated; 5 skipped) |
| Unit tests (node:test legacy) | **PASS** | cache/helpers/pagination → **28/28** via `node --test` |
| Client tests | **PASS** | **20/20** |
| Client production build | **PASS** | `vite build` → dist OK (489.87 kB JS) |
| API regression (live, read-only) | **PASS** | **95/95** + 5 safety checks (zero mutations: users 7→7, payments 6→6) |
| Browser regression (live) | **PASS** | **41/41 PASS**, 0×429 under raised QA limits, 17 evidence screenshots |
| Integration suites (isolated DB) | **NOT TESTED** | No isolated project credentials in workspace; never run against prod |
| Live idempotency double-run | **NOT TESTED** | Would mutate prod (forbidden) |
| Dashboard env values | **BLOCKED** | See `DEPLOYMENT_ENV_VERIFICATION_CHECKLIST.md` |

---

## 5. Remaining manual actions (operator)

1. Backup → execute 017 → 018 → 019 → 020 → 021 via `apply-migration-guarded.mjs` (see `supabase/MIGRATION_ROLLOUT_CHECKLIST.md`).
2. Run `verify-rollout` Sections D/E/F/H/I/J + bucket URL probe (must 404).
3. Confirm Render dashboard: `SUPABASE_URL` ref, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `ADMIN_RECEIVER_NAME` decision.
4. Confirm Vercel dashboard: `VITE_API_URL=https://<render>/api` (highest frontend risk), build command/output, no server secrets in `VITE_*`.
5. Admin password login verification with operator-held password (or confirm `ADMIN_NOT_CONFIGURED` is expected).
6. Provide isolated test project credentials → run integration suites + live idempotency double-run there.
7. Accept documented payment-verification limitation (screenshot+UTR ≠ settlement) in writing.

## 6. Security risks remaining

| Risk | Level | Status |
|------|-------|--------|
| Public bucket + capability URLs (until 021 applied) | HIGH | Mitigated in code/migration; **live until operator applies 021** |
| 009-era delete fns free UTRs / destroy audit (until 018/020 applied) | CRITICAL | Mitigated in code/migration; **live until operator applies** |
| No real settlement verification (mode `none`) | HIGH (accepted) | Documented; sign-off required |
| Receiver-name gate off until env/DB configured | MEDIUM | Explicitly disclosed as N/A in every verification record |
| Shared-NAT rate-limit lockout; in-memory store | MEDIUM | Documented; env-tunable; shared-store migration prepared (comment) |
| 7-day stateless JWT, no revocation list | LOW | Pre-existing, documented |
| Verification history writes fail until 017 applied | MEDIUM | Non-blocking by design; visible as console errors until rollout |

## 7. Final verdict: 🔴 NO-GO — BLOCKED (not FAIL)

All **code-level** remediations are complete and green (1705+28+20 offline tests, 95/95 API, 41/41 browser, build PASS). The remaining blockers are **production-operator actions only**: migrations must be applied with approval+backup, the storage bucket flipped, and dashboard environment values verified. Per the GO criteria, "migrations verified as applied" and "environment configuration verified" are not yet satisfiable from this workspace → **NO-GO until Sections 5.1–5.4 complete**, after which re-run `verify-rollout` + this report's test matrix for a GO re-assessment.
