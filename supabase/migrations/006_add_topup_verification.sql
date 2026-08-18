-- =============================================================
-- 006_add_topup_verification.sql
-- Adds OCR verification result storage to top-ups (mirrors payments).
-- The verification_result / verified_at columns only store history —
-- UTR / transaction_id is NOT used as a decision gate or idempotency
-- key anywhere. Idempotency for balance credit is enforced by the
-- top-up record status transition in application code.
-- =============================================================

ALTER TABLE topups
  ADD COLUMN IF NOT EXISTS verification_result JSONB,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE;