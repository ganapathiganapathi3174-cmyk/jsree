import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const projectRef = process.env.SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');

  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, read)',
    'CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_id ON wallet_transactions(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_ip_logs_user_id ON ip_logs(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_ip_logs_ip ON ip_logs(ip_address)',
    'CREATE INDEX IF NOT EXISTS idx_ip_logs_event ON ip_logs(event_type)',
    'CREATE INDEX IF NOT EXISTS idx_suspicious_user ON suspicious_activity(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_suspicious_ip ON suspicious_activity(ip_address)',
    'CREATE INDEX IF NOT EXISTS idx_suspicious_resolved ON suspicious_activity(resolved)',
  ];

  console.log('Creating indexes via Management API...\n');
  
  for (let i = 0; i < indexes.length; i++) {
    const idx = indexes[i];
    try {
      const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: idx })
      });
      console.log(`[${i+1}/${indexes.length}] ${response.ok ? 'OK' : 'FAIL (' + response.status + ')'}: ${idx.substring(0, 60)}`);
    } catch (e) {
      console.log(`[${i+1}/${indexes.length}] ERROR: ${e.message}`);
    }
  }

  // Verify tier data
  console.log('\n--- Checking referral tiers ---');
  const { data: tiers, error: tErr } = await supabase.from('referral_tiers').select('*').order('min_referrals');
  if (tErr) {
    console.log('Error:', tErr.message);
  } else {
    console.log('Tiers:', JSON.stringify(tiers, null, 2));
  }

  // Check user columns
  console.log('\n--- Checking user columns ---');
  const { data: users, error: uErr } = await supabase.from('users').select('id, wallet_balance, referral_tier').limit(1);
  if (uErr) {
    console.log('wallet_balance/referral_tier columns:', uErr.message);
  } else {
    console.log('Columns exist. Sample:', JSON.stringify(users));
  }

  // Final table verification
  console.log('\n--- Final table verification ---');
  const allTables = [
    'users', 'payments', 'referrals', 'topups',
    'plan_change_requests', 'conversations', 'messages', 'audit_logs',
    'notifications', 'wallet_transactions', 'referral_tiers', 'ip_logs', 'suspicious_activity'
  ];
  for (const t of allTables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    console.log(`  ${t}: ${error ? 'ERROR: ' + error.message.substring(0, 50) : count + ' rows'}`);
  }
}

main().catch(console.error);
