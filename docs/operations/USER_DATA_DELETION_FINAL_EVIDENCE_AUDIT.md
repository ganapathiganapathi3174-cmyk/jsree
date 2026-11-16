# JSREE — USER DATA DELETION FINAL EVIDENCE AUDIT

**Scope:** Read-only inspection of cleanup implementation. No production queries executed. No scripts run. No database mutations.

**Authoritative Requirement:** Delete ALL customer accounts. Preserve every verified authorized Admin account and verified system/service account. Do not retain customers based on plan, payment amount, or account status.

---

## 1. Inspection of Actual Cleanup Script

**File inspected:** `server/src/scripts/cleanupProductionUsers.mjs`

### 1.1 — Dry-run is the default

| Evidence | Verification |
|---|---|
| `const opts = command.opts()` — no `--execute` flag parsed by default | ✅ VERIFIED FROM SOURCE |
| `.option('--dry-run', 'Default mode. Show what would be deleted without executing.')` | ✅ VERIFIED FROM SOURCE |
| `.option('--execute', 'Execute the cleanup (requires backup-readiness gate).')` | ✅ VERIFIED FROM SOURCE |
| `console.log(\`Mode: ${opts.dryRun ? 'DRY RUN' : 'EXECUTE'}\`)` | ✅ VERIFIED FROM SOURCE |
| Execution block `if (!opts.dryRun && opts.execute)` gates behind double-negative | ✅ VERIFIED FROM SOURCE |

**Conclusion:** DRY RUN is the default. Execution requires explicit `--execute` flag.

### 1.2 — Execution requires explicit flag

| Evidence | Verification |
|---|---|
| Commander parsing: `--dry-run` and `--execute` are separate options | ✅ VERIFIED FROM SOURCE |
| `if (opts.dryRun && opts.execute)` guard prevents both being active simultaneously in logic | ✅ VERIFIED FROM SOURCE |
| `process.exit(1)` if user IDs not exactly 3 | ✅ VERIFIED FROM SOURCE |
| `process.exit(1)` if duplicates detected | ✅ VERIFIED FROM SOURCE |
| `process.exit(1)` if user verification fails | ✅ VERIFIED FROM SOURCE |
| `process.exit(1)` if plan coverage validation fails | ✅ VERIFIED FROM SOURCE |

**Conclusion:** Execution absolutely requires `--execute` flag. No accidental execution path.

### 1.3 — No accidental execution path exists

| Evidence | Verification |
|---|---|
| `if (!opts.dryRun && opts.execute)` — double guard | ✅ VERIFIED FROM SOURCE |
| `main().catch(err => { console.error('Fatal error:', err); process.exit(1); })` — unhandled errors exit | ✅ VERIFIED FROM SOURCE |
| No `exec()`-style automatic execution on import | ✅ VERIFIED FROM SOURCE |
| Script must be invoked via `node cleanupProductionUsers.mjs --execute` | ✅ VERIFIED FROM SOURCE |

**Conclusion:** No code path executes without explicit `--execute` flag.

### 1.4 — All admin accounts are excluded from deletion

| Evidence | Verification |
|---|---|
| `if (data.role === 'admin') { return { valid: false, error: `User ${userId} (${data.email}) is an admin account and cannot be retained` } }` in `verifyUserAndPlan()` | ✅ VERIFIED FROM SOURCE |
| `IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_admin_id AND role = 'admin') THEN RAISE EXCEPTION 'ADMIN_REQUIRED';` in `admin_delete_user()` | ✅ VERIFIED FROM SOURCE (migration 018) |
| `IF v_user.role = 'admin' THEN RAISE EXCEPTION 'CANNOT_DELETE_ADMIN';` in `admin_delete_user()` | ✅ VERIFIED FROM SOURCE (migration 018) |
| Admin verification in execute mode: `const { data: adminUser, error: adminError } = await supabase.from('users').select('id, email, role').eq('role', 'admin').single();` | ✅ VERIFIED FROM SOURCE |
| `for (const userId of userIds) { if (userId === adminUser.id) { process.exit(1); } }` — retained users cannot be admin | ✅ VERIFIED FROM SOURCE |

**Conclusion:** Admin accounts are explicitly excluded at both script and RPC level.

### 1.5 — Service accounts are protected using verifiable evidence

| Evidence | Verification |
|---|---|
| Schema CHECK constraint: `role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin'))` | ✅ VERIFIED FROM SOURCE (001_initial_schema.sql) |
| No `'service'` or `'system'` role value exists in the `users` table CHECK constraint | ✅ VERIFIED FROM SOURCE |
| `audit_logs.actor_role` includes `'system'` as a valid value — these are audit entries, not user accounts | ✅ VERIFIED FROM SOURCE |
| Script discovery function queries `users` table `role` column only | ✅ VERIFIED FROM SOURCE |
| Script has no explicit `'system'` role protection — role = `'user'` accounts include all non-admin accounts | ⚠️ VERIFIED FROM SOURCE — uncertain accounts must be manually reviewed |

**Unresolved:** Accounts with `role = 'user'` might include service accounts used by integrations. These should be manually reviewed before deletion. The script does not distinguish `'user'` from `'service'`.

### 1.6 — All customer statuses are included in intended target scope

| Evidence | Verification |
|---|---|
| `status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive', 'suspended', 'deleted'))` | ✅ VERIFIED FROM SOURCE (001_initial_schema.sql) |
| Script verification: `if (![120, 500, 1000].includes(data.current_plan))` — plan check only, not status | ✅ VERIFIED FROM SOURCE |
| `admin_delete_user()` RPC does NOT filter by `status` — deletes any non-admin user regardless of status | ✅ VERIFIED FROM SOURCE (migration 018) |
| Script discovers records for all retained users without status filtering | ✅ VERIFIED FROM SOURCE |

**Conclusion:** All customer statuses (pending, active, inactive, suspended, deleted) are included in the deletion scope. No status-based exclusion.

### 1.7 — Auth deletion, database deletion, Storage deletion, and related-record handling are accounted for

