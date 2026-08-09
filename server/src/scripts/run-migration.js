import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyTables() {
  console.log('\nVerifying tables...');
  
  const tablesToCheck = [
    'users', 'payments', 'referrals', 'topups',
    'plan_change_requests', 'conversations', 'messages', 'audit_logs',
    'notifications', 'wallet_transactions', 'referral_tiers', 'ip_logs', 'suspicious_activity'
  ];
  
  for (const table of tablesToCheck) {
    const { data, error } = await supabase.from(table).select('id').limit(1);
    if (error) {
      console.log(`  ✗ ${table}: ${error.message}`);
    } else {
      console.log(`  ✓ ${table}: exists`);
    }
  }
}

async function createStorageBucket() {
  console.log('\nCreating storage bucket...');
  
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  
  if (listError) {
    console.log('Cannot list buckets:', listError.message);
    return false;
  }
  
  const existingBucket = buckets?.find(b => b.name === 'payments');
  if (existingBucket) {
    console.log('  ✓ Bucket "payments" already exists');
    return true;
  }
  
  const { data, error } = await supabase.storage.createBucket('payments', {
    public: true,
    allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
    fileSizeLimit: 5242880
  });
  
  if (error) {
    console.log('  ✗ Failed to create bucket:', error.message);
    return false;
  }
  
  console.log('  ✓ Bucket "payments" created successfully');
  return true;
}

async function main() {
  try {
    console.log('=== ReferralHub Migration Runner ===\n');
    
    const migrationFile = process.argv[2] || '002_add_features.sql';
    const sqlPath = join(__dirname, `../../../supabase/migrations/${migrationFile}`);
    
    console.log(`Migration file: ${migrationFile}`);
    console.log(`Path: ${sqlPath}\n`);
    
    const sql = readFileSync(sqlPath, 'utf-8');
    console.log('SQL to execute:');
    console.log('─'.repeat(60));
    console.log(sql);
    console.log('─'.repeat(60));
    console.log('\n⚠️  Copy the SQL above and run it in Supabase Dashboard SQL Editor:');
    console.log('   https://supabase.com/dashboard/project/vuwtxdtfkacndedsaroi/sql/new\n');
    
    await verifyTables();
    await createStorageBucket();
    
    console.log('\n=== Verification Complete ===');
  } catch (err) {
    console.error('Error:', err.message);
  }
}

main();
