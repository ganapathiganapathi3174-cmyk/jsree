# Phase 13 — Backup Validation Report (PGlite variant)

**Date:** 15 Nov 2026
**Scope:** Validate the existing production SQL backup using `@electric-sql/pglite`
(no PostgreSQL, Docker, or WSL install available on this machine).
**Overall verdict: PARTIAL PASS**

> **Critical scope statement.** PGlite runs PostgreSQL **18.3** compiled to
> WebAssembly (PGlite 0.5.8). It is **not** PostgreSQL **17.12** and it is **not**
> Supabase. A successful PGlite restore proves the backup file is internally
> consistent and losslessly restorable into a vanilla PostgreSQL-family engine.
> It does **not** prove the backup restores into the production Supabase project,
> nor that it is byte-identical to a `pg_restore` on 17.12. Those remain
> **NOT VERIFIED**.

---

## 1. Verdict summary

| # | Validation item | Verdict | Evidence |
|---|-----------------|---------|----------|
| 1 | Backup file present & size | **PASS** | 213,581 bytes, 2,260 lines |
| 2 | SHA-256 integrity vs sidecar | **PASS** (verified twice: before and after cleanup) | `CA80B336…9E019E29` = expected |
| 3 | Backup readable / parses | **PASS** | 160 statements split & executed |
| 4 | Schema restore (tables) | **PASS** (with documented shims) | 17/17 tables = baseline |
| 5 | Data restore (rows) | **PASS** | 595 rows = baseline |
| 6 | Functions / triggers / FKs | **PASS** | 6 / 7 / 17 = baseline |
| 7 | Indexes | **PASS** (reconciled) | 46 explicit `CREATE INDEX` → 70 catalog indexes |
| 8 | RLS & policy state captured | **PASS** | 17 × `ENABLE ROW LEVEL SECURITY`, 0 policies |
| 9 | `credit_wallets_atomic` absent | **PASS** | count = 0 (migration 015 unapplied at dump time) |
| 10 | Migration 015 applicability | **PARTIAL PASS** | applies + idempotent on PGlite 18.3 with Supabase roles; not a 17.12 proof |
| 11 | Restore on PostgreSQL 17.12 | **BLOCKED** | no `postgres`/`initdb`/`psql`, no Docker/WSL, installer URLs 404 |
| 12 | Restore into live Supabase | **NOT VERIFIED** | no production access attempted |
| 13 | Storage (payment screenshots) coverage | **NOT COVERED** | 0 `storage.` references in dump |
| 14 | Supabase Auth (`auth.users`) coverage | **NOT COVERED** | 0 `auth.` references in dump |
| 15 | Roles / grants coverage | **NOT COVERED** | 0 `CREATE ROLE` / `GRANT` / `REVOKE` statements |

---

## 2. Backup identity

| Field | Value |
|---|---|
| Path | `C:\Users\pavi\Desktop\jsree-backup\production-backup-20261114-213603.sql` |
| Size | 213,581 bytes |
| Lines | 2,260 |
| SHA-256 | `CA80B33651CAEE9E0344B2156ACE7EE5404BEED7CA56744F932131749E019E29` |
| Sidecar match | MATCH (verified at task start **and** after cleanup) |
| Dump header | `Dumped from database version 17.6` / `Dumped by pg_dump version 17.12` |
| Format | plain SQL, `pg_dump` standard, with `\restrict` / `\unrestrict` client meta |

### Dump object inventory (source file)

| Object | Count |
|---|---|
| `CREATE TABLE` | 17 |
| `COPY … FROM stdin` | 17 (595 data rows) |
| `INSERT INTO` | 0 |
| `CREATE FUNCTION` | 6 |
| `CREATE (UNIQUE) INDEX` | 46 |
| `CREATE TRIGGER` | 7 |
| `FOREIGN KEY` | 17 |
| `CREATE POLICY` | 0 |
| `ENABLE ROW LEVEL SECURITY` | 17 |
| `SECURITY DEFINER` | 4 |
| `CREATE SCHEMA` | 1 (`public`) |
| `CREATE EXTENSION` | 0 |
| `CREATE ROLE` / `GRANT` / `REVOKE` | 0 |
| `storage.` references | **0** |
| `auth.` references | **0** |

---

## 3. Method

1. Created throwaway workspace
   `C:\Users\pavi\AppData\Local\Temp\jsree_pglite_validation`.
2. Installed `@electric-sql/pglite` **there** with `npm install --no-save` —
   repo `package.json` / `package-lock.json` untouched (verified empty
   `git status` on both).
