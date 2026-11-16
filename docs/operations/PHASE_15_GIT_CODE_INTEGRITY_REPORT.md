# PHASE 15 - GIT & CODE INTEGRITY RECOVERY (LOCAL-ONLY)

**Status:** COMPLETE - read-only. No staging, no commit, no push, no deploy, no application
source edits, no file deletions.
**Date:** 2026-11-15
**Repository:** `C:\Users\pavi\Desktop\jsree` (branch `main`)
**Report:** `docs/operations/PHASE_15_GIT_CODE_INTEGRITY_REPORT.md`

---

## 0. Executive summary

The working tree contains **80 uncommitted entries** representing the entire Payment
Verification V2 rebuild: **15 modified, 59 deleted, 6 untracked, 0 staged**.

| Check | Result |
|---|---|
| HEAD == origin/main | YES - `57ae855bf04bb3806c9c9706540fe95d80d474ef`, 0 ahead / 0 behind |
| V2 source complete & loadable | **PASS** - 15 files, runtime import OK, 46 exports |
| Internal V2 import resolution | **PASS** - 46/46 resolve, 0 missing |
| Named exports present | **PASS** - 46/46 exist, 0 missing |
| Dangling imports to 59 deleted files | **PASS** - `BROKEN_COUNT = 0` |
| Secret/backup leakage into a future commit | **PASS** - 0 real credentials, 0 backups, 0 dist |
| Required source silently ignored | **PASS** - 0 source files ignored |
| Backend syntax integrity | **PASS** - `node --check` 132 files, 0 errors |
| Payment-verification tests | **PASS** - 14/14 files, 170/170 tests |
| Full server suite | 380 passed / 5 skipped / **0 assertion failures**; 6 failing files = 5 hollow + 1 env |
| Client suite | **PASS** - 6/6 files, 20/20 tests |
| Client production build | **PASS** - 1759 modules, 16.45 s |
| Index state after all work | **UNCHANGED** - 0 staged, HEAD unchanged, 80 entries |

**Overall verdict: the tree is SAFE TO RECONCILE in a single atomic commit, subject to the
manual-review items in Section 10.5.** Two test-coverage gaps (Section 8) must be resolved
either by restoring tests from HEAD or by writing replacements before the suite is considered
equivalent to HEAD.

---

## 1. Scope and rules observed

Phase 15 brief: reconcile the working tree with HEAD before any release; classify uncommitted
entries; verify V2 source integrity; inspect `.gitignore` and the `referral-platform` gitlink;
run safe local build/test checks; produce a file-by-file recovery plan; write this report; STOP.

Strictly enforced in this phase:

- No application source modified.
- Nothing staged (`git add --dry-run` only - verified index still has 0 staged entries afterward).
- No commit, no push, no deploy.
- No production DB / Supabase / Render / Vercel changes.
- No user file deleted (including `client/dist`, temp artifacts, backups).
- Evidence-based claims only; failure states reported as-is.

---

## 2. Git baseline

| Item | Value |
|---|---|
| Branch | `main` |
| HEAD | `57ae855bf04bb3806c9c9706540fe95d80d474ef` |
| HEAD subject | `fix: apply migrations 017-021 to production and harden 021 portability` |
| `origin/main` | `57ae855bf04bb3806c9c9706540fe95d80d474ef` |
| Divergence | `0	0` (0 ahead, 0 behind) |
| Remote | `origin https://github.com/ganapathiganapathi3174-cmyk/jsree.git` (fetch+push) |
| `.gitattributes` | **ABSENT** |
| `core.autocrlf` | `true` |
| Files on disk (server tests) | 44 |
| Files on disk (client tests) | 6 |

> Note: `git branch -vv` reports no explicit `@{upstream}` tracking config for `main`, but
> `origin/main` exists and is byte-identical to HEAD, verified via
> `git rev-list --left-right --count HEAD...origin/main` = `0	0`.

---

## 3. Classification of the 80 uncommitted entries

`git status --porcelain` → **80 entries = 0 staged + 15 modified + 59 deleted + 6 untracked + 0 other.**

### 3.1 Modified (15) - with `git diff --numstat` added/deleted

