import { supabase } from '../db/supabase.js';

/**
 * One-time startup migration: adds 'approved' to the topups status CHECK
 * constraint via Supabase HTTP SQL API (bypasses direct PG connection issues).
 */
export async function ensureTopupApprovedStatus() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.log('[migration] Missing Supabase credentials, skipping');
    return;
  }

  try {
    const res = await fetch(`${supabaseUrl}/pg`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'topups_status_check'`
      }),
    });
    const data = await res.json();
    const currentDef = data?.[0]?.def || '';

    if (currentDef.includes("'approved'")) {
      console.log('[migration] topups approved status constraint already OK');
      return;
    }

    console.log('[migration] Adding approved status to topups constraint...');
    const mRes = await fetch(`${supabaseUrl}/pg`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          ALTER TABLE topups DROP CONSTRAINT IF EXISTS topups_status_check;
          ALTER TABLE topups ADD CONSTRAINT topups_status_check
            CHECK (status IN ('created', 'payment_pending', 'proof_submitted', 'verification_pending', 'approved', 'completed', 'rejected', 'manual_review'));
        `
      }),
    });
    if (!mRes.ok) {
      const err = await mRes.text();
      throw new Error(err);
    }
    console.log('[migration] topups approved status constraint updated successfully');
  } catch (e) {
    console.error('[migration] Failed to update topups constraint:', e.message);
    console.error('[migration] Please apply 010_add_approved_status_to_topups.sql via Supabase SQL Editor');
  }
}