3. Wrote conversion + restore script (see §5), executed statement-by-statement.
4. Ran post-restore catalog queries for every baseline figure.
5. Ran migration 015 against a **separate disposable** PGlite instance (§7).
6. Deleted the temp workspace (315 files) and re-verified the backup checksum.

**Engine under test:**

```
PostgreSQL 18.3 (PGlite 0.5.8) on wasm32-unknown-emscripten,
compiled by emcc (Emscripten gcc/clang-like replacement + linker
emulating GNU ld) 3.1.74, 32-bit
```

---

## 4. Restore result

```
STATEMENT_COUNT=160
EXECUTED=160
FAILED=0
```

### Schema objects

| Metric | Restored | Baseline | Match |
|---|---|---|---|
| Tables (public) | 17 | 17 | ✅ |
| Functions | 6 | 6 | ✅ |
| Triggers | 7 | 7 | ✅ |
| Foreign keys | 17 | 17 | ✅ |
| Indexes (catalog) | 70 | 46 explicit `CREATE INDEX` | ✅ reconciled¹ |
| Constraints (all) | 142 | — | recorded |
| RLS-enabled tables | 17 | 17 | ✅ |
| Policies | 0 | 0 | ✅ |
| Schemas | `public`, `extensions`² | `public` | ✅ |
| Extensions | `plpgsql` | `plpgsql` | ✅ |

¹ pg_dump emits 46 `CREATE INDEX` statements; primary-key and unique
constraints create a further 24 indexes implicitly, giving 70 in
`pg_indexes`. 46 + 24 = 70 — no index is missing or extra.
² `extensions` is created by the documented compatibility shim (§5).

### Functions restored

`admin_delete_topup`, `admin_delete_user`, `approve_initial_payment`,
`delete_pending_registration`, `generate_referral_code`,
`update_updated_at_column`

### Rows restored — total **595** (baseline 595 ✅)

| Table | Rows | | Table | Rows |
|---|---:|---|---|---:|
| `audit_logs` | 333 | | `notifications` | 6 |
| `suspicious_activity` | 98 | | `payment_config` | 5 |
| `ip_logs` | 137 | | `payments` | 6 |
| `users` | 7 | | `referral_tiers` | 3 |
| `approved_utrs` | 0 | | `conversations` | 0 |
| `deleted_user_financial_records` | 0 | | `messages` | 0 |
| `payment_verifications` | 0 | | `plan_change_requests` | 0 |
| `referrals` | 0 | | `topups` | 0 |
| `wallet_transactions` | 0 | | | |

### Required key-table counts

| Table | Count | | Table | Count |
|---|---:|---|---|---:|
| `users` | 7 | | `topups` | 0 |
| `payments` | 6 | | `payment_verifications` | 0 |
| `payment_config` | 5 | | `audit_logs` | 333 |
| `wallet_transactions` | 0 | | `suspicious_activity` | 98 |
| `ip_logs` | 137 | | | |

### Migration-015 guard

`credit_wallets_atomic` function count = **0** → confirmed **absent**,
i.e. migration 015 was **not applied** at dump time. Consistent with the
production-blocker list. Migration 015 was **not** applied to any shared
or production database during this task.

---

## 5. Compatibility shims (all lossless, all documented)

The raw dump cannot be fed to `PGlite.exec()` verbatim. Four adjustments
were required. **No data row, table, column, index, constraint, trigger,
function, or policy was discarded.**

| # | Shim | Why | Data impact |
|---|---|---|---|
| S1 | Strip `\restrict …` / `\unrestrict …` (2 lines) | `pg_dump` client-side meta; not SQL, not understood by any server | none |
| S2 | `CREATE SCHEMA public;` → `CREATE SCHEMA IF NOT EXISTS public;` | PGlite pre-creates `public`; plain form errors with `schema "public" already exists` | none |
| S3 | Convert all 17 `COPY … FROM stdin` blocks to equivalent `INSERT` statements (595 rows, `\N`→`NULL`, backslash escapes decoded, tab-split) | **PGlite does not support `COPY … FROM stdin`** — confirmed empirically: `syntax error at or near "1"` | none — row count and values identical |
| S4 | `CREATE SCHEMA IF NOT EXISTS extensions;` + `extensions.uuid_generate_v4()` → `gen_random_uuid()` | 9 column defaults call `extensions.uuid_generate_v4()`; the dump has 0 `CREATE EXTENSION` (Supabase pre-installs `uuid-ossp` in the `extensions` schema); PGlite does not bundle `uuid-ossp` (`extension "uuid-ossp" is not available`) | none — every restored row carries an explicit `id`; the shim only satisfies default expressions |

