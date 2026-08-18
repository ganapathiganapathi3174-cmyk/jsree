-- Migration 007: Approved-UTR duplicate protection.
--
-- Business rule (shared by registration payments AND top-ups):
--   * The OCR decision stays: approved = upiMatch && amountMatch && dateValid.
--   * ADDITIONALLY, if a UTR was extracted from the screenshot, it must NOT
--     have been used by a PREVIOUSLY APPROVED payment or top-up. If it has,
--     the request is rejected with reason DUPLICATE_UTR and the user is NOT
--     activated / balance is NOT credited.
--   * UTRs from rejected/pending/failed/cancelled records never participate.
--   * Missing/unreadable UTRs are simply skipped (no duplicate check).
--   * Concurrency is protected by the UNIQUE(utr) constraint via
--     INSERT ... ON CONFLICT DO NOTHING in the shared reserveApprovedUtr()
--     helper (atomic insert-first, never SELECT-then-INSERT).
--
-- approved_utrs becomes the SINGLE arbiter for UTR uniqueness, so the old
-- broad unique index on payments(transaction_id) (migration 003) is dropped
-- below. transaction_id is only ever written for APPROVED payments anyway
-- (rejected rows store NULL), so the approved-only table fully supersedes it.

CREATE TABLE IF NOT EXISTS approved_utrs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  utr VARCHAR(255) NOT NULL UNIQUE,
  reference_type TEXT NOT NULL CHECK (reference_type IN ('payment', 'topup')),
  reference_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approved_utrs_reference ON approved_utrs(reference_id);

-- Backfill from existing APPROVED payments that carry a transaction_id
-- (kept as UTR history). Top-ups store the UTR inside verification_result.
INSERT INTO approved_utrs (utr, reference_type, reference_id)
SELECT DISTINCT ON (transaction_id) transaction_id, 'payment', id
FROM payments
WHERE status = 'approved'
  AND transaction_id IS NOT NULL
  AND transaction_id != ''
ON CONFLICT (utr) DO NOTHING;

INSERT INTO approved_utrs (utr, reference_type, reference_id)
SELECT verification_result->>'utr', 'topup', id
FROM topups
WHERE status = 'completed'
  AND verification_result IS NOT NULL
  AND verification_result->>'utr' IS NOT NULL
  AND verification_result->>'utr' != ''
ON CONFLICT (utr) DO NOTHING;

-- Drop the superseded broad unique index. approved_utrs now gates UTR
-- uniqueness across both flows (and only for approved records).
DROP INDEX IF EXISTS idx_payments_transaction_id_unique;
