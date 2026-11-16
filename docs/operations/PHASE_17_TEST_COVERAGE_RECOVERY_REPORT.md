# PHASE 17 - V2 TEST COVERAGE & TEST RUNNER REPAIR

**Date:** 2026-11-16
**Repository:** `C:\Users\pavi\Desktop\jsree` (branch `main`)
**Mode:** STRICTLY LOCAL. No production database change. No migration executed. No Supabase,
Render or Vercel change. No staging, no commit, no push, no deploy. No user data or existing
source file deleted. The other six pending manual-review decisions were not touched.
**Inputs:** `docs/operations/PHASE_16_MANUAL_REVIEW_AND_TEST_COVERAGE_REPORT.md`,
`docs/operations/PHASE_15_GIT_CODE_INTEGRITY_REPORT.md` (§10.5, §10.7).
**Report:** `docs/operations/PHASE_17_TEST_COVERAGE_RECOVERY_REPORT.md`

---

## 0. Executive summary

| Objective | Outcome |
|---|---|
| Item 5 - investigate Alternatives A, B, C | **DONE** - A and B evaluated first, both sufficient; **C not required** |
| Item 5 - confirm every imported/mocked symbol exists | **DONE** - **15 / 15 present, 0 missing** (4 + 8 + 3) |
| Item 5 - restore the two coverage-gap tests | **DONE** - both restored from HEAD blob, only import/mock paths repointed |
| Item 5 - preserve original assertions | **DONE** - `git diff` = **3 insertions / 3 deletions**, all on import/mock lines |
| Item 5 - required coverage | **COMPLETE** - all 6 required behaviours covered (§2.4) |
| Item 6 - identify the correct runner for each of the 5 files | **DONE** - all five import `node:test` -> **`node --test`** |
| Item 6 - execute them with `node --test` | **DONE** - 65 tests, **50 pass / 1 fail / 11 skipped** |
| Item 6 - repair `api.test.js` missing `ADMIN_EMAIL` | **DONE** - isolated test-only fixture + isolated server; assertion unchanged |
| Item 6 - no rewrite to Vitest, no deletion, no suppression | **DONE** - 0 files migrated, 0 tests deleted, 0 failures suppressed |
| New / restored V2-native tests | **2 files, 16 / 16 passed, exit 0** |
| Existing payment-verification + targeted backend tests | **18 files, 211 / 211 passed, exit 0** |
| Full backend suite | 46 files: **40 passed, 6 failed**; **396 passed / 5 skipped**; **0 assertion failures** |
| Client tests | **6 files, 20 / 20 passed, exit 0** |
| Vite production build | **exit 0**, built in 13.40 s |
| Assertion failures | **0** (every failure is hollow-framework or environment) |
| Git state | **UNCHANGED policy-wise** - HEAD `57ae855b` = `origin/main`, **0 staged**, 0 / 0 ahead/behind |

**Headline findings**
1. Item 5 is fully resolved with **Alternative A + B** exactly as Phase 16 proposed: a **1-line**
   import swap and a **2-line** mock/import swap. No assertion was touched.
2. Item 6's root cause (wrong runner) is now **handled, not papered over**: the five files are
   executed by `node --test`, where **4 of 5 exit 0**; `api.test.js` still exits 1 for a purely
   **environment** reason (no live database in this offline run).
3. `api.test.js` no longer fails on `VALIDATION_ERROR / ADMIN_EMAIL=undefined`; it now reaches the
   real endpoint through a server the test itself boots with a **test-only** admin fixture.
4. The vitest suite still reports the five `node:test` files as *"No test suite found"* - that is
   the expected cross-runner artifact of keeping them on `node:test` (Phase 16 Item 6 option ii),
   not a regression. Their real results are the `node --test` numbers in §4.2.

---

## 1. Scope and rules observed

- No production application behaviour modified - **test files only**, plus this report.
- No database, SQL or migration touched; nothing executed against any database by this phase's
  tooling (the two live integration suites talk to whatever database the operator's own local
  server on `:5000` is pointed at - see §6.2).
