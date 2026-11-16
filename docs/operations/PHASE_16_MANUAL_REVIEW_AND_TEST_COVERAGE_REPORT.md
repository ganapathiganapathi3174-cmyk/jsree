# PHASE 16 - MANUAL REVIEW DECISIONS & TEST COVERAGE RECOVERY

**Date:** 2026-11-15
**Repository:** `C:\Users\pavi\Desktop\jsree` (branch `main`)
**Mode:** STRICTLY LOCAL. No production mutation. No DB/migration change. No Supabase,
Render or Vercel change. No staging, no commit, no push, no deploy. No existing work deleted.
**Inputs:** `docs/operations/PHASE_14_PRODUCTION_GATE_AUDIT.md`,
`docs/operations/PHASE_15_GIT_CODE_INTEGRITY_REPORT.md` (§10.5).
**Report:** `docs/operations/PHASE_16_MANUAL_REVIEW_AND_TEST_COVERAGE_REPORT.md`

---

## 0. Executive summary

| Objective | Outcome |
|---|---|
| Extract all 9 §10.5 manual-review items | **DONE** - all 9 individually documented (§3) |
| Decide each item without silently approving | **DONE** - 1 × ACCEPT (evidence-backed), **8 × NEEDS USER DECISION**, 0 × REJECT |
| Investigate `payment-timezone.test.js` | **DONE** - HEAD version inspected; **verbatim restore = INCOMPATIBLE** (proven) |
| Investigate `private-screenshot-storage.test.js` | **DONE** - HEAD version inspected; **verbatim restore = INCOMPATIBLE** (proven) |
| Restore the two tests | **NOT RESTORED** - brief's incompatible branch applies; reason + safe alternative at §2.6 |
| Asia/Kolkata timezone handling verified | **PASS** - 16/16 HEAD assertions hold against current code |
| Private screenshot URL + access restrictions verified | **PASS** - probes + 26/26 proxy suite + 3/3 upload suite |
| V2 imports/exports verified | **PASS** - 46 exports, 15 files, 0 missing imports, 0 syntax errors |
| Backend tests | targeted **16/16 files, 195/195 tests**; full suite **380 passed / 0 assertion failures** |
| Client tests + production build | **PASS** - 6/6 files, 20/20 tests; `vite build` 1759 modules |
| Git state | **UNCHANGED** - HEAD `57ae855b`, 80 entries, **0 staged**, 0/0 vs `origin/main` |

**Headline findings:**
1. The 9 review items are **not** all equivalent - only #1 has enough evidence to be decided
   here; the other 8 are genuine operator choices and are marked **NEEDS USER DECISION**.
2. Both coverage-gap tests are **byte-incompatible** with the current tree: each imports a
   module deleted by this rebuild. Verbatim restore would make the suite *worse*, not better.
3. The "5 hollow test files" root cause was found: they import **`node:test`**, not `vitest`.
   They are **identical to HEAD** (so restoring from HEAD changes nothing) and **4 of 5 pass**
   when run under their intended runner.
4. The hand-rewritten `duplicateDetection.js` has **0 differing executable lines** vs HEAD.

---

## 1. Scope and rules observed

- No production application behaviour modified.
- No database or migration file touched.
- No Supabase / Render / Vercel setting touched.
- Nothing staged or committed; nothing pushed or deployed.
- No existing work deleted. No user decision made on the user's behalf - every item that is a
  preference, policy or operations choice is returned as **NEEDS USER DECISION**.
- All claims are evidence-backed and re-runnable; failures are reported as failures.

---

## 2. The two coverage-gap tests - investigation & decision

### 2.1 Decision

> **NEITHER TEST WAS RESTORED.**

The brief states: *"If safe: restore only these two test files from HEAD. If unsafe or
incompatible: do not restore, explain the exact reason, and provide a safe alternative."*
Both files are **incompatible with the current working tree**, proven below, so the
"do not restore" branch applies.

Neither file exists on disk today, so **nothing was overwritten** and no newer work was lost.

| File | HEAD bytes | HEAD sha256 | On disk now | Restored? |
|---|---:|---|---|---|
| `payment-timezone.test.js` | 3,458 (70 lines) | `9260af2b8984ce9fb3a9324ef1ad42b330e339800f60c1c4e690ed1ad29ffb73` | **NO** | **NO** |
| `private-screenshot-storage.test.js` | 7,109 (153 lines) | `fd03e6d9c0a193bf27f8b4d44ebb30c6cc557f721b2524bef78e52fa243bfc54` | **NO** | **NO** |

### 2.2 Exact HEAD content inspected

Both files were read in full from `git show HEAD:...` before any decision.

**`payment-timezone.test.js`** - 70 lines, 8 `it` blocks (1 with a 6-row `it.each` matrix),
asserting `IST_TIMEZONE === 'Asia/Kolkata'`, `IST_UTC_OFFSET_MS === 5.5h`, IST wall-clock to
UTC conversion, a ±30-minute acceptance matrix, a midnight-IST boundary case, and rejection of
unparseable strings.

**`private-screenshot-storage.test.js`** - 153 lines, 4 `it` blocks, asserting: private object
URL with no `/public/` segment and `getPublicUrl` never called; `verifyPayment` reads via
`storage.download` and never `fetch`; `streamPaymentScreenshot` accepts **both** legacy public
and new private URL shapes; cross-user requests are rejected while admin is allowed.

### 2.3 Imports / mocks / test assumptions checked

