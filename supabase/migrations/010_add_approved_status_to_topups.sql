-- =============================================================
-- 010_add_approved_status_to_topups.sql
--
-- Adds 'approved' to the topups status CHECK constraint.
-- Required by the two-phase claim flow: sender payment verified →
-- 'approved' → sponsor claims → 'completed'.
-- The 'approved' status was missing from the original constraint,
-- causing all OCR-approved top-ups to fail with a constraint
-- violation ("Failed to complete topup").
-- =============================================================

DO $$
BEGIN
  ALTER TABLE topups DROP CONSTRAINT IF EXISTS topups_status_check;
  ALTER TABLE topups ADD CONSTRAINT topups_status_check
    CHECK (status IN ('created', 'payment_pending', 'proof_submitted', 'verification_pending', 'approved', 'completed', 'rejected', 'manual_review'));
END $$;