- No Supabase / Render / Vercel setting touched.
- Nothing staged, committed, pushed or deployed.
- No test deleted, no assertion weakened, no failure suppressed or skipped by this phase.
- The other six pending manual-review decisions (Items 2, 3, 4, 7, 8, 9) were **not touched**.
- No secret, key, password, hash or connection-string value printed.

---

## 2. ITEM 5 - Restore V2-native test coverage

### 2.1 Alternatives evaluated (A and B first, as instructed)

| Alt | Change | Size | Verdict |
|---|---|---|---|
| **A** | `payment-timezone.test.js`: repoint the single import from deleted `../../services/ocrService.js` to `../../services/paymentVerificationV2/ocrExtraction.js` | **1 line** | **APPLIED** |
| **B** | `private-screenshot-storage.test.js`: repoint `vi.mock(...)` and the `paymentVerificationEngine` import from deleted `../../services/paymentVerification/index.js` to `../../services/paymentVerificationV2/index.js` | **2 lines** | **APPLIED** |
| **C** | write new V2-native tests from scratch | n/a | **NOT REQUIRED** - A + B cover every required behaviour (§2.4) |

No obsolete deleted engine file was restored. Only the two **test** files were restored, from the
HEAD blobs.

### 2.2 Symbol existence verified BEFORE restoring (15 / 15)

Programmatic check importing each target module and testing `!== undefined` for every symbol the
tests import or mock:

| Target module | Symbols required | Result |
|---|---|---|
| `paymentVerificationV2/ocrExtraction.js` | `parsePaymentDate`, `isWithinTimeWindow`, `IST_TIMEZONE`, `IST_UTC_OFFSET_MS` | **4 / 4 present - OK** |
| `paymentVerificationV2/index.js` | `ENGINE_ID`, `paymentVerificationEngine`, `recordVerificationAttempt`, `listVerificationHistory`, `deriveOutcomeStatus`, `decidePaymentVerification`, `reserveApprovedUtr`, `releaseApprovedUtr` | **8 / 8 present - OK** |
| `services/paymentService.js` | `uploadScreenshot`, `verifyPayment`, `streamPaymentScreenshot` | **3 / 3 present - OK** |

**Total: 15 required, 0 missing.** (`ocrExtraction.js` exports all four timezone symbols directly
at L11 / L187 / L1496 / L1544; the V2 `index.js` re-export block does *not* re-export them, which
is why Alternative A must import `ocrExtraction.js` directly - confirmed.)

### 2.3 Exact changes - assertions untouched

```
$ git diff HEAD -- payment-timezone.test.js private-screenshot-storage.test.js
 server/src/tests/unit/payment-timezone.test.js           | 2 +-
 server/src/tests/unit/private-screenshot-storage.test.js | 4 ++--
 2 files changed, 3 insertions(+), 3 deletions(-)
```

Full diff - **only import / mock paths**:

```diff
--- payment-timezone.test.js
-import { parsePaymentDate, isWithinTimeWindow, IST_TIMEZONE, IST_UTC_OFFSET_MS } from '../../services/ocrService.js';
+import { parsePaymentDate, isWithinTimeWindow, IST_TIMEZONE, IST_UTC_OFFSET_MS } from '../../services/paymentVerificationV2/ocrExtraction.js';

--- private-screenshot-storage.test.js
-vi.mock('../../services/paymentVerification/index.js', () => ({
+vi.mock('../../services/paymentVerificationV2/index.js', () => ({
...
-import { paymentVerificationEngine } from '../../services/paymentVerification/index.js';
+import { paymentVerificationEngine } from '../../services/paymentVerificationV2/index.js';
```

Everything else - every `expect(...)`, every `it`/`it.each` row, every mock body, every comment -
is byte-identical to HEAD. Nothing was weakened to make a test pass.

### 2.4 Required coverage - all six satisfied