| # | File | +/- | Nature |
|---|---|---|---|
| 1 | `DEPLOYMENT_ENV_VERIFICATION_CHECKLIST.md` | +21/-0 | docs |
| 2 | `JSREE_FINAL_PRODUCTION_READINESS_REPORT.md` | +1/-0 | docs |
| 3 | `client/src/pages/user/TopUps.jsx` | +26/-13 | client top-up flow |
| 4 | `client/src/pages/user/TopUps.test.jsx` | +4/-1 | client test |
| 5 | `referral-platform` (gitlink 160000) | 0/0 | **dirty-submodule signal only** - see 6.3 |
| 6 | `server/src/config/paymentConfig.js` | +1/-1 | comment only |
| 7 | `server/src/controllers/adminController.js` | +1/-1 | import swap (deleted `paymentVerificationHistoryService` -> V2) |
| 8 | `server/src/controllers/topupController.js` | +5/-3 | top-up controller |
| 9 | `server/src/scripts/migrationState.mjs` | +21/-0 | adds 015 detector |
| 10 | `server/src/services/paymentService.js` | +3/-3 | 3 import-path swaps -> V2 |
| 11 | `server/src/services/topupService.js` | +15/-7 | import swap + `PLAN_NOT_ELIGIBLE` logic |
| 12 | `server/src/tests/unit/migration-state-detector.test.js` | +27/-1 | now covers migration 015 |
| 13 | `server/src/tests/unit/topup-direct.test.js` | +14/-3 | mocks -> V2 + `ocrExtraction.js`; new `PLAN_NOT_ELIGIBLE` cases |
| 14 | `server/src/tests/unit/topup-hardening.test.js` | +3/-3 | mocks -> V2; engine id -> `paymentVerificationV2/1.0` |
| 15 | `server/src/tests/unit/topup-verification.test.js` | +1/-1 | imports `decidePaymentVerification` from V2 (was `legacyVerificationAdapter`) |

Content-changed files that must be committed: **14** (rows 1-4, 6-15; row 5 is the gitlink).

### 3.2 Deleted (59) - all recoverable from HEAD

| Group | Count | Files |
|---|---|---|
| Old engine | 14 | `paymentVerification/{auditService,decisionEngine,duplicateDetection,engine,extractFields,imageIntegrity,index,ocr,providerVerification,validateAmount,validateReceiver,validateSender,validateTimestamp,validateTransactionId}.js` |
| Services | 2 | `services/paymentVerificationHistoryService.js`, `services/ocrService.js` |
| Root/script | 4 | `server/runtime-proof.mjs`, `scripts/audit-recovery-order.mjs`, `scripts/audit-recovery-stages.mjs`, `scripts/e2e-payment-test.js` |
| Test helper | 1 | `tests/helpers/legacyVerificationAdapter.js` |
| Tests | 38 | see 3.3 |

**Recoverability verified:** all 39 test-path removals (`38 tests + 1 helper`) checked with
`git cat-file -e HEAD:<path>` → **0 missing from HEAD**. Everything deleted on disk still
exists at HEAD and can be restored byte-for-byte.

### 3.3 The 38 deleted test files

`approved-utr`, `diagnostic-full-verification.mjs`, `e2e-payment-verification`,
`expiry-lifecycle`, `expiry-security`, `futureproof-audit`, `gpay-masked-upi-regression`,
`gpay-recovery`, `hardening-audit-2`, `ocr-latency-optimizations`, `ocr`,
`parity-membership-topup`, `payment-409-conflicts`, `payment-auto-approval-e2e`,
`payment-auto-approval-regression`, `payment-auto-decision-policy`, `payment-decision-status`,
`payment-recovery-budget`, `payment-strict-validation`, **`payment-timezone`**,
`payment-validation-engine`, `payment-validation-matrix`, `payment-verification-failure`,
`payment-verification-unified`, `payment-verification`, `paytm-case-625024266060`,
**`private-screenshot-storage`**, `provider-agnostic`, `provider-regression`,
`recipient-name-verification`, `sender-name-validation`, `strict-verification`,
`verification-8-scenario-regression`, `verification-bullet-ocr-fix`, `verification-production`,
`verification-runtime`, `verification-service`, `verification-shortcircuit`

(bold = leaves a coverage gap; see Section 8)

### 3.4 Untracked (6 entries -> 21 files)

| Entry | Expands to |
|---|---|
| `docs/operations/` | 2 files now (PHASE_13, PHASE_14) + **this report -> 3** |
| `server/src/services/paymentVerificationV2/` | **15 files** |
| `server/src/tests/unit/paymentVerificationV2-engine.test.js` | 1 |
| `server/src/tests/unit/paymentVerificationV2-real-ocr.test.js` | 1 |
| `PRE_DEPLOYMENT_SAFETY_REPORT.md` | 1 |
| `PRODUCTION_BACKUP_AND_FINAL_SAFETY_REPORT.md` | 1 |

### 3.5 Would-be-added set (`git add --dry-run -A`)

**94 entries** (6 untracked entries expand to 21 files = +15; the `referral-platform` gitlink is
**excluded** because its recorded SHA equals the nested HEAD: 80 - 1 + 15 = 94).

**Index verified UNCHANGED after the dry run: 0 staged entries.**
---

