import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('Cleaning up test data...\n');

  const testEmails = ['test1@example.com', 'test2@example.com', 'test3@example.com', 'test4@example.com'];
  const { data: users } = await supabase.from('users').select('id').in('email', testEmails);

  if (!users || users.length === 0) {
    console.log('No test users found. Nothing to clean.');
    return;
  }

  const userIds = users.map(u => u.id);
  console.log(`Found ${userIds.length} test users\n`);

  // Delete in dependency order - audit_logs first (has actor_id FK)
  const { error: aErr } = await supabase.from('audit_logs').delete().in('actor_id', userIds);
  console.log(`  audit_logs: ${aErr ? 'skip - ' + aErr.message.substring(0, 50) : 'cleared'}`);

  const { error: mErr } = await supabase.from('messages').delete().in('sender_id', userIds);
  console.log(`  messages: ${mErr ? 'skip - ' + mErr.message.substring(0, 50) : 'cleared'}`);

  const { error: cErr } = await supabase.from('conversations').delete().in('user_id', userIds);
  console.log(`  conversations: ${cErr ? 'skip - ' + cErr.message.substring(0, 50) : 'cleared'}`);

  const { error: nErr } = await supabase.from('notifications').delete().in('user_id', userIds);
  console.log(`  notifications: ${nErr ? 'skip - ' + nErr.message.substring(0, 50) : 'cleared'}`);

  const { error: wErr } = await supabase.from('wallet_transactions').delete().in('user_id', userIds);
  console.log(`  wallet_transactions: ${wErr ? 'skip - ' + wErr.message.substring(0, 50) : 'cleared'}`);

  const { error: iErr } = await supabase.from('ip_logs').delete().in('user_id', userIds);
  console.log(`  ip_logs: ${iErr ? 'skip - ' + iErr.message.substring(0, 50) : 'cleared'}`);

  const { error: sErr } = await supabase.from('suspicious_activity').delete().in('user_id', userIds);
  console.log(`  suspicious_activity: ${sErr ? 'skip - ' + sErr.message.substring(0, 50) : 'cleared'}`);

  const { error: pcErr } = await supabase.from('plan_change_requests').delete().in('user_id', userIds);
  console.log(`  plan_change_requests: ${pcErr ? 'skip' : 'cleared'}`);

  const { error: tErr } = await supabase.from('topups').delete().eq('sender_id', userIds[0]);
  console.log(`  topups (sender): ${tErr ? 'skip' : 'cleared'}`);
  const { error: tErr2 } = await supabase.from('topups').delete().eq('receiver_id', userIds[0]);
  console.log(`  topups (receiver): ${tErr2 ? 'skip' : 'cleared'}`);

  const { error: rErr } = await supabase.from('referrals').delete().in('referrer_id', userIds);
  console.log(`  referrals (referrer): ${rErr ? 'skip - ' + rErr.message.substring(0, 40) : 'cleared'}`);
  const { error: rErr2 } = await supabase.from('referrals').delete().in('referred_user_id', userIds);
  console.log(`  referrals (referred): ${rErr2 ? 'skip - ' + rErr2.message.substring(0, 40) : 'cleared'}`);

  const { error: payErr } = await supabase.from('payments').delete().in('user_id', userIds);
  console.log(`  payments: ${payErr ? 'skip - ' + payErr.message.substring(0, 40) : 'cleared'}`);

  // Now delete users
  const { error: uErr } = await supabase.from('users').delete().in('id', userIds);
  console.log(`  users: ${uErr ? 'error - ' + uErr.message : 'deleted'}`);

  // Verify
  const { count } = await supabase.from('users').select('*', { count: 'exact', head: true });
  console.log(`\nRemaining users: ${count}`);
}

main().catch(console.error);