**Conversion statistics:** `COPY_BLOCKS_CONVERTED=17`,
`COPY_ROWS_CONVERTED=595`, `CONVERTED_SQL_BYTES=229,187` (source 213,581 —
increase is purely the INSERT encoding of tab/newline/backslash data).

---

## 6. Backup coverage limitations (important)

The dump contains **only the `public` schema**. Explicitly **not** in this backup:

| Not covered | Impact | Evidence |
|---|---|---|
| **Storage objects** — customer payment screenshots in the `payments` bucket, avatars in `avatars` | Restoring this SQL does **not** restore any screenshot. Financial records referencing `screenshot_url` would point at missing objects. | 0 occurrences of `storage.` |
| **Supabase Auth** — `auth.users`, identities, sessions | User login accounts are not restorable from this file. The `public.users` rows exist, but passwords/identities live in `auth`. | 0 occurrences of `auth.` |
| **Roles, grants, revokes** | Ownership and privilege state is not captured; a bare restore runs as the connecting superuser with default privileges. | 0 `CREATE ROLE`/`GRANT`/`REVOKE` |
| **`storage.buckets` metadata** | Bucket existence/public flag is not in the dump (it lives in the `storage` schema). | 0 `storage.` refs |

**Consequence:** this backup is a **public-schema data backup only**. It is
sufficient for financial/relational recovery of `public` tables; it is
**not** a complete disaster-recovery artifact for the application.

---

## 7. Migration 015 compatibility test (separate disposable DB)

Test target: a **fresh, disposable** PGlite instance (never any shared or
production database). Prerequisites `users.wallet_balance` and
`wallet_transactions` were confirmed present in the restored schema.

### Result sequence

```
SUPABASE_ROLES_CREATED=YES
M015_APPLY=OK
FUNCTION_PRESENT=1
SECURITY_DEFINER=true
PROCONFIG=["search_path=public"]
CALL1_CREDITED=true  NEWBAL=125
CALL2_CREDITED=false NEWBAL=125
FINAL_BALANCE=125.00
LEDGER_ROWS=1
EMPTY_ARRAY_REJECTED=YES
GRANTS=[{postgres,EXECUTE},{service_role,EXECUTE}]
```

### Findings

1. **First apply attempt FAILED** with `role "anon" does not exist`.
   Migration 015 contains `REVOKE … FROM PUBLIC, anon, authenticated;`.
   PGlite has no Supabase-managed roles. This is an **environment
   difference, not a defect**: `anon` / `authenticated` / `service_role`
   are created by Supabase on every project, and the production project
   already has them.
2. After creating those three roles in the disposable DB, migration 015
   applied cleanly and is functionally correct:
   - `SECURITY DEFINER` ✔, `search_path = public` ✔
   - **Idempotency proven:** first call credited 25.00 (100.00 → 125.00)
     and wrote exactly 1 ledger row; identical second call returned
     `credited=false` with balance unchanged at 125.00 and **still exactly
     1 ledger row** (no double-credit).
   - Empty credit array correctly rejected.
   - `EXECUTE` granted only to `service_role` (plus the owner);
     `anon`/`authenticated` denied — matches the least-intent design.

### Verdict: **PARTIAL PASS**

Migration 015 applies and behaves correctly on **PostgreSQL 18.3 / PGlite**
with Supabase roles present. This is **not** a PostgreSQL **17.12**
compatibility proof and **not** a Supabase compatibility proof. Production
application of migration 015 remains **blocked pending explicit operator
approval (Gate A)** and was **not** performed.

---

## 8. Bonus: migration state implied by the 14 Nov backup

The checklist `supabase/MIGRATION_ROLLOUT_CHECKLIST.md` was generated
**11 Nov 2026** from live probes. The backup is dated **14 Nov 2026** and
its contents show a **newer** state:

| Migration | State per 11 Nov checklist | Evidence in 14 Nov backup | Inferred |
|---|---|---|---|
| 017 | NOT APPLIED | `payment_verifications` table **present** (created by 017) | applied |
| 018 | NOT APPLIED | `deleted_user_financial_records` table present; `admin_delete_user` has `DELETE FROM approved_utrs`=0, `DELETE FROM audit_logs`=0, `actor_id = NULL`=1, 3× archive `INSERT` — **exactly** 018's three post-conditions | applied |
| 019 | PARTIALLY APPLIED | `ENABLE ROW LEVEL SECURITY` on **17/17** tables (019 contains exactly 17) | applied |
| 020 | UNKNOWN | `admin_delete_topup` has `DELETE FROM approved_utrs`=0; the 009 body **does** contain that delete, so the 020 post-condition holds | applied |
| 021 | NOT APPLIED | **cannot be determined** — bucket metadata lives in `storage`, absent from this dump | **treat as OPEN** |