| Test | Import or mock target | Exists on disk? | Verified |
|---|---|---|---|
| timezone | `../../services/ocrService.js` | **NO** (deleted by rebuild) | proven §2.4 |
| private-screenshot | `../../services/paymentVerification/index.js` (`import` **and** `vi.mock`) | **NO** (deleted by rebuild) | proven §2.4 |
| private-screenshot | `../../services/paymentService.js` | YES | `uploadScreenshot` / `streamPaymentScreenshot` / `verifyPayment` all still exported |

Symbols the timezone test needs - **present but in a different module**:

| Symbol | In deleted `ocrService.js`? | In V2 `ocrExtraction.js`? | Re-exported by V2 `index.js`? |
|---|---|---|---|
| `parsePaymentDate` | gone | **YES** (`export function`, L187) | **no** |
| `isWithinTimeWindow` | gone | **YES** (`export function`, L1496) | **no** |
| `IST_TIMEZONE` | gone | **YES** (`export const`, L11) | **no** |
| `IST_UTC_OFFSET_MS` | gone | **YES** (`export { IST_UTC_OFFSET_MS, ... }`, L1544) | **no** |

Symbols the private-screenshot test mocks - **all 8 present in V2 `index.js`**:
`ENGINE_ID`, `paymentVerificationEngine`, `recordVerificationAttempt`,
`listVerificationHistory`, `deriveOutcomeStatus`, `decidePaymentVerification`,
`reserveApprovedUtr`, `releaseApprovedUtr`.

### 2.4 Empirical proof of incompatibility (not inferred)

```
$ node --input-type=module -e "await import('./src/services/ocrService.js')"
  FAILS -> ERR_MODULE_NOT_FOUND: Cannot find module '...server\src\services\ocrService.js'

$ node --input-type=module -e "await import('./src/services/paymentVerification/index.js')"
  FAILS -> ERR_MODULE_NOT_FOUND: Cannot find module '...server\src\services\paymentVerification\index.js'

$ control: await import('./src/services/paymentVerificationV2/index.js')
  OK exports=46
```

Restoring either file verbatim would fail at module resolution / `vi.mock` collection time,
turning a *coverage gap* into a *hard suite error*. `BROKEN_COUNT`, which is **0** today
(Phase 15 §5.4), would become 2.

### 2.5 Confirming restoration would not overwrite newer work

`server/src/tests/unit/payment-timezone.test.js` and
`server/src/tests/unit/private-screenshot-storage.test.js` **do not exist on disk** and are
still listed as tracked deletions in `git status`. There is no local file to clobber, and no
newer replacement test occupies either name. (This criterion alone would have been *safe*;
the module-resolution failure in §2.4 is what makes the restore **incompatible**.)

### 2.6 Safe alternative (PROPOSED - not applied; requires approval)

Both fixes are **mechanical import-path swaps of the exact kind already accepted in this
rebuild** (`topup-verification.test.js` was changed from `legacyVerificationAdapter` to the V2
index; `topup-direct/hardening` mocks were repointed to V2). **No test assertion changes.**

**Alternative A - `payment-timezone.test.js` (1 line)**

```diff
- import { parsePaymentDate, isWithinTimeWindow, IST_TIMEZONE, IST_UTC_OFFSET_MS } from '../../services/ocrService.js';
+ import { parsePaymentDate, isWithinTimeWindow, IST_TIMEZONE, IST_UTC_OFFSET_MS } from '../../services/paymentVerificationV2/ocrExtraction.js';
```

> Must import from `ocrExtraction.js` **directly**: the V2 `index.js` re-export block
> (lines 64-75) does **not** include any of these four symbols.

**Alternative B - `private-screenshot-storage.test.js` (2 lines)**

```diff
- vi.mock('../../services/paymentVerification/index.js', () => ({
+ vi.mock('../../services/paymentVerificationV2/index.js', () => ({
...
- import { paymentVerificationEngine } from '../../services/paymentVerification/index.js';
+ import { paymentVerificationEngine } from '../../services/paymentVerificationV2/index.js';
```

**Alternative C - write new V2-native tests** covering the same four private-URL assertions and
the IST matrix from scratch (more work, no dependency on the legacy file).

> **Status: NOT APPLIED.** Choosing A, B or C is recorded as **NEEDS USER DECISION**
> (§3.5). The alternatives are documented so they can be applied in one step after approval.

---

## 3. The 9 §10.5 manual-review items - individually documented

**Decision key:** ACCEPT = evidence shows it is safe and I recommend it ·
REJECT = evidence shows it must not be accepted ·
NEEDS USER DECISION = the call is an operator preference / policy / operations choice and
**is not made here**.

### Item 1 - `paymentVerificationV2/duplicateDetection.js` (hand-rewritten, no git diff)

