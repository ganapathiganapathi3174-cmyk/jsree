-- =============================================================
-- 008_payment_review_and_screenshot_hash.sql
--
-- Adds the manual_review status to payments/topups and a
-- screenshot content-hash column to payments (duplicate-proof rule).
--
-- manual_review is a 4th verification decision: every security gate
-- (amount / receiver UPI) passed, but the evidence was not clean
-- enough to auto-approve (ambiguous date, low OCR confidence, or a
-- receipt whose wording suggests the transaction failed). Admin
-- approval/rejection completes it. Strong mismatches and confirmed
-- duplicate UTRs STILL reject immediately.
-- =============================================================

-- payments: allow status 'manual_review'
DO $$
BEGIN
  ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_status_check;
  ALTER TABLE payments ADD CONSTRAINT payments_status_check
    CHECK (status IN ('pending', 'processing', 'approved', 'rejected', 'manual_review'));
END $$;

-- payments: screenshot content hash + index (duplicate-proof detection)
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS screenshot_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_payments_screenshot_hash
  ON payments (screenshot_hash);

-- topups: allow status 'manual_review'
DO $$
BEGIN
  ALTER TABLE topups DROP CONSTRAINT IF EXISTS topups_status_check;
  ALTER TABLE topups ADD CONSTRAINT topups_status_check
    CHECK (status IN ('created', 'payment_pending', 'proof_submitted', 'verification_pending', 'completed', 'rejected', 'manual_review'));
END $$;