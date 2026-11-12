-- ═══════════════════════════════════════════════════════════════════
-- verify-rollout-017-018-019.sql
-- Read-only verification for the 017 → 018 → 019 → 020 migration rollout.
-- EVERY statement in this file is a SELECT — safe to run at any time,
-- before, during, or after the rollout, on any project (test or prod).
-- Run as the `postgres` role (Dashboard SQL Editor or psql via
-- DATABASE_URL). Each section states the EXPECTED result.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- SECTION A — PREREQUISITES (run BEFORE applying 017)
-- A1: all 17 core tables must exist (expect 17 rows, all present=TRUE).
--     If any row is missing, migrations 001–016 are not fully applied
--     on this project: STOP and apply them first, in order.
-- ───────────────────────────────────────────────────────────────────
SELECT t.name AS table_name, to_regclass('public.' || t.name) IS NOT NULL AS present
FROM (VALUES
  ('users'),('payments'),('topups'),('wallet_transactions'),('approved_utrs'),
  ('referrals'),('referral_tiers'),('audit_logs'),('notifications'),
  ('conversations'),('messages'),('ip_logs'),('suspicious_activity'),
  ('payment_config'),('plan_change_requests')
) AS t(name)
ORDER BY 1;

-- A2: functions 018 replaces/cannot-break must exist BEFORE 018
--     (expect: admin_delete_user present; credit_wallets_atomic present;
--      admin_delete_topup present — 009 must not have been dropped).
SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('admin_delete_user','admin_delete_topup',
                     'credit_wallets_atomic','approve_initial_payment',
                     'delete_pending_registration')
 ORDER BY 1, 2;

-- A3: extensions used by 017/018 defaults (expect both rows, installed).
SELECT extname FROM pg_extension
 WHERE extname IN ('uuid-ossp','pgcrypto') ORDER BY 1;
-- Note: on PostgreSQL 13+ gen_random_uuid() (017) is core and needs no
-- extension; uuid_generate_v4() (018 table default) needs uuid-ossp.

-- A4: FORCE ROW SECURITY must be FALSE everywhere (owner/SECURITY DEFINER
--     bypass depends on it). Expect 0 rows.
SELECT c.relname FROM pg_class c
 JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity;

-- ───────────────────────────────────────────────────────────────────
-- SECTION B — PRE-APPLY STATE OF 017 / 018 / 019 (idempotency check)
-- B1: 017 — expect present=FALSE before apply, TRUE after.
SELECT to_regclass('public.payment_verifications') IS NOT NULL AS present_017;
-- B2: 018 — expect present=FALSE before apply, TRUE after.
SELECT to_regclass('public.deleted_user_financial_records') IS NOT NULL AS present_018;
-- B3: 018 function signature — expect the TWO-ARG (p_user_id, p_admin_id)
--     form before AND after (009 and 018 share it; 018 only hardens it).
SELECT pg_get_function_identity_arguments(p.oid) AS args
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='admin_delete_user';
-- B4: 019 — count of core tables with RLS currently ON (expect 2 before
--     019: payment_verifications + deleted_user_financial_records;
--     expect 17 after 019).
SELECT count(*) AS rls_enabled_core_tables
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
   AND c.relname IN ('users','payments','topups','wallet_transactions',
        'approved_utrs','referrals','referral_tiers','audit_logs',
        'notifications','conversations','messages','ip_logs',
        'suspicious_activity','payment_config','plan_change_requests',
        'payment_verifications','deleted_user_financial_records');
-- B5: 020 — admin_delete_topup source. Expect has_utr_delete=TRUE
--     BEFORE 020 (the 009 bug) and FALSE AFTER 020 (UTR retained).
SELECT pg_get_functiondef(p.oid) LIKE '%DELETE FROM approved_utrs%' AS has_utr_delete
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='admin_delete_topup';

-- ───────────────────────────────────────────────────────────────────
-- SECTION C — DATA-SAFETY SNAPSHOT (run BEFORE and AFTER the rollout;
-- the two runs must return IDENTICAL numbers — applying 017/018/019
-- performs zero DML, so no row may appear, vanish, or change).
-- ───────────────────────────────────────────────────────────────────
SELECT 'users' AS t, count(*) AS rows FROM users
UNION ALL SELECT 'payments', count(*) FROM payments
UNION ALL SELECT 'topups', count(*) FROM topups
UNION ALL SELECT 'wallet_transactions', count(*) FROM wallet_transactions
UNION ALL SELECT 'approved_utrs', count(*) FROM approved_utrs
UNION ALL SELECT 'payment_verifications', count(*) FROM payment_verifications
UNION ALL SELECT 'deleted_user_financial_records', count(*) FROM deleted_user_financial_records
UNION ALL SELECT 'audit_logs', count(*) FROM audit_logs
ORDER BY 1;