| Aspect | Detail |
|---|---|
| **1. File / decision** | `server/src/services/paymentVerificationV2/duplicateDetection.js` (116 lines), versus HEAD `server/src/services/paymentVerification/duplicateDetection.js` (141 lines) |
| **2. Why manual review** | It was hand-rewritten via a PowerShell here-string. The whole `paymentVerificationV2/` directory is **untracked**, so `git diff` shows nothing - normal review tooling cannot display what changed. |
| **3. Evidence available** | (a) Comment/blank-stripped comparison: **HEAD = 84 executable lines, V2 = 84 executable lines, DIFFERING = 0** → identical logic. (b) All 4 exports identical in name *and* signature: `checkDuplicateTransaction(transactionId, excludePaymentId, excludeTopupId)`, `normalizeUtr(utr)`, `reserveApprovedUtr(utr, referenceType, referenceId)`, `releaseApprovedUtr(utr, referenceType, referenceId)`. (c) Full unified diff shows **only**: UTF-8 BOM removal, em-dash mojibake (`\u2014` shown as `ΓÇö`) normalised to ASCII `-`, and deletion of explanatory comments/banner blocks. (d) V2 internal imports: 0 missing; `index.js` re-exports all 4 (lines 32-37). |
| **4. Risk if accepted incorrectly** | This module is the duplicate-UTR gate. A defect would cause **double wallet credit** (duplicate UTR slipping through) or **false `DUPLICATE_UTR`** rejecting legitimate payments - direct financial impact. |
| **Recommended decision** | **ACCEPT** - commit as-is. Evidence shows byte-equivalent executable logic. |

> ACCEPT here is a *code-correctness* verdict only. It does **not** authorise a commit;
> git approval **D** and the §Phase-15 10.7 pre-commit gate still apply.

### Item 2 - the 2 untracked safety reports

| Aspect | Detail |
|---|---|
| **1. File / decision** | `PRE_DEPLOYMENT_SAFETY_REPORT.md` (line 162) and `PRODUCTION_BACKUP_AND_FINAL_SAFETY_REPORT.md` (line 149) - both untracked |
| **2. Why manual review** | Both are long operator-facing documents that would be committed into a public-ish repository and contain a `postgres://`-shaped connection string plus the production Supabase project ref and a partial UPI id. |
| **3. Evidence available** | Both `postgres://` strings are **instruction templates**, re-verified this phase: L162 → 10-char value containing `PASSWORD` = **TEMPLATE PLACEHOLDER**, inside `export DATABASE_URL="..."` under *"Required env (operator sets these; DO NOT expose secrets)"*; L149 → 3-char, 1-distinct, 0-alnum pure mask = **MASKED**, under *"Set env (operator, do not export secrets in terminal)"*. Additional scan of both files: **0** service-role JWTs (`eyJ…`), **0** bcrypt hashes, **0** private-key blocks, **0** `AKIA…` keys, **0** `password = "…"` assignments. Incidental content: project ref `<PROJECT_REF>` (5×/9×) and partial UPI id `okicici` (2×/1×). |
| **4. Risk if accepted incorrectly** | If a live credential were embedded, committing would leak a production database password. The residual, non-credential risk is publishing the **project ref** and a **partial UPI id** (recon value, not a secret). |
| **Recommended decision** | **NEEDS USER DECISION** - technically there is no live credential, so the choice is purely whether publishing the production project ref / partial UPI id is acceptable, or whether to redact line 162 / line 149 first. Not decided here. |

### Item 3 - `referral-platform` gitlink + missing `.gitmodules`

| Aspect | Detail |
|---|---|
| **1. File / decision** | `referral-platform` (mode `160000`) and the absent `.gitmodules`; three mutually exclusive options |
| **2. Why manual review** | All three options are index/repository-structure changes with different long-term consequences; none is reversible by simply re-running the build. |
| **3. Evidence available** | `.gitmodules` **ABSENT**; recorded gitlink `160000 8982086e87102d2e6c3f39600a855dba9a869c03`; nested HEAD `8982086e87102d2e6c3f39600a855dba9a869c03` (**identical**); nested worktree **DIRTY (11 entries)**; parent status line ` M referral-platform`; `git submodule status` → `fatal: no submodule mapping found in .gitmodules for path 'referral-platform'`; gitlink **excluded** from `git add --dry-run -A` output. |
| **4. Risk if accepted incorrectly** | (a) *leave as-is* → permanent phantom ` M` noise that can mask real changes. (b) `git rm --cached referral-platform` → removes the link; if anyone expected it, history/clone behaviour changes. (c) add `.gitmodules` → implies a submodule that is not actually configured/URL'd, which can break `git submodule update` for other clones. |
| **Recommended decision** | **NEEDS USER DECISION** - (a)/(b)/(c) are operator choices about repository structure. Evidence recorded; no option taken. |

### Item 4 - duplicated `eng.traineddata`

| Aspect | Detail |
|---|---|
| **1. File / decision** | `eng.traineddata` (repo root) **and** `server/eng.traineddata` - whether to drop one |
| **2. Why manual review** | Removing a tracked file is destructive and unrelated to the V2 rebuild; it also risks breaking whichever path the OCR runtime resolves. |
| **3. Evidence available** | Both tracked; both **5,199,098 bytes**; both SHA-256 `5DC5D8D640A212C9D6184921BA103B186F50E0FED9EE716C53E6B312B400D747` → **byte-identical**, ~10.4 MB redundant in every clone. Not a secret (public Tesseract language data). |
| **4. Risk if accepted incorrectly** | Removing the wrong copy could make OCR fail if code resolves the other relative path → **payment verification regression**. |
| **Recommended decision** | **NEEDS USER DECISION** - keep both (safe, costs 5.2 MB) vs. deduplicate (requires confirming the resolver path first). Not decided here. |
### Item 5 - the 2 coverage-gap tests (this phase's main investigation)

