import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envCandidates = [
  join(__dirname, '../../.env'),
  join(__dirname, '../../../referral-platform/server/.env'),
];
const envPath = envCandidates.find((p) => existsSync(p));
if (!envPath) {
  console.error('No .env found. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
dotenv.config({ path: envPath });

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const confirmed = process.argv.includes('--yes');
if (!confirmed) {
  console.error('Refusing to run. This PERMANENTLY deletes every non-admin user.');
  console.error('Re-run with: node src/scripts/delete-all-users.js --yes');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const BATCH = 50;
const STORAGE_BUCKET = 'payments';

async function removeStorage(paths) {
  const clean = [...new Set(paths.filter((p) => typeof p === 'string' && p.length > 0))];
  for (let i = 0; i < clean.length; i += 100) {
    const chunk = clean.slice(i, i + 100);
    const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(chunk);
    if (error) {
      console.warn(`  storage cleanup warning: ${error.message}`);
    }
  }
  return clean.length;
}

async function main() {
  console.log(`Target: ${SUPABASE_URL}`);
  console.log(`Env:    ${envPath}\n`);

  const { data: admin, error: adminError } = await supabase
    .from('users')
    .select('id, email')
    .eq('role', 'admin')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (adminError) throw new Error(`Failed to load admin: ${adminError.message}`);
  if (!admin) throw new Error('No admin account found. Aborting so the site stays accessible.');

  console.log(`Acting admin: ${admin.email} (${admin.id})`);

  const { count: total, error: countError } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .neq('role', 'admin');
  if (countError) throw new Error(`Failed to count users: ${countError.message}`);

  console.log(`Non-admin users to delete: ${total}\n`);
  if (!total) {
    console.log('Nothing to delete.');
    return;
  }

  let deleted = 0;
  let failed = 0;
  let storageRemoved = 0;

  while (true) {
    const { data: users, error } = await supabase
      .from('users')
      .select('id, email')
      .neq('role', 'admin')
      .order('created_at', { ascending: true })
      .limit(BATCH);

    if (error) throw new Error(`Failed to fetch users: ${error.message}`);
    if (!users || users.length === 0) break;

    for (const user of users) {
      const { data, error: rpcError } = await supabase.rpc('admin_delete_user', {
        p_user_id: user.id,
        p_admin_id: admin.id,
      });

      if (rpcError) {
        failed += 1;
        console.error(`  FAILED ${user.email || user.id}: ${rpcError.message}`);
        continue;
      }

      deleted += 1;
      const paths = data?.storagePaths || [];
      if (paths.length) storageRemoved += await removeStorage(paths);
      console.log(`  deleted ${deleted}/${total} ${user.email || user.id}`);
    }
  }

  const { count: remaining } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .neq('role', 'admin');

  console.log('\n--- Done ---');
  console.log(`Deleted users:      ${deleted}`);
  console.log(`Failed:             ${failed}`);
  console.log(`Storage files:      ${storageRemoved}`);
  console.log(`Remaining non-admin: ${remaining ?? 'unknown'}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`\nAborted: ${err.message}`);
  process.exit(1);
});
