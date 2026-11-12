-- =============================================================
-- 018_complete_user_deletion.sql
-- Complete admin user deletion with financial-record retention.
--
-- Replaces admin_delete_user() with a hardened, single-transaction
-- (SECURITY DEFINER) implementation that:
--
--   1. Enforces RBAC inside the function (admin actor required).
--   2. Refuses to delete admin accounts (protected system accounts).
--   3. Refuses self-deletion (the currently authenticated admin).
--   4. ARCHIVES financial records (payments, top-ups, wallet ledger)
--      into deleted_user_financial_records BEFORE removing them, so
--      money-movement history is retained in anonymized form and never
--      silently destroyed. No names, emails, mobiles or screenshots are
--      copied into the archive.
--   5. RETAINS approved_utrs — the consumed-UTR ledger that prevents the
--      same bank transaction reference from ever being approved twice.
--      It contains no user PII and is not surfaced as active user data.
--   6. RETAINS payment_verifications — the append-only verification audit
--      history (RLS-enabled, service-role only).
--   7. Clears payment_config.updated_by so the users FK can never block
--      the deletion.
--   8. Deletes every remaining user-owned record child-first, then the
--      users row itself (audit_logs rows are PRESERVED with actor_id
--      detached), then writes the hard_delete_user audit entry — all
--      inside ONE transaction (no partial deletion possible).
--   9. Returns the storage object paths (bucket 'payments') for
--      post-commit best-effort storage cleanup by the application.
--
-- Everything is scoped to p_user_id: other users' rows are never
-- touched, other users' referral links are preserved (only the pointer
-- to the deleted user is cleared).
-- =============================================================

-- -----------------------------------------------------------------
-- Anonymized financial retention archive.
-- RLS enabled with NO policies: only the service role (which bypasses
-- RLS) can read or write. Never exposed through the public API.
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deleted_user_financial_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  record_type TEXT NOT NULL CHECK (record_type IN ('payment', 'topup', 'wallet_transaction')),
  record_id UUID NOT NULL,
  deleted_user_id UUID NOT NULL,
  counterparty_user_id UUID,
  utr TEXT,
  amount NUMERIC,
  status TEXT,
  plan INTEGER,
  wallet_type TEXT,
  reference_type TEXT,
  reference_id UUID,
  occurred_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_by UUID,
  UNIQUE (record_type, record_id)
);

ALTER TABLE deleted_user_financial_records ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_deleted_financial_records_deleted_user
  ON deleted_user_financial_records (deleted_user_id);
CREATE INDEX IF NOT EXISTS idx_deleted_financial_records_utr
  ON deleted_user_financial_records (utr) WHERE utr IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_deleted_financial_records_archived_at
  ON deleted_user_financial_records (archived_at);

-- -----------------------------------------------------------------
-- admin_delete_user(p_user_id, p_admin_id) — complete deletion
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
  v_archived_payments INT := 0;
  v_archived_topups INT := 0;
  v_archived_wallet INT := 0;
  v_audit_preserved INT := 0;
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
  IF p_user_id = p_admin_id THEN
    RAISE EXCEPTION 'CANNOT_DELETE_SELF';
  END IF;

  -- Collect storage object paths (bucket 'payments') BEFORE deleting rows.
  SELECT COALESCE(ARRAY_AGG(s) FILTER (WHERE s IS NOT NULL), '{}'::TEXT[]) INTO v_storage
  FROM (
    SELECT regexp_replace(screenshot_url, '^.*/storage/v1/object/(public/)?payments/', '') AS s
    FROM payments WHERE user_id = p_user_id AND screenshot_url IS NOT NULL
    UNION ALL
    SELECT regexp_replace(screenshot_url, '^.*/storage/v1/object/(public/)?payments/', '') AS s
    FROM topups WHERE (sender_id = p_user_id OR receiver_id = p_user_id) AND screenshot_url IS NOT NULL
  ) t;

  -- ── Financial retention: anonymized archive (same transaction) ──
  INSERT INTO deleted_user_financial_records
    (record_type, record_id, deleted_user_id, counterparty_user_id, utr, amount, status, plan, occurred_at, archived_by)
  SELECT 'payment', p.id, p.user_id, NULL, p.transaction_id, p.expected_amount, p.status, p.selected_plan, p.created_at, p_admin_id
  FROM payments p
  WHERE p.user_id = p_user_id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_archived_payments = ROW_COUNT;

  INSERT INTO deleted_user_financial_records
    (record_type, record_id, deleted_user_id, counterparty_user_id, utr, amount, status, plan, occurred_at, archived_by)
  SELECT 'topup', t.id, p_user_id,
         CASE WHEN t.sender_id = p_user_id THEN t.receiver_id ELSE t.sender_id END,
         t.reference_id, t.amount, t.status, t.plan, t.created_at, p_admin_id
  FROM topups t
  WHERE t.sender_id = p_user_id OR t.receiver_id = p_user_id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_archived_topups = ROW_COUNT;

  INSERT INTO deleted_user_financial_records
    (record_type, record_id, deleted_user_id, wallet_type, amount, reference_type, reference_id, occurred_at, archived_by)
  SELECT 'wallet_transaction', w.id, w.user_id, w.type, w.amount, w.reference_type, w.reference_id, w.created_at, p_admin_id
  FROM wallet_transactions w
  WHERE w.user_id = p_user_id
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_archived_wallet = ROW_COUNT;

  -- payment_config.updated_by references users(id) with NO ACTION: clear it
  -- so a config editor can never block their own account deletion.
  UPDATE payment_config SET updated_by = NULL WHERE updated_by = p_user_id;

  -- User-owned records (child-first so FK RESTRICT constraints never fire).
  -- approved_utrs is DELIBERATELY NOT deleted: it is the consumed-UTR fraud
  -- ledger (no PII) that stops one bank transaction being spent twice.
  -- payment_verifications is DELIBERATELY NOT deleted: append-only audit.
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
  -- PRESERVE audit history: detach the actor pointer (the users FK is
  -- NO ACTION) but keep every audit row — actions, targets, metadata and
  -- timestamps are financial/regulatory evidence and are never destroyed.
  UPDATE audit_logs SET actor_id = NULL WHERE actor_id = p_user_id;
  GET DIAGNOSTICS v_audit_preserved = ROW_COUNT;
  DELETE FROM topups WHERE sender_id = p_user_id OR receiver_id = p_user_id;
  DELETE FROM payments WHERE user_id = p_user_id;

  DELETE FROM users WHERE id = p_user_id;

  -- Preserve the required audit trail for the deletion itself.
  INSERT INTO audit_logs (actor_id, actor_role, action, target_id, target_type, metadata, created_at)
  VALUES (p_admin_id, 'admin', 'hard_delete_user', p_user_id, 'user',
          jsonb_build_object(
            'deleted', true,
            'archivedPayments', v_archived_payments,
            'archivedTopups', v_archived_topups,
            'archivedWalletTransactions', v_archived_wallet,
            'retainedApprovedUtrs', true,
            'retainedPaymentVerifications', true,
            'auditLogsPreserved', v_audit_preserved
          ), NOW());

  RETURN jsonb_build_object(
    'deleted', true,
    'userId', p_user_id,
    'storagePaths', COALESCE(v_storage, '{}'::TEXT[]),
    'auditLogsPreserved', v_audit_preserved,
    'archived', jsonb_build_object(
      'payments', v_archived_payments,
      'topups', v_archived_topups,
      'walletTransactions', v_archived_wallet
    )
  );
END;
$$;

-- Same hardening as 014: never reachable from anon/authenticated PostgREST.
REVOKE EXECUTE ON FUNCTION public.admin_delete_user(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_user(UUID, UUID)
  TO service_role;
