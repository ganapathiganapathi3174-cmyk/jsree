# Phase 18 - Manual Decisions and Cleanup (LOCAL ONLY, NO PRODUCTION MUTATIONS)

Date: 2026-11-16
Workdir: `C:\Users\pavi\Desktop\jsree`
Predecessors: `PHASE_15_GIT_CODE_INTEGRITY_REPORT.md`, `PHASE_16_MANUAL_REVIEW_AND_TEST_COVERAGE_REPORT.md`, `PHASE_17_TEST_COVERAGE_RECOVERY_REPORT.md`

---

## 1. Scope and rules observed

Phase 18 resolves, or formally documents, the six manual-review items left open by Phase 16.
Every rule in the Phase 18 brief was observed:

| Rule | Observed? |
|---|---|
| No production database or Supabase access | **YES** - zero DB connections opened; no `DATABASE_URL`, no Supabase URL, no `pg` client |
| No migrations executed | **YES** - no SQL from `supabase/migrations/` was ever run |
| No Render / Vercel changes | **YES** |
| No staging, commit, push or deploy | **YES** - 0 staged, HEAD unchanged, `origin/main` unchanged |
| No deleting user work | **YES** - no file deleted or truncated |
| No irreversible repository changes | **YES** - the only edits are 2 source/test files, both reversible by `git checkout` |
| Stop after writing this report | **YES** |

Per-item limits were also observed: Item 2 reports were **read only** (no redaction applied);
the nested repo and parent gitlink were **not altered**; both `eng.traineddata` copies were
**kept** and OCR runtime behaviour is **unchanged**; no production DB was touched for Item 7;
migration 016 was **not executed**; the guarded migration applier was **not modified**; no
repo-wide line endings or Git config were changed.

---

## 2. Outcome summary

| Item | Subject | Status | Result |
|---|---|---|---|
| **2** | Safety-report disclosure | **RECOMMENDED, NOT APPLIED** | Exact line-scoped redactions documented in §3; reports untouched |
| **3** | Nested gitlink / `.gitmodules` | **RECOMMENDED, NOT APPLIED** | Option C (keep + document); no gitlink or nested-repo change |
| **4** | `eng.traineddata` duplication | **RESOLVED - KEEP BOTH** | Removal not proven safe; OCR behaviour unchanged |
| **7** | `cache-stats-auth` fixture | **DOCUMENTED - BLOCKED** | Exact DB rows / env / infra recorded; no production DB touched |
| **8** | Migration `016` detector | **IMPLEMENTED** | Read-only probe + mocked unit tests; 016 never executed |
| **9** | `.gitattributes` / line endings | **RECOMMENDED, NOT APPLIED** | No repo-wide policy; state recorded |

Net effect of Phase 18 on the repository: **2 files modified, 0 added, 0 deleted, 0 staged.**

---

## 3. Item 2 - Safety-report disclosure

### 3.1 Files inspected (both untracked, both unchanged by this phase)

| File | Bytes | Lines | U+FFFD | BOM |
|---|---|---|---|---|
| `PRE_DEPLOYMENT_SAFETY_REPORT.md` | 11,653 | ~200 | 0 | no |
| `PRODUCTION_BACKUP_AND_FINAL_SAFETY_REPORT.md` | 15,357 | ~200 | 0 | no |

Both files are structurally clean. The only defect found is the disclosure itself.

### 3.2 Occurrence census (measured this phase)

| Identifier | `PRE_DEPLOYMENT…` | `PRODUCTION_BACKUP…` | Total |
|---|---|---|---|
| Supabase project ref `<PROJECT_REF>` | 5 lines / 5 hits (L140, L162, L163, L164, L186) | 7 lines / 9 hits (L7, L14, L15, L76, L138, L149, L152) | 12 lines / 14 hits |
| Full receiver UPI VPA (`receiver_upi` value) | 2 hits (L19, L20) | 1 hit (L102) | 3 hits |
| `postgres://` connection-string template | 1 hit (L162) | 1 hit (L149) | 2 hits |

**Correction to Phase 16:** Phase 16 characterised the UPI leak as *"partial UPI id `okicici` (2x/1x)"*.
Measurement shows it is the **full receiver VPA**, not a partial handle - 3 hits across the two files.

**Connection strings are already non-secret** and require no change:

