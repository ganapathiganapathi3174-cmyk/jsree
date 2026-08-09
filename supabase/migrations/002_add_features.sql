-- Migration 002: Add notification, wallet, referral tiers, IP logging, audit enhancements

-- 1. NOTIFICATIONS TABLE
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('payment_approved','payment_rejected','plan_change_approved','plan_change_rejected','referral_activated','referral_deactivated','tier_upgrade','wallet_credit','wallet_debit','system','admin_reactivation')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, read);

-- 2. WALLET TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('credit','debit','refund')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  reference_id UUID,
  reference_type TEXT CHECK (reference_type IN ('payment','topup','plan_change','referral_bonus')),
  balance_after NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_wallet_tx_user_id ON wallet_transactions(user_id);

-- Add wallet_balance to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(10,2) DEFAULT 0;

-- 3. REFERRAL TIERS TABLE
CREATE TABLE IF NOT EXISTS referral_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  min_referrals INTEGER NOT NULL,
  bonus_percentage NUMERIC(5,2) NOT NULL,
  color TEXT DEFAULT '#6366f1',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default tiers
INSERT INTO referral_tiers (name, min_referrals, bonus_percentage, color) VALUES
  ('Bronze', 1, 5.00, '#cd7f32'),
  ('Silver', 3, 10.00, '#c0c0c0'),
  ('Gold', 5, 15.00, '#ffd700')
ON CONFLICT (name) DO NOTHING;

-- Add tier to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_tier TEXT DEFAULT 'Bronze';

-- 4. IP LOGGING TABLE
CREATE TABLE IF NOT EXISTS ip_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ip_address TEXT NOT NULL,
  user_agent TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('login','register','payment','password_change','admin_action')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ip_logs_user_id ON ip_logs(user_id);
CREATE INDEX idx_ip_logs_ip ON ip_logs(ip_address);
CREATE INDEX idx_ip_logs_event ON ip_logs(event_type);

-- 5. SUSPICIOUS ACTIVITY TABLE
CREATE TABLE IF NOT EXISTS suspicious_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ip_address TEXT NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('multiple_accounts_same_ip','rapid_payments','failed_login_attempts','unusual_location','bulk_referrals')),
  severity TEXT DEFAULT 'low' CHECK (severity IN ('low','medium','high','critical')),
  details JSONB DEFAULT '{}',
  resolved BOOLEAN DEFAULT FALSE,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_suspicious_user ON suspicious_activity(user_id);
CREATE INDEX idx_suspicious_ip ON suspicious_activity(ip_address);
CREATE INDEX idx_suspicious_resolved ON suspicious_activity(resolved);
