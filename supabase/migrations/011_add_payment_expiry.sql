-- Migration 011: Add payment request expiry, receiver_upi tracking, and config table
--
-- Adds three columns to `payments`:
--   expires_at              – immutable 30-minute window deadline
--   receiver_upi            – the UPI ID this payment was created for
--   payment_request_created_at – server timestamp when the request was created
--
-- Also creates a `payment_config` table for admin-configurable settings.
-- All changes are ADDITIVE; existing columns and behavior are untouched.

-- 1. Add columns to payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS receiver_upi VARCHAR(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_request_created_at TIMESTAMPTZ;

-- 2. Backfill existing rows with sensible defaults.
--    payment_request_created_at = created_at,
--    expires_at = created_at + 30 minutes,
--    receiver_upi = the payment's own upi_id (falls back to the
--    current receiver UPI only if upi_id is somehow NULL).
--    No status, amount, UTR, or verification data is touched.
UPDATE payments
SET
  payment_request_created_at = created_at,
  expires_at = created_at + INTERVAL '30 minutes',
  receiver_upi = COALESCE(upi_id, 'jayarajj126-3@okicici')
WHERE expires_at IS NULL;

-- 3. Create index for auto-expiry background job (find stale pending payments)
CREATE INDEX IF NOT EXISTS idx_payments_expires_at ON payments(expires_at)
  WHERE status = 'pending';

-- 4. Create payment_config table for admin-configurable settings
CREATE TABLE IF NOT EXISTS payment_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key VARCHAR(100) NOT NULL UNIQUE,
  value JSONB NOT NULL,
  description TEXT,
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Auto-update updated_at on payment_config
--    (DROP first so the migration is safely re-runnable.)
DROP TRIGGER IF EXISTS update_payment_config_updated_at ON payment_config;
CREATE TRIGGER update_payment_config_updated_at
  BEFORE UPDATE ON payment_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 6. Seed default configuration
INSERT INTO payment_config (key, value, description) VALUES
  ('receiver_upi', '"jayarajj126-3@okicici"', 'UPI ID for receiving payments'),
  ('payment_window_minutes', '30', 'Payment request validity window in minutes'),
  ('min_ocr_confidence', '55', 'Minimum OCR confidence for auto-approval'),
  ('plans', '{"120": 120, "500": 500, "1000": 1000}', 'Available payment plans (months: amount)')
ON CONFLICT (key) DO NOTHING;

-- 7. Index for payment_config
CREATE INDEX IF NOT EXISTS idx_payment_config_key ON payment_config(key);