- `PRE_DEPLOYMENT…` L162 ends `:<password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres` - the
  password slot is the literal placeholder `<password>`, not a real credential.
- `PRODUCTION_BACKUP…` L149 uses the same template with the password slot masked `***`.

No secret key, service-role token, JWT secret or database password appears in either file.

### 3.3 Exact proposed redactions (DOCUMENTED ONLY - NOT APPLIED)

The reports were **not modified**, per the brief. These are the exact changes to apply if and
only if the operator approves publication of this repository.

| # | File | Line(s) | Field | Action |
|---|---|---|---|---|
| R1 | `PRE_DEPLOYMENT_SAFETY_REPORT.md` | **19** | `receiver_upi` value inside the `/api/config/public` response sample | Replace the value with `<REDACTED>` |
| R2 | `PRE_DEPLOYMENT_SAFETY_REPORT.md` | **20** | `receiver_upi="…"` in the DB `payment_config` row | Replace the value with `<REDACTED>` |
| R3 | `PRODUCTION_BACKUP_AND_FINAL_SAFETY_REPORT.md` | **102** | backticked `receiver_upi` value in the receiver-verification row | Replace the value with `<REDACTED>` |
| R4 | `PRE_DEPLOYMENT_SAFETY_REPORT.md` | 140, 162, 163, 164, 186 | project ref | Replace `<PROJECT_REF>` with `<PROJECT_REF>` |
| R5 | `PRODUCTION_BACKUP_AND_FINAL_SAFETY_REPORT.md` | 7, 14, 15, 76, 138, 149, 152 | project ref | Replace `<PROJECT_REF>` with `<PROJECT_REF>` |
| R6 | both files | L162 / L149 | `postgres://` template | **NO CHANGE** - password slot already non-secret |

### 3.4 Risk assessment

| Item | Sensitivity | Verdict |
|---|---|---|
| **Receiver UPI VPA (R1-R3)** | **HIGH** - a live payment address bound to a named individual; anyone with it can push money to, or enumerate, the payee | **Redact before any publication** |
| **Supabase project ref (R4-R5)** | **LOW** - not a credential; grants nothing without an API key. Security-through-obscurity only | **Operator decision** - see 3.5 |
| **`postgres://` template (R6)** | none - placeholder only | Leave as-is |

### 3.5 Why R4/R5 is an operator decision, not an automatic redaction

The project ref is **not confined to these two files**. It is already recorded in tracked
documentation, including `docs/operations/PHASE_14_PRODUCTION_GATE_AUDIT.md` and
`CLIENT_HANDOVER_AUDIT.md`, as well as the untracked `referral-platform/CLIENT_HANDOVER_AUDIT.md`.
Redacting it in only the two safety reports would be cosmetic and inconsistent.

Two coherent options:

- **Option A (recommended):** accept that the project ref may be published. It is not a secret
  and rotating it is impossible without recreating the Supabase project. Redact R1-R3 only.
- **Option B:** perform a separate, repo-wide project-ref redaction pass across every document
  as its own approved phase. Do not do this piecemeal.

**Recommendation: R1-R3 redact; R6 no change; R4/R5 -> Option A unless the operator directs Option B.**

---

## 4. Item 3 - Nested gitlink / `referral-platform`

### 4.1 Evidence collected

| Fact | Measurement |
|---|---|
| Nested repo remote | `https://github.com/ganapathiganapathi3174-cmyk/jsree.git` - **identical to the parent remote** |
| Nested HEAD | `8982086e87102d2e6c3f39600a855dba9a869c03` (2026-10-21, *"feat: harden payment verification with timeout, dedup, and external confirmation gates"*) |
| Nested branch | `main [origin/main]` |
| `git cat-file -t 8982086` | `commit` - object exists in the **parent** object store |
| `git merge-base --is-ancestor 8982086 HEAD` (in parent) | exit **0** - nested HEAD is an ancestor of parent HEAD |
| Nested tree vs `parent@8982086` tree | both **248 files** - identical |
| `.gitmodules` | **absent** (root, `server/`, `client/`) |
| Parent gitlink entry | `160000 commit 8982086e87102d2e6c3f39600a855dba9a869c03  referral-platform` |
| `.gitignore:23` | `referral-platform_snapshot_*.zip` |
| `.vercelignore:11` | excludes `referral-platform/` (and `eng.traineddata`) |
| Parent unique files | `WEBSITE_COMPLETE_AUDIT_REPORT.md`, `server/src/utils/screenshotUrl.js` are **not** in the parent |