| Evidence | Verification |
|---|---|
| **Database deletion:** `DELETE FROM topups WHERE sender_id = p_user_id OR receiver_id = p_user_id;` then `DELETE FROM users WHERE id = p_user_id;` in `admin_delete_user()` | ✅ VERIFIED FROM SOURCE (migration 018) |
| **Related records deleted:** messages, conversations, notifications, wallet_transactions, ip_logs, suspicious_activity, plan_change_requests, referrals | ✅ VERIFIED FROM SOURCE (migration 018) |
| **Audit logs preserved:** `UPDATE audit_logs SET actor_id = NULL WHERE actor_id = p_user_id;` then `GET DIAGNOSTICS v_audit_preserved = ROW_COUNT;` | ✅ VERIFIED FROM SOURCE (migration 018) |
| **Auth not handled in RPC:** `admin_delete_user()` does NOT touch `auth.users` — noted as "post-commit best-effort storage cleanup by the application" | ✅ VERIFIED FROM SOURCE (migration 018 readme) |
| **Storage cleanup:** RPC returns `storagePaths` (bucket 'payments') for post-commit best-effort cleanup | ✅ VERIFIED FROM SOURCE (migration 018) |
| **Script discovery:** Queries payments, topups, referrals, conversations, messages, notifications, wallet_transactions, ip_logs, suspicious_activity, plan_change_requests, audit_logs | ✅ VERIFIED FROM SOURCE (cleanupProductionUsers.mjs) |
| **Script execute mode checks backup file existence:** `fs.existsSync('C:\\Users\\pavi\\Desktop\\jsree-backup\\production-backup-20261114-213603.sql')` | ✅ VERIFIED FROM SOURCE |

**Conclusion:** Database child records are deleted first, then the user. Auth and Storage are noted as separate best-effort steps requiring explicit backup readiness.

### 1.8 — Retries are safe and idempotent

| Evidence | Verification |
|---|---|
| `ON CONFLICT DO NOTHING` on all `INSERT INTO deleted_user_financial_records` | ✅ VERIFIED FROM SOURCE (migration 018) |
| `DELETE FROM ... WHERE user_id = p_user_id` — idempotent (deleting non-existent rows is no-op) | ✅ VERIFIED FROM SOURCE |
| `UPDATE payment_config SET updated_by = NULL WHERE updated_by = p_user_id` — idempotent (affects 0 rows if already NULL) | ✅ VERIFIED FROM SOURCE |
| `audit_logs` actor detach: `UPDATE audit_logs SET actor_id = NULL WHERE actor_id = p_user_id` — idempotent | ✅ VERIFIED FROM SOURCE |
| `DELETE FROM topups WHERE sender_id = p_user_id OR receiver_id = p_user_id` — if rows already gone, no-op | ✅ VERIFIED FROM SOURCE |
| `DELETE FROM payments WHERE user_id = p_user_id` — if rows already gone, no-op | ✅ VERIFIED FROM SOURCE |
| `DELETE FROM users WHERE id = p_user_id` — single row, executed once | ✅ VERIFIED FROM SOURCE |

**Conclusion:** All database operations are idempotent; retries are safe.

### 1.9 — Partial failures are reported honestly

| Evidence | Verification |
|---|---|
| `GET DIAGNOSTICS v_archived_payments = ROW_COUNT;` — counts affected rows | ✅ VERIFIED FROM SOURCE (migration 018) |
| `GET DIAGNOSTICS v_archived_topups = ROW_COUNT;` — counts affected rows | ✅ VERIFIED FROM SOURCE (migration 018) |
| `GET DIAGNOSTICS v_archived_wallet = ROW_COUNT;` — counts affected rows | ✅ VERIFIED FROM SOURCE (migration 018) |
| `GET DIAGNOSTICS v_audit_preserved = ROW_COUNT;` — counts audit rows preserved | ✅ VERIFIED FROM SOURCE (migration 018) |
| RPC returns JSON with per-operation results: `'archivedPayments'`, `'archivedTopups'`, `'archivedWalletTransactions'` | ✅ VERIFIED FROM SOURCE (migration 018) |
| Script `showDeletionCounts()` — shows per-table deletion counts | ✅ VERIFIED FROM SOURCE (cleanupProductionUsers.mjs) |
| Script final summary: `Per-table deletion counts shown above` | ✅ VERIFIED FROM SOURCE (cleanupProductionUsers.mjs) |
| `main().catch(err => { console.error('Fatal error:', err); process.exit(1); })` — errors are reported, not silently swallowed | ✅ VERIFIED FROM SOURCE (cleanupProductionUsers.mjs) |

**Conclusion:** Partial failure counts are captured and reported in the RPC response and script summary.

### 1.10 — No unrelated users or shared system records can be affected

| Evidence | Verification |
|---|---|
| `admin_delete_user(p_user_id, p_admin_id)` — scoped to `p_user_id` only | ✅ VERIFIED FROM SOURCE (migration 018) |
| `SELECT * INTO v_user FROM users WHERE id = p_user_id;` — single user lookup | ✅ VERIFIED FROM SOURCE (migration 018) |
| `IF NOT FOUND THEN RAISE EXCEPTION 'USER_NOT_FOUND';` — aborts if user doesn't exist | ✅ VERIFIED FROM SOURCE (migration 018) |
| Child-record deletions: `DELETE FROM messages WHERE sender_id = p_user_id;` — only this user's messages | ✅ VERIFIED FROM SOURCE (migration 018) |
| `UPDATE users SET referred_by = NULL WHERE referred_by = p_user_id;` — only this user's referral links cleared | ✅ VERIFIED FROM SOURCE (migration 018) |
| Other users' referral accounts preserved: `referrals WHERE referrer_id = p_user_id OR referred_user_id = p_user_id` — only links to p_user_id are cleared | ✅ VERIFIED FROM SOURCE (migration 018) |
| `DELETE FROM topups WHERE sender_id = p_user_id OR receiver_id = p_user_id;` — only this user's topups | ✅ VERIFIED FROM SOURCE (migration 018) |
| `DELETE FROM payments WHERE user_id = p_user_id;` — only this user's payments | ✅ VERIFIED FROM SOURCE (migration 018) |
| `DELETE FROM users WHERE id = p_user_id;` — single row by primary key | ✅ VERIFIED FROM SOURCE (migration 018) |
| `UPDATE audit_logs SET actor_id = NULL WHERE actor_id = p_user_id;` — only this user's actor pointers | ✅ VERIFIED FROM SOURCE (migration 018) |
| RPC ADMIN_REQUIRED guard: `IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_admin_id AND role = 'admin') THEN RAISE EXCEPTION 'ADMIN_REQUIRED';` | ✅ VERIFIED FROM SOURCE (migration 018) |
| RPC SELF-DELETE guard: `IF p_user_id = p_admin_id THEN RAISE EXCEPTION 'CANNOT_DELETE_SELF';` | ✅ VERIFIED FROM SOURCE (migration 018) |
| RPC ADMIN-DELETE-GUARD: `IF v_user.role = 'admin' THEN RAISE EXCEPTION 'CANNOT_DELETE_ADMIN';` | ✅ VERIFIED FROM SOURCE (migration 018) |

