-- Migration: Add unique constraint on transaction_id for UTR dedup
-- This prevents concurrent duplicate UTR approvals

-- Only add constraint for non-null transaction_id values
-- First, clean up any existing duplicates (keep the most recent)
WITH ranked AS (
  SELECT id, transaction_id,
    ROW_NUMBER() OVER (PARTITION BY transaction_id ORDER BY created_at DESC) as rn
  FROM payments
  WHERE transaction_id IS NOT NULL AND transaction_id != ''
)
DELETE FROM payments
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Now add the unique partial index
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_transaction_id_unique
  ON payments(transaction_id)
  WHERE transaction_id IS NOT NULL AND transaction_id != '';