## 4. V2 source integrity

`server/src/services/paymentVerificationV2/` contains **15 files**:

`amountValidation.js`, `auditHistory.js`, `decisionEngine.js`, `duplicateDetection.js`,
`engine.js`, `extractFields.js`, `index.js`, `ocr.js`, `ocrExtraction.js` (73 KB),
`paymentAuthenticity.js`, `receiverValidation.js`, `screenshotIntegrity.js`,
`senderValidation.js`, `timestampValidation.js`, `utrValidation.js`

The deleted old engine contained **14 files** (V2 adds `ocrExtraction.js` and splits
`imageIntegrity` -> `screenshotIntegrity`, `validate*` -> `*Validation`).

### 4.1 Tracking status - NOT ignored, simply never added

```
git check-ignore -v server/src/services/paymentVerificationV2/   -> NOT IGNORED
git check-ignore -v .../paymentVerificationV2/engine.js          -> NOT IGNORED
git check-ignore -v .../paymentVerificationV2-engine.test.js     -> NOT IGNORED
git check-ignore -v .../paymentVerificationV2-real-ocr.test.js   -> NOT IGNORED
git check-ignore -v docs/operations/                             -> NOT IGNORED
git check-ignore -v PRE_DEPLOYMENT_SAFETY_REPORT.md              -> NOT IGNORED
git check-ignore -v PRODUCTION_BACKUP_AND_FINAL_SAFETY_REPORT.md -> NOT IGNORED
```

`git status` classifies them `??` (untracked) rather than ignored. **Root cause: they were
never `git add`ed**, not that a rule excludes them. No `.gitignore` change is required.

### 4.2 Import resolution - 46/46

All 46 internal relative imports across the 15 files resolve to a file on disk:
`MISSING_COUNT = 0`. No self-referential or dead-path imports.

### 4.3 Named exports - 46/46 present

Every symbol imported by callers exists. `engine.js` exports exactly:
- `default` -> `paymentVerificationEngine`
- `PaymentVerificationEngine` (class)
- `paymentVerificationEngine` (const)

### 4.4 Runtime module-graph load (definitive)

```
$ node --input-type=module -e "const m = await import('./src/services/paymentVerificationV2/index.js'); ..."
IMPORT_OK exports=46
default=PaymentVerificationEngine
```

Named exports observed at runtime (46):
`ENGINE_ID, PaymentVerificationEngine, ValidationDecisionEngine, checkDuplicateTransaction,
closeOCRWorkers, codeForInconclusive, dateTimeEntryToDate, decidePaymentVerification,
deriveOutcomeStatus, extractPaymentData, extractPaymentFields, extractTransactionStatus,
historyFieldsForOutcome, isDemoScreenshot, isInconclusiveReason, isSameIstDay,
listVerificationHistory, logVerificationAction, matchReceiverName, matchSenderName,
matchUPIWithRecovery, normalizeAmountStrict, normalizeName, normalizeUtr,
paymentVerificationEngine, preprocessForOCR, recordVerificationAttempt,
recordVerificationOutcome, releaseApprovedUtr, requireExternalPaymentConfirmation,
reserveApprovedUtr, resolveApprovalOutcome, runAmountRecoveryDeep, runAmountRecoveryProbe,
runOcrAdditionalPasses, runOcrPrimary, statusForOutcome, userMessageFor, validateAmount,
validateDateTime, validateImageIntegrity, validateReceiver, validateSender,
validateTransactionId, verifyWithProvider`

This proves the entire V2 graph loads under Node v25.2.0 with the offline placeholder env.

---

## 5. Old-engine dependency map - no broken imports

### 5.1 Callers of the OLD engine (`services/paymentVerification/`)

**NONE.** Zero live source or test files import any of the 14 old-engine files.

### 5.2 Callers of V2 (source)

| File | Role |
|---|---|
| `server/src/config/paymentConfig.js` | engine wiring |
| `server/src/controllers/adminController.js` | history/listing via `listVerificationHistory` |
| `server/src/services/paymentService.js` | `recordVerificationAttempt` x6 |
| `server/src/services/topupService.js` | `recordVerificationAttempt` x3, verify path |

### 5.3 Callers of V2 (tests)

`paymentVerificationV2-engine.test.js`, `paymentVerificationV2-real-ocr.test.js`,
`topup-direct.test.js`, `topup-hardening.test.js`, `topup-verification.test.js`

### 5.4 Broken-import proof

**`BROKEN_COUNT = 0`** - no live (on-disk) file imports any of the 59 deleted paths.
This covers source, tests, and scripts.

### 5.5 npm scripts

`server/package.json` has exactly 4 scripts and **none references a deleted file**:

```
dev                 = node --watch src/index.js
start               = node src/index.js
seed:qa-users       = node src/scripts/seedDefaultUsers.js
vercel-build        = echo 'No build needed'
```

The 3 deleted scripts (`audit-recovery-order.mjs`, `audit-recovery-stages.mjs`,
`e2e-payment-test.js`) were never wired into `package.json`.

---

## 6. Release safety

### 6.1 `.gitignore` review

Rules in effect: `node_modules`, `.env` and `.env*`, `dist/`, `build/`, `uploads/*`, `*.log`,
`coverage/`, `.vercel/`, `.railway/`, `referral-platform_snapshot_*.zip`, `__pycache__/`,
`*.pid`, `qa/artifacts/`.

**Over-broad-ignore check:** every file under `server/src`, `client/src`, `docs`, `supabase`
was run through `git check-ignore -v` → **NONE ignored**. No required application source can be
silently lost by a commit.

**`.env` inventory:**

| File | State |
|---|---|
| `.env.example` (root) | TRACKED / not ignored - template, safe |
| `server\.env.example` | TRACKED / not ignored - template, safe |
| `client\.env.example` | TRACKED / not ignored - template, safe |
| `referral-platform\server\.env` | untracked; **ignored by the nested repo's own `.gitignore:21:.env*`** |
| `referral-platform\*.env.local`, `*.vercel\.env.*.local` (4 more) | untracked; ignored by nested repo |
| `referral-platform\*.env.example` (4) | tracked by nested repo - templates, safe |

**No real `.env` file is tracked by the main repository.**

**`client/dist`** → ignored by `.gitignore:7:dist/` (build output regenerated on demand;
not deleted in this phase).

### 6.2 Would-be-added contents (sensitive-content scan)

35 unique files would be added. Scanned for: Supabase service-role JWT literals (`eyJ...`),
`AKIA`/`sk-` keys, private-key blocks, password assignments, `JWT_SECRET` assignments,
credential-bearing `postgres://` URLs, `Bearer` literals, bcrypt hashes.

| Pattern | Hits |
|---|---|
| service-role / JWT literal (`eyJ...`) | **0** |
| AWS / `sk-` key | **0** |
| private-key block | **0** |
| bcrypt hash | **0** |
| SHA-256 checksum literal (64 hex) | **0** |
| `postgres://` credential-shaped string | **2** (both classified below) |
| backup `.sql` / backup artifact in set | **0** |
| `dist/`, `node_modules/`, `*.zip` snapshot in set | **0** |

**The 2 `postgres://` hits, value-safe classification (value never printed):**

| File | Line | Shape | Verdict |
|---|---|---|---|
| `PRE_DEPLOYMENT_SAFETY_REPORT.md` | 162 | 10 chars, 9 distinct, 8 alnum, **contains `PASSWORD`** | **TEMPLATE PLACEHOLDER** - appears inside `export DATABASE_URL="..."` under the heading *"Required env (operator sets these; DO NOT expose secrets)"* → safe |
| `PRODUCTION_BACKUP_AND_FINAL_SAFETY_REPORT.md` | 149 | 3 chars, 1 distinct, **0 alnum, pure mask (`*`-class)** | **MASKED** - appears inside `export DATABASE_URL="..."` under *"Set env (operator, do not export secrets in terminal)"* → safe |

Both hits are operator instruction templates, not live credentials. Both reports additionally
contain the public-ish Supabase project ref `<PROJECT_REF>` (5x / 9x) and a partial UPI
id (`okicici` 2x / 1x) - informational exposure only, not a credential.

**Reports written in Phases 13/14 are clean:**

```
docs/operations/PHASE_13_PGLITE_BACKUP_VALIDATION.md -> CLEAN
docs/operations/PHASE_14_PRODUCTION_GATE_AUDIT.md     -> CLEAN
```

### 6.3 `referral-platform` gitlink

| Item | Value |
|---|---|
| Mode | `160000` (gitlink / embedded git repo) |
| Recorded SHA | `8982086e87102d2e6c3f39600a855dba9a869c03` |
| Nested HEAD | `8982086e87102d2e6c3f39600a855dba9a869c03` (**identical**) |
| Nested HEAD subject | `feat: harden payment verification with timeout, dedup, and external confirmation gates` |
| `.gitmodules` | **ABSENT** |
| `git submodule status` | `fatal: no submodule mapping found in .gitmodules for path 'referral-platform'` |
| Nested worktree | **DIRTY - 11 entries** (5 modified: `adminController.js`, `paymentService.js`, `registrationStatusService.js`, `topupService.js`, `verificationService.js`; plus probe/debug leftovers `__dateprobe.mjs`, `__dbprobe.mjs`, `__probe.mjs`, 2 untracked reports/tests) |
| In `git add --dry-run` set? | **NO - excluded entirely** |