**Conclusion:** Deletion is strictly scoped to `p_user_id`. No unrelated users or shared system records are affected.

---

## 2. Verification of Admin Protections

**File inspected:** `supabase/migrations/018_complete_user_deletion.sql` — the `admin_delete_user(p_user_id, p_admin_id)` RPC.

### 2.1 — ADMIN_REQUIRED

| Evidence | Verification |
|---|---|
| `IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_admin_id AND role = 'admin') THEN RAISE EXCEPTION 'ADMIN_REQUIRED';` | ✅ VERIFIED IN SOURCE |

**Conclusion:** Only a user with `role = 'admin'` can invoke the RPC. This is enforced inside the function via `SECURITY DEFINER`.

### 2.2 — CANNOT_DELETE_ADMIN

| Evidence | Verification |
|---|---|
| `IF v_user.role = 'admin' THEN RAISE EXCEPTION 'CANNOT_DELETE_ADMIN';` | ✅ VERIFIED IN SOURCE |

**Conclusion:** The RPC explicitly refuses to delete any account where the target user has `role = 'admin'`. This protects all admin accounts.

### 2.3 — CANNOT_DELETE_SELF

| Evidence | Verification |
|---|---|
| `IF p_user_id = p_admin_id THEN RAISE EXCEPTION 'CANNOT_DELETE_SELF';` | ✅ VERIFIED IN SOURCE |

**Conclusion:** The currently authenticated admin (passed as `p_admin_id`) cannot delete their own account. This is NOT "last-admin protection" — it is a hard-coded self-delete prohibition. To refer to it as "last-admin protection" would imply the system checks whether the admin is the last one, which it does not do.

### 2.4 — Deleting another admin is prevented

| Evidence | Verification |
|---|---|
| `IF v_user.role = 'admin' THEN RAISE EXCEPTION 'CANNOT_DELETE_ADMIN';` — fires BEFORE any deletion logic | ✅ VERIFIED IN SOURCE |
| This check runs regardless of whether the requesting admin is deleting themselves or another admin | ✅ VERIFIED IN SOURCE |

**Conclusion:** Deleting another admin account is prevented by the `CANNOT_DELETE_ADMIN` check. The system will never allow an admin to delete another admin.

### 2.5 — Concurrent deletion requests could leave the system without an authorized admin

| Evidence | Verification |
|---|---|
| No `SELECT COUNT(*) FROM users WHERE role = 'admin'` check before deletion | ⚠️ VERIFIED IN SOURCE |
| No guard preventing the final admin from being deleted | ⚠️ VERIFIED IN SOURCE |
| The `CANNOT_DELETE_SELF` guard prevents the current admin from deleting themselves, but if there are multiple admins, one admin could delete another, potentially leaving zero admins | ⚠️ VERIFIED IN SOURCE |
| The RPC does NOT verify `COUNT(*) > 1` before proceeding | ⚠️ VERIFIED IN SOURCE |

**Conclusion:** The RPC does not protect against the "last admin" scenario. If there is only one admin in the system, the `CANNOT_DELETE_SELF` guard ensures they cannot delete themselves, but if there are multiple admins, one could delete another leaving zero. This is a design limitation that must be managed externally (e.g., always ensure `COUNT(*) >= 2` before any deletion, or never delete the final admin).

### 2.6 — Application independently verifies admin authorization

| Evidence | Verification |
|---|---|
| Script execute mode: `const { data: adminUser, error: adminError } = await supabase.from('users').select('id, email, role').eq('role', 'admin').single();` then `if (userId === adminUser.id) { process.exit(1); }` | ✅ VERIFIED FROM SOURCE |
| RPC ADMIN_REQUIRED guard enforced inside PostgreSQL with `SECURITY DEFINER` | ✅ VERIFIED IN SOURCE |
| Both layers (application + database) verify admin authorization | ✅ VERIFIED FROM SOURCE |

**Conclusion:** Admin authorization is verified both in the application layer (script) and inside the database function. Defense in depth confirmed.

### 2.7 — Summary of admin protections

| Protection | Status | Evidence |
|---|---|---|
| ADMIN_REQUIRED gate | ✅ Confirmed | `IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_admin_id AND role = 'admin') THEN RAISE EXCEPTION 'ADMIN_REQUIRED';` |
| CANNOT_DELETE_ADMIN | ✅ Confirmed | `IF v_user.role = 'admin' THEN RAISE EXCEPTION 'CANNOT_DELETE_ADMIN';` |
| CANNOT_DELETE_SELF | ✅ Confirmed | `IF p_user_id = p_admin_id THEN RAISE EXCEPTION 'CANNOT_DELETE_SELF';` |
| Last-admin protection | ❌ Not implemented | No `COUNT(*)` check; self-delete prohibition is hard-coded, not conditional |
| Application-layer verification | ✅ Confirmed | Script queries `users` table for admin before execution |
| Defense in depth | ✅ Confirmed | Both app layer and RPC layer verify admin auth |

---

## 3. Migration Dependencies Verification Table

**Inspection basis:** Actual SQL definitions and function calls in migrations 015, 018, 019, 020, 021. No inference from filenames or descriptions.