**Conclusion:** `referral-platform` is not an independent project. It is a **clone of the same
JSREE repository pinned at an ancestor commit** (the commit the gitlink records). It is a
read-only historical snapshot, ignored by the Vercel deploy context.

### 4.2 Dirty state (unchanged - NOT altered this phase)

11 entries, exactly as reported by Phases 15/16:

- **5 modified:** `server/src/controllers/adminController.js`, `server/src/services/paymentService.js`,
  `server/src/services/registrationStatusService.js`, `server/src/services/topupService.js`,
  `server/src/services/verificationService.js`
- **6 untracked:** `WEBSITE_COMPLETE_AUDIT_REPORT.md`, `server/__dateprobe.mjs`,
  `server/__dbprobe.mjs`, `server/__probe.mjs`,
  `server/src/tests/unit/screenshot-private-access.test.js`, `server/src/utils/screenshotUrl.js`

### 4.3 Options compared

| Option | Effect | Assessment |
|---|---|---|
| **A - convert to `.gitmodules`** | Registers `referral-platform` as a submodule pointing at **the same repository** it already lives in | **REJECT.** Self-referential. Adds a submodule whose URL equals the superproject's URL, whose pinned commit is an ancestor of the superproject's own HEAD. Git will warn about recursion; clone/CI behaviour becomes confusing; it solves nothing, because the gitlink already pins the exact commit |
| **B - convert to an ordinary tracked directory** | Index would absorb ~248 files, most of them an **older duplicate of this same repository**, plus 11 dirty entries | **REJECT.** Would commit a full stale copy of jsree into itself, roughly doubling the tree and mixing an old engine snapshot with the current V2 rebuild. High blast radius, zero benefit, and it would make the Vercel build context materially larger |
| **C - keep the gitlink, do not alter nested repo or gitlink, document** | Status quo, with the relationship written down | **ACCEPT.** Zero risk, zero diff, already correctly excluded from the deploy by `.vercelignore`, and the pinned commit is verifiably an ancestor so nothing is lost |

### 4.4 Recommendation

**Option C.** Keep the `160000` gitlink exactly as it is. Do not create `.gitmodules`. Do not
flatten the directory. Do not clean the 11 dirty entries.

Optional follow-up (separate approval, not performed): record in the parent repository's
documentation that `referral-platform` is an ancestor snapshot of this same repository, so a
future phase does not re-investigate it.

**No change made in Phase 18.**

---

## 5. Item 4 - `eng.traineddata` duplication

### 5.1 The two files are byte-identical

| Property | Root copy | `server/` copy |
|---|---|---|
| Path | `C:\Users\pavi\Desktop\jsree\eng.traineddata` | `C:\Users\pavi\Desktop\jsree\server\eng.traineddata` |
| Size | 5,199,098 bytes | 5,199,098 bytes |
| SHA-256 | `5DC5D8D640A212C9D6184921BA103B186F50E0FED9EE716C53E6B312B400D747` | `5DC5D8D640A212C9D6184921BA103B186F50E0FED9EE716C53E6B312B400D747` |
| `git ls-files --eol` | `i/-text w/-text attr/` | `i/-text w/-text attr/` (git already treats it as binary) |

### 5.2 Code references (measured)

| Location | References which copy? |
|---|---|
| `server/__bench.mjs:65` - `Tesseract.createWorker('eng', 1, { langPath: path.join(__dir), gzip: false })` | **`server/eng.traineddata`** - the only code path that loads a repository copy |
| `server/src/services/paymentVerificationV2/ocrExtraction.js:75` - `Tesseract.createWorker('eng')` | **Neither.** No `langPath` is passed, so tesseract.js resolves the model itself (CDN / local cache) |
| Everything else (reports, checklists, `.vercelignore:11`) | Documentation only |

**Production OCR behaviour therefore depends on neither repository copy.** That is a material
finding: the `server/` copy exists to serve `__bench.mjs`, and the root copy serves no code path
at all.

### 5.3 What actually ships

`server/Dockerfile` sets `WORKDIR /app` and `COPY . .` with build context `server/`, and
`server/.dockerignore` does not exclude `*.traineddata`. Therefore **only `server/eng.traineddata`
is ever included in a container image.** The root copy is not in any build context that matters,
and `.vercelignore` excludes it from the Vercel deploy.