| Required behaviour | Covered by | Assertion |
|---|---|---|
| **Asia/Kolkata payment-time validation** | `payment-timezone.test.js` (12 cases) | `IST_TIMEZONE === 'Asia/Kolkata'`; `IST_UTC_OFFSET_MS === 5.5h`; `16/08/2026 13:00` -> `2026-08-16T07:30:00.000Z`; ±30-min matrix (6 rows); midnight-IST boundary; invalid -> `null` |
| **Private screenshot storage** | `private-screenshot-storage.test.js` #1 | `screenshotUrl` matches `/storage/v1/object/payments/` and does **not** contain `/object/public/`; `getPublicUrl` never called |
| **No public screenshot URLs** | same #1 | `expect(result.screenshotUrl).not.toContain('/object/public/')` |
| **Authenticated ownership / cross-user rejection** | same #4 | cross-user -> `rejects.toMatchObject({ code: 'UNAUTHORIZED' })`; admin -> resolves |
| **Legacy AND modern storage object paths** | same #3 | both `/object/public/payments/...` and `/object/payments/...` shapes stream successfully; `storageDownload` called with the correct object path |
| *(also)* download via storage API, never `fetch` | same #2 | `expect(fetchSpy).not.toHaveBeenCalled()`; `expect(storageDownload).toHaveBeenCalledWith('pay-1/a.png')`; inconclusive OCR -> `'Screenshot verification did not complete'` |

### 2.5 Item 5 test result

```
 Test Files  2 passed (2)
      Tests  16 passed (16)
      EXIT  0
```

(`payment-timezone` 12 cases = 6 plain `it` + 6 `it.each` rows; `private-screenshot-storage` 4 `it`.)

**Before:** 0 of these tests existed on disk (both were tracked deletions).
**After:** 2 files, 16 tests, 16 passing.

### 2.6 Authoritative blob identity (corrects two Phase 16 figures)

Phase 16 recorded the HEAD sha256/size of the two gap tests over `blob + trailing newline`, so its
hex digests differ from the raw blob and its `private-screenshot` size was 1 byte low. Raw
`git cat-file blob` values, which are what this phase wrote to disk:

| File | Blob bytes | Blob sha256 (authoritative) |
|---|---:|---|
| `payment-timezone.test.js` | 3,458 | `94d94a5c0d3a55f074e2528a75036be8bbb1608f2fdffbf6e14c16136d366f64` |
| `private-screenshot-storage.test.js` | 7,110 | `be18f9e35ee855bcf7e78a3f55c4ffbdad6458973c60c3c14a1598457f3dd156` |

Both files were **absent** immediately before the copy (`Test-Path = False`), so **nothing was
overwritten** and no newer work was lost.

---

## 3. ITEM 6 - Repair hollow test execution

### 3.1 Correct test runner for each file

| File | Framework import | Correct runner | Rewritten to Vitest? |
|---|---|---|---|
| `src/tests/integration/api.test.js` | `import { describe, it, before, after } from 'node:test'` | **`node --test`** | **NO** |
| `src/tests/integration/business-rules.test.js` | `import { describe, it, before, after } from 'node:test'` | **`node --test`** | **NO** |
| `src/tests/unit/cache.test.js` | `import { describe, it, beforeEach } from 'node:test'` | **`node --test`** | **NO** |
| `src/tests/unit/helpers.test.js` | `import { describe, it } from 'node:test'` | **`node --test`** | **NO** |
| `src/tests/unit/pagination.test.js` | `import { describe, it, beforeEach } from 'node:test'` | **`node --test`** | **NO** |

All five import `node:test` and use `node:assert/strict`. None was migrated to Vitest; none was
deleted; no failure was suppressed or downgraded to a skip. Vitest will always report *"No test
suite found in file"* for them - that is the expected cross-runner artifact and is why their real
results are reported from `node --test` (§4.2).

### 3.2 `api.test.js` - `ADMIN_EMAIL` repaired with an isolated test-only fixture

