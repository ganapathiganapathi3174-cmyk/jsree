-- Migration 016: Payment Validation Engine — schema requirements audit.
--
-- This migration is intentionally a NO-OP: the centralized
-- paymentValidationEngine requires NO schema changes beyond what earlier
-- migrations already provide. It exists to document that audit and to fail
-- loudly if any prerequisite is missing from a database it is applied to.
--
-- Engine requirement -> covered by:
--   * UTR uniqueness across BOTH flows (registration payments + top-ups)
--       -> 007: approved_utrs table, utr VARCHAR(255) NOT NULL UNIQUE.
--          reserveApprovedUtr() relies on this for the atomic
--          INSERT ... ON CONFLICT gate (never SELECT-then-INSERT).
--   * Duplicate screenshot detection (same image may not back two
--     completed/approved records)
--       -> 008: payments.screenshot_hash + index
--       -> 012: topups.screenshot_hash + index
--   * Duplicate transaction reference lookups (engine pre-check reads
--     payments.transaction_id / topups.reference_id)
--       -> 001: both columns exist; transaction_id is only written for
--          APPROVED rows, reference_id holds the top-up UTR.
--   * Immutable 30-minute payment window (pre/post-OCR expiry gates)
--       -> 011: payments.expires_at (+ index)
--       -> 012: topups.expires_at (+ index)
--   * Atomic, idempotent wallet credits on top-up approval
--       -> 012: partial UNIQUE (user_id, reference_type, reference_id)
--       -> 015: atomic wallet-credit RPC
--   * Structured engine output (checks, audit log, timings)
--       -> 001/006: payments.verification_result JSONB,
--          topups.verification_result JSONB — the engine writes its full
--          result here; no additional metadata column is needed.
--   * manual_review status for both flows
--       -> 008: payments manual_review status support
--       -> 010: topups approved/manual_review status support
--
-- Guard: verify the two columns the engine's duplicate pre-check queries,
-- so an under-migrated database fails at migration time instead of silently
-- turning every duplicate check into an inconclusive DB error at runtime.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'transaction_id'
  ) THEN
    RAISE EXCEPTION 'payments.transaction_id is missing — run migrations 001-015 first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'topups' AND column_name = 'reference_id'
  ) THEN
    RAISE EXCEPTION 'topups.reference_id is missing — run migrations 001-015 first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'approved_utrs'
  ) THEN
    RAISE EXCEPTION 'approved_utrs is missing — run migration 007 first';
  END IF;
END $$;
