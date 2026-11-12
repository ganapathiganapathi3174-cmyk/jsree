-- =============================================================
-- 021_private_payments_bucket.sql
--
-- CRITICAL security fix (Final Production Launch Readiness Audit,
-- 11 Nov 2026): the `payments` storage bucket was PUBLIC, so real
-- customer payment screenshots were fetchable by anyone holding the
-- capability URL (proven live: HTTP 200, image/png).
--
-- This migration:
--   1. Flips the `payments` bucket to PRIVATE.
--   2. Removes any anon/authenticated SELECT policies on storage.objects
--      for that bucket (deny-by-default; there should be none because ALL
--      application reads go through ownership-checked API proxy endpoints
--      that use the service role).
--
-- The `avatars` bucket is intentionally NOT touched (profile pictures are
-- public by design).
--
-- Application code stores a private object URL (no /public/ segment) and
-- reads exclusively via:
--   GET /api/payments/:paymentId/screenshot          (owner or admin)
--   GET /api/admin/payments/:paymentId/screenshot    (admin)
--   GET /api/admin/topups/:topupId/screenshot        (admin)
--
-- Idempotent and safe to re-run. Apply AFTER 017-020 (see
-- supabase/MIGRATION_ROLLOUT_CHECKLIST.md).
-- =============================================================

DO $$
DECLARE r record;
BEGIN
  -- 1. Bucket must exist; refuse to guess.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'payments') THEN
    RAISE EXCEPTION 'BUCKET_NOT_FOUND: storage bucket "payments" does not exist on this project';
  END IF;

  -- 2. Make it private (this alone removes public/object anon reads).
  UPDATE storage.buckets SET public = false WHERE id = 'payments';

  -- 3. Deny-by-default: drop any object-level SELECT policies that grant
  --    anon or authenticated direct reads of payments objects. The
  --    application never uses them (service-role proxy only). Scoped to
  --    payments so avatar policies are untouched.
  --    storage schema versions differ across Supabase projects: use the
  --    storage.policies catalog when present, and always reconcile from
  --    pg_policies (available everywhere) so the outcome is identical.
  IF to_regclass('storage.policies') IS NOT NULL THEN
    DELETE FROM storage.policies
     WHERE bucket_id = 'payments'
       AND command = 'SELECT'
       AND ((roles::text[]) @> ARRAY['anon']::text[] OR (roles::text[]) @> ARRAY['authenticated']::text[]);
  END IF;

  FOR r IN
    SELECT policyname FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT'
       AND ((roles::text[]) @> ARRAY['anon']::text[] OR (roles::text[]) @> ARRAY['authenticated']::text[])
       AND (qual IS NULL OR qual LIKE '%payments%')
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
  END LOOP;
END $$;

-- ── Post-apply verification (expect exactly these results) ──
SELECT id, public AS is_public FROM storage.buckets WHERE id = 'payments';
-- expect is_public = false
SELECT count(*) AS remaining_read_policies FROM pg_policies
 WHERE schemaname = 'storage' AND tablename = 'objects' AND cmd = 'SELECT'
   AND ((roles::text[]) @> ARRAY['anon']::text[] OR (roles::text[]) @> ARRAY['authenticated']::text[])
   AND (qual IS NULL OR qual LIKE '%payments%');
-- expect 0