-- ───────────────────────────────────────────────────────────────────
-- SECTION D — POST-APPLY 017
-- D1: table + both indexes exist (expect 1 table row, 2 index rows).
SELECT c.relname AS table_name FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='payment_verifications';
SELECT indexname FROM pg_indexes
 WHERE schemaname='public' AND tablename='payment_verifications'
 ORDER BY 1;  -- expect idx_payment_verifications_reference,
              --       idx_payment_verifications_transaction_id
-- D2: RLS on, zero policies (expect true / 0).
SELECT c.relrowsecurity AS rls_enabled FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='payment_verifications';
SELECT count(*) AS policies FROM pg_policies
 WHERE schemaname='public' AND tablename='payment_verifications';

-- ───────────────────────────────────────────────────────────────────
-- SECTION E — POST-APPLY 018
-- E1: archive table + 3 indexes (expect 1 + 3 rows).
SELECT to_regclass('public.deleted_user_financial_records') IS NOT NULL AS present;
SELECT indexname FROM pg_indexes
 WHERE schemaname='public' AND tablename='deleted_user_financial_records'
 ORDER BY 1;  -- idx_deleted_financial_records_{deleted_user,utr,archived_at}
-- E2: function hardened: two-arg signature, SECURITY DEFINER,
--     search_path pinned to public (expect 1 row, true, public).
SELECT pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef AS security_definer, p.proconfig AS config
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='admin_delete_user';
-- E3: execute grants: ONLY service_role (expect exactly 1 row with
--     service_role; PUBLIC/anon/authenticated must NOT appear).
SELECT grantee, privilege_type FROM information_schema.routine_privileges
 WHERE routine_schema='public' AND routine_name='admin_delete_user'
 ORDER BY 1;
-- E4: archive table RLS on, zero policies (expect true / 0).
SELECT c.relrowsecurity AS rls_enabled FROM pg_class c
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='deleted_user_financial_records';
SELECT count(*) AS policies FROM pg_policies
 WHERE schemaname='public' AND tablename='deleted_user_financial_records';

-- ───────────────────────────────────────────────────────────────────
-- SECTION F — POST-APPLY 019
-- F1: ALL 17 core tables RLS-enabled (expect 17 rows, every one true;
--     the count query B4 must also return 17).
SELECT c.relname, c.relrowsecurity AS rls_enabled
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r'
   AND c.relname IN ('users','payments','topups','wallet_transactions',
        'approved_utrs','referrals','referral_tiers','audit_logs',
        'notifications','conversations','messages','ip_logs',
        'suspicious_activity','payment_config','plan_change_requests',
        'payment_verifications','deleted_user_financial_records')
 ORDER BY 1;
-- F2: ZERO policies on any core table (expect 0) — deny-all for
--     anon/authenticated; nothing was granted to end-user roles.
SELECT count(*) AS core_table_policies FROM pg_policies
 WHERE schemaname='public' AND tablename IN
      ('users','payments','topups','wallet_transactions','approved_utrs',
       'referrals','referral_tiers','audit_logs','notifications',
       'conversations','messages','ip_logs','suspicious_activity',
       'payment_config','plan_change_requests','payment_verifications',
       'deleted_user_financial_records');
-- F3: role attributes (expect service_role bypassrls = true;
--     anon/authenticated bypassrls = false; postgres bypassrls = true
--     or table-owner).
SELECT rolname, rolbypassrls, rolsuper FROM pg_roles
 WHERE rolname IN ('anon','authenticated','service_role','postgres')
 ORDER BY 1;
-- F4: service_role retains FULL table privileges despite RLS (expect
--     true for every table — RLS never revokes grants, it filters rows
--     for roles WITHOUT bypassrls).
SELECT c.relname,
       has_table_privilege('service_role', c.oid, 'SELECT')  AS sr_select,
       has_table_privilege('service_role', c.oid, 'INSERT')  AS sr_insert,
       has_table_privilege('service_role', c.oid, 'UPDATE')  AS sr_update,
       has_table_privilege('service_role', c.oid, 'DELETE')  AS sr_delete
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r'
   AND c.relname IN ('users','payments','topups','wallet_transactions',
        'approved_utrs','referrals','referral_tiers','audit_logs',
        'notifications','conversations','messages','ip_logs',
        'suspicious_activity','payment_config','plan_change_requests',
        'payment_verifications','deleted_user_financial_records')
 ORDER BY 1;
