-- =============================================================
-- 009_admin_delete_operations.sql
-- Atomic admin deletion of a user (ALL user-owned records) and of a
-- single top-up.
--
-- SECURITY DEFINER functions run inside ONE transaction, so every
-- DELETE either commits together or rolls back together (no partial
-- deletion). RBAC is additionally enforced inside the function via
-- p_admin_id (role='admin') so the RPC is safe even if called outside
-- the Express admin route.
--
-- Storage objects are NOT deleted here (storage is a separate
-- subsystem). Each function returns the storage object paths that the
-- app should remove from bucket 'payments' AFTER the DB transaction
-- succeeds (best-effort, matching the existing deletePayment flow).
--
-- Wallet safety for top-up deletion: wallet_transactions rows that
-- reference this top-up (reference_type='topup', reference_id=topup)
-- are PRESERVED. They are user-owned accounting ledger records, not
-- top-up-owned data. Deleting them would leave an unexplained balance.
-- The wallet balance is NEVER modified by deletion. Only the top-up
-- row + its own verification artifacts (approved_utrs, screenshot)
-- are removed.
-- =============================================================

-- -----------------------------------------------------------------
-- admin_delete_user(p_user_id, p_admin_id)
-- Permanently deletes a non-admin user together with ALL of their
-- user-owned records: payments, top-ups (as sender OR receiver),
-- referrals, referral links from other users, conversations, messages,
-- notifications, wallet transactions, plan change requests, ip logs,
-- suspicious activity, audit records and approved-UTRs referencing
-- their payments/top-ups.
-- Returns JSON with storagePaths to clean up.
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_delete_user(p_user_id UUID, p_admin_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user users%ROWTYPE;
  v_storage TEXT[];
BEGIN
  -- Defense in depth: only an admin can invoke this.
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_admin_id AND role = 'admin') THEN
    RAISE EXCEPTION 'ADMIN_REQUIRED';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;
  IF v_user.role = 'admin' THEN
    RAISE EXCEPTION 'CANNOT_DELETE_ADMIN';
  END IF;

  -- Collect storage object paths (bucket 'payments') BEFORE deleting rows.
  SELECT COALESCE(ARRAY_AGG(s) FILTER (WHERE s IS NOT NULL), '{}'::TEXT[]) INTO v_storage
  FROM (
    SELECT regexp_replace(screenshot_url, '^.*/storage/v1/object/public/[^/]+/', '') AS s
    FROM payments WHERE user_id = p_user_id AND screenshot_url IS NOT NULL
    UNION ALL
    SELECT regexp_replace(screenshot_url, '^.*/storage/v1/object/public/[^/]+/', '') AS s
    FROM topups WHERE (sender_id = p_user_id OR receiver_id = p_user_id) AND screenshot_url IS NOT NULL
  ) t;

  -- User-owned records (child-first so FK RESTRICT constraints never fire).
  DELETE FROM approved_utrs WHERE reference_type = 'payment' AND reference_id IN (SELECT id FROM payments WHERE user_id = p_user_id);
  DELETE FROM approved_utrs WHERE reference_type = 'topup' AND reference_id IN (SELECT id FROM topups WHERE sender_id = p_user_id OR receiver_id = p_user_id);

  DELETE FROM messages WHERE sender_id = p_user_id;
  DELETE FROM conversations WHERE user_id = p_user_id;
  DELETE FROM notifications WHERE user_id = p_user_id;
  DELETE FROM wallet_transactions WHERE user_id = p_user_id;
  DELETE FROM ip_logs WHERE user_id = p_user_id;
  DELETE FROM suspicious_activity WHERE user_id = p_user_id;
  -- Records this user resolved belong to OTHER users: only clear the reference.
  UPDATE suspicious_activity SET resolved_by = NULL WHERE resolved_by = p_user_id;
  DELETE FROM plan_change_requests WHERE user_id = p_user_id;
  DELETE FROM referrals WHERE referrer_id = p_user_id OR referred_user_id = p_user_id;
  -- Other users that this user referred keep their accounts; drop the link.
  UPDATE users SET referred_by = NULL WHERE referred_by = p_user_id;
  DELETE FROM audit_logs WHERE actor_id = p_user_id;
  DELETE FROM topups WHERE sender_id = p_user_id OR receiver_id = p_user_id;
  DELETE FROM payments WHERE user_id = p_user_id;

  DELETE FROM users WHERE id = p_user_id;

  -- Preserve the required audit trail for the deletion itself.
  INSERT INTO audit_logs (actor_id, actor_role, action, target_id, target_type, metadata, created_at)
  VALUES (p_admin_id, 'admin', 'hard_delete_user', p_user_id, 'user',
          jsonb_build_object('deleted', true), NOW());

  RETURN jsonb_build_object('deleted', true, 'userId', p_user_id, 'storagePaths', COALESCE(v_storage, '{}'::TEXT[]));
END;
$$;

-- -----------------------------------------------------------------
-- admin_delete_topup(p_topup_id, p_admin_id)
-- Deletes a single top-up + its own verification artifacts.
-- Idempotent: returns alreadyDeleted=true if the top-up is already gone.
-- Wallet transactions / balances are NEVER touched (see header comment).
-- -----------------------------------------------------------------
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
  FROM (SELECT regexp_replace(v_topup.screenshot_url, '^.*/storage/v1/object/public/[^/]+/', '') AS s) t
  WHERE v_topup.screenshot_url IS NOT NULL;

  DELETE FROM approved_utrs WHERE reference_type = 'topup' AND reference_id = p_topup_id;
  DELETE FROM topups WHERE id = p_topup_id;

  INSERT INTO audit_logs (actor_id, actor_role, action, target_id, target_type, metadata, created_at)
  VALUES (p_admin_id, 'admin', 'delete_topup', p_topup_id, 'topup',
          jsonb_build_object('deleted', true), NOW());

  RETURN jsonb_build_object('deleted', true, 'topupId', p_topup_id, 'storagePaths', COALESCE(v_storage, '{}'::TEXT[]));
END;
$$;