### 5.4 Why removal is NOT proven safe

- Removing **`server/eng.traineddata`** would break `server/__bench.mjs`, the only loader of a
  repository copy. Not safe.
- Removing the **root** copy has no code-path consequence, but it *is* referenced by
  `.vercelignore:11` and by the documentation set; deleting it would silently invalidate those
  references and would be an irreversible change to operator-provided material, which the brief
  forbids without approval.

### 5.5 Recommendation

**KEEP BOTH.** Removal is not proven safe, exactly as the brief instructs. OCR runtime behaviour
is unchanged (production still passes no `langPath`). Deduplication, if ever wanted, belongs in a
separate approved cleanup that also updates `.vercelignore` and the referencing documents.

**No change made in Phase 18.**

---

## 6. Item 7 - `cache-stats-auth` isolated fixture

### 6.1 Exact requirements (read from `server/src/tests/integration/cache-stats-auth.test.js`)

| Requirement | Detail |
|---|---|
| Env loaded | `dotenv.config({ path: server/.env })` - **`server/.env` does not exist** |
| Env vars needed | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET` |
| DB row #1 | `from('users').select('id').neq('role', 'admin').limit(1)` -> **at least one user whose `role != 'admin'`** |
| DB row #2 | `from('users').select('id').eq('role', 'admin').eq('status', 'active').limit(1)` -> **at least one `role='admin' AND status='active'` user** |
| Server under test | spawns `src/index.js` on a free TCP port via `freePort()` + `spawn(process.execPath, ['src/index.js'])`, health-polls up to **45 s / 90 attempts** (attempt cap chosen to avoid the login rate limiter) |
| Auth | signs `JWT_SECRET`-signed bearer tokens for the **existing row ids** |
| Mutations | **none** - the file states read-only intent and performs no inserts, updates or deletes |
| Test count | 6 |

Offline run result (unchanged from Phase 16):

```
fixture missing: no non-admin user row found
```

### 6.2 Why an isolated fixture cannot be created in this workspace

A safe fixture needs a Supabase-compatible REST surface, because the test drives
`@supabase/supabase-js` directly. Checked this phase:

| Tool | Availability |
|---|---|
| `docker` | **NOT FOUND** |
| `supabase` CLI | present (`…\AppData\Roaming\npm\supabase.ps1`) - but `supabase start` requires Docker |
| `psql` / `pg_dump` | **NOT FOUND** |
| Plain local PostgreSQL | not reachable; would not satisfy `createClient` anyway |

Consequently **no local Supabase stack can be started here.**

Three candidate approaches and why each is rejected or blocked:

| Approach | Verdict |
|---|---|
| **(a) Isolated, non-production Supabase project** (repo checklist **F2**) | **BLOCKED, and the correct long-term answer.** Needs credentials for a *separate* project - **never** production. Not available offline |
| **(b) Local `supabase start` stack** | **BLOCKED** - Docker is not installed |
| **(c) Mock `@supabase/supabase-js`** | **REJECTED.** The file is an *integration* test; mocking the client would make the admin-login and role assertions vacuous, i.e. it would delete the test's value rather than fix it. That is a weakening, which the brief forbids |

### 6.3 Recommendation

- **Do not migrate, delete, skip or suppress** this file. It remains a genuine integration test
  that is simply unable to run in an offline workspace.
- **Document as BLOCKED pending checklist item F2** (an isolated, non-production Supabase
  project). Once F2 exists, set `server/.env` with that project's URL and service-role key and
  the file runs unchanged.
- **Never point it at production.** The test only reads, but it does spawn the real server and
  mint real bearer tokens; it belongs on a non-production project.

**No change made in Phase 18. No production database was accessed.**

---

## 7. Item 8 - Migration `016_payment_validation_engine.sql` detector (IMPLEMENTED)

### 7.1 Why `016` has no observable artifact

`016_payment_validation_engine.sql` is an **intentional no-op audit**. Its entire body is a
single `DO $$ … END $$;` block that checks three prerequisites and `RAISE EXCEPTION` if any is
absent:

1. `payments.transaction_id`
2. `topups.reference_id`
3. table `approved_utrs`

It creates **no table, function, index, policy or row**. Therefore "was it applied?" is not
answerable from the catalog, and Phase 14 recorded it as *unverifiable by tool*.

### 7.2 A defect found while implementing (material correction to Phase 14 R8)

Phase 14 R8 said the applier *"cannot SKIP/REFUSE correctly for 016; blind re-run risk."*
Reading `apply-migration-guarded.mjs` shows the actual behaviour is worse than that.
Before this change, with no probe registered:

1. **Phase 1 (L81-96):** `detectMigrationState` returned `{ applied: false, unknown: true }`
   -> the `state.unknown` branch logged *"applying blind"* and fell through.
2. **Phase 2 (L104-106):** the no-op SQL ran and succeeded.
3. **Phase 3 (L109-112):** the probe was re-run, still returned `{ applied: false, unknown: true }`,
   and the guard `if (post.error || !post.applied)` evaluated **true** ->
   `throw new Error('post-apply verification failed: … transaction will roll back')`.

**So `apply-migration-guarded.mjs 016_payment_validation_engine.sql` could never commit - it
always rolled back and exited 1**, even though the SQL itself succeeded. This is a stronger and
more precise statement than Phase 14 R8, and it is the constraint that shaped the probe below.

### 7.3 Design

The applier's Phase 3 **requires `post.applied === true`**, so a probe that permanently returns
`{ applied: false }` would keep 016 un-appliable. The probe must therefore report the state the
file itself audits:

- **All three prerequisites present** -> `{ applied: true }` -> Phase 1 takes the **SKIP** branch
  (L90-93) and exits 0 without opening a transaction. This is correct: the migration is a no-op
  and the probe has just performed the identical audit.
- **Any prerequisite missing** -> `{ error: … }` -> Phase 2 **REFUSED (unexpected database state)**
  (L82-87). This matches the precedent already set by the `021` probe, whose file would also
  fail if its prerequisite (the storage bucket) is absent. The message carries the manual
  instruction: run migrations 001-015 first.

The query is **read-only** - it touches `information_schema` only.

### 7.4 What was changed

| File | Change |
|---|---|
| `server/src/scripts/migrationState.mjs` | **+28 lines** - new `MIGRATION_PROBES['016_payment_validation_engine.sql']` entry, inserted between the `015` and `017` entries, in the established shape (`async (client) => …`, built on the module's existing `scalar()` helper) |
| `server/src/tests/unit/migration-state-detector.test.js` | **+28 / -1** - the coverage-list assertion was extended from `015, 017-021` to `015-021` (it is an exact `toEqual` array, so it had to be extended to stay truthful), and a new `016` test was added |

The `1` deletion in the test file is the old title line `covers every rollout migration 015, 017-021`,
replaced by `covers every rollout migration 015-021`. No assertion was weakened: the list check
remains an exact `toEqual`.

**Not changed:** `apply-migration-guarded.mjs` (read-only reference, per the brief),
`016_payment_validation_engine.sql`, any other probe, and any migration state anywhere.

### 7.5 Test added

`016: all three prerequisites present -> skip; any missing -> refuse (the file would RAISE)`
covers five cases through the existing `fakeClient(map)` mock helper:

| Case | Mocked catalog row | Expected |
|---|---|---|
| all present | `{ txn_col: 1, ref_col: 1, utr_table: 1 }` | `toEqual({ applied: true })` |
| `approved_utrs` absent | `utr_table: 0` | `error` matches `/approved_utrs/` and `/001-015/` |
| `payments.transaction_id` absent | `txn_col: 0` | `error` matches `/payments\.transaction_id/` |
| `topups.reference_id` absent | `ref_col: 0` | `error` matches `/topups\.reference_id/` |
| query returns no row | `[]` | `error` truthy (a missing row is never reported as applied) |

No database was contacted. No migration was executed.

### 7.6 Result

```
Test Files  1 passed (1)
     Tests  9 passed (9)
