import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const sql = readFileSync(join(__dirname, '../../../supabase/migrations/002_add_features.sql'), 'utf-8');

  // Split into individual statements
  const statements = sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 10 && !s.startsWith('--'));

  console.log(`Found ${statements.length} SQL statements to execute\n`);

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    const preview = stmt.replace(/\n/g, ' ').substring(0, 70);
    
    // Try using the Supabase SQL API via fetch
    const projectRef = process.env.SUPABASE_URL.replace('https://', '').replace('.supabase.co', '');
    
    try {
      const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: stmt + ';' })
      });
      
      if (response.ok) {
        console.log(`[${i+1}/${statements.length}] OK: ${preview}...`);
      } else {
        const err = await response.text();
        console.log(`[${i+1}/${statements.length}] FAIL (${response.status}): ${preview}...`);
        console.log(`  Error: ${err.substring(0, 120)}`);
      }
    } catch (e) {
      console.log(`[${i+1}/${statements.length}] ERROR: ${e.message}`);
    }
  }

  // Verify tables
  console.log('\n--- Verifying tables ---');
  const tables = [
    'users', 'payments', 'referrals', 'topups',
    'plan_change_requests', 'conversations', 'messages', 'audit_logs',
    'notifications', 'wallet_transactions', 'referral_tiers', 'ip_logs', 'suspicious_activity'
  ];

  for (const t of tables) {
    const { error } = await supabase.from(t).select('id').limit(1);
    console.log(`  ${t}: ${error ? 'MISSING - ' + error.message.substring(0, 50) : 'EXISTS'}`);
  }
}

main().catch(console.error);
