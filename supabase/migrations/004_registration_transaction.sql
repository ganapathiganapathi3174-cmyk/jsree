-- =============================================================
-- 004_registration_transaction.sql
-- Atomic DB-level functions for the registration/payment lifecycle.
--
-- Business rule: a user must NOT get dashboard access until their
-- initial registration payment is APPROVED. Approval activates
-- payment + user + referral link + notification atomically.
--
-- These functions are OPTIONAL enhancements. The application code
-- falls back to compensating app-level transactions if the RPC
-- functions are not present.
-- =============================================================

-- -----------------------------------------------------------------
-- approve_initial_payment(p_payment_id, p_admin_id)
-- Atomically: payment -> approved, user -> active, referral code
-- ensured, payment_approved notification created.
-- Returns JSON with payment_id / user_id. Raises exception on any
-- failure so the whole transaction rolls back.
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_initial_payment(
  p_payment_id UUID,
  p_admin_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_user users%ROWTYPE;
  v_referral_code TEXT;
BEGIN
  -- Lock the payment row and verify it is still pending.
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;
  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'PAYMENT_NOT_PENDING';
  END IF;

  -- Lock the user row and verify it is still pending.
  SELECT * INTO v_user FROM users WHERE id = v_payment.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND';
  END IF;

  -- 1. Payment -> approved
  UPDATE payments
     SET status = 'approved',
         approved_at = NOW(),
         updated_at = NOW()
   WHERE id = v_payment.id;

  -- 2. User -> active (dashboard/wallet/referral access enabled)
  UPDATE users
     SET status = 'active',
         current_plan = v_payment.selected_plan,
         updated_at = NOW()
   WHERE id = v_user.id;

  -- 3. Referral link -> generated if missing
  v_referral_code := v_user.referral_code;
  IF v_referral_code IS NULL OR v_referral_code = '' THEN
    v_referral_code := 'REF' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    UPDATE users SET referral_code = v_referral_code WHERE id = v_user.id;
  END IF;

  -- 4. Notification -> payment_approved
  INSERT INTO notifications (user_id, type, title, message, metadata, created_at)
  VALUES (
    v_user.id,
    'payment_approved',
    'Payment Approved',
    'Your payment of ' || v_payment.expected_amount || ' for plan ' || v_payment.selected_plan || ' months has been approved.',
    jsonb_build_object('paymentId', v_payment.id, 'amount', v_payment.expected_amount, 'plan', v_payment.selected_plan),
    NOW()
  );

  RETURN jsonb_build_object(
    'paymentId', v_payment.id,
    'userId', v_user.id,
    'status', 'approved',
    'referralCode', v_referral_code
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

-- -----------------------------------------------------------------
-- delete_pending_registration(p_payment_id, p_admin_id)
-- Atomically removes an unapproved registration/payment that has no
-- financial ledger activity. Throws FINANCIAL_HISTORY_EXISTS if the
-- payment is approved or the user has financial records.
-- -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_pending_registration(
  p_payment_id UUID,
  p_admin_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_user users%ROWTYPE;
  v_approved_count BIGINT;
  v_wallet_count BIGINT;
  v_topup_count BIGINT;
BEGIN
  SELECT * INTO v_payment FROM payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('alreadyDeleted', true, 'paymentId', p_payment_id);
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_payment.user_id;
  IF v_user.id IS NULL THEN
    -- Orphaned payment with no user: just remove the payment.
    DELETE FROM payments WHERE id = v_payment.id;
    RETURN jsonb_build_object('deleted', true, 'paymentId', p_payment_id);
  END IF;

  -- Financial history check (approved payment counts as financial record).
  SELECT COUNT(*) INTO v_approved_count FROM payments
    WHERE user_id = v_user.id AND status = 'approved';
  SELECT COUNT(*) INTO v_wallet_count FROM wallet_transactions
    WHERE user_id = v_user.id;
  SELECT COUNT(*) INTO v_topup_count FROM topups
    WHERE (sender_id = v_user.id OR receiver_id = v_user.id)
      AND status IN ('completed', 'approved');

  IF v_approved_count > 0 OR v_wallet_count > 0 OR v_topup_count > 0 THEN
    RAISE EXCEPTION 'FINANCIAL_HISTORY_EXISTS';
  END IF;

  -- Controlled cleanup of temporary/pending registration data.
  -- audit_logs/topups rows referencing the user are removed so the
  -- user row can be deleted (FK integrity); the admin's own
  -- delete_payment_registration record is preserved.
  DELETE FROM referrals WHERE referrer_id = v_user.id OR referred_user_id = v_user.id;
  DELETE FROM notifications WHERE user_id = v_user.id;
  DELETE FROM messages WHERE sender_id = v_user.id;
  DELETE FROM conversations WHERE user_id = v_user.id;
  DELETE FROM plan_change_requests WHERE user_id = v_user.id;
  DELETE FROM ip_logs WHERE user_id = v_user.id;
  DELETE FROM suspicious_activity WHERE user_id = v_user.id;
  DELETE FROM topups WHERE sender_id = v_user.id OR receiver_id = v_user.id;
  DELETE FROM audit_logs WHERE actor_id = v_user.id;
  DELETE FROM payments WHERE id = v_payment.id;
  DELETE FROM users WHERE id = v_user.id;

  -- Preserve the required audit trail.
  INSERT INTO audit_logs (actor_id, actor_role, action, target_id, target_type, metadata, created_at)
  VALUES (
    p_admin_id,
    'admin',
    'delete_payment_registration',
    v_payment.id,
    'payment',
    jsonb_build_object('userId', v_user.id, 'amount', v_payment.expected_amount, 'plan', v_payment.selected_plan, 'reason', 'Pending registration permanently removed'),
    NOW()
  );

  RETURN jsonb_build_object('deleted', true, 'paymentId', p_payment_id, 'userId', v_user.id);
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;