**Interpretation:** the ` M referral-platform` status flag is a *dirty-submodule signal* from
the nested repo's own uncommitted work, **not** a content change to the gitlink. Because the
recorded SHA equals the nested HEAD, staging it would be a **no-op**. Its contents are never
part of this repository and were never in the would-be-added set.

**Also relevant:** `eng.traineddata` is tracked **twice** (repo root + `server/`), 5,199,098 B
each = ~10.4 MB redundant. Flagged for the operator (Section 10.5), not changed.

---

## 7. CORRECTION to Phase 14 finding R6

Phase 14 stated "`payment_verifications` is never written". **That finding was WRONG and is
hereby retracted.** It was an artifact of a PowerShell 5.1 limitation: `-Path` with a `**`
glob does not recurse, so the scanner never reached the V2 files.

Verified in this phase:

| Claim | Evidence |
|---|---|
| Table IS written | `paymentVerificationV2/auditHistory.js:58` → `await supabase.from('payment_verifications').insert(row)` |
| Table IS read | `paymentVerificationV2/auditHistory.js:79-80` → `.select('*')` |
| Writer callers | `services/paymentService.js` calls `recordVerificationAttempt` **x6**; `services/topupService.js` calls it **x3** |
| Reader callers | `controllers/adminController.js` calls `listVerificationHistory` **x2** |

**Verification history IS recorded.** Phase 14's R6 must be read as retracted when reviewing
that report. (All other Phase 14 findings stand.)

**Related confirmed Phase 14 finding R8 (still valid):** `scripts/migrationState.mjs` now
detects `015, 017-021` (per `migration-state-detector.test.js`, +27 lines), but **016 still has
no detector**.

---

## 8. Test coverage gaps after the 38 test deletions

Areas verified as still covered by the remaining 44 test files: screenshot proxy RBAC
(`screenshot-proxy-access.test.js`), UTR atomic reservation, payment expiry, HTTP 409 conflict,
strict amount validation, sender-name policy, receiver-name gate, duplicate-UTR detection,
screenshot integrity, payment ownership, wallet service, top-up (direct/hardening/verification/
claim/concurrency/controller/retention), migration-state detection.

**Two genuine gaps found:**

| # | Gap | Evidence | Deleted test | Size | Recoverable from HEAD? |
|---|---|---|---|---|---|
| 1 | **IST / timezone handling** | No test file contains any of `Asia/Kolkata`, `IST_UTC_OFFSET`, `isSameIstDay`, `TIMEZONE`, `+05:30`; **both V2 tests have NO IST markers** | `payment-timezone.test.js` | 3,458 B | **YES** |
| 2 | **Private bucket / signed private URL** | No remaining test references `privateObjectUrl` (defined in `server/src/utils/helpers.js`) or `storageObjectPathFromUrl` (defined in `services/paymentService.js` and `services/topupService.js`) | `private-screenshot-storage.test.js` | 7,110 B | **YES** |

`screenshot-proxy-access.test.js` still covers *proxy RBAC* but does **not** cover
`privateObjectUrl` construction.

**All 39 deleted test paths are recoverable from HEAD - 0 missing.** Restore is lossless:

```
git show HEAD:server/src/tests/unit/payment-timezone.test.js        > server/src/tests/unit/payment-timezone.test.js
git show HEAD:server/src/tests/unit/private-screenshot-storage.test.js > server/src/tests/unit/private-screenshot-storage.test.js
```

---

## 9. Build & test results (Phase 15, fresh runs)

Offline placeholder env used for all runs:
`SUPABASE_URL=https://supabase-unit-test.invalid`,
`SUPABASE_SERVICE_ROLE_KEY=placeholder-service-role-key-for-unit-tests`,
`SUPABASE_ANON_KEY=placeholder-anon-key-for-unit-tests`,
`JWT_SECRET=placeholder-jwt-secret-minimum-32-characters`, `NODE_ENV=test`,
`ADMIN_RECEIVER_NAME=Jayaraj`.

### 9.1 V2 runtime import

`IMPORT_OK exports=46`, default = `PaymentVerificationEngine` - **PASS**

### 9.2 Targeted payment-verification tests (14 files)

```
Test Files  14 passed (14)
     Tests  170 passed (170)
     EXIT   0
```

Files: `paymentVerificationV2-engine`, `paymentVerificationV2-real-ocr`,
`migration-state-detector`, `screenshot-proxy-access`, `payment-ownership`, `payment-expiry`,
`wallet-service`, `topup-direct`, `topup-hardening`, `topup-verification`, `topup-claim`,
`topup-concurrency-race`, `topup-controller`, `admin-delete-topup-retention`.

