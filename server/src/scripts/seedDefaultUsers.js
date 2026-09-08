// ─────────────────────────────────────────────────────────────
// seedDefaultUsers.js — one-time/manual QA seed.
//
// Creates EXACTLY 3 active, normal-role QA accounts (plans 120/500/1000)
// using the EXISTING users table and the EXISTING bcrypt password
// mechanism. No payment rows, no notifications, no schema changes.
//
//   npm run seed:qa-users            (requires QA_SEED_PASSWORD env)
//
// Idempotent: accounts are keyed by fixed internal emails. Re-running
// reuses existing rows and only enforces the required default state
// (active + correct plan). Admin rows are never touched. Nothing runs
// on application startup.
// ─────────────────────────────────────────────────────────────
import 'dotenv/config';
import { supabase } from '../db/supabase.js';
import { hashPassword } from '../utils/helpers.js';

export const QA_USER_SPECS = [
  { plan: 120, email: 'qa.120@jsree.local', full_name: 'QA User 120', mobile: '9000000120', referral_code: 'QA120USR0' },
  { plan: 500, email: 'qa.500@jsree.local', full_name: 'QA User 500', mobile: '9000000500', referral_code: 'QA500USR0' },
  { plan: 1000, email: 'qa.1000@jsree.local', full_name: 'QA User 1000', mobile: '9000001000', referral_code: 'QA1000USR' },
];

export function getSeedPassword() {
  const pw = process.env.QA_SEED_PASSWORD;
  if (!pw || pw.length < 8) {
    throw new Error('QA_SEED_PASSWORD env (min 8 chars) is required. It is never committed or logged.');
  }
  return pw;
}

export async function seedDefaultUsers({ supabaseClient = supabase, password = getSeedPassword() } = {}) {
  const results = [];
  for (const spec of QA_USER_SPECS) {
    const { data: existing } = await supabaseClient
      .from('users')
      .select('id, email, role, status, current_plan')
      .eq('email', spec.email)
      .single();

    if (existing) {
      if (existing.role === 'admin') {
        throw new Error(`Refusing to touch admin row for ${spec.email}`);
      }
      // Reuse: enforce only the required default state. Password untouched.
      const { error } = await supabaseClient
        .from('users')
        .update({ status: 'active', current_plan: spec.plan })
        .eq('id', existing.id);
      if (error) throw new Error(`Failed to enforce QA state for ${spec.email}: ${error.message}`);
      results.push({ email: spec.email, plan: spec.plan, reused: true });
      continue;
    }

    const password_hash = await hashPassword(password);
    const { data: created, error } = await supabaseClient
      .from('users')
      .insert({
        email: spec.email,
        password_hash,
        full_name: spec.full_name,
        mobile: spec.mobile,
        role: 'user',
        status: 'active',
        current_plan: spec.plan,
        referral_code: spec.referral_code,
        referred_by: null,
      })
      .select('id, email')
      .single();
    if (error) throw new Error(`Failed to create ${spec.email}: ${error.message}`);
    results.push({ email: spec.email, plan: spec.plan, reused: false, id: created?.id || null });
  }
  return results;
}

// CLI entrypoint (no-op on import so tests can reuse the functions).
const isCli = process.argv[1] && process.argv[1].endsWith('seedDefaultUsers.js');
if (isCli) {
  seedDefaultUsers()
    .then((results) => {
      for (const r of results) console.log(`${r.reused ? 'REUSED' : 'CREATED'} ${r.email} plan=${r.plan} role=user status=active`);
      console.log(`Done: exactly ${results.length} QA accounts.`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(`SEED FAILED: ${e.message}`);
      process.exit(1);
    });
}