Exit 0
```

(was 8 tests before this phase; the +1 is the new `016` case).

### 7.7 Effect on the guarded applier

Without touching the applier, `016` now behaves correctly end to end:

- prerequisites satisfied -> **SKIP, exit 0** (previously: guaranteed rollback, exit 1)
- prerequisites missing -> **REFUSED, exit 1**, with the instruction to run 001-015 first

---

## 8. Item 9 - `.gitattributes` and line endings

### 8.1 Measured state

| Check | Result |
|---|---|
| `.gitattributes` anywhere in the repo | **ABSENT** (root, `server/`, `client/`, and a full recursive search) |
| `core.autocrlf` | `true`, sourced from `file:C:/Program Files/Git/etc/gitconfig` - the **Git-for-Windows system config**, not a repo-local setting |
| `core.eol` | unset |
| `core.safecrlf` | unset |
| `core.filemode` / `core.ignorecase` (local) | `false` / `true` |
| Line-ending census, first 341 tracked files | **172 CRLF-only**, **102 LF-only**, **2 mixed**, 5 binary/skip |
| Both `eng.traineddata` | `i/-text w/-text attr/` - already treated as binary by git |

The working tree is **already mixed**: roughly 50% CRLF and 30% LF among text files, with 2 files
genuinely mixed within a single file.

### 8.2 Options

| Option | Effect | Assessment |
|---|---|---|
| **A - no change** | Status quo; `core.autocrlf=true` from the Git-for-Windows install keeps behaving as it does today | **Safe default.** Produces zero diff and zero churn |
| **B - minimal binary-only `.gitattributes`** (`*.traineddata binary`, `*.png binary`, `*.zip binary`, …) | **No practical effect today** - git already classifies these as binary (`i/-text`), so it would be a declaration for future files only | Harmless but near-zero value; still a repo change needing approval |
| **C - repo-wide `* text=auto eol=lf` normalisation** | Would rewrite **172 CRLF working-tree files** on the next checkout, producing an enormous diff and colliding with the 81 uncommitted entries holding the entire V2 rebuild | **REJECT for now.** Directly violates the brief's *"do not change repo-wide line endings"*, and would be reckless while the V2 rebuild is still uncommitted |

### 8.3 Recommendation

**Option A - no change in Phase 18.**

Line-ending normalisation is a legitimate piece of work, but it must be its own approved phase
with its own baseline commit, executed **after** the 81 uncommitted entries are resolved - not
smuggled into a manual-decisions phase. Option B is optional and may be folded into that future
phase.

**No change made in Phase 18. No Git config was modified.**

---

## 9. Test results

### 9.1 The change under test (Item 8)

| Suite | Files | Tests | Exit |
|---|---|---|---|
| `src/tests/unit/migration-state-detector.test.js` | 1 passed | **9 passed** | **0** |

### 9.2 Regression - server

| Suite | Files | Tests | Exit |
|---|---|---|---|
| Full `vitest run` (server) | 46 files: **6 failed suites**, 40 passed | **397 passed, 5 skipped, 0 failed tests** | 1 |
| `vitest run src/tests/unit` | 43 files: **3 failed suites**, 40 passed | **397 passed, 0 skipped, 0 failed tests** | 1 |

`fail 0` in both runs - **zero assertion failures.** The 6 failing *suites* are hollow: they
collect 0 tests under Vitest because they import `node:test`. They are the same 6 named by
Phases 16/17, reported, not suppressed:

- unit: `cache.test.js`, `helpers.test.js`, `pagination.test.js`
- integration: `api.test.js`, `business-rules.test.js`, `cache-stats-auth.test.js`

Passed tests rose **396 -> 397**, i.e. exactly the one new `016` test. Nothing else moved.

### 9.3 Regression - client and build

| Suite | Result | Exit |
|---|---|---|
| `vitest run` (client) | **6 files, 20 passed** | **0** |
| `vite build` | built in 10.67 s; `index-CzcwcluN.js` 490.16 kB / 141.76 kB gzip | **0** |

### 9.4 Integrity re-check

| Check | Result |
|---|---|
| Relative-import resolution scan (201 `.js`/`.jsx`/`.mjs` under `server/src` + `client/src`) | **`BROKEN_COUNT = 0`** |

### 9.5 `node --test` files

Unchanged from Phase 17 - all five still run under `node --test` as Phase 16 Option 6 required.
They were not re-run this phase because Phase 18 touched neither them nor anything they import;
the Vitest results above are the regression evidence for the two files that *were* touched.

---

## 10. Updated Git status

Measured after all Phase 18 edits and test runs:

```
HEAD         = 57ae855bf04bb3806c9c9706540fe95d80d474ef
origin/main  = 57ae855bf04bb3806c9c9706540fe95d80d474ef
ahead/behind = 0 / 0
staged       = 0
entries      = 81
breakdown    = modified 18 | deleted 57 | untracked 6 | other 0
```

| Metric | Phase 15 baseline | Phase 17 | Phase 18 | Delta |
|---|---|---|---|---|
| total entries | 80 | 81 | **81** | **0** |
| modified (` M`) | 15 | 18 | **18** | **0** |
| deleted (` D`) | 59 | 57 | **57** | **0** |
| untracked (`??`) | 6 | 6 | **6** | **0** |
| staged | 0 | 0 | **0** | **0** |

**The entry count is unchanged.** `migrationState.mjs` and `migration-state-detector.test.js`
were **already** in the modified set - Phase 15 §3.1 records them as rows 9 (+21/-0, *"adds 015
detector"*) and 12 (+27/-1, *"now covers migration 015"*). Phase 18 edited those two existing
entries rather than creating new ones.

Their individual diffs grew as follows:

| File | Phase 15 | Phase 18 | Phase 18 delta |
|---|---|---|---|
| `server/src/scripts/migrationState.mjs` | +21/-0 | **+49/-0** | +28/-0 |
| `server/src/tests/unit/migration-state-detector.test.js` | +27/-1 | **+55/-1** | +28/-0 |

Net new work in Phase 18: **+56 lines across 2 files.**

Untracked set (unchanged): `PRE_DEPLOYMENT_SAFETY_REPORT.md`,
`PRODUCTION_BACKUP_AND_FINAL_SAFETY_REPORT.md`, `docs/operations/`,
`server/src/services/paymentVerificationV2/`, `server/src/tests/unit/paymentVerificationV2-engine.test.js`,
`server/src/tests/unit/paymentVerificationV2-real-ocr.test.js`.

**Nothing was staged, committed or pushed.**

---

## 11. Decisions that still require operator approval

Phase 18 resolved or documented all six items, but four of them are recommendations only.
Nothing below was approved on the operator's behalf.

| # | Decision | Recommendation | Approval required for |
|---|---|---|---|
| **2a** | Redact the receiver UPI VPA (R1-R3, 3 hits) | **Redact before publication** | Editing the two safety reports |
| **2b** | Project ref (R4-R5, 12 lines / 14 hits) | **Option A - publish as-is**; Option B = separate repo-wide pass | Either choice |
| **3** | Nested gitlink / `.gitmodules` | **Option C - keep and document** | Any change at all (A or B) |
| **4** | `eng.traineddata` | **Keep both copies** | Any deletion |
| **7** | `cache-stats-auth` fixture | **Blocked pending isolated non-production project (F2)** | Creating/obtaining F2 credentials |
| **9** | `.gitattributes` | **Option A - no change now** | Options B or C, in a dedicated phase after the 81 entries are resolved |

Carried forward unchanged from earlier phases and still open:

- **Migration 015** unverified - sole `credit_wallets_atomic` path.
- **Migration 021** storage-bucket state unverified.
- **`ADMIN_RECEIVER_NAME`** unset in Render and `receiver_name` empty in the DB.
- **`VITE_API_URL`** unverifiable (no `/api` proxy in either `vercel.json`).
- **81 uncommitted entries** hold the entire V2 rebuild; `origin/main` still ships the old engine.
- **No validated production restore** (Phase 13 PARTIAL PASS).
- **`PAYMENT_PROVIDER_MODE = none`**.
- Repo checklist **F1 / F2 / F3** open.
- Vitest full server suite still exits 1 (6 hollow `node:test` files) - expected while Phase 16
  Item 6's *"run via `node --test`, do not migrate"* option stands.

---

## 12. Stopped

Phase 18 is complete and has stopped here, as instructed.

- Six items addressed: **1 implemented** (Item 8), **1 resolved** (Item 4), **4 documented with
  recommendations** (Items 2, 3, 7, 9).
- **0 migrations executed. 0 production database connections. 0 Render/Vercel changes.
  0 commits, 0 pushes, 0 staged files.**
- The only repository modifications are **+56 lines across 2 files**, both reversible with
  `git checkout -- server/src/scripts/migrationState.mjs server/src/tests/unit/migration-state-detector.test.js`.
- Migration `016` was never executed against any database.
- Both safety reports are byte-for-byte as they were before this phase.