### 9.3 Full server suite

```
Test Files  6 failed | 38 passed (44)
      Tests  380 passed | 5 skipped (385)
   Duration  24.42s
      EXIT   1
```

**Zero assertion failures.** The 6 failing files are all non-assertion failures:

| File | Failure | Class |
|---|---|---|
| `src/tests/integration/api.test.js` | `No test suite found in file` | **HOLLOW** |
| `src/tests/integration/business-rules.test.js` | `No test suite found in file` | **HOLLOW** |
| `src/tests/unit/cache.test.js` | `No test suite found in file` | **HOLLOW** |
| `src/tests/unit/helpers.test.js` | `No test suite found in file` | **HOLLOW** |
| `src/tests/unit/pagination.test.js` | `No test suite found in file` | **HOLLOW** |
| `src/tests/integration/cache-stats-auth.test.js` | `fixture missing: no non-admin user row found` | **ENVIRONMENT** (live-DB fixture; 5 tests skipped) |

Reproduces the Phase 14 counts exactly. Disk file count = 44, matching the suite.

### 9.4 Backend syntax integrity

```
node --check across server/src/**/*.js,*.mjs
  checked = 132     syntax_errors = 0
```

No build step exists for the backend (`vercel-build` = `echo 'No build needed'`); syntax +
module-graph checks are the equivalent gate. **PASS**

### 9.5 Client suite

```
Test Files  6 passed (6)
      Tests  20 passed (20)
   Duration  29.82s
      EXIT   0
```

Files: `AuthForms.test.jsx`, `RegisterPage.test.jsx`, `RegistrationPaymentFlow.test.jsx`,
`Receipts.test.jsx`, `TopUps.test.jsx`, `api.test.js`. **PASS**

### 9.6 Client production build

```
vite build
  1759 modules transformed
  built in 16.45s
  EXIT 0
```

**PASS** (output lands in ignored `client/dist`).

### 9.7 Post-work integrity of this phase

```
HEAD         = 57ae855bf04bb3806c9c9706540fe95d80d474ef   (unchanged)
branch       = main
entries      = 80   staged = 0                            (unchanged)
origin/main  = 57ae855bf04bb3806c9c9706540fe95d80d474ef   (0 ahead / 0 behind)
untracked    = exactly the same 6 entries as at start     (no new files created)
```
---

## 10. File-by-file reconciliation plan (PROPOSED - not executed)

> **Category key:** TRACK = must be committed · LOCAL = leave as-is (ignored/untracked by
> design) · EXCLUDE = must NOT enter the commit · REVIEW = human decision required first.

### 10.1 TRACK - new files never added (22 files)

| # | Path | State |
|---|---|---|
| 1-15 | `server/src/services/paymentVerificationV2/*.js` (15 files) | REVIEW `duplicateDetection.js` (10.5.1) |
| 16 | `server/src/tests/unit/paymentVerificationV2-engine.test.js` | TRACK |
| 17 | `server/src/tests/unit/paymentVerificationV2-real-ocr.test.js` | TRACK |
| 18 | `docs/operations/PHASE_13_PGLITE_BACKUP_VALIDATION.md` | TRACK (clean) |
| 19 | `docs/operations/PHASE_14_PRODUCTION_GATE_AUDIT.md` | TRACK (clean; R6 retracted - see 7) |
| 20 | `docs/operations/PHASE_15_GIT_CODE_INTEGRITY_REPORT.md` (this file) | TRACK |
| 21 | `PRE_DEPLOYMENT_SAFETY_REPORT.md` | REVIEW - credential is a placeholder (6.2) |
| 22 | `PRODUCTION_BACKUP_AND_FINAL_SAFETY_REPORT.md` | REVIEW - credential is masked (6.2) |

*(15 + 2 + 3 docs + 2 reports = 22 tracked files after this report is written.)*

### 10.2 TRACK - modified files (14)

`DEPLOYMENT_ENV_VERIFICATION_CHECKLIST.md`,
`JSREE_FINAL_PRODUCTION_READINESS_REPORT.md`,
`client/src/pages/user/TopUps.jsx`,
`client/src/pages/user/TopUps.test.jsx`,
`server/src/config/paymentConfig.js`,
`server/src/controllers/adminController.js`,
`server/src/controllers/topupController.js`,
`server/src/scripts/migrationState.mjs`,
`server/src/services/paymentService.js`,
`server/src/services/topupService.js`,
`server/src/tests/unit/migration-state-detector.test.js`,
`server/src/tests/unit/topup-direct.test.js`,
`server/src/tests/unit/topup-hardening.test.js`,
`server/src/tests/unit/topup-verification.test.js`