**These are inferences from the dump, not live probes.** The operator must
re-run the checklist's read-only probes against `<PROJECT_REF>`
before relying on them. Migration 021 must still be treated as open
(the last direct observation was `payments` bucket `public=true`, proven by
an HTTP 200 on a customer screenshot).

---

## 9. Storage backup & recovery procedure (no downloads performed)

### Current configuration (read from repo, no live access)

| Item | Value | Source |
|---|---|---|
| Screenshot bucket | `payments` | `server/src/services/paymentService.js`, `topupService.js` |
| Avatar bucket | `avatars` (public by design) | `server/src/controllers/userController.js` |
| URL style stored in DB | **private** object URL (no `/public/` segment) via `privateObjectUrl('payments', path)` | `paymentService.js:330`, `topupService.js:214` |
| Reads | **only** through ownership-checked API proxies using the service role | see endpoints below |
| Bucket hardening migration | `supabase/migrations/021_private_payments_bucket.sql` | flips `payments` to private, drops anon/authenticated SELECT policies, idempotent, refuses if bucket missing |

Application read endpoints (all authenticated, all proxied — the client never
receives a public object URL for screenshots):

- `GET /api/payments/:paymentId/screenshot` — owner or admin
- `GET /api/admin/payments/:paymentId/screenshot` — admin
- `GET /api/admin/topups/:topupId/screenshot` — admin

### Gap

**This SQL backup does not cover Storage.** There is no row-level copy of
`screenshot_url` object bytes anywhere in the backup.

### Required recovery procedure (for an operator, requires authorization)

1. Take a **Supabase project-level backup / PITR restore point** — this is
   the only artifact that covers `storage.objects` bytes and `auth.users`.
2. Separately export the two buckets:
   - Dashboard → Storage → `payments` → select-all → download, **or**
   - `supabase storage` / S3-compatible tier listing with service-role
     credentials, streamed to encrypted offsite storage.
3. Record bucket-level state to restore afterwards:
   `payments.public` (expect `false` after 021), `avatars.public` (expect
   `true`), and the `storage.objects` RLS policies.
4. After any restore, re-run 021's post-apply verification:
   `public=false` and `remaining_read_policies=0` for `payments`.
5. Never change bucket permissions or download customer screenshots
   without explicit, operation-specific authorization.

**Status: NOT COVERED** — no export, download, or permission change was
performed during this task.

---

## 10. Cleanup

| Action | Result |
|---|---|
| PGlite connections closed (`db.close()`) | done in every script |
| Temp workspace `C:\Users\pavi\AppData\Local\Temp\jsree_pglite_validation` | **deleted** (315 files, path no longer exists) |
| Repo `package.json` / `package-lock.json` | **untouched** (empty `git status`) |
| Original backup + `.sha256` | **never modified** |
| Post-cleanup SHA-256 re-verify | **MATCH** `CA80B336…9E019E29`, size 213,581 |
| Migration 015 on production | **not applied** |
| Storage bucket permissions | **not changed** |
| Smoke tests / deploy / commit / push | **not performed** |

---

## 11. Reproduction (for the record)

```text
1. sha256sum production-backup-20261114-213603.sql  -> compare with .sha256
2. mkdir temp-workspace; cd temp-workspace
3. npm init -y; npm install @electric-sql/pglite --no-save
4. read the dump; strip \restrict/\unrestrict
5. map "CREATE SCHEMA public;" -> "CREATE SCHEMA IF NOT EXISTS public;"
6. convert each "COPY ... FROM stdin;" block (tab-split, \N -> NULL,
   decode \b \f \n \r \t \v \\ \ooo) into INSERT ... VALUES ...;
7. prepend the extensions schema + uuid_generate_v4() shim (S4)
8. split on ';' honoring quotes, --, /* */, and $tag$ ... $tag$
9. PGlite: exec each statement; count tables/rows/functions/triggers/FKs
10. separate instance: CREATE ROLE anon/authenticated/service_role;
    exec 015_atomic_wallet_credits.sql; call it twice; assert idempotency
11. delete the temp workspace; re-verify the checksum
```

---

## 12. What this task did NOT do

- Did **not** install PostgreSQL, Docker, or WSL.
- Did **not** apply migration 015 to any shared, test-or-production database.
- Did **not** access the live Supabase project or change any bucket.
- Did **not** download, export, or expose any customer screenshot or PII.
- Did **not** modify Render, Vercel, or Supabase configuration.
- Did **not** run smoke tests, deploy, commit, or push.
- Did **not** upgrade any "PARTIAL PASS" to "PASS" without direct evidence.
