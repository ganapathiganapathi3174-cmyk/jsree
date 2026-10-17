-- Migration 013: Add recipient (payee) name to payment_config
--
-- Adds a new ADMIN-CONFIGURABLE key, `receiver_name`, used as a SECONDARY
-- identity check in the shared OCR verification engine (payments AND top-ups):
-- the detected payee name on the screenshot is compared against this value,
-- in addition to the primary receiver-UPI match.
--
-- Behaviour when the value is EMPTY: the engine fails SAFE — the payment is
-- routed to manual_review, never auto-approved. An administrator should set
-- this to the real name shown on the receiving UPI app (e.g. the account
-- holder name) through the admin Settings page.
--
-- This table is key/value, so no schema change is needed. The row is seeded
-- with an empty JSON string so the key exists and is editable. The value is
-- NOT hardcoded to any real person; it must be set per deployment.
--
-- All changes are ADDITIVE and idempotent; no existing config is overwritten.

INSERT INTO payment_config (key, value, description) VALUES
  ('receiver_name', '""', 'Expected recipient (payee) name on payment screenshots; empty disables auto-approval (manual review)')
ON CONFLICT (key) DO NOTHING;