### 10.3 TRACK - deletions (59) - ATOMIC with 10.1/10.2

- **14** `server/src/services/paymentVerification/*.js`
- **2** `server/src/services/paymentVerificationHistoryService.js`, `server/src/services/ocrService.js`
- **4** `server/runtime-proof.mjs`, `server/src/scripts/audit-recovery-order.mjs`,
  `server/src/scripts/audit-recovery-stages.mjs`, `server/src/scripts/e2e-payment-test.js`
- **1** `server/src/tests/helpers/legacyVerificationAdapter.js`
- **38** unit/integration tests (list at 3.3)

### 10.4 EXCLUDE - must not enter the commit

| Path | Why |
|---|---|
| `referral-platform` (gitlink `160000`) | No `.gitmodules`; SHA already matches; staging is a no-op; nested repo is dirty with its own work. Resolve via 10.5.3 first. |
| `referral-platform/**` contents (5 modified, 6 untracked incl. `__*probe.mjs`) | Belongs to a separate repository; never part of this worktree's commit. |
| `referral-platform\server\.env`, `*.env.local`, `*.vercel\.env.*.local` | Ignored by the nested repo; keep it that way. |
| `client/dist/**` | Ignored by `.gitignore:7:dist/` - regenerated by `vite build`. |
| `node_modules/**`, `referral-platform_snapshot_*.zip`, `uploads/**`, `*.log`, `coverage/**` | Ignored by design. |
| Any real `.env` | None tracked today; keep it that way. |

### 10.5 REVIEW - human decision required before commit

1. **`server/src/services/paymentVerificationV2/duplicateDetection.js`** - hand-rewritten via
   PowerShell here-string; the whole V2 directory is untracked, so **git has no diff to show**
   for it. It must be read end-to-end against the HEAD version it replaces
   (`services/paymentVerification/duplicateDetection.js`).
2. **The 2 untracked safety reports** - credential values verified as placeholder/masked in
   6.2, but both are long operator-facing docs containing the production project ref and a
   partial UPI id. Confirm acceptable, or redact line 162 / line 149.
3. **`referral-platform` gitlink + missing `.gitmodules`** - pick one: (a) leave the gitlink
   out of the commit permanently and stop reporting ` M`; (b) remove the gitlink from the index
   (`git rm --cached referral-platform`); (c) add a real `.gitmodules`. Option (b) or (c) are
   the only ways to stop the permanent phantom ` M`.
4. **Duplicated `eng.traineddata`** - 5,199,098 B tracked at root *and* at `server/`
   (~10.4 MB). Consider dropping one (separately; unrelated to V2).
5. **Coverage gaps (Section 8)** - restore `payment-timezone.test.js` and
   `private-screenshot-storage.test.js` from HEAD, **or** write V2 equivalents covering
   IST/timezone alignment and `privateObjectUrl`/`storageObjectPathFromUrl`.
6. **5 hollow test files** - `api`, `business-rules`, `cache`, `helpers`, `pagination` emit
   `No test suite found`. Restore their `describe/it` bodies from HEAD, or delete them so the
   suite reports honestly instead of always exiting non-zero.
7. **`cache-stats-auth.test.js`** - needs a non-admin fixture row (`fixture missing`). Mark it
   as an integration/live-DB test or supply a fixture.
8. **Migration 016 detector still absent** from `scripts/migrationState.mjs`.
9. **`.gitattributes` absent + `core.autocrlf=true`** - the docs written by Phases 13-15 will
   be normalized to CRLF on commit. Consider adding `.gitattributes` with `* text=auto
   eol=lf` to stop the LF/CRLF warnings and avoid spurious diffs on other machines.

### 10.6 Atomicity - ordering rules

The four rewired callers (`paymentService.js`, `topupService.js`, `paymentConfig.js`,
`adminController.js`) already import `./paymentVerificationV2/index.js`. Therefore:

| Commit composition | Result |
|---|---|
| 10.1 + 10.2 + 10.3 together (one commit) | **SAFE - recommended** |
| 10.1 + 10.2 only (deletions left behind) | SAFE, but tree keeps a dead old engine |
| **10.2 only (callers without V2 dir)** | **BROKEN - `BROKEN_COUNT` becomes non-zero** |
| **10.3 only (deletions without V2 dir)** | **BROKEN - V2 callers lose their module** |
| 10.1 only | SAFE (old engine still in HEAD, both present) |

**Never split the callers from the V2 directory.** Since all entries live in one worktree, a
single staging action covering 10.1-10.3 satisfies this automatically.

### 10.7 Required pre-commit gate (re-run immediately before any commit)