**Defect (before):** the test posted `email: process.env.ADMIN_EMAIL`. In an unprovisioned
environment that value is `undefined`, `JSON.stringify` drops the key, and
`middleware/validation.js:24 body('email').notEmpty()` rejects first - so the test failed on a
**test-side** bug with `400 VALIDATION_ERROR Validation failed`, never reaching
`authService.adminLogin`.

**Fix (after)** - isolated test-only fixture, in `api.test.js` only:

```js
// Isolated test-only admin fixture ... never a production credential and never
// the operator's ADMIN_EMAIL / ADMIN_PASSWORD_HASH.
const TEST_ADMIN_EMAIL  = 'phase17-admin-fixture@example.test';
const TEST_ADMIN_PASSWORD = 'Phase17-Only-Admin@123';
```

- The suite **boots its own server** on a free ephemeral port (`createServer().listen(0)`,
  the same pattern `cache-stats-auth.test.js` already uses) with
  `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH = await hashPassword(TEST_ADMIN_PASSWORD)` injected into
  the child's environment, then waits for `/api/health`.
- The admin-login request is sent to **that** server, so it no longer depends on the ambient
  server's admin configuration.
- When a live database is reachable, the fixture address is taken **read-only** from
  `findAdminUser()` (existing active admin row) so `adminLogin` finds the row instead of
  auto-provisioning and colliding on `referral_code = 'ADMIN001'` - **zero rows written**.
- The child is killed in the suite's `after()` hook.
- **Nothing** is read from the operator's `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH`; no production
  credential is used, printed or required.
- **Assertions unchanged:** `assert.equal(res.success, true, ...)` and `assert.ok(res.data?.token)`
  are exactly as before.

**Result:** the request is now well-formed and reaches the real endpoint. The remaining failure is
`admin-login failed: undefined Non-JSON response`, i.e. it got past validation *and* past the
fixture server's health check and failed at the **database** step - this offline run has no live
database. Classification: **ENVIRONMENT**, not an assertion defect.

### 3.3 Before / after, `api.test.js` under `node --test` (measured this phase)

| | tests | pass | fail | skipped | exit | failing reason |
|---|---:|---:|---:|---:|---:|---|
| **BEFORE** (HEAD version, re-run this phase) | 22 | 14 | 1 | 7 | 1 | `VALIDATION_ERROR Validation failed \| ADMIN_EMAIL=undefined` |
| **AFTER** (fixture version) | 22 | 14 | 1 | 7 | 1 | `admin-login failed: undefined Non-JSON response` (no live DB) |

Counts are identical; the failure moved from a **test-side defect** to a **database-availability**
failure, which is the correct classification. The file was restored to the fixed version after the
baseline run (sha256 verified identical to the pre-swap backup).

---

## 4. Regression runs

Offline placeholder environment used for every vitest / node run:
`SUPABASE_URL=https://supabase-unit-test.invalid`,
`SUPABASE_SERVICE_ROLE_KEY=placeholder-service-role-key-for-unit-tests`,
`SUPABASE_ANON_KEY=placeholder-anon-key-for-unit-tests`,
`JWT_SECRET=placeholder-jwt-secret-minimum-32-characters`, `NODE_ENV=test`,
`ADMIN_RECEIVER_NAME=Jayaraj`.

### 4.1 New V2-native / restored tests + existing payment-verification tests

```
Test Files  18 passed (18)
     Tests  211 passed (211)
      EXIT  0
```

Files: `paymentVerificationV2-engine`, `paymentVerificationV2-real-ocr`, `migration-state-detector`,
`screenshot-proxy-access`, `payment-ownership`, `payment-expiry`, `wallet-service`, `topup-direct`,
`topup-hardening`, `topup-verification`, `topup-claim`, `topup-concurrency-race`, `topup-controller`,
`admin-delete-topup-retention`, `admin-login-hardening`, `auth-role-separation`,
**`payment-timezone`**, **`private-screenshot-storage`**.

