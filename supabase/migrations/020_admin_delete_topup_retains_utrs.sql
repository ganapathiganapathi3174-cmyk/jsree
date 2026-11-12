-- =============================================================
-- 020_admin_delete_topup_retains_utrs.sql
--
-- Fixes a duplicate-credit vector in admin_delete_topup (009):
-- the function deleted the top-up's approved_utrs row together with
-- the top-up itself, which FREED the consumed bank-UTR back into the
-- pool. The same bank transaction reference could then be reserved
-- and credited again by a new top-up or registration payment.
--
-- This mirrors the invariant established by 018 (admin_delete_user
-- RETAINS approved_utrs): approved_utrs is the consumed-UTR ledger
-- that prevents the same bank transaction reference from ever being
-- approved twice. Orphaned ledger rows (reference_id pointing at a
-- deleted top-up) are harmless — they carry no FK and continue to
-- block reuse, which is exactly the desired behavior.
--
-- Everything else about admin_delete_topup is unchanged:
--   * wallet_transactions rows and wallet balances are NEVER touched
--   * storage paths are returned for best-effort cleanup
--   * idempotent: alreadyDeleted=true when the row is already gone
--   * RBAC enforced inside the function via p_admin_id
--   * audit_logs entry preserved
--
-- NOT YET APPLIED to any environment. Rollout order: 017 -> 018 ->
-- 019 -> 020 (each in its own transaction; see
-- supabase/verify-rollout-017-018-019.sql and
-- DEPLOYMENT_OPERATIONS.md §9/§10).
-- =============================================================

CREATE OR REPLACE FUNCTION admin_delete_topup(p_topup_id UUID, p_admin_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_topup topups%ROWTYPE;
  v_storage TEXT[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;

  SELECT * INTO v_topup FROM topups WHERE id = p_topup_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('alreadyDeleted', true, 'topupId', p_topup_id);
  END IF;

  SELECT COALESCE(ARRAY_AGG(s) FILTER (WHERE s IS NOT NULL), '{}'::TEXT[]) INTO v_storage
  FROM (SELECT regexp_replace(v_topup.screenshot_url, '^.*/storage/v1/object/(public/)?payments/', '') AS s) t
  WHERE v_topup.screenshot_url IS NOT NULL;

  -- RETAIN approved_utrs: the consumed-UTR ledger row stays so this bank
  -- transaction reference can never be approved a second time (see header).
  DELETE FROM topups WHERE id = p_topup_id;

  INSERT INTO audit_logs (actor_id, actor_role, action, target_id, target_type, metadata, created_at)
  VALUES (p_admin_id, 'admin', 'delete_topup', p_topup_id, 'topup',
          jsonb_build_object('deleted', true), NOW());

  RETURN jsonb_build_object('deleted', true, 'topupId', p_topup_id, 'storagePaths', COALESCE(v_storage, '{}'::TEXT[]));
END;
$$;

-- Same hardening as 014/018: never reachable from anon/authenticated
-- PostgREST. CREATE OR REPLACE preserves the existing ACL, but this
-- keeps the migration self-contained (defense in depth).
REVOKE EXECUTE ON FUNCTION public.admin_delete_topup(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_topup(UUID, UUID)
  TO service_role;