1. `node --input-type=module -e "import('./src/services/paymentVerificationV2/index.js')"` → 46 exports
2. `node --check` across `server/src` → 0 syntax errors
3. `npx vitest run` (14 targeted payment files) → 14/14, 170/170, exit 0
4. `npx vitest run` (full server) → 380 passed, **0 assertion failures** (report the 6 known files)
5. `cd client && npx vitest run` → 6/6, 20/20, exit 0
6. `cd client && npx vite build` → exit 0
7. `git check-ignore` on the 15 V2 files → still NOT IGNORED
8. Re-run the sensitive-content scan (6.2) on the exact staged set (`git diff --cached --name-only`)

---

## 11. Safe recovery commands (FOR OPERATOR REVIEW - none executed)

> Every command below was **verified to be possible** (Section 3.2) but **NOT run** in Phase 15.

```bash
# A. Restore the two tests that leave coverage gaps (lossless, from HEAD)
git show HEAD:server/src/tests/unit/payment-timezone.test.js \
  > server/src/tests/unit/payment-timezone.test.js
git show HEAD:server/src/tests/unit/private-screenshot-storage.test.js \
  > server/src/tests/unit/private-screenshot-storage.test.js

# B. Restore any of the other 36 deleted tests the same way
git show HEAD:server/src/tests/unit/<name>.test.js > server/src/tests/unit/<name>.test.js

# C. Full audit of what a commit would contain (changes the index - run only when ready)
git add -A --dry-run                 # read-only preview  -> expect 94 entries (now 95 with this report)
git add -A                           # STAGES - review first
git diff --cached --stat             # review staged set before committing

# D. Proposed commit message (only after 10.7 gate passes + operator approval)
git commit -m "feat: finalize payment verification v2 production readiness"

# E. Verify we are in sync before pushing (never force-push)
git fetch origin
git rev-list --left-right --count HEAD...origin/main   # expect: <ahead> 0

# F. Show the nested repo's own state (read-only)
git -C referral-platform status --porcelain
git submodule status                                  # currently fatals - no .gitmodules
```

**Phase 15 executed none of A-F except the `--dry-run` form of C.**

---

## 12. Unresolved blockers (carried forward from Phase 14 - NOT resolved here)

These are outside Phase 15's read-only scope and remain **BLOCKED**:

| ID | Blocker | Impact |
|---|---|---|
| A | **Migration 015 state unverified** - sole path providing `credit_wallets_atomic` | Top-up credit can fail at runtime; Gate A = CONDITIONAL |
| B | **`ADMIN_RECEIVER_NAME=Jayaraj` unset in Render** | Receipt/name gate will fail |
| C | **`VITE_API_URL` unverifiable** - no `/api` proxy in either `vercel.json` | FE→BE routing unconfirmed |
| D | **Migration 021 bucket state unverified** | Storage config unknown |
| E | **80 (now still 80) uncommitted entries hold the entire V2 rebuild** | Nothing is pushed; `main` on GitHub has none of this work |
| F | **No validated production restore** (Phase 13 = PARTIAL PASS; storage backup uncovered) | RTO/RPO unproven |
| F1/F2/F3 | Repo checklist items open (see Phase 14 §R) | Per Phase 14 |
| G | 5 hollow test files + 1 env fixture → suite always exits 1 | CI signal is permanently red |
| H | 2 coverage gaps (Section 8) | IST/timezone and private-URL behaviour unguarded |
| I | Provider mode `none` (OCR only) | OCR result is not bank settlement confirmation |

---

## 13. Final statement

- **80 entries classified:** 15 modified · 59 deleted · 6 untracked · 0 staged · 0 other.
- **V2 integrity: PASS** on all four axes (tracking, imports, exports, runtime load).
- **No broken imports** to any of the 59 deleted files (`BROKEN_COUNT = 0`).
- **No secret, backup, or build artifact would enter a commit**; the 2 credential-shaped
  strings are confirmed placeholder/masked template values.
- **No required source is silently ignored.**
- **Builds and tests: PASS** - V2 import OK, 132-file syntax check 0 errors, targeted
  14/14 + 170/170, full server 380 passed / 0 assertion failures, client 6/6 + 20/20,
  `vite build` 1759 modules.
- **Phase 14 R6 retracted** (Section 7) - `payment_verifications` IS written and read.
- **2 coverage gaps identified** with lossless restore paths from HEAD (Section 8).
- **Repository state unchanged by this phase:** HEAD `57ae855b...`, 0 staged, 80 entries,
  0 ahead / 0 behind `origin/main`.

**The working tree is safe to reconcile in one atomic commit after the 9 manual-review items
in Section 10.5 and the 8-part pre-commit gate in Section 10.7 are satisfied by the operator.**

**STOP.** No staging, commit, push, deploy, source edit, or file deletion was performed.