-- Migration 012: Top-up payment-request hardening + wallet idempotency.
--
-- Brings top-ups to the same server-authoritative standard as membership
-- payments (migration 011) WITHOUT touching the shared verification engine:
--
-- topups:
--   expires_at      – immutable 30-minute window deadline (server-generated)
--   receiver_upi    – the UPI ID this top-up was created for (server value)
--   screenshot_hash – sha256 of proof image (duplicate-proof rule, mirrors payments)
--   payment_type    – always 'TOPUP' (explicit server-side payment type)
-- payments:
--   payment_type    – always 'MEMBERSHIP' (explicit server-side payment type)
--
-- wallet_transactions:
--   partial UNIQUE (user_id, reference_type, reference_id) WHERE
--   reference_id IS NOT NULL — makes double-crediting the same reference
--   impossible at the database level (concurrency backstop for the
--   application-level idempotency guards).
--
-- All changes are ADDITIVE. No rows are deleted. No statuses changed.
-- Pre-checked on production: zero duplicate (user, type, ref) groups exist.

-- 1. New columns on topups
ALTER TABLE topups ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE topups ADD COLUMN IF NOT EXISTS receiver_upi VARCHAR(255);
ALTER TABLE topups ADD COLUMN IF NOT EXISTS screenshot_hash TEXT;
ALTER TABLE topups ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'TOPUP';

-- 2. Backfill existing top-up rows (status/amount/UTR data untouched)
UPDATE topups
SET
  expires_at = created_at + INTERVAL '30 minutes',
  receiver_upi = 'jayarajj126-3@okicici',
  payment_type = 'TOPUP'
WHERE expires_at IS NULL;

-- 3. Explicit payment type on membership payments
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type TEXT DEFAULT 'MEMBERSHIP';

UPDATE payments
SET payment_type = 'MEMBERSHIP'
WHERE payment_type IS NULL;

-- 4. Index for the stale-top-up cleanup sweep (pending-like statuses only)
CREATE INDEX IF NOT EXISTS idx_topups_expires_at ON topups(expires_at)
  WHERE status IN ('created', 'payment_pending');

-- 5. Duplicate-proof hash index on topups (mirrors payments)
CREATE INDEX IF NOT EXISTS idx_topups_screenshot_hash
  ON topups (screenshot_hash);

-- 6. Wallet idempotency backstop: one ledger row per (user, type, reference)
--    NULL reference_ids (ad-hoc/manual entries) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_tx_idempotency
  ON wallet_transactions (user_id, reference_type, reference_id)
  WHERE reference_id IS NOT NULL;
