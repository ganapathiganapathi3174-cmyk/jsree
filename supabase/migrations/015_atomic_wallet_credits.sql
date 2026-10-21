-- Apply wallet balance changes and their ledger rows in one transaction.
-- Top-up sender/receiver credits are passed together so neither side can be
-- credited if the other ledger write fails.

CREATE OR REPLACE FUNCTION public.credit_wallets_atomic(p_credits JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry JSONB;
  v_user_id UUID;
  v_amount NUMERIC(10, 2);
  v_reference_id UUID;
  v_reference_type TEXT;
  v_balance NUMERIC(10, 2);
  v_existing wallet_transactions%ROWTYPE;
  v_transaction wallet_transactions%ROWTYPE;
  v_results JSONB := '[]'::JSONB;
BEGIN
  IF p_credits IS NULL OR jsonb_typeof(p_credits) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'INVALID_WALLET_CREDITS';
  END IF;
  IF jsonb_array_length(p_credits) = 0 THEN
    RAISE EXCEPTION 'INVALID_WALLET_CREDITS';
  END IF;

  FOR v_user_id IN
    SELECT DISTINCT (entry->>'user_id')::UUID
    FROM jsonb_array_elements(p_credits) AS items(entry)
    ORDER BY 1
  LOOP
    PERFORM 1 FROM users WHERE id = v_user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WALLET_USER_NOT_FOUND';
    END IF;
  END LOOP;

  FOR v_entry IN
    SELECT value
    FROM jsonb_array_elements(p_credits) WITH ORDINALITY AS items(value, position)
    ORDER BY position
  LOOP
    v_user_id := (v_entry->>'user_id')::UUID;
    v_amount := (v_entry->>'amount')::NUMERIC(10, 2);
    v_reference_id := NULLIF(v_entry->>'reference_id', '')::UUID;
    v_reference_type := NULLIF(v_entry->>'reference_type', '');

    IF v_amount IS NULL OR v_amount <= 0
       OR NULLIF(v_entry->>'description', '') IS NULL
       OR ((v_reference_id IS NULL) <> (v_reference_type IS NULL)) THEN
      RAISE EXCEPTION 'INVALID_WALLET_CREDIT';
    END IF;

    IF v_reference_id IS NOT NULL THEN
      SELECT * INTO v_existing
      FROM wallet_transactions
      WHERE user_id = v_user_id
        AND reference_type = v_reference_type
        AND reference_id = v_reference_id
      LIMIT 1;

      IF FOUND THEN
        SELECT wallet_balance INTO v_balance FROM users WHERE id = v_user_id;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'transaction', to_jsonb(v_existing),
          'newBalance', v_balance,
          'credited', FALSE
        ));
        CONTINUE;
      END IF;
    END IF;

    UPDATE users
    SET wallet_balance = COALESCE(wallet_balance, 0) + v_amount
    WHERE id = v_user_id
    RETURNING wallet_balance INTO v_balance;

    INSERT INTO wallet_transactions (
      user_id, type, amount, description, reference_id, reference_type, balance_after
    ) VALUES (
      v_user_id, 'credit', v_amount, v_entry->>'description',
      v_reference_id, v_reference_type, v_balance
    )
    RETURNING * INTO v_transaction;

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'transaction', to_jsonb(v_transaction),
      'newBalance', v_balance,
      'credited', TRUE
    ));
  END LOOP;

  RETURN jsonb_build_object('results', v_results);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.credit_wallets_atomic(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallets_atomic(JSONB)
  TO service_role;
