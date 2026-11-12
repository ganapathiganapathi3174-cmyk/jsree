-- ═══════════════════════════════════════════════════════════════════
-- 019_enable_rls_core_tables.sql
-- Production hardening P2 — Supabase RLS security audit remediation.
--
-- FINDING (audit): only payment_verifications (017) and
-- deleted_user_financial_records (018) had Row Level Security enabled.
-- All core business tables (users, payments, topups, wallet_transactions,
-- approved_utrs, …) had RLS DISABLED, meaning the anon/authenticated
-- roles could read and write them directly through the PostgREST API if
-- the endpoint were reachable — bypassing the application entirely.
--
-- WHY THIS IS SAFE FOR THE APP (verified statically, not deployed):
--   * The server uses the service_role client exclusively
--     (server/src/db/supabase.js — supabaseAnon is an unused export).
--   * The web client contains ZERO supabase usage (no SDK, no keys).
--   * service_role BYPASSES RLS by definition in Supabase — enabling
--     RLS with NO policies does not affect any application query.
--   * anon/authenticated get the default DENY (no policy = no access).
--
-- WHAT THIS DOES NOT DO:
--   * It creates NO policies — access for end-user roles stays denied.
--     Any future policy must be added by a follow-up migration with an
--     explicit owner-column or allow-list design.
--   * It does NOT verify anything against a live database. This file is
--     static-only until an operator applies it with
--     `supabase db push` (or psql) and runs the verification queries
--     below. DO NOT claim RLS is live until those queries pass.
--
-- DEPLOYMENT ORDER: after 018 (which must be applied first), before any
-- new feature migrations. Rollback: ALTER TABLE … DISABLE ROW LEVEL
-- SECURITY (policies are none, so no DROP POLICY is required).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.topups               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approved_utrs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referrals            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_tiers       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ip_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suspicious_activity  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_config       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_change_requests ENABLE ROW LEVEL SECURITY;

-- Already enforced by earlier migrations (re-asserted for completeness —
-- idempotent, safe to re-run). IF EXISTS keeps this file runnable when
-- 017/018 have not been applied yet (the 15 core tables above are the
-- security-relevant ones and are always present after 001-016).
ALTER TABLE IF EXISTS public.payment_verifications           ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.deleted_user_financial_records  ENABLE ROW LEVEL SECURITY;

-- ───────────────────────────────────────────────────────────────────
-- POST-DEPLOYMENT VERIFICATION (run as an operator against the LIVE
-- database after applying; all three queries must return the expected
-- shape before this migration is considered complete):
--
-- 1) Every core table must have rowsecurity = true (expect 17 rows,
--    rls_enabled = true for each):
-- SELECT c.relname, c.relrowsecurity
--   FROM pg_class c
--   JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'public'
--    AND c.relkind = 'r'
--    AND c.relname IN ('users','payments','topups','wallet_transactions',
--         'approved_utrs','referrals','referral_tiers','audit_logs',
--         'notifications','conversations','messages','ip_logs',
--         'suspicious_activity','payment_config','plan_change_requests',
--         'payment_verifications','deleted_user_financial_records')
--  ORDER BY 1;
--
-- 2) No policies exist for these tables (expect 0 rows — deny-all for
--    anon/authenticated; service_role bypasses RLS):
-- SELECT schemaname, tablename, policyname
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('users','payments','topups','wallet_transactions',
--         'approved_utrs','referrals','referral_tiers','audit_logs',
--         'notifications','conversations','messages','ip_logs',
--         'suspicious_activity','payment_config','plan_change_requests');
--
-- 3) Live smoke (must FAIL with permission denied when executed with the
--    ANON key — proves external access is blocked; the same query with
--    the service_role key must SUCCEED):
--    GET /rest/v1/users?select=id&limit=1   with apikey=<anon key>
--    → expect HTTP 401/403, never data.
--
-- Live-bank-verification note: unrelated to this migration — no payment
-- provider is configured in this environment; settlement claims remain
-- screenshot-verification only.
-- ═══════════════════════════════════════════════════════════════════