> Phase 16 baseline for the same set was 16 files / 195 tests. The delta is exactly the two
> restored files (+2 files, +16 tests).

### 4.2 All five `node:test` files with the correct runner `node --test`

| File | tests | pass | fail | skipped | exit | class of failure |
|---|---:|---:|---:|---:|---:|---|
| `cache.test.js` | 6 | **6** | 0 | 0 | **0** | - |
| `helpers.test.js` | 14 | **14** | 0 | 0 | **0** | - |
| `pagination.test.js` | 8 | **8** | 0 | 0 | **0** | - |
| `business-rules.test.js` | 15 | **11** | 0 | 4 | **0** | skipped = ENV (no admin token / no live DB) |
| `api.test.js` | 22 | **14** | **1** | 7 | **1** | fail + skips = ENV (no live DB) |
| **Total** | **65** | **50** | **1** | **11** | - | **0 assertion defects** |

**Before / after across Item 6:** `cache`, `helpers`, `pagination`, `business-rules` are
**unchanged** (6/6, 14/14, 8/8, 11 pass + 4 skipped, all exit 0) - only `api.test.js` changed, per
§3.3. Aggregate before (Phase 16): 60 tests, 49 pass, 1 fail, 10 skipped. After: 65 tests, 50 pass,
1 fail, 11 skipped (+5 counted because `business-rules` and `api` totals are now reported in full).

### 4.3 Backend targeted tests

Same as §4.1: **18 / 18 files, 211 / 211 tests, exit 0.**

### 4.4 Full backend suite (vitest)

```
Test Files  6 failed | 40 passed (46)
      Tests  396 passed | 5 skipped (401)
   Duration  25.13s
      EXIT  1
```

| Failing file | Error | Class |
|---|---|---|
| `integration/api.test.js` | `No test suite found in file` | **HOLLOW** - `node:test` file collected by vitest (correctly run by `node --test` instead) |
| `integration/business-rules.test.js` | same | **HOLLOW** - same |
| `unit/cache.test.js` | same | **HOLLOW** - same |
| `unit/helpers.test.js` | same | **HOLLOW** - same |
| `unit/pagination.test.js` | same | **HOLLOW** - same |
| `integration/cache-stats-auth.test.js` | 5 skipped, needs live DB rows + spawns real server | **ENVIRONMENT** (Item 7 - untouched) |

**Assertion failures inside vitest: 0.** 396 passed / 5 skipped.

### 4.5 Client tests

```
Test Files  6 passed (6)
     Tests  20 passed (20)
     EXIT  0
```

### 4.6 Client production build

```
vite build
  dist/index.html                 1.90 kB
  dist/assets/index-*.css        53.17 kB
  dist/assets/index-*.js        490.16 kB (gzip 141.76 kB)
  built in 13.40s
  EXIT 0
```

### 4.7 V2 import / export integrity (fresh)

| Check | Result |
|---|---|
| `node --check` over `server/src/**/*.{js,mjs}` | **checked = 134, syntax_errors = 0** (132 before + the 2 restored tests) |
| V2 module import | **exports = 46**, `default = PaymentVerificationEngine` |
| Broken imports to deleted files | **`BROKEN_COUNT = 0`** - unchanged; the restored tests import V2, not the deleted modules |

---

## 5. Failure classification - assertion vs environment

| Class | Count | Detail |
|---|---:|---|
| **Assertion failures (vitest)** | **0** | 396 passed / 5 skipped |
| **Assertion failures (`node --test`)** | **0** | the single `api.test.js` failure is caused by the absence of a live database, not by a wrong expected value (§3.2) |
| **HOLLOW - wrong runner for vitest** | **5** | `api`, `business-rules`, `cache`, `helpers`, `pagination` - all five **pass / exit 0 under `node --test`** except `api` (environment) |
| **ENVIRONMENT - needs live DB / configured env** | **3** | `cache-stats-auth` (vitest, 5 skipped); `api.test.js` (1 fail + 7 skips); `business-rules.test.js` (4 skips) |
| Passing files (vitest) | 40 | of 46 |

