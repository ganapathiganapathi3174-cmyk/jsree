# JSREE — Production Migration Execution Checklist (017 → 021)

**Generated:** 11 Nov 2026 — Final Production Launch Readiness remediation.
**Rule:** NOTHING in this checklist runs automatically. Every step requires an
explicit operator action on an explicitly named project. Take a backup first.

## Current verified state (live project `vuwtxdtfkacndedsaroi`, probed read-only)

| # | File | State | How we know |
|---|------|-------|-------------|
| 017 | `017_payment_verification_history.sql` | **NOT APPLIED** | `payment_verifications` table → 404 PGRST205 |
| 018 | `018_complete_user_deletion.sql` | **NOT APPLIED** | archive table absent; `admin_delete_user` = 009 body (deletes `approved_utrs` + `audit_logs`) |
| 019 | `019_enable_rls_core_tables.sql` | **PARTIALLY APPLIED** | anon holds SELECT privilege on `users` yet reads 0 rows → RLS filtering on core 15; lines 52–53 skipped (tables absent at run time) |
| 020 | `020_admin_delete_topup_retains_utrs.sql` | **UNKNOWN (treat as OPEN)** | function present but 009-vs-020 indistinguishable via REST — confirm with §H1 SQL |
| 021 | `021_private_payments_bucket.sql` | **NOT APPLIED** | `payments` bucket `public=true` (proven: customer screenshot → HTTP 200) |

## Preconditions (all must be TRUE)

- [ ] Backup / PITR restore point taken for the target project.
- [ ] Target project ref written down and matches `SUPABASE_URL`.
- [ ] `supabase/verify-rollout-017-018-019.sql` **Section A + B + C** run; results saved (baseline snapshot).
- [ ] Rollback note: 017/018/019/021 are idempotent DDL (IF NOT EXISTS / CREATE OR REPLACE / UPDATE). A failed run rolls back (guarded runner uses one transaction). Data DML is not performed by any of them. The only behavioral rollback is re-running with the previous function bodies (re-apply 009/014 definitions from git history if a defect is found).

## Execution order (one at a time, each verified before the next)

```powershell
# From repo root, with DATABASE_URL (direct connection), SUPABASE_URL,
# MIGRATION_TARGET_PROJECT_REF, MIGRATION_CONFIRM set in the shell:
node server/src/scripts/apply-migration-guarded.mjs 017_payment_verification_history.sql
node server/src/scripts/apply-migration-guarded.mjs 018_complete_user_deletion.sql
node server/src/scripts/apply-migration-guarded.mjs 019_enable_rls_core_tables.sql
node server/src/scripts/apply-migration-guarded.mjs 020_admin_delete_topup_retains_utrs.sql
node server/src/scripts/apply-migration-guarded.mjs 021_private_payments_bucket.sql
```

Guarded-runner behavior (this remediation):
1. **State detection first** — live catalog probes (`migrationState.mjs`):
   post-conditions already hold → **SKIP** (no blind re-run); unexpected object
   kinds → **REFUSE** with instructions.
2. Apply inside ONE transaction under an advisory lock.
3. **Re-run the same probe as post-condition verification** — anything short of
   full success rolls the whole transaction back.
4. `ALLOW_NON_TEST_TARGET=I_UNDERSTAND` required for any project ref without
   `test` in its name (production guard).

## Post-rollout verification (all must pass)

- [ ] `verify-rollout-017-018-019.sql` Sections **D, E, F, H, I, J** → expected results.
- [ ] Section **C** snapshot identical to baseline (017–021 perform no row DML).
- [ ] Section **G** API smoke: anon denied / service role OK / anon RPC rejected.
- [ ] Live bucket check: `GET $SUPABASE_URL/storage/v1/object/public/payments/<known-path>` → **404** (was 200).
- [ ] Proxy check (authenticated): owner screenshot → 200; other user's → 403/404; anon → 401.
- [ ] Re-run offline test suites (vitest + `node --test`) — see final report.
- [ ] After migrations: restart/verify Render service healthy (`/api/health` 200).

## Operator SQL quick checks (Dashboard SQL editor, read-only)

```sql
-- 018 body fixed?  expect: utr_delete=false, audit_delete=false, audit_detach=true
SELECT pg_get_functiondef(p.oid) LIKE '%DELETE FROM approved_utrs%' AS utr_delete,
       pg_get_functiondef(p.oid) LIKE '%DELETE FROM audit_logs%' AS audit_delete,
       pg_get_functiondef(p.oid) LIKE '%UPDATE audit_logs SET actor_id = NULL%' AS audit_detach
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='admin_delete_user';

-- 020 applied?  expect: has_utr_delete=false
SELECT pg_get_functiondef(p.oid) LIKE '%DELETE FROM approved_utrs%' AS has_utr_delete
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='admin_delete_topup';

-- 021 applied?  expect: is_public=false, remaining_read_policies=0
SELECT public AS is_public FROM storage.buckets WHERE id='payments';
SELECT count(*) FROM storage.policies
 WHERE bucket_id='payments' AND command='SELECT'
   AND (roles @> ARRAY['anon']::text[] OR roles @> ARRAY['authenticated']::text[]);
```

## Recovery

- All five files are safe to **re-run** (guarded runner will also SKIP when
  already applied). A mid-run failure rolls back completely.
- If `admin_delete_*` behaves unexpectedly after 018/020: re-apply the last
  known-good definition from git (`git show <sha>:supabase/migrations/009_...`)
  via the guarded runner, then investigate.
- If 021 misbehaves: `UPDATE storage.buckets SET public = true WHERE id='payments'`
  restores prior (insecure) behavior — only as an emergency rollback, and
  re-secure immediately.