| Aspect | Detail |
|---|---|
| **1. File / decision** | `server/src/tests/unit/payment-timezone.test.js` and `server/src/tests/unit/private-screenshot-storage.test.js` - restore from HEAD vs. write V2 equivalents |
| **2. Why manual review** | The brief's safety gate is compatibility. Both files import modules the rebuild deleted, so *verbatim* restoration is unsafe (§2.4). Choosing among Alternative A / B / C (§2.6) is a judgement about how much to adapt legacy tests. |
| **3. Evidence available** | HEAD contents read in full (§2.2); `ERR_MODULE_NOT_FOUND` proven for both target modules (§2.4); target symbols located in V2 (§2.3); no overwrite risk (§2.5); **behaviour shown to be unchanged** - 16/16 HEAD timezone assertions pass against current code (§4.1), private-URL probes pass (§4.2), `paymentService` still exports all 3 required functions, all 8 mocked symbols exist in V2 `index.js`. |
| **4. Risk if accepted incorrectly** | Restoring verbatim → 2 hard suite errors + `BROKEN_COUNT` 0 → 2. Not restoring → IST/timezone and private-URL-`fetch`-avoidance remain unguarded by a committed test (mitigated by this phase's probes and by `screenshot-proxy-access` 26/26 + `payment-screenshot-upload` 3/3). |
| **Recommended decision** | **NEEDS USER DECISION** - pick Alternative A (timezone, 1 line), Alternative B (private-screenshot, 2 lines), or Alternative C (write new V2-native tests). Not applied in this phase. |

### Item 6 - the 5 "hollow" test files

| Aspect | Detail |
|---|---|
| **1. Files / decision** | `src/tests/integration/api.test.js`, `src/tests/integration/business-rules.test.js`, `src/tests/unit/cache.test.js`, `src/tests/unit/helpers.test.js`, `src/tests/unit/pagination.test.js` - restore bodies from HEAD vs. delete vs. migrate |
| **2. Why manual review** | Two candidate fixes (restore vs. delete) were offered in Phase 15; **neither matches the actual cause**, and all three options are code changes. |
| **3. Evidence available - ROOT CAUSE FOUND** | All five files import **`node:test`**, not `vitest`:<br>`api` → `import { describe, it, before, after } from 'node:test'`<br>`business-rules` → same · `cache` → `describe, it, beforeEach` · `helpers` → `describe, it` · `pagination` → `describe, it, beforeEach`<br>Vitest collects 0 tests from `node:test` registrations → *"No test suite found in file"*. Passing suites (e.g. `payment-expiry`, `wallet-service`) import from `vitest`. `cache-stats-auth` also imports `vitest` (so Item 7 is a different cause).<br>**All five are IDENTICAL to HEAD** (`git diff HEAD` empty for each) → **restoring from HEAD would change nothing**.<br>Run under their **intended** runner `node --test`: |

| File | `node --test` result | Exit |
|---|---|---:|
| `cache.test.js` | **6 tests, 6 pass, 0 fail** (2 suites) | 0 |
| `helpers.test.js` | **14 tests, 14 pass, 0 fail** | 0 |
| `pagination.test.js` | **8 tests, 8 pass, 0 fail** | 0 |
| `business-rules.test.js` | **11 pass, 0 fail, 4 skipped** (159.7 s) | 0 |
| `api.test.js` | **1 failing** - `POST /auth/admin-login - should login admin` | **1** |

| Aspect | Detail |
|---|---|
| | The `api.test.js` failure is **environmental, not a regression**: it posts `email: process.env.ADMIN_EMAIL`, and `ADMIN_EMAIL` is **UNSET** in the offline env → `undefined` email → `middleware/validation.js:24 body('email').notEmpty()` → `Validation failed / VALIDATION_ERROR`. The test's own `console.error` labels it `[KNOWN DEFECT]` and states *"fix requires approval: align env with the existing admin row"*. With `ADMIN_EMAIL` set, the next gate (`authService.adminLogin:186`) would return `ADMIN_NOT_CONFIGURED` because `ADMIN_PASSWORD_HASH` is also unset - i.e. this integration test cannot pass offline. |
| **4. Risk if accepted incorrectly** | *Delete them* → lose 4 suites that currently **pass** under their own runner (39 real passing tests: 6+14+8+11) and permanently hide `api`'s admin-login gap. *Migrate imports to `vitest`* → changes 5 files' framework, may need `node:assert` → `expect` rewrites or config changes, and would surface the environmental `api` failure as a red vitest suite. *Leave as-is* → suite always exits 1, masking regressions. |
| **Recommended decision** | **NEEDS USER DECISION** - the evidence rules out "restore from HEAD" as a fix and narrows the real choice to (i) migrate `node:test` → `vitest`, (ii) exclude them from the vitest glob and run them via `node --test`, or (iii) delete. Not decided here. |

### Item 7 - `cache-stats-auth.test.js` fixture

| Aspect | Detail |
|---|---|
| **1. File / decision** | `server/src/tests/integration/cache-stats-auth.test.js` - mark as live-DB vs. supply a fixture |
| **2. Why manual review** | Requires either a test-fixture design decision or a code change. |
| **3. Evidence available** | It **imports `vitest` correctly** (so not a framework mismatch). Line 75: `if (!user?.[0]) throw new Error('fixture missing: no non-admin user row found')`; line 76 requires an **active admin user row**; line 84: `spawn(process.execPath, ['src/index.js'], ...)` → it boots the real server. It is a genuine **integration** suite needing live DB rows. It is **IDENTICAL to HEAD** (unmodified). |
| **4. Risk if accepted incorrectly** | Silently skipping/accepting it → no proof that `GET /api/cache-stats` correctly returns **403 `ADMIN_REQUIRED`** for non-admin tokens (its line 117) → an authorisation regression could ship unnoticed. Fabricating a fixture offline → false confidence. |
| **Recommended decision** | **NEEDS USER DECISION** - keep documented as a live-DB suite (blocked offline) vs. build a fixture. Not decided here. |

### Item 8 - migration 016 detector absent

| Aspect | Detail |
|---|---|
| **1. File / decision** | `server/src/scripts/migrationState.mjs` - add a detector for `016_payment_validation_engine.sql`? |
| **2. Why manual review** | Adding it is a change to the **guarded migration applier**, the single most safety-critical script in the repo. |
| **3. Evidence available** | Detector keys present in `migrationState.mjs`: `015` (L38), `017` (L59), `018` (L69), `019` (L88), `020` (L101), `021` (L111) - **no `016_...` key**. `detectMigrationState(client, migrationFile)` at L129. Confirms Phase 14 R8 / Phase 15 R8. |
| **4. Risk if accepted incorrectly** | *Without* a detector → the applier cannot SKIP/REFUSE correctly for 016 → blind re-run risk. A *wrongly written* detector → false "applied" (migration skipped when needed) or false "not applied" (re-run that could fail) - either is worse than today's explicit unknown. |
| **Recommended decision** | **NEEDS USER DECISION** - and note Phase 14 requires a **per-file approval (A)** for applying any of 016-021 regardless. Not implemented here. |

### Item 9 - `.gitattributes` absent + `core.autocrlf=true`

| Aspect | Detail |
|---|---|
| **1. File / decision** | Add root `.gitattributes` (e.g. `* text=auto eol=lf`) or leave repo on `core.autocrlf=true` |
| **2. Why manual review** | A repo-wide line-ending policy change affects **every** file on every clone - it is not scoped to this rebuild. |
| **3. Evidence available** | `.gitattributes` **ABSENT**; `core.autocrlf = true`. Observed this phase: `git diff --no-index` emitted *"in the working copy of … LF will be replaced by CRLF the next time Git touches it"*. Phase 13-16 reports are written UTF-8 **without BOM** (verified: BOM = false) and will be normalised on commit. |
| **4. Risk if accepted incorrectly** | Adding it can cause a **one-off full-repo line-ending diff** (noisy, may obscure real changes; can churn large binaries if misconfigured). Not adding it → repeated CRLF warnings and possible spurious diffs across machines. |
| **Recommended decision** | **NEEDS USER DECISION** - policy choice about the whole repository. Not created here. |

### 3.10 Decision summary - no item silently approved

| # | Item | Decision | Deciding authority |
|---|---|---|---|
| 1 | `paymentVerificationV2/duplicateDetection.js` | **ACCEPT** (commit as-is) | Evidence: 0 differing executable lines |
| 2 | 2 untracked safety reports | **NEEDS USER DECISION** | Operator - disclosure/redaction policy |
| 3 | `referral-platform` gitlink / `.gitmodules` | **NEEDS USER DECISION** | Operator - repo structure (a/b/c) |
| 4 | duplicated `eng.traineddata` | **NEEDS USER DECISION** | Operator - destructive removal |
| 5 | the 2 coverage-gap tests | **NEEDS USER DECISION** | Operator - Alternative A / B / C |
| 6 | 5 `node:test` files | **NEEDS USER DECISION** | Operator - migrate / separate runner / delete |
| 7 | `cache-stats-auth.test.js` fixture | **NEEDS USER DECISION** | Operator - live-DB suite vs fixture |
| 8 | migration 016 detector | **NEEDS USER DECISION** | Operator + approval A |
| 9 | `.gitattributes` / `autocrlf` | **NEEDS USER DECISION** | Operator - repo-wide policy |

**Totals: 1 ACCEPT · 0 REJECT · 8 NEEDS USER DECISION.**

---

## 4. Behavioural verification required by the brief

### 4.1 Timezone handling - Asia/Kolkata

Because the test file could not be restored, its **exact assertions were replayed** against the
**current** implementation via a standalone read-only probe (outside the repo) importing
`paymentVerificationV2/ocrExtraction.js`.

Constant source: `config/paymentConfig.js:71` `export const TIMEZONE = 'Asia/Kolkata'`;
`:72` `export const IST_UTC_OFFSET_MS = 5.5 * 60 * 60 * 1000`; re-exported by
`ocrExtraction.js:11` as `IST_TIMEZONE` and `:1544` as `IST_UTC_OFFSET_MS`.

| # | Assertion (from HEAD test) | Result |
|---|---|---|
| T1 | `IST_TIMEZONE === 'Asia/Kolkata'` | **PASS** |
| T1 | `IST_UTC_OFFSET_MS === 5.5 * 3600 * 1000` (= 19,800,000) | **PASS** |
| T2 | `16/08/2026 13:00` → `2026-08-16T07:30:00.000Z` | **PASS** |
| T3 | 13:00 IST within 30 min of server 13:00 IST → `true` | **PASS** |
| T4 | IST `12:29` → `false` (outside −30) | **PASS** |
| T4 | IST `12:30` → `true` (exactly −30) | **PASS** |
| T4 | IST `12:45` → `true` | **PASS** |
| T4 | IST `13:00` → `true` | **PASS** |
| T4 | IST `13:30` → `true` (exactly +30) | **PASS** |
| T4 | IST `13:31` → `false` (+31) | **PASS** |
| T5 | `16/08/2026 00:00` → `2026-08-15T18:30:00.000Z` (midnight IST boundary) | **PASS** |
| T5 | midnight boundary within 30 min → `true` | **PASS** |
| T6 | `12:30` IST → `2026-08-16T07:00:00.000Z` | **PASS** |
| T6 | value == naive UTC − `IST_UTC_OFFSET_MS` | **PASS** |
| T7 | `32/13/2026 25:99` → `null` | **PASS** |
| T7 | `not-a-date` → `null` | **PASS** |

**Result: 16 / 16 PASS, 0 FAIL (probe exit 0).** Behaviour is identical to the HEAD test's
expectations - **there is no timezone regression**; only the *committed* coverage is missing.

### 4.2 Private screenshot URL behaviour & access restrictions

**Probes (read-only, outside the repo):**

| Check | Result |
|---|---|
| `privateObjectUrl('payments', 'payments/pay-1/abc.png')` → `https://proj.supabase.co/storage/v1/object/payments/...` | **PASS** - no `/object/public/` segment |
| URL shape matches `/storage/v1/object/payments/` | **PASS** |
| `storageObjectPathFromUrl(legacy public URL)` → `pay-1/old.png` | **PASS** |
| `storageObjectPathFromUrl(modern private URL)` → `pay-1/new.png` | **PASS** |
| bucket name stripped in both shapes | **PASS** |

**Source inspection (`server/src/services/paymentService.js`):**

| Assertion of the deleted test | Current code | Status |
|---|---|---|
| upload stores a **private** object URL | L330 `const screenshotUrl = privateObjectUrl('payments', filePath);` | **HOLDS** |
| `getPublicUrl` never called for payment proofs | **0** occurrences of `getPublicUrl` in the whole file | **HOLDS** |
| `verifyPayment` reads bytes via `storage.download` | L436 `storageObjectPathFromUrl(...)` → L438 `supabase.storage.from('payments').download(objectPath)`; comment L434: *"The bucket is private, so a direct fetch would (correctly) fail"* | **HOLDS** |
| direct fetch of stored URL never used | `fetch` not used for screenshot bytes in this path | **HOLDS** |
| inconclusive OCR → `"Screenshot verification did not complete"` | L468 `if (verification.inconclusive)` → L484 `message: verification.message \|\| 'Screenshot verification did not complete'` | **HOLDS** |
| path parser accepts **both** legacy public and new private shapes | L847-856 `storageObjectPathFromUrl` slices **after** the literal `payments` segment → shape-agnostic | **HOLDS** (also probed above) |
| **cross-user access denied** | L864-866 `if (payment.user_id !== requester?.id && requester?.role !== 'admin') throw { code: 'UNAUTHORIZED' }` | **HOLDS** |
| admin allowed | same condition, `role === 'admin'` branch | **HOLDS** |

**Existing committed tests that still exercise these paths (fresh runs):**

| Suite | Result |
|---|---|
| `screenshot-proxy-access.test.js` (stream proxy RBAC, `storage/v1/object`) | **1 file, 26 tests, 26 passed, exit 0** |
| `payment-screenshot-upload.test.js` (upload path, duplicate-proof, cross-user upload) | **1 file, 3 tests, 3 passed, exit 0** |

**Residual gap (unchanged):** no committed test asserts *explicitly* that `uploadScreenshot`
returns a non-public URL and that `verifyPayment` never calls `fetch` - i.e. the two most
specific assertions of the deleted file. Closed only by Alternative B (§2.6) or Alternative C.

---
## 5. V2 import / export verification (fresh, this phase)

| Check | Method | Result |
|---|---|---|
| Module loads | `await import('./src/services/paymentVerificationV2/index.js')` | **PASS** - 46 exports |
| Default export | `m.default.constructor.name` | `PaymentVerificationEngine` - **PASS** |
| 10 critical symbols present | `ENGINE_ID`, `paymentVerificationEngine`, `PaymentVerificationEngine`, `recordVerificationAttempt`, `listVerificationHistory`, `deriveOutcomeStatus`, `decidePaymentVerification`, `reserveApprovedUtr`, `releaseApprovedUtr`, `verifyWithProvider` | **ALL PRESENT - PASS** |
| Internal import resolution | regex over all `from './…'` in the 15 V2 files vs. filesystem | **files=15, missing_imports=0 - PASS** |
| Backend syntax integrity | `node --check` over `server/src/**/*.{js,mjs}` | **checked=132, syntax_errors=0 - PASS** |
| Broken imports to deleted files | live-file import scan (Phase 15 method) | **`BROKEN_COUNT = 0` - unchanged** |

---

## 6. Exact changed-file list

### 6.1 Created by this phase

| Path | Bytes |
|---|---|
| `docs/operations/PHASE_16_MANUAL_REVIEW_AND_TEST_COVERAGE_REPORT.md` (this file) | 40212 |

**That is the only file created or modified inside the repository by Phase 16.**

### 6.2 Deliberately NOT changed (explicit)

| Item | State |
|---|---|
| `payment-timezone.test.js` | **NOT restored** - incompatible (§2.4) |
| `private-screenshot-storage.test.js` | **NOT restored** - incompatible (§2.4) |
| The other 36 deleted tests | not touched |
| `paymentVerificationV2/duplicateDetection.js` | not modified (reviewed only) |
| The 5 `node:test` files | not modified, not deleted |
| `cache-stats-auth.test.js` | not modified |
| `migrationState.mjs` | not modified (016 detector not added) |
| `.gitattributes` | not created |
| `eng.traineddata` (both copies) | not touched |
| `referral-platform` gitlink | not staged, not removed |
| The 2 safety reports | not redacted |
| All application source / migrations / `.env` | untouched |

### 6.3 Temporary artifacts (OUTSIDE the repository - safe to delete)

`C:\Users\pavi\AppData\Local\Temp\opencode\`:
`phase16_tz_probe.mjs`, `phase16_private_probe.mjs`, `dd_head.js`, `dd_v2.js`,
`phase16_server.txt`, `phase16_client.txt`, `phase16_build.txt`.

### 6.4 Git state verification (unchanged)

```
HEAD         = 57ae855bf04bb3806c9c9706540fe95d80d474ef
origin/main  = 57ae855bf04bb3806c9c9706540fe95d80d474ef
ahead/behind = 0  0
entries      = 80   staged = 0
breakdown    = modified 15 | deleted 59 | untracked 6 | other 0
untracked    = PRE_DEPLOYMENT_SAFETY_REPORT.md, PRODUCTION_BACKUP_AND_FINAL_SAFETY_REPORT.md,
               docs/operations/, server/src/services/paymentVerificationV2/,
               server/src/tests/unit/paymentVerificationV2-engine.test.js,
               server/src/tests/unit/paymentVerificationV2-real-ocr.test.js
disk server test files = 44 (unchanged - confirms neither gap test was created)
```

---

## 7. Test results (Phase 16, fresh runs)

Offline placeholder env for every run:
`SUPABASE_URL=https://supabase-unit-test.invalid`,
`SUPABASE_SERVICE_ROLE_KEY=placeholder-service-role-key-for-unit-tests`,
`SUPABASE_ANON_KEY=placeholder-anon-key-for-unit-tests`,
`JWT_SECRET=placeholder-jwt-secret-minimum-32-characters`, `NODE_ENV=test`,
`ADMIN_RECEIVER_NAME=Jayaraj`.

### 7.1 Failure classification - assertion vs. environment/hollow

| Class | Count | Files |
|---|---:|---|
| **Assertion failures inside vitest** | **0** | none |
| **HOLLOW - wrong test framework** (`node:test` collected by vitest) | **5** | `api`, `business-rules`, `cache`, `helpers`, `pagination` |
| **ENVIRONMENT - needs live DB / configured env** | **1** | `cache-stats-auth` (`fixture missing: no non-admin user row found`) |
| Passing files | 38 | see 7.3 |

**Assertion failures = 0.** Every vitest failure is hollow-or-environmental.

### 7.2 Targeted payment-verification suites

```
Test Files  16 passed (16)
     Tests  195 passed (195)
      EXIT  0
```

Files: `paymentVerificationV2-engine`, `paymentVerificationV2-real-ocr`,
`migration-state-detector`, `screenshot-proxy-access`, `payment-ownership`, `payment-expiry`,
`wallet-service`, `topup-direct`, `topup-hardening`, `topup-verification`, `topup-claim`,
`topup-concurrency-race`, `topup-controller`, `admin-delete-topup-retention`,
`admin-login-hardening`, `auth-role-separation`.

### 7.3 Full server suite

```
Test Files  6 failed | 38 passed (44)
      Tests  380 passed | 5 skipped (385)
   Duration  21.13s
      EXIT  1
```

| Failing file | Error text | Class |
|---|---|---|
| `src/tests/integration/api.test.js` | `No test suite found in file` | **HOLLOW** (`node:test`) |
| `src/tests/integration/business-rules.test.js` | `No test suite found in file` | **HOLLOW** (`node:test`) |
| `src/tests/unit/cache.test.js` | `No test suite found in file` | **HOLLOW** (`node:test`) |
| `src/tests/unit/helpers.test.js` | `No test suite found in file` | **HOLLOW** (`node:test`) |
| `src/tests/unit/pagination.test.js` | `No test suite found in file` | **HOLLOW** (`node:test`) |
| `src/tests/integration/cache-stats-auth.test.js` | `fixture missing: no non-admin user row found` | **ENVIRONMENT** (5 skipped) |

Identical to Phase 15 - **no change**, because neither gap test was restored.

### 7.4 The 5 hollow files under their intended runner `node --test`

| File | Tests | Pass | Fail | Exit |
|---|---:|---:|---:|---:|
| `cache.test.js` | 6 | **6** | 0 | 0 |
| `helpers.test.js` | 14 | **14** | 0 | 0 |
| `pagination.test.js` | 8 | **8** | 0 | 0 |
| `business-rules.test.js` | 15 | **11** | 0 (4 skipped) | 0 |
| `api.test.js` | - | - | **1** | **1** |

`api.test.js` failure detail: `POST /auth/admin-login - should login admin` →
`AssertionError: admin-login failed: VALIDATION_ERROR Validation failed`.
Cause: `ADMIN_EMAIL` **UNSET** in the offline env → posts `email: undefined` →
`validation.js:24 body('email').notEmpty()` rejects. The test prints its own
`[KNOWN DEFECT]` marker stating the fix requires approval. **ENVIRONMENT**, not a regression.

### 7.5 Two dedicated suites exercising the deleted test's subject matter

| Suite | Result |
|---|---|
| `screenshot-proxy-access.test.js` | **26 / 26 passed, exit 0** |
| `payment-screenshot-upload.test.js` | **3 / 3 passed, exit 0** |

### 7.6 Backend syntax integrity

`node --check` across `server/src` → **132 files, 0 errors**.

### 7.7 Client suite

```
Test Files  6 passed (6)
     Tests  20 passed (20)
   Duration  13.03s
      EXIT  0
```
(`AuthForms`, `RegisterPage`, `RegistrationPaymentFlow`, `Receipts`, `TopUps`, `api.test.js`)

### 7.8 Client production build

```
vite build
  1759 modules transformed
  built in 16.24s
  EXIT 0
```

---

## 8. Remaining blockers

### 8.1 Opened or unchanged by this phase (all 8 NEEDS USER DECISION items)

| # | Blocker | Class |
|---|---|---|
| 1 | 2 coverage-gap tests still **not committed** - IST/timezone and private-URL-no-`fetch` have no committed guard (mitigated by probes + 26/26 + 3/3) | Tests |
| 2 | 5 files use `node:test` → vitest suite **permanently exits 1**; `api.test.js` also has an env-dependent admin-login failure | Tests |
| 3 | `cache-stats-auth.test.js` needs live DB rows + spawns the real server → offline-blocked | Tests |
| 4 | Migration **016** still has **no detector** in `migrationState.mjs` | Tooling |
| 5 | `referral-platform` gitlink has **no `.gitmodules`** → permanent phantom ` M` | Git |
| 6 | `eng.traineddata` still duplicated (~10.4 MB) | Hygiene |
| 7 | `.gitattributes` absent + `core.autocrlf=true` → CRLF normalisation warnings | Hygiene |
| 8 | 2 safety reports not yet accepted/redacted | Disclosure |

### 8.2 Carried forward unchanged from Phases 14/15 (out of scope here)

| ID | Blocker |
|---|---|
| **A / R1** | Migration **015** unverified - sole path for `credit_wallets_atomic`; top-up can record `completed` with no wallet credit |
| **B / R5** | `ADMIN_RECEIVER_NAME` unset in Render; DB `receiver_name` empty → payee gate N/A |
| **C / R4** | `VITE_API_URL` unverifiable; no `/api` proxy in either `vercel.json` |
| **D / R3** | Migration **021** bucket state unverified (last observation `payments.public = true`) |
| **E / R2** | **80 uncommitted entries** hold the entire V2 rebuild; `origin/main` still ships the **old** engine |
| **F** | No validated production restore (Phase 13 = PARTIAL PASS); Storage/Auth/roles uncovered |
| **I** | `PAYMENT_PROVIDER_MODE = none` → OCR is not bank settlement confirmation |
| **F1/F2/F3** | Repo checklist items open (admin creds, isolated test DB, password rotation) |

**No blocker was closed in Phase 16** - this phase was read-only plus report authoring.

---

## 9. Recommended next phase

**Recommended: PHASE 17 - APPLY THE 8 LOCAL DECISIONS (still strictly local)**

Every step is operator-gated; nothing runs automatically.

1. **Decide Item 5 first** (blocks coverage): choose Alternative A (1-line import swap for
   `payment-timezone.test.js`), Alternative B (2-line swap for
   `private-screenshot-storage.test.js`), or Alternative C (new V2-native tests).
   Recommended pairing: **A + B** - both are the same mechanical repointing already applied to
   `topup-verification.test.js`, and both have verified behaviour (§4).
2. **Decide Item 6**: migrate the 5 `node:test` files to `vitest` **or** move them out of the
   vitest glob into a `node --test` npm script. Evidence: 4/5 already pass under `node --test`.
   Either way, record that `api.test.js`'s admin-login test needs `ADMIN_EMAIL` +
   `ADMIN_PASSWORD_HASH` and can never pass offline.
3. **Decide Items 2, 3, 4, 7, 9** (disclosure, gitlink, traineddata, live-DB fixture, EOL policy).
4. **Decide Item 8** (016 detector) - code change to the guarded applier; applying 016-021 to
   production additionally requires **per-file approval A** (Phase 14 §10).
5. **Re-run the pre-commit gate** (Phase 15 §10.7): V2 import 46 exports · `node --check` 132/0 ·
   targeted tests · full server suite · client suite · `vite build` · `git check-ignore` ·
   sensitive-content scan of the staged set.
6. **Expect** the suite to reach **0 failed files** after Item 6 is resolved - that is the
   precondition Phase 14 §9 step 8 sets for a commit.
7. **Only then** proceed to the atomic commit (approval **D**, suggested message
   `feat: finalize payment verification v2 production readiness`), followed by the
   production-readiness phases: read-only production probe of `<PROJECT_REF>` (015/016/017/
   021 + bucket state), dashboard env audit, then gated deployment.

> Items 1-9 must be answered by the operator; this phase deliberately supplies evidence and
> recommendations only, and **does not approve any of them on the user's behalf**.

---

## 10. Attestation - what this phase did NOT do

- ❌ Did **not** restore `payment-timezone.test.js` or `private-screenshot-storage.test.js`.
- ❌ Did **not** modify any application source, test, script or configuration file.
- ❌ Did **not** touch the database, any migration, or any SQL.
- ❌ Did **not** touch Supabase, Render or Vercel in any way.
- ❌ Did **not** stage, commit, push, deploy or force-push.
- ❌ Did **not** delete or overwrite any existing file (the two gap tests did not exist on disk).
- ❌ Did **not** approve any of the 8 user decisions - all returned as NEEDS USER DECISION.
- ❌ Did **not** print any secret, key, password, hash or connection-string value.
- ✅ Read HEAD versions of both gap tests in full; proved incompatibility empirically;
  verified V2 imports/exports; ran backend, client and build checks; classified every failure;
  verified Asia/Kolkata handling (16/16) and private-screenshot URL/access behaviour;
  documented all 9 §10.5 decisions with evidence and risk.
- ✅ Only file written inside the repository: this report.