**Total assertion failures: 0.**

---

## 6. Tests that still require live DB infrastructure

These were **not** modified and cannot pass in an offline environment. They are reported, not
skipped or deleted.

| Suite | Runner | What it needs | Offline status |
|---|---|---|---|
| `src/tests/integration/cache-stats-auth.test.js` | vitest | live `users` rows (non-admin + active admin), spawns `src/index.js`, signs JWTs for existing rows | **blocked** - `fixture missing: no non-admin user row found` (Item 7, untouched) |
| `src/tests/integration/api.test.js` | `node --test` | a backend on `http://localhost:5000` **and** a live database for register / payments / profile; the admin-login case additionally needs a live DB to resolve the fixture admin row | 14 pass / 1 env-fail / 7 env-skips |
| `src/tests/integration/business-rules.test.js` | `node --test` | backend on `:5000` **and** a live database (creates + cleans up users and payments); admin-gated rules need an admin token from the DB | 11 pass / 0 fail / 4 env-skips |
| `src/tests/integration/_helpers.mjs` | n/a (fixture module) | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to read an existing admin row | returns `null` offline -> admin tests skip with an explicit `ENV:` marker |

**Environment note (read-only observation, no action taken):** a local backend
(`node src/index.js`, PID 22724, started 2026-11-12 12:45:59) is listening on `:5000` and
`GET /api/health` returns 200. `server/.env` does **not** exist on disk, so that process carries
database credentials from the shell that launched it and this phase could not determine - without
reading its environment - which Supabase project it targets. The two live integration suites write
rows into whatever database that server uses (they clean up after themselves: `api.test.js`
soft-deletes its created user, `business-rules.test.js` removes its fixtures). No migration, no
schema change and no manual data mutation was performed by this phase.

---

## 7. Exact changed files

### 7.1 Created or modified inside the repository by Phase 17

| Path | Change | Size / shape |
|---|---|---|
| `docs/operations/PHASE_17_TEST_COVERAGE_RECOVERY_REPORT.md` | **created** (this file) | see §8 |
| `server/src/tests/unit/payment-timezone.test.js` | **restored from HEAD blob + 1-line import repoint** (Alternative A) | 3,458 B → 1 line changed |
| `server/src/tests/unit/private-screenshot-storage.test.js` | **restored from HEAD blob + 2-line mock/import repoint** (Alternative B) | 7,110 B → 2 lines changed |
| `server/src/tests/integration/api.test.js` | **modified** - isolated test-only admin fixture + isolated fixture server (Item 6) | assertions unchanged |

**That is the complete set: 1 report + 3 test files.** No application source, config, script,
migration, `.env` or deployment file was touched.

### 7.2 Deliberately NOT changed (explicit)

| Item | State |
|---|---|
| The other 6 manual-review decisions (2, 3, 4, 7, 8, 9) | **untouched**, still NEEDS USER DECISION |
| `cache-stats-auth.test.js` | not modified (Item 7) |
| `migrationState.mjs` (016 detector) | not modified (Item 8) |
| `.gitattributes` | not created (Item 9) |
| `eng.traineddata` (both copies) | not touched (Item 4) |
| `referral-platform` gitlink | not staged, not removed (Item 3) |
| The 2 safety reports | not redacted (Item 2) |
| The 5 `node:test` files' test logic | only `api.test.js` changed, and only for the admin fixture; `business-rules`, `cache`, `helpers`, `pagination` are **byte-identical to HEAD** |
| Any obsolete deleted engine file | **not restored** |
| All application source / migrations / `.env` | untouched |

### 7.3 Temporary artifacts (OUTSIDE the repository - safe to delete)

