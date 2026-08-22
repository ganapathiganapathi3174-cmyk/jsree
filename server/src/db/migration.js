import pg from 'pg';

/**
 * One-time startup migration: adds 'approved' to the topups status CHECK
 * constraint. Required by the two-phase claim flow.
 *
 * Idempotent: uses DROP IF EXISTS + ADD CONSTRAINT, safe on every startup.
 * Only runs if DATABASE_URL is available (Railway production).
 */
export async function ensureTopupApprovedStatus() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log('[migration] DATABASE_URL not set, skipping topup constraint check');
    return;
  }

  const client = new pg.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const { rows } = await client.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'topups_status_check'`
    );

    const currentDef = rows[0]?.def || '';
    if (currentDef.includes("'approved'")) {
      console.log('[migration] topups approved status constraint already OK');
      return;
    }

    console.log('[migration] Adding approved status to topups constraint...');
    await client.query(`ALTER TABLE topups DROP CONSTRAINT IF EXISTS topups_status_check;`);
    await client.query(`
      ALTER TABLE topups ADD CONSTRAINT topups_status_check
        CHECK (status IN ('created', 'payment_pending', 'proof_submitted', 'verification_pending', 'approved', 'completed', 'rejected', 'manual_review'));
    `);
    console.log('[migration] topups approved status constraint updated successfully');
  } catch (e) {
    console.error('[migration] Failed to update topups constraint:', e.message);
    console.error('[migration] Please apply supabase/migrations/010_add_approved_status_to_topups.sql manually');
  } finally {
    await client.end().catch(() => {});
  }
}