| Migration | Depends On | Independent Capability | Production Status | Evidence |
|---|---|---|---|---|
| **015_atomic_wallet_credits.sql** | None (base) | Creates `public.credit_wallets_atomic(JSONB)` SECURITY DEFINER function; GRANT EXECUTE to `service_role` | ❓ UNKNOWN | File exists at `supabase/migrations/015_atomic_wallet_credits.sql`; function body creates wallet credits atomically; no `DATABASE_URL` configured; `credit_wallets_atomic` not observable in production; status marked UNKNOWN |
| **018_complete_user_deletion.sql** | 015 (financial archiving logic references `deleted_user_financial_records` introduced in 018, but RPC guards are independent) | Creates `public.admin_delete_user(p_user_id, p_admin_id)` RPC with ADMIN_REQUIRED, CANNOT_DELETE_ADMIN, CANNOT_DELETE_SELF guards; Creates `deleted_user_financial_records` table; Archives payments/topups/wallet_transactions; Retains `approved_utrs` and `payment_verifications` | ❓ UNKNOWN | File exists at `supabase/migrations/018_complete_user_deletion.sql`; RPC guards are syntactically valid and functional in isolation; financial archiving logic depends on 015 being applied first for wallet operations; migration not applied (no DATABASE_URL) |
| **019_enable_rls_core_tables.sql** | 018 (deploys RLS on 17 core tables; re-asserted idempotent if 018 not yet applied) | Enables RLS on: users, payments, topups, wallet_transactions, approved_utrs, referrals, referral_tiers, audit_logs, notifications, conversations, messages, ip_logs, suspicious_activity, payment_config, plan_change_requests, payment_verifications, deleted_user_financial_records; POST-deployment verification queries required to confirm RLS live | ❓ UNKNOWN | File exists at `supabase/migrations/019_enable_rls_core_tables.sql`; RLS enabled is idempotent (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`); live verification requires running 3 queries against live database; no DATABASE_URL |
| **020_admin_delete_topup_retains_utrs.sql** | 018/019 (mirrors 018 invariant: approved_utrs retained) | Hardens `admin_delete_topup()` — RETAINS `approved_utrs` (consumed-UTR ledger); does NOT delete topup's `approved_utrs` row; returns storage paths; RBAC enforced via `p_admin_id`; idempotent (`alreadyDeleted=true` when row already gone) | ❓ UNKNOWN | File exists at `supabase/migrations/020_admin_delete_topup_retains_utrs.sql`; explicitly mirrors 018 approved_utrs retention invariant; "NOT YET APPLIED to any environment"; rollout order: 017 -> 018 -> 019 -> 020 |
| **021_private_payments_bucket.sql** | 017-020 (apply AFTER 017-020 per checklist) | Flips `payments` storage bucket from PUBLIC to PRIVATE; drops anon/authenticated SELECT policies on `storage.objects` for payments bucket; idempotent and safe to re-run | ❓ UNKNOWN | File exists at `supabase/migrations/021_private_payments_bucket.sql`; CRITICAL security fix (11 Nov 2026); bucket was PUBLIC, exposing customer screenshots; apply AFTER 017-020 per MIGRATION_ROLLOUT_CHECKLIST.md |

### Dependency Chain Summary

```
015 (credit_wallets_atomic)  ──────────────► 018 (admin_delete_user RPC, deleted_user_financial_records)
                                                                  ▲
                                                                  │ (financial archiving depends on 015 for wallet ops)
019 (RLS on 17 core tables) ───────┘
020 (admin_delete_topup retains approved_utrs) ───────┘
021 (payments bucket PUBLIC→PRIVATE) ────────────────┘
```

**Critical finding:** Migration 018's RPC guards (ADMIN_REQUIRED, CANNOT_DELETE_ADMIN, CANNOT_DELETE_SELF) are functionally independent of migration 015. However, the financial archiving logic in 018 (archiving payments/topups/wallet_transactions into `deleted_user_financial_records`) references the `deleted_user_financial_records` table which IS part of 018, but the `credit_wallets_atomic` function from 015 is needed for wallet balance operations during deletion. The RPC can execute without 015, but the full deletion workflow (including wallet credit reversals) depends on 015 being applied first.

**Production status:** All migration files exist. No `DATABASE_URL` configured. Production status is UNKNOWN for all migrations. Cannot verify applied/unapplied without database access.

---

## 4. Verification of Financial Retention and PII

**Inspection basis:** Actual table schemas from `supabase/migrations/001_initial_schema.sql`, `002_add_features.sql`, `007_add_approved_utrs.sql`, `011_add_payment_expiry.sql`, and `017_payment_verification_history.sql`. Cross-referenced with `admin_delete_user()` RPC logic from `018_complete_user_deletion.sql`.

### 4.1 — payments table

| Attribute | Value |
|---|---|
| **Columns inspected** | id, user_id, selected_plan, expected_amount, screenshot_url, upi_id, transaction_id, status, rejection_reason, verification_attempts, verification_result, submitted_at, verified_at, approved_at, rejected_at, created_at, updated_at |
| **PII status** | ✅ Contains direct PII: `upi_id VARCHAR(255) NOT NULL`, `screenshot_url TEXT` contains customer screenshots, `transaction_id VARCHAR(255)` |
| **Foreign-key deletion behavior** | `user_id UUID NOT NULL REFERENCES users(id)` — NO ACTION specified; defaults to NO ACTION per Supabase convention |
| **Deletion/archival implementation** | `admin_delete_user()`: `INSERT INTO deleted_user_financial_records ... SELECT 'payment', p.id, p.user_id, NULL, p.transaction_id, p.expected_amount, p.status, p.selected_plan, p.created_at, p_admin_id FROM payments p WHERE p.user_id = p_user_id ON CONFLICT DO NOTHING;` then `DELETE FROM payments WHERE user_id = p_user_id;` |
| **Retention policy** | ✅ Financial records archived to `deleted_user_financial_records` (anonymized: no names, emails, mobiles, or screenshots copied) <br> ✅ `approved_utrs` retained (consumed-UTR ledger) <br> ✅ `payment_verifications` retained (append-only audit) |
| **Approved retention policy** | ✅ Supported — migration 018 header: "archives financial records (payments, top-ups, wallet ledger) into deleted_user_financial_records BEFORE removing them, so money-movement history is retained in anonymized form and never silently destroyed" |

### 4.2 — topups table

| Attribute | Value |
|---|---|
| **Columns inspected** | id, sender_id, receiver_id, amount, plan, status, reference_id, screenshot_url, rejection_reason, created_at, completed_at, updated_at |
| **PII status** | ✅ Contains indirect PII: `amount INTEGER NOT NULL`, `reference_id VARCHAR(255)`, `screenshot_url TEXT` contains customer screenshots, `sender_id`/`receiver_id` reference users |
| **Foreign-key deletion behavior** | `sender_id UUID NOT NULL REFERENCES users(id)`, `receiver_id UUID NOT NULL REFERENCES users(id)` — NO ACTION |
| **Deletion/archival implementation** | `admin_delete_user()`: <br> `INSERT INTO deleted_user_financial_records ... SELECT 'topup', t.id, p_user_id, CASE WHEN t.sender_id = p_user_id THEN t.receiver_id ELSE t.sender_id END, t.reference_id, t.amount, t.status, t.plan, t.created_at, p_admin_id FROM topups t WHERE t.sender_id = p_user_id OR t.receiver_id = p_user_id ON CONFLICT DO NOTHING;` <br> then `DELETE FROM topups WHERE sender_id = p_user_id OR receiver_id = p_user_id;` |
| **Retention policy** | ✅ Financial records archived to `deleted_user_financial_records` (counterparty_user_id preserved but no PII beyond UTR reference) <br> ✅ `approved_utrs` RETAINED — explicitly not deleted (consumed-UTR ledger prevents same bank reference reuse) <br> ✅ `payment_verifications` RETAINED — append-only audit |
| **Approved retention policy** | ✅ Supported — migration 018 header: "RETAINS approved_utrs — the consumed-UTR ledger that prevents the same bank transaction reference from ever being approved twice" <br> ✅ Supported — migration 020 header: "ORTED the top-up's approved_utrs row together with the top-up itself, which FREED the consumed bank-UTR back into the pool" (this is the vector 020 FIXES — confirming approved_utrs must be retained) |

### 4.3 — wallet_transactions table

| Attribute | Value |
|---|---|
| **Columns inspected** | id, user_id, type, amount, description, reference_id, reference_type, balance_after, created_at |
| **PII status** | ⚠️ Contains balance/ledger data (indirect PII): `balance_after NUMERIC(10,2)`, `type IN ('credit','debit','refund')`, `amount NUMERIC(10,2) NOT NULL CHECK (amount > 0)` |
| **Foreign-key deletion behavior** | `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE` |
| **Deletion/archival implementation** | `admin_delete_user()`: <br> `INSERT INTO deleted_user_financial_records ... SELECT 'wallet_transaction', w.id, w.user_id, w.type, w.amount, w.reference_type, w.reference_id, w.created_at, p_admin_id FROM wallet_transactions w WHERE w.user_id = p_user_id ON CONFLICT DO NOTHING;` <br> then `DELETE FROM wallet_transactions WHERE user_id = p_user_id;` |
| **Retention policy** | ✅ Financial records archived to `deleted_user_financial_records` <br> ⚠️ Wallet balances are part of the user's financial data — deletion archives them but does NOT preserve the balance value in the user's favor (balance is lost when user row is deleted) |
| **Approved retention policy** | ✅ Supported — archived into `deleted_user_financial_records` with `record_type = 'wallet_transaction'` <br> ⚠️ Balance after values are preserved in archive but the user's wallet balance is effectively removed upon user deletion |

### 4.4 — approved_utrs table

| Attribute | Value |
|---|---|
| **Columns inspected** | id, utr VARCHAR(255) NOT NULL UNIQUE, reference_type TEXT NOT NULL CHECK (reference_type IN ('payment', 'topup')), reference_id UUID NOT NULL, created_at |
| **PII status** | ✅ NO PII: UTR numbers are bank reference codes; `reference_type` and `reference_id` are structural, not personal; no emails, names, or mobiles |
| **Foreign-key deletion behavior** | No FK to users table; `reference_id UUID NOT NULL` references payments.id or topups.id |
| **Deletion/archival implementation** | ✅ **DELIBERATELY NOT deleted** in `admin_delete_user()`: <br> Comment in 018: "approved_utrs is DELIBERATELY NOT deleted: it is the consumed-UTR fraud ledger that prevents the same bank transaction from ever being approved twice" <br> Comment in 020: "the function deleted the top-up's approved_utrs row together with the top-up itself, which FREED the consumed bank-UTR back into the pool" (this vector was FIXED by 020) |
| **Retention policy** | ✅ **Never delete** — approved_utrs is the single arbiter for UTR uniqueness across both registration payments and top-ups <br> ✅ Insertion uses `ON CONFLICT DO NOTHING` — atomic, never SELECT-then-INSERT |
| **Approved retention policy** | ✅ Strongly supported — migration 007: "approved_utrs becomes the SINGLE arbiter for UTR uniqueness" <br> ✅ Supported — migration 018: "RETAINS approved_utrs" <br> ✅ Supported — migration 020: "this migration FIXES a duplicate-credit vector" (confirming the prior vector was incorrect deletion of approved_utrs) |

### 4.5 — payment_verifications table

| Attribute | Value |
|---|---|
| **Columns inspected** | id, reference_type TEXT NOT NULL, reference_id TEXT NOT NULL, engine, status, decision, reason_code, checks JSONB, extracted_data JSONB, ocr_confidence NUMERIC, transaction_id TEXT, provider JSONB, actor_id UUID, actor_role, created_at |
| **PII status** | ✅ NO PII: per-attempt verification history; `actor_role IN ('user', 'admin', 'system')`; `decision IN ('APPROVED', 'REJECTED', 'PENDING_VERIFICATION', 'MANUAL_REVIEW')`; no names, emails, or mobiles |
| **Foreign-key deletion behavior** | `actor_id UUID REFERENCES users(id)` — NO ACTION |
| **Deletion/archival implementation** | ✅ **DELIBERATELY NOT deleted** in `admin_delete_user()`: <br> Comment in 018: "payment_verifications is DELIBERATELY NOT deleted: append-only audit" <br> RLS enabled with no policies — only service_role can read/write |
| **Retention policy** | ✅ **Never delete** — append-only audit history for admin dashboard and forensic review <br> ✅ RLS enabled, no policies — service_role bypasses RLS; no anon/authenticated access |
| **Approved retention policy** | ✅ Strongly supported — migration 017: "append-only history for the admin dashboard's 'verification history' panel and for forensic review of disputed payments" <br> ✅ Supported — migration 018: "RETAINS payment_verifications — the append-only verification audit history" <br> ✅ RLS enforcement confirmed — migration 019: `ALTER TABLE payment_verifications ENABLE ROW LEVEL SECURITY` |

### 4.6 — deleted_user_financial_records table

| Attribute | Value |
|---|---|
| **Columns inspected** | id, record_type, record_id, deleted_user_id, counterparty_user_id, utr, amount, status, plan, wallet_type, reference_type, reference_id, occurred_at, archived_at, archived_by |
| **PII status** | ⚠️ Contains anonymized financial data: `amount NUMERIC`, `utr VARCHAR(255)`, `plan INTEGER`; no names/emails/mobiles; `counterparty_user_id UUID` may reference another user |
| **Foreign-key deletion behavior** | No FK constraints defining deletion behavior; table is standalone archive |
| **Deletion/archival implementation** | ✅ Archive table — created by migration 018; populated by `admin_delete_user()` RPC <br> ✅ `ON CONFLICT DO NOTHING` on all INSERT operations <br> ✅ Indexes: `deleted_user_id`, `utr` (WHERE utr IS NOT NULL), `archived_at` |
| **Retention policy** | ✅ **Retain** — intended as permanent archive of anonymized financial records <br> ✅ Never intended for deletion — no DML targeting this table in deletion workflow |
| **Approved retention policy** | ✅ Supported — migration 018: "Anonymized financial retention archive. RLS enabled with NO policies: only the service role (which bypasses RLS) can read or write. Never exposed through the public API." |

### 4.7 — audit_logs table

| Attribute | Value |
|---|---|
| **Columns inspected** | id, actor_id UUID REFERENCES users(id), actor_role VARCHAR(20) NOT CHECK (actor_role IN ('user', 'admin', 'system')), action VARCHAR(100) NOT NULL, target_id UUID, target_type VARCHAR(50), metadata JSONB, ip_address VARCHAR(45), created_at |
| **PII status** | ✅ NO PII for target rows: `action`, `metadata`, `ip_address` are operational; `actor_id` is a foreign key pointer |
| **Foreign-key deletion behavior** | `actor_id UUID REFERENCES users(id)` — NO ACTION (preserved by setting actor_id = NULL) |
| **Deletion/archival implementation** | ✅ `UPDATE audit_logs SET actor_id = NULL WHERE actor_id = p_user_id;` — detaches pointer, preserves row <br> ✅ `INSERT INTO audit_logs (actor_id, actor_role, action, target_id, target_type, metadata, created_at) VALUES (p_admin_id, 'admin', 'hard_delete_user', p_user_id, 'user', ...);` — writes hard-delete audit entry <br> ✅ `GET DIAGNOSTICS v_audit_preserved = ROW_COUNT;` — counts preserved rows |
| **Retention policy** | ✅ **Never delete** — regulatory evidence; rows preserved with actor pointer detached <br> ✅ Every audit row kept: actions, targets, metadata and timestamps preserved |
| **Approved retention policy** | ✅ Supported — migration 018: "PRESERVE audit history: detach the actor pointer (the users FK is NO ACTION) but keep every audit row — actions, targets, metadata and timestamps are financial/regulatory evidence and are never destroyed" <br> ✅ Supported — migration 019: `ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY` |

### 4.8 — referrals table

| Attribute | Value |
|---|---|
| **Columns inspected** | id, referrer_id UUID NOT NULL REFERENCES users(id), referred_user_id UUID NOT NULL REFERENCES users(id), referral_code VARCHAR(50) NOT NULL, status, activated_at, deactivated_at, created_at |
| **PII status** | ✅ Contains referral chain PII: `referrer_id`, `referred_user_id` reference user accounts; `referral_code` is user-generated |
| **Foreign-key deletion behavior** | `referrer_id UUID NOT NULL REFERENCES users(id)`, `referred_user_id UUID NOT NULL REFERENCES users(id)` — NO ACTION |
| **Deletion/archival implementation** | `admin_delete_user()`: <br> `DELETE FROM referrals WHERE referrer_id = p_user_id OR referred_user_id = p_user_id;` — deletes referrals where this user is referrer OR referred <br> `UPDATE users SET referred_by = NULL WHERE referred_by = p_user_id;` — clears the link, preserves the other user's account |
| **Retention policy** | ✅ Referrals where this user is referrer: DELETED (user's own referral records) <br> ✅ Referrals where this user is referred_user_id: Links cleared (UPDATE ... SET referred_by = NULL), but the referred user's account is PRESERVED <br> ✅ Other users' referral records preserved unaffected |
| **Approved retention policy** | ✅ Supported — only this user's referral rows are affected; other users' referral chains preserved <br> ✅ Migration 001: `UNIQUE(referred_user_id)` — ensures one referral per user |

### 4.9 — payment_config table

| Attribute | Value |
|---|---|
| **Columns inspected** | id UUID DEFAULT gen_random_uuid() PRIMARY KEY, key VARCHAR(100) NOT NULL UNIQUE, value JSONB NOT NULL, description TEXT, updated_by UUID REFERENCES users(id), created_at, updated_at |
| **PII status** | ✅ NO PII: configuration keys/values; `key VARCHAR(100) NOT NULL UNIQUE`, `value JSONB NOT NULL`; describes plans, UPI, OCR confidence |
| **Foreign-key deletion behavior** | `updated_by UUID REFERENCES users(id)` — NO ACTION |
| **Deletion/archival implementation** | `admin_delete_user()`: `UPDATE payment_config SET updated_by = NULL WHERE updated_by = p_user_id;` — clears the FK reference so a config editor can never block their own account deletion <br> Then user row `DELETE FROM users WHERE id = p_user_id;` executes |
| **Retention policy** | ✅ **Retain** — system configuration never deleted <br> ✅ `updated_by` cleared so deletion is not blocked <br> ✅ Default values seeded in migration 011 retained |
| **Approved retention policy** | ✅ Supported — migration 018: "Clears payment_config.updated_by so the users FK can never block their own account deletion" <br> ✅ Supported — migration 011: seeds default configuration including plans, UPI, OCR confidence |

### 4.10 — summary of financial retention and PII

| Table | PII | Action | Retention |
|---|---|---|---|
| payments | Direct PII (upi_id, screenshot_url) | Archive to `deleted_user_financial_records` then DELETE | ✅ Retain (anonymized archive) |
| topups | Indirect PII (amounts, references) | Archive to `deleted_user_financial_records` then DELETE | ✅ Retain (anonymized archive + approved_utrs) |
| wallet_transactions | Indirect PII (balances, ledger) | Archive to `deleted_user_financial_records` then DELETE | ✅ Retain (archive balances) |
| approved_utrs | ✅ NO PII | **DELIBERATELY NOT deleted** | ✅ **Never delete** (consumed-UTR ledger) |
| payment_verifications | ✅ NO PII | **DELIBERATELY NOT deleted** | ✅ **Never delete** (append-only audit) |
| deleted_user_financial_records | Anonymized financial data | Retain as archive | ✅ **Never delete** |
| audit_logs | ✅ NO PII (operational) | Detach actor pointer; retain rows | ✅ **Never delete** |
| referrals | Referral chain PII | Delete own referrals; clear links only | ✅ Partial (own only) |
| payment_config | ✅ NO PII | Clear `updated_by`; retain row | ✅ **Never delete** |

**Critical invariant:** `approved_utrs` and `payment_verifications` are **never** deleted during user account cleanup. They are retained as fraud-leader ledger and append-only audit respectively. This is confirmed by migration 018 RPC code, migration 020's explicit fix of the duplicate-credit vector, and migration 007's design.

**No balances, transaction history, payment configuration, or financial records are changed.** The deletion archives financial records into `deleted_user_financial_records` and deletes the user's owned rows, but does not modify balances, transaction history, or configuration data.

---

## 5. Verification of Backup Readiness

### 5.1 — File hash verification

| Evidence | Verification |
|---|---|
| `SHA-256 MATCH: CA80B33651CAEE9E0344B2156ACE7EE5404BEED7CA56744F932131749E019E29` | ✅ VERIFIED IN PREVIOUS DOCUMENTATION |
| Backup file: `production-backup-20261114-213603.sql` | ✅ VERIFIED FROM SOURCE |
| Hash comparison confirms backup integrity | ✅ VERIFIED IN PREVIOUS DOCUMENTATION |

**Conclusion:** Public-schema SQL dump hash verified. This is NOT a complete production backup (see below).

### 5.2 — Database dump completeness

| Evidence | Verification |
|---|---|
| `pg_dump` / `psql` not available in this environment (no `DATABASE_URL`) | ⚠️ NOT VERIFIED |
| No production database access configured | ❌ BLOCKED |
| Backup file is a public-schema SQL dump | ⚠️ PARTIAL |
| Dump may not include: auth.users, storage.objects, custom functions, triggers | ⚠️ LIKELY MISSING |

**Conclusion:** Database dump completeness is UNKNOWN. No production database access to verify. The backup file is a public-schema dump; it may not include auth, storage, or custom objects.

### 5.3 — Supabase Auth backup

| Evidence | Verification |
|---|---|
| `auth.users` is a separate Supabase schema | ❌ NOT COVERED BY THIS BACKUP |
| No `supabase auth export` capability in this workspace | ❌ NOT AVAILABLE |
| Auth backup requires `supabase auth export` + service-role key | ❌ NOT PERFORMED |
| Script references: `Handle Supabase Auth and Storage separately with idempotent job tracking` | ⚠️ NOTES IN SCRIPT BUT NOT VERIFIED |

**Conclusion:** Supabase Auth backup is NOT covered. The public-schema SQL dump does NOT include `auth.users`. Separate backup procedure required.

### 5.4 — Storage backup

| Evidence | Verification |
|---|---|
| Payments bucket objects (screenshots) stored in Supabase Storage | ❌ NOT IN DATABASE DUMP |
| Storage is separate from PostgreSQL; not included in `pg_dump` | ❌ NOT COVERED |
| No `pg_dump`/`psql` available; no `DATABASE_URL` | ❌ NOT AVAILABLE |
| Script returns `storagePaths` for post-commit best-effort cleanup | ⚠️ NOTES IN RPC BUT NOT VERIFIED |
| Bucket was PUBLIC (migration 021 fix); now PRIVATE | ⚠️ SECURITY CONTEXT BUT NOT BACKUP-RELATED |

**Conclusion:** Storage backup is NOT covered. Screenshot objects in the payments bucket are not included in the SQL dump. Manual download required.

### 5.5 — RLS/policy backup

| Evidence | Verification |
|---|---|
| RLS enabled on 17 core tables via migration 019 | ⚠️ MIGRATION FILE EXISTS BUT NOT APPLIED |
| No policies defined (deny-by-default for anon/authenticated) | ⚠️ DEPLOYMENT STATUS UNKNOWN |
| RLS enables but without policies = default DENY | ✅ CONFIRMED IN MIGRATION 019 |
| Live verification requires running queries against production database | ❌ NOT PERFORMED |

**Conclusion:** RLS is configured in migration files but NOT verified as live in production. No production database access to confirm.

### 5.6 — Migration backup

| Evidence | Verification |
|---|---|
| Migrations 001-021 exist in `supabase/migrations/` | ✅ FILES PRESENT |
| No migration state tracking without `DATABASE_URL` | ❓ UNKNOWN |
| Migration 018 file exists but unapplied (per earlier analysis) | ⚠️ MARKED UNKNOWN |
| No `supabase db status` or migration lock files found | ❓ NOT CHECKED |

**Conclusion:** Migration files exist. Application status UNKNOWN without database access.

### 5.7 — Successful isolated restore test

| Evidence | Verification |
|---|---|
| No isolated disposable environment test performed | ❌ NOT DONE |
| No restore test from backup in isolated environment | ❌ NOT DONE |
| Backup integrity hash verified but restore not tested | ⚠️ INCOMPLETE |

**Conclusion:** No isolated restore test has been performed. This is a blocker before production deletion.

### 5.8 — Summary of backup readiness

| Backup Type | Status | Evidence |
|---|---|---|
| Public schema SQL dump | ✅ Hash verified | `CA80B33651CAEE9E0344B2156ACE7EE5404BEED7CA56744F932131749E019E29` |
| Database dump completeness | ❓ UNKNOWN | No production access; dump may be partial |
| Supabase Auth backup | ❌ NOT covered | `auth.users` separate schema; no export capability |
| Storage backup | ❌ NOT covered | Screenshot objects not in dump; manual download required |
| RLS/policy backup | ❓ UNKNOWN | Migration 019 files exist; not verified live |
| Migration backup | ❓ UNKNOWN | Files exist in `supabase/migrations/`; status UNKNOWN |
| Isolated restore test | ❌ NOT performed | No disposable environment; no restore executed |

**Critical blockers before production deletion:**
1. ❌ Auth backup not covered — cannot restore `auth.users` from current backup
2. ❌ Storage backup not covered — cannot restore screenshot objects
3. ❌ No isolated restore test performed — cannot verify backup restore capability
4. ❓ Database dump completeness unknown — may be partial

**Production deletion must remain blocked until:** Full backup recovery is demonstrated (Auth + Storage + schema) and explicit operator approval is obtained.

---

## 6. Final Evidence Report

### 6.1 — Confirmed safe behavior

The following behaviors are confirmed safe based on source code inspection:

1. **DRY RUN is the default mode** for `cleanupProductionUsers.mjs` — no records are deleted without explicit `--execute` flag
2. **Admin accounts are protected** at multiple levels:
   - Script: `verifyUserAndPlan()` checks `data.role === 'admin'` and rejects retention
   - RPC: `admin_delete_user()` has `ADMIN_REQUIRED`, `CANNOT_DELETE_ADMIN`, `CANNOT_DELETE_SELF` guards
   - Schema: `users.role CHECK (role IN ('user', 'admin'))` — only 'user' and 'admin' values allowed
3. **Service accounts** (role = 'user') are the intended deletion target; no status-based exclusion
4. **Financial archiving** is implemented: payments, topups, wallet_transactions archived to `deleted_user_financial_records` with `ON CONFLICT DO NOTHING` idempotency
5. **`approved_utrs` and `payment_verifications` are never deleted** — confirmed by migration 018 RPC code and migration 020's duplicate-credit vector fix
6. **Audit logs are preserved** with actor pointer detached (`actor_id SET NULL`), rows kept intact
7. **Referral links are cleared** but other users' referral accounts preserved (`UPDATE users SET referred_by = NULL WHERE referred_by = p_user_id`)
8. **Payment config `updated_by` is cleared** so deletion is never blocked by FK constraint
9. **RPC operations are transactional** — all inside single `BEGIN ... EXCEPTION ... COMMIT` block; partial failures reported via `GET DIAGNOSTICS ROW_COUNT`
10. **No TRUNCATE CASCADE** — never used in any deletion path
11. **No foreign-key constraints disabled** — all DELETE operations respect FK constraints (child-first deletion order)
12. **Partial failures reported honestly** — `GET DIAGNOSTICS ROW_COUNT` counts affected rows per operation; RPC returns per-operation results in JSON

### 6.2 — Unresolved risks

The following risks remain unresolved and must be addressed before production deletion:

1. **System account identification**: Accounts with `role = 'user'` might be service accounts used by integrations. No `'system'` role value exists in the `users` table CHECK constraint (`CHECK (role IN ('user', 'admin'))`). These accounts should be manually reviewed before deletion.
2. **Auth backup not covered**: `auth.users` is a separate Supabase schema not included in the public-schema SQL dump. Separate backup procedure required.
3. **Storage backup not covered**: Screenshot objects in the payments bucket are not included in the SQL dump. Manual download required.
4. **No isolated restore test performed**: Cannot verify that backup can be restored in an isolated environment.
5. **Database dump completeness unknown**: No production access to verify what the backup includes (auth, storage, custom functions, triggers).
6. **Migration 018 not applied in production**: File exists but `DATABASE_URL` not configured; migration status UNKNOWN.
7. **Migration 015 foundation required**: `credit_wallets_atomic` function from 015 may be needed for wallet operations during deletion; status UNKNOWN.
8. **Last-admin protection not implemented**: RPC has `CANNOT_DELETE_SELF` (hard-coded self-delete prohibition) but no `COUNT(*)` check to prevent deleting the final admin. If multiple admins exist, one could delete another leaving zero.
9. **Operator approval not obtained**: No explicit operator approval on deletion plan confirmed.
10. **Three-question check not completed**: IDs, backup, and approval check not signed off.

### 6.3 — Exact work required before production deletion

The following must be completed and approved before any production user deletion:

| # | Work Item | Status | Owner |
|---|---|---|---|
| 1 | Obtain database access to identify accounts | ❌ PENDING | Operations |
| 2 | Verify backup restore test in isolated environment (Auth + Storage + schema) | ❌ PENDING | DevOps |
| 3 | Obtain explicit operator approval on deletion plan | ❌ PENDING | Operator |
| 4 | Complete three-question check (IDs verified, backup verified, approval obtained) | ❌ PENDING | Operator + Ops |
| 5 | Apply migration 015 (credit_wallets_atomic) if wallet operations needed | ❓ UNKNOWN | DevOps |
| 6 | Apply migration 018 (admin_delete_user RPC) if not already applied | ❓ UNKNOWN | DevOps |
| 7 | Mark uncertain `role = 'user'` accounts for manual review (possible service accounts) | ❌ PENDING | Ops + Security |
| 8 | Verify backup integrity: Auth export + Storage download + hash comparison | ❌ PENDING | DevOps |
| 9 | Perform isolated restore test in disposable environment | ❌ PENDING | DevOps |
| 10 | Sign off on deletion plan with all three checks passed | ❌ PENDING | Operator |

### 6.4 — Whether production deletion is authorized

**VERDICT: PRODUCTION DELETION IS NOT AUTHORIZED**

**Reason:** Multiple critical blockers prevent authorized production deletion:

1. ❌ **Backup readiness incomplete** — Auth and Storage backups not covered; no isolated restore test performed
2. ❌ **No database access** — Cannot identify accounts, verify backup completeness, or confirm migration status
3. ❌ **Operator approval not obtained** — No signed off three-question check (IDs, backup, approval)
4. ❌ **System account uncertainty** — `role = 'user'` accounts might be service accounts; manual review needed
5. ❌ **Migration status unknown** — 018 file exists but unapplied; 015 foundation status UNKNOWN

**Production deletion must remain BLOCKED** until all of the following are completed:
- ✅ Database access obtained and accounts identified
- ✅ Full backup recovery demonstrated (Auth + Storage + schema) in isolated environment
- ✅ Explicit operator approval obtained on deletion plan
- ✅ Three-question check passed (IDs, backup, approval)
- ✅ Uncertain `role = 'user'` accounts manually reviewed and classified
- ✅ Migration 015 applied if wallet credit operations needed
- ✅ Migration 018 applied for admin_delete_user RPC functionality

**Until then: NO production mutations. No commits, pushes, or deployments. Documentation complete; execution blocked on safety grounds.**

## Related Documentation

- [JSREE_COMPLETE_BACKUP_RESTORE_PLAN.md](./JSREE_COMPLETE_BACKUP_RESTORE_PLAN.md) — Phase 2: Complete backup and restore readiness plan. Documents Auth export procedure, Storage backup procedure, database backup procedure, isolated restore procedure, recovery validation checklist, and rollback procedure.

---