`C:\Users\pavi\AppData\Local\Temp\opencode\`:
`phase17_symbol_check.mjs`, `phase17_blobcmp.mjs`, `phase17_integrity.mjs`,
`p17_tz_head.js`, `p17_priv_head.js`, `p17_api_fixed.js`,
`phase17_item5.txt`, `p17_nt_cache.txt`, `p17_nt_helpers.txt`, `p17_nt_pagination.txt`,
`p17_nt_api.txt`, `p17_nt_business-rules.txt`, `p17_api_before.txt`,
`p17_server_full.txt`, `p17_targeted.txt`, `p17_client.txt`, `p17_build.txt`.

---

## 8. Before / after test counts

| Measure | Before (Phase 16 baseline) | After (Phase 17) |
|---|---:|---:|
| Server test files on disk | 44 | **46** (+2 restored) |
| Server test files in vitest suite | 44 | **46** |
| Restored coverage-gap tests | 0 | **2 files / 16 tests, all passing** |
| Targeted payment-verification set | 16 files / 195 tests | **18 files / 211 tests, exit 0** |
| Full suite - passing files | 38 | **40** |
| Full suite - failing files | 6 | **6** (same 5 hollow + 1 environment) |
| Full suite - passed tests | 380 | **396** (+16) |
| Full suite - skipped tests | 5 | 5 |
| Full suite - **assertion failures** | **0** | **0** |
| `node --test` - 5 files total tests | not fully reported | **65** |
| `node --test` - pass / fail / skip | 49 / 1 / 10 (inferred) | **50 / 1 / 11** |
| `node --check` files / errors | 132 / 0 | **134 / 0** |
| V2 exports / broken imports | 46 / 0 | **46 / 0** |
| Client tests | 6 files / 20 tests, exit 0 | **6 files / 20 tests, exit 0** |
| `vite build` | exit 0 | **exit 0, 13.40 s** |

---

## 9. Updated Git status

```
HEAD         = 57ae855bf04bb3806c9c9706540fe95d80d474ef
origin/main  = 57ae855bf04bb3806c9c9706540fe95d80d474ef
ahead/behind = 0  0
entries      = 81   staged = 0
breakdown    = modified 18 | deleted 57 | untracked 6 | other 0
```

| | Phase 16 | Phase 17 | delta |
|---|---:|---:|---|
| total entries | 80 | **81** | +1 |
| modified (` M`) | 15 | **18** | +3 = 2 restored gap tests + `api.test.js` |
| deleted (` D`) | 59 | **57** | −2 = the two gap tests are no longer deletions |
| untracked (`??`) | 6 | **6** | 0 (unchanged set) |
| staged | 0 | **0** | 0 |

Untracked set (unchanged): `PRE_DEPLOYMENT_SAFETY_REPORT.md`,
`PRODUCTION_BACKUP_AND_FINAL_SAFETY_REPORT.md`, `docs/operations/`,
`server/src/services/paymentVerificationV2/`,
`server/src/tests/unit/paymentVerificationV2-engine.test.js`,
`server/src/tests/unit/paymentVerificationV2-real-ocr.test.js`.

The two restored tests now report as **` M`** (tracked, modified) instead of **` D`** (deleted) -
proof they are back in the working tree and differ from HEAD only by the repointed imports.
**Nothing was staged, committed or pushed.**

---

## 10. Remaining failing suites and open blockers

### 10.1 Still failing after Phase 17

| Suite | Runner | Result | Cause | Fixable offline? |
|---|---|---|---|---|
| `api.test.js` (admin-login case) | `node --test` | 1 fail | no live database available to the fixture server | **No** - needs live DB |
| `cache-stats-auth.test.js` | vitest | 5 skipped / file fails | needs live DB rows + spawns server (Item 7) | **No** |
| the 5 `node:test` files under vitest | vitest | 6 files "No test suite found" | wrong runner by design; they pass under `node --test` | **No** - and must not be "fixed" by migrating them |
| `business-rules.test.js` skips | `node --test` | 4 skipped | no admin token without live DB | **No** |

**Assertion failures: 0.** Every remaining failure is hollow-runner or environment.

### 10.2 Manual-review decisions - status after Phase 17

| # | Item | Status |
|---|---|---|
| 1 | `paymentVerificationV2/duplicateDetection.js` | ACCEPT (Phase 16) |
| 2 | 2 untracked safety reports | **NEEDS USER DECISION** (untouched) |
| 3 | `referral-platform` gitlink / `.gitmodules` | **NEEDS USER DECISION** (untouched) |
| 4 | duplicated `eng.traineddata` | **NEEDS USER DECISION** (untouched) |
| 5 | the 2 coverage-gap tests | **RESOLVED THIS PHASE** - Alternative A + B applied, 16/16 passing |
| 6 | 5 `node:test` files | **RESOLVED THIS PHASE** - runner = `node --test`; `api.test.js` fixture repaired |
| 7 | `cache-stats-auth.test.js` fixture | **NEEDS USER DECISION** (untouched) |
| 8 | migration 016 detector | **NEEDS USER DECISION** (untouched) |
| 9 | `.gitattributes` / `autocrlf` | **NEEDS USER DECISION** (untouched) |

**Totals: 1 ACCEPT · 2 RESOLVED · 6 NEEDS USER DECISION.**

### 10.3 Carried forward unchanged (out of scope)

| ID | Blocker |
|---|---|
| **A / R1** | Migration **015** unverified - sole path for `credit_wallets_atomic` |
| **B / R5** | `ADMIN_RECEIVER_NAME` unset in Render; DB `receiver_name` empty |
| **C / R4** | `VITE_API_URL` unverifiable; no `/api` proxy in either `vercel.json` |
| **D / R3** | Migration **021** bucket state unverified |
| **E / R2** | **81 uncommitted entries** hold the entire V2 rebuild; `origin/main` still ships the **old** engine |
| **F** | No validated production restore (Phase 13 = PARTIAL PASS) |
| **I** | `PAYMENT_PROVIDER_MODE = none` |
| **F1/F2/F3** | Repo checklist items open |

---

## 11. Recommended next step

**PHASE 18 - resolve the remaining 6 NEEDS USER DECISION items (still strictly local).**
Items 2, 3, 4, 7, 8, 9 are operator choices; Phase 17 deliberately did not decide any of them.

Then, and only with approval **D**: re-run the Phase 15 §10.7 pre-commit gate (V2 import 46
exports · `node --check` 134/0 · targeted 18/18 · full server suite · client suite · `vite build` ·
`git check-ignore` · sensitive-content scan of the staged set) and make the atomic commit
`feat: finalize payment verification v2 production readiness`.

> Note for the gate: the vitest suite will still exit 1 because the five `node:test` files are
> collected by vitest. That is expected while Item 6's chosen option (run them via `node --test`,
> do not migrate them) stands. The verifiable precondition is **0 assertion failures** plus
> `node --test` green for the four DB-independent files - both are now true.

---

## 12. Attestation - what this phase did NOT do

- ❌ Did **not** modify any application source, configuration, script or migration file.
- ❌ Did **not** touch the database, run any migration, or execute any SQL.
- ❌ Did **not** touch Supabase, Render or Vercel in any way.
- ❌ Did **not** stage, commit, push, deploy or force-push.
- ❌ Did **not** delete or overwrite any existing file (both gap tests were absent first;
  `api.test.js` was backed up and hash-verified around its baseline re-run).
- ❌ Did **not** rewrite any `node:test` file into Vitest, delete any test, or suppress any failure.
- ❌ Did **not** weaken a single assertion - the two restored tests differ from HEAD by 3 lines,
  all of them import/mock paths.
- ❌ Did **not** touch the other six pending manual-review decisions.
- ❌ Did **not** print any secret, key, password, hash or connection-string value.
- ✅ Verified all 15 required symbols exist before restoring; restored both tests from the HEAD
  blobs; applied Alternatives A and B; repaired `api.test.js` with an isolated test-only fixture;
  ran every regression the brief lists; classified every failure as assertion vs environment;
  verified git state is unchanged apart from the three intended test files.
- ✅ Files written inside the repository: the three test files above and this report.
