-- Migration 017: payment_verifications — per-attempt verification history.
--
-- Every automated validation attempt (registration payment OR top-up) is
-- recorded here as an immutable audit row: the engine decision, the outcome
-- status (APPROVED / REJECTED / PENDING_VERIFICATION / MANUAL_REVIEW), the
-- individual check results, the extracted fields, the provider verification
-- response and the acting actor (user / system / admin).
--
-- The live payment state stays on payments / topups (guarded status updates
-- remain the concurrency-safe source of truth). This table is append-only
-- history for the admin dashboard's "verification history" panel and for
-- forensic review of disputed payments.

CREATE TABLE IF NOT EXISTS payment_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_type TEXT NOT NULL CHECK (reference_type IN ('payment', 'topup')),
  reference_id TEXT NOT NULL,
  engine TEXT,
  status TEXT NOT NULL CHECK (status IN ('APPROVED', 'REJECTED', 'PENDING_VERIFICATION', 'MANUAL_REVIEW')),
  decision TEXT,
  reason_code TEXT,
  checks JSONB,
  extracted_data JSONB,
  ocr_confidence NUMERIC,
  transaction_id TEXT,
  provider JSONB,
  actor_id UUID,
  actor_role TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Fast per-record history lookups from the admin detail modal.
CREATE INDEX IF NOT EXISTS idx_payment_verifications_reference
  ON payment_verifications (reference_type, reference_id, created_at DESC);

-- Search by extracted transaction reference across attempts.
CREATE INDEX IF NOT EXISTS idx_payment_verifications_transaction_id
  ON payment_verifications (transaction_id)
  WHERE transaction_id IS NOT NULL AND transaction_id != '';

-- Service-role only access path (mirrors the rest of the schema: the API
-- always connects with the service-role key; no anon/user-facing RLS policy
-- is granted for this table).
ALTER TABLE payment_verifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'payment_verifications'
  ) THEN
    -- No policies: only the service role (bypasses RLS) can read/write.
    NULL;
  END IF;
END $$;