-- F5: SECURITY DEFINER financial functions still executable by their
--     owner path (expect: table owner = the role that ran the
--     migrations, and that role can SELECT every core table — owner
--     bypasses RLS because FORCE is false, see A4).
SELECT current_user AS run_as,
       has_table_privilege(current_user, 'public.users', 'SELECT') AS can_read_users;
-- Run this section AS the migration-executing role (postgres).

-- ───────────────────────────────────────────────────────────────────
-- SECTION G — LIVE API SMOKE (not SQL — run from a shell AFTER 019)
-- G1: ANON key must be DENIED (expect HTTP 401/403, never JSON rows):
--   curl -s -o /dev/null -w "%{http_code}\n" \
--     "$SUPABASE_URL/rest/v1/users?select=id&limit=1" \
--     -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY"
-- G2: SERVICE_ROLE key must still succeed (expect HTTP 200 + [] or rows):
--   curl -s -o /dev/null -w "%{http_code}\n" \
--     "$SUPABASE_URL/rest/v1/users?select=id&limit=1" \
--     -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
--     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
-- G3: RPC smoke — admin_delete_user must be REJECTED for anon
--     (expect HTTP 401/403 or PGRST202/permission denied — never
--     'ADMIN_REQUIRED', which would prove the function executed):
--   curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/admin_delete_user" \
--     -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
--     -H "Content-Type: application/json" \
--     -d '{"p_user_id":"00000000-0000-0000-0000-000000000000","p_admin_id":"00000000-0000-0000-0000-000000000000"}'
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- SECTION H — POST-APPLY 020 (admin_delete_topup retains approved_utrs)
-- H1: expect has_utr_delete=FALSE (020 removed the approved_utrs
--     deletion), still_deletes_topups=TRUE, writes_audit=TRUE.
--     Before 020 the first column reads TRUE (the 009 bug).
-- ───────────────────────────────────────────────────────────────────
SELECT pg_get_functiondef(p.oid) LIKE '%DELETE FROM approved_utrs%' AS has_utr_delete,
       pg_get_functiondef(p.oid) LIKE '%DELETE FROM topups WHERE id = p_topup_id%' AS still_deletes_topups,
       pg_get_functiondef(p.oid) LIKE '%INSERT INTO audit_logs%' AS writes_audit
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='admin_delete_topup';

-- ───────────────────────────────────────────────────────────────────
-- SECTION I — POST-APPLY 018 audit retention + UTR retention in
-- admin_delete_user (added by the 11 Nov 2026 remediation).
-- I1: admin_delete_user must NOT delete approved_utrs or audit_logs.
--     Expect utr_delete=FALSE, audit_delete=FALSE, audit_detach=TRUE,
--     archives=TRUE after 018; before 018 (009 version) utr_delete and
--     audit_delete read TRUE.
-- ───────────────────────────────────────────────────────────────────
SELECT pg_get_functiondef(p.oid) LIKE '%DELETE FROM approved_utrs%' AS utr_delete,
       pg_get_functiondef(p.oid) LIKE '%DELETE FROM audit_logs%' AS audit_delete,
       pg_get_functiondef(p.oid) LIKE '%UPDATE audit_logs SET actor_id = NULL%' AS audit_detach,
       pg_get_functiondef(p.oid) LIKE '%deleted_user_financial_records%' AS archives
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname='public' AND p.proname='admin_delete_user';

-- ───────────────────────────────────────────────────────────────────
-- SECTION J — POST-APPLY 021 (private payments bucket).
-- J1: expect is_public = FALSE.
-- J2: expect remaining_read_policies = 0.
-- ───────────────────────────────────────────────────────────────────
SELECT id, public AS is_public FROM storage.buckets WHERE id = 'payments';
SELECT count(*) AS remaining_read_policies FROM pg_policies
 WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT'
   AND ((roles::text[]) @> ARRAY['anon']::text[] OR (roles::text[]) @> ARRAY['authenticated']::text[])
   AND (qual IS NULL OR qual LIKE '%payments%');
-- ═══════════════════════════════════════════════════════════════════
