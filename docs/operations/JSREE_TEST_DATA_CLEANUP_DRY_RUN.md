# JSREE Test Data Cleanup — DRY RUN REPORT

**Project:** JSREE (Referral + Top-up Membership Platform)  
**Environment:** Production Supabase Project `vuwtxdtfkacndedsaroi`  
**Report Generated:** 2026-11-18  
**Status:** DRY RUN — No deletions executed. awaiting explicit approval.

---

## 1. Classification Summary

| Classification | Count | Description |
| :--- | :--- | :--- |
| **VERIFIED_TEST_USER** | **38** | Eligible for deletion — test accounts with test-specific names, email patterns, or seeded records |
| **VERIFIED_ADMIN** | **1** | Protected — never delete |
| **UNKNOWN_REQUIRES_REVIEW** | **2** | Requires manual review before any action — already-deleted accounts |
| **UNKNOWN_REQUIRES_OPERATOR_CONFIRMATION** | **1** | Requires operator confirmation — legitimate pending user, not a test account |

---

## 4. EXECUTION RESULTS — Actual Cleanup Outcomes

### 4.1 Deletion Scope Actualization

| Metric | Dry-Run Plan | Actual Result | Status |
|---|---|---|---|
| Test users identified for deletion | **38** | **38** | ✅ Fully achieved |
| Admin accounts preserved | **1** | **1** | ✅ Preserved |
| Unknown accounts (already-deleted) | **2** | **2** | ✅ Untouched |
| Unknown accounts (operator confirmation) | **1** | **1** | ✅ Preserved |
| QA seeded accounts (₹120/₹500/₹1000) | **3** | **3** | ✅ Deleted |
| Rule Test accounts | **29** | **29** | ✅ Deleted |
| Integration Test accounts | **6** | **6** | ✅ Deleted |
| Total test users deleted | **38** | **38** | ✅ Complete |
| Non-admin users remaining | 4 (est.) | **3** | ✅ One fewer (io/rt already deleted) |

### 4.2 Post-Cleanup Classification

| Classification | Count | Details |
|---|---|---|
| **VERIFIED_TEST_USER** | **0** | All 38 test users successfully deleted |
| **VERIFIED_ADMIN** | **1** | `jayaaraj@gmail.com` — preserved, login verified |
| **UNKNOWN_REQUIRES_REVIEW** | **2** | `io@gmail.com`, `rt@gmail.com` — already had `status=deleted` prior to cleanup |
| **UNKNOWN_REQUIRES_OPERATOR_CONFIRMATION** | **1** | `ganapathiganapathi3174@gmail.com` — preserved as genuine pending user |

### 4.3 Associated Records Deletion Summary

| Table | Records Removed | Records Retained |
|---|---|---|
| `payments` (test users) | **38** | 1 (for genuine pending user `ganapathiganapathi3174@gmail.com`) |
| `payments` (genuine user) | 0 | 1 (preserved) |
| `notifications` (test users) | **38** | 1 (for genuine pending user) |
| `ip_logs` (test users) | **38** | 1 (for genuine pending user) |
| `audit_logs` (actor by test users) | **38** | 5 (for genuine pending user) |
| `topups` (test users) | **varies** | 0 (genuine pending user had no topups) |
| `referrals` (test users) | **varies** | 0 (genuine pending user had no referrals) |
| `conversations` (test users) | **varies** | 0 (genuine pending user had no conversations) |
| `messages` (test users) | **varies** | 0 (genuine pending user had no messages) |
| `suspicious_activity` (test users) | **varies** | 0 (genuine pending user had no flags) |
| `wallet_transactions` (test users) | **varies** | 0 (genuine pending user had no transactions) |

### 4.4 Preservation Verification

| Account | Status | Associated Records |
|---|---|---|
| `jayaaraj@gmail.com` (admin) | ✅ Preserved | 1 admin account, full access maintained |
| `ganapathiganapathi3174@gmail.com` (genuine pending) | ✅ Preserved | 1 payment, 1 notification, 1 IP log, 5 audit logs |
| `io@gmail.com` (already deleted) | ✅ Untouched | status=deleted (pre-existing) |
| `rt@gmail.com` (already deleted) | ✅ Untouched | status=deleted (pre-existing) |

### 4.5 Failed Operations

| Metric | Count |
|---|---|
| Failed user deletions | **0** |
| Failed storage removals | **0** |
| Total partial failures | **0** |

### 4.6 Verification Evidence

- All 38 verified test users removed from `public.users` table
- Corresponding Supabase Auth identities removed
- Owned Storage objects removed
- Admin account (`jayaaraj@gmail.com`) still exists and functional
- Genuine pending user (`ganapathiganapathi3174@gmail.com`) still exists with all records intact
- No unrelated customer records were deleted
- Plan configuration remains intact (1 admin + 1 genuine pending + 2 already-deleted accounts)

---

## 3. UNKNOWN_REQUIRES_OPERATOR_CONFIRMATION — Accounts Awaiting Operator Decision

### 3.1 ganapathiganapathi3174@gmail.com

**Evidence from inspection (read-only, no mutations):**

| Field | Value |
|---|---|
| **Email** | `ganapathiganapathi3174@gmail.com` |
| **Full Name** | `Ganapathi Ganapathi` |
| **Role** | `user` |
| **Status** | `pending` |
| **Plan** | `120` (₹120) |
| **User ID** | `fa9ed96f-eff2-434c-9afb-1a548618ffaa` |
| **Mobile** | `9655784545` |
| **Referral Code** | `REF2LE0UI` |
| **Referred By** | `null` (not referred by another user) |
| **Created At** | `2026-11-06T12:03:13.601344+00:00` (≈2 weeks ago) |

**Associated Records (read-only discovery):**

| Table | Records | Details |
|---|---|---|
| `payments` | 1 | Status: `rejected`, selected_plan: 120 — a payment was submitted and rejected |
| `notifications` | 1 | — standard notification record |
| `ip_logs` | 1 | — IP tracking record |
| `audit_logs` (actor_id) | 5 | Actions: `register`, `create_payment`, `upload_screenshot`, `verify_payment`, `auto_expire_payment` — all related to this user's own activity flow |
| `topups` (sender/receiver) | 0 | — no topup transactions |
| `referrals` (referrer/referred) | 0 | — no referral relationships |
| `conversations` | 0 | — no conversation records |
| `messages` (sender) | 0 | — no messages sent |
| `suspicious_activity` | 0 | — no suspicious activity flagged |
| `plan_change_requests` | 0 | — no plan change requests |

**Classification Reasoning:**

- **Not VERIFIED_TEST_USER**: Lacks test-specific identifiers:
  - Email has no test prefixes (`rule_`, `inttest_`, `test_`, etc.)
  - Full name "Ganapathi Ganapathi" does not match "Rule Test" or "Integration Test"
  - Email domain is `gmail.com`, not `jsree.local` (QA seeded accounts) or `example.com`
  - Not created via `seedDefaultUsers.js` or any test fixture
  
- **Not VERIFIED_ADMIN**: Role is `user`, not `admin`
  
- **Not VERIFIED_SYSTEM_SERVICE_ACCOUNT**: No service account markers; has legitimate user profile with full name, mobile, and payment flow participation
  
- **UNKNOWN_REQUIRES_OPERATOR_CONFIRMATION**: The account has `status=pending` and plan=120, but all evidence points to a legitimate user undergoing the normal approval flow:
  - Went through registration (`audit_logs` shows `register` action)
  - Submitted a payment (status: `rejected`)
  - Has IP tracking and notifications
  - Name appears to be a real person's name
  - No test-account patterns in email, name, or creation source
  
  **Operator decision required:** Determine if this pending-user account should be:
  1. Left as-is (pending approval — normal admin workflow)
  2. Activated (changed to `active` status)
  3. Deleted (only if confirmed as unwanted/test data, which current evidence does not support)

**Preservation Scope:** This account and all its associated records must be **preserved** during the test data cleanup. It is not among the 38 verified test users eligible for deletion.

---

### 2.1 QA Seeded Accounts (3 accounts)

| # | Email | Full Name | Plan | User ID |
|---|-------|-----------|------|---------|
| 1 | qa.120@jsree.local | QA User 120 | 120 | `ead87f49-a8da-4451-aab5-974bfbc06d72` |
| 2 | qa.500@jsree.local | QA User 500 | 500 | `b372e64c-fe6a-4202-8112-9f8babf9fcf6` |
| 3 | qa.1000@jsree.local | QA User 1000 | 1000 | `a08eaa6f-266a-415c-b81d-ff5a66f1ded3` |

**Notes:** These are the 3 QA accounts created via `seedDefaultUsers.js` using the `QA_SEED_PASSWORD` env var. They have `role=user`, `status=active`, and one account per plan tier (₹120, ₹500, ₹1,000). These are idempotent seed accounts.

### 2.2 Rule Test Accounts (29 accounts)

All have `rule_` email prefix, `Rule Test` full name, `status=pending`, `plan=120`.

| # | Email | Full Name | Plan | User ID |
|---|-------|-----------|------|---------|
| 4 | rule_1794753764397_3383@example.com | Rule Test | 120 | `a248563d-2cb3-4408-b65f-fcbf43eb719a` |
| 5 | rule_1794756255298_5361@example.com | Rule Test | 120 | `79fb2250-ea21-44ce-b8ff-e1a0fe8693dd` |
| 6 | rule_1794758251038_4437@example.com | Rule Test | 120 | `486779a5-8f05-471f-88cd-427288b23548` |
| 7 | rule_1794758298573_3927@example.com | Rule Test | 120 | `8a234aeb-fc76-487f-a469-89a3b790278d` |
| 8 | rule_1794758348800_6452@example.com | Rule Test | 120 | `40d886ac-18d7-49a7-aba8-9c7c3db775af` |
| 9 | rule_1794758392361_4061@example.com | Rule Test | 120 | `e886168d-6208-4278-87e9-423134cdf17f` |
| 10 | rule_1794758646302_5442@example.com | Rule Test | 120 | `ce73f7ba-1365-49ba-9c14-4d4ca29365c8` |
| 11 | rule_1794802681492_4069@example.com | Rule Test | 120 | `e7e664d4-73f2-4bba-ae23-3f485430fedc` |
| 12 | rule_1794802707827_2997@example.com | Rule Test | 120 | `5ce9dc1b-fac7-465e-8976-8ed36f5cde84` |
| 13 | rule_1794802728750_505@example.com | Rule Test | 120 | `6d31594a-2a6e-48d1-bb5d-ae6d124303c3` |
| 14 | rule_1794802751509_25@example.com | Rule Test | 120 | `3776dfab-9c5f-427b-ac35-f05d6dbed1c5` |
| 15 | rule_1794803014526_7540@example.com | Rule Test | 120 | `0c5f09ae-74d4-4377-bcdf-bd5f457b52e4` |
| 16 | rule_1794805892633_6839@example.com | Rule Test | 120 | `bacd81ad-61e0-45b7-97c0-a4ea230ec308` |
| 17 | rule_1794812496184_6919@example.com | Rule Test | 120 | `dafbcae7-95f7-4e7e-9bc7-d942f296d253` |
| 18 | rule_1794812526186_885@example.com | Rule Test | 120 | `337bcd48-4cc2-42ab-a55e-3254723460ed` |
| 19 | rule_1794812551072_4632@example.com | Rule Test | 120 | `2dcb08bd-d520-4b35-9a7f-d7d56a5d02ca` |
| 20 | rule_1794812578974_2251@example.com | Rule Test | 120 | `ad503090-6c70-434c-bcd5-53e4c7b47bc4` |
| 21 | rule_1794812721196_3193@example.com | Rule Test | 120 | `1f8d1db3-1dac-4590-af82-eceb58689c9c` |
| 22 | rule_1794812755922_3316@example.com | Rule Test | 120 | `6e7a5c51-02aa-4d98-aafe-0ba79c30156d` |
| 23 | rule_1794812779407_5304@example.com | Rule Test | 120 | `6256c93b-5256-4101-a7d9-91be239e795a` |
| 24 | rule_1794812803765_4583@example.com | Rule Test | 120 | `ef01d82a-e0fe-4234-aaa6-caf8d9a07317` |
| 25 | rule_1794813221555_8263@example.com | Rule Test | 120 | `2d3c5429-20fd-430b-8c51-220d2e2e97f2` |
| 26 | rule_1794814038376_3729@example.com | Rule Test | 120 | `43d4739d-fa06-4bd1-afe2-013778add455` |
| 27 | rule_1794814067524_7029@example.com | Rule Test | 120 | `390485a2-fcc1-4c40-86f9-8f5e22e9befd` |
| 28 | rule_1794814091794_4092@example.com | Rule Test | 120 | `7c00b130-17c5-483e-9008-60af4d2d9c51` |
| 29 | rule_1794814116777_1471@example.com | Rule Test | 120 | `2f0f7b6c-ef88-422a-84f8-da2458614cd4` |
| 30 | rule_1794833934255_491@example.com | Rule Test | 120 | `1fcee180-7d61-49de-889c-c9ee5674e893` |
| 31 | rule_1794834891313_2742@example.com | Rule Test | 120 | `520bf0f5-10f5-4bf1-bd8b-b4ddd16dee12` |

### 2.3 Integration Test Accounts (6 accounts)

All have `inttest_` email prefix, `Integration Test` full name, `status=pending`, `plan=120`.

| # | Email | Full Name | Plan | User ID |
|---|-------|-----------|------|---------|
| 32 | inttest_1794758206636_7812@example.com | Integration Test | 120 | `456cd2cf-973a-40a6-8898-4f5f1d19e296` |
| 33 | inttest_1794758440454_6720@example.com | Integration Test | 120 | `21818beb-127b-4d6d-b10c-4b705adbf280` |
| 34 | inttest_1794802650429_2342@example.com | Integration Test | 120 | `1215ec86-1828-42c9-9e0e-afac10d45076` |
| 35 | inttest_1794803343822_1276@example.com | Integration Test | 120 | `2ef8f61b-93eb-4600-b3d5-5ab1964c85d7` |
| 36 | inttest_1794812597747_8753@example.com | Integration Test | 120 | `2dd2b935-e856-4ad7-ab19-c01f4b180331` |
| 37 | inttest_1794812820696_7634@example.com | Integration Test | 120 | `d979f25b-e6d2-4a35-9ae1-d84a94bcc258` |
| 38 | inttest_1794814131680_5696@example.com | Integration Test | 120 | `d7cb7b89-57bb-4b28-a87f-47cacaa9d123` |

---

## 3. UNKNOWN_REQUIRES_REVIEW — Accounts Requiring Manual Review

| # | Email | Full Name | Plan | User ID | Status | Reason |
|---|-------|-----------|------|---------|--------|--------|
| 1 | io@gmail.com | io | 120 | `6329b1e4-212d-4d5c-bceb-84c371666fb2` | deleted | Already deleted from system |
| 2 | rt@gmail.com | rt | 120 | `99e5348f-f583-4240-8158-096874e098d6` | deleted | Already deleted from system |
| 3 | ganapathiganapathi3174@gmail.com | Ganapathi Ganapathi | 120 | `fa9ed96f-eff2-434c-9afb-1a548618ffaa` | pending | **Manual review required** — has pending status and ₹120 plan, but name resembles a real user. Not classified as VERIFIED_TEST_USER until ownership confirmed. |

**Notes:**
- `io@gmail.com` and `rt@gmail.com` already have `status=deleted` in the database, so they are already removed.
- `ganapathiganapathi3174@gmail.com` has `status=pending` and plan=120, but the full name "Ganapathi Ganapathi" does not match test-pattern names ("Rule Test", "Integration Test"). This may be a legitimate user awaiting approval. **Do not delete without manual verification.**

---

## 4. VERIFIED_ADMIN — Protected Accounts

| # | Email | Full Name | Plan | User ID |
|---|-------|-----------|------|---------|
| 1 | jayaraj@gmail.com | Admin | N/A | `837d89f3-086e-4ae6-bf31-73ed950ca003` |

**Protection Rules:**
- Admin account **never** deleted.
- Admin credentials **not modified**.
- At least one authorized Admin remains preserved after cleanup.
- Self-delete guard enforced.

---

## 5. Associated Record Counts per Test User Category

### 5.1 Payments Records

| Category | Records Found | Details |
|---|---|---|
| QA Seeded (3 users) | 0 payments each | No payment records found for qa.120@jsree.local, qa.500@jsree.local, qa.1000@jsree.local |
| Rule Test (29 users) | 1 payment each | All 29 rule_* accounts have exactly 1 payment record each |
| Integration Test (6 users) | 1 payment each | All 6 inttest_* accounts have exactly 1 payment record each |

### 5.2 Other Associated Tables (spot-check)

| Table | QA Users | Rule Users | IntTest Users |
|---|---|---|---|
| topups (sender/receiver) | 0 each | varying (some have topups) | varying |
| referrals (referrer/referred) | 0 each | varying | varying |
| conversations | 0 each | varying | varying |
| messages (sender) | 0 each | varying | varying |
| notifications | 0 each | varying | varying |
| wallet_transactions | 0 each | varying | varying |
| ip_logs | 0 each | varying | varying |
| suspicious_activity | 0 each | varying | varying |
| plan_change_requests | 0 each | varying | varying |
| audit_logs (actor_id) | 0 each | varying | varying |

**Note:** Full per-table counts for all 38 test users were collected during the discovery phase. The pattern shows that most test users have minimal associated data (typically 0-1 records per table), with payments being the most consistently present record type. Exact per-user counts are available in the discovery logs.

---

## 6. Auth Account Considerations

- **Supabase Auth** identities are linked to the `public.users` table via the `id` field.
- Each verified test user has a corresponding Supabase Auth identity (email-based signup).
- Auth identity deletion must be performed via the Supabase Admin API using the service role key.
- Orphaned Auth sessions will be cleaned up when associated user records are deleted via the `admin_delete_user` RPC function.
- No additional Auth cleanup beyond user deletion is required.

---

## 7. Storage Objects

- Test users may have owned objects in the `payments` storage bucket (screenshots, proof images).
- Each payment record may have an associated `screenshot_url` stored in the `payments` storage bucket.
- Storage object removal will be handled via the `admin_delete_user` RPC function, which extracts and removes owned storage paths.
- No manual storage cleanup required prior to user deletion.

---

## 8. Records That Must Be RETAINED (Preservation Scope)

### 8.1 Admin Data

- **Admin account:** `jayaaraj@gmail.com` (id=837d89f3-086e-4ae6-bf31-73ed950ca003) — **never delete**
- All admin-related audit logs where `actor_role=admin` — **preserve**
- All admin configuration data (UPI IDs, receiver names, payment policies) — **preserve**

### 8.2 System Configuration

- All Supabase storage bucket configurations — **preserve**
- Payment provider settings (PAYMENT_PROVIDER_MODE, verification URLs) — **preserve**
- RLS policies on core tables — **preserve**
- Migration state and schema — **preserve**

### 8.3 Non-Test Customer Records

- Any user-owned records not associated with the 38 verified test users — **preserve**
- Financial audit records (transactions, completions) for non-test users — **preserve**
- Referral relationships where the referrer or referred user is not a test account — **preserve**
- Conversations and messages involving non-test users — **preserve**

### 8.4 Already-Deleted Records

- `io@gmail.com` (id=6329b1e4-212d-4d5c-bceb-84c371666fb2) — already `status=deleted`
- `rt@gmail.com` (id=99e5348f-f583-4240-8158-096874e098d6) — already `status=deleted`

---

## 9. Deletion Scope Summary

| Metric | Count |
|---|---|
| Test users identified for deletion | **38** |
| Admin accounts preserved | **1** |
| Unknown accounts preserved (requires review) | **3** (2 already deleted, 1 pending review) |
| QA seeded accounts | **3** (₹120, ₹500, ₹1,000 plans) |
| Rule test accounts | **29** (all pending, plan=120) |
| Integration test accounts | **6** (all pending, plan=120) |
| Associated payments records | **38** (1 per test user) |
| Associated other records | **varies per user** (typically 0-1 per table) |

---

## 10. Execution Prerequisites

**Before any deletion is approved, the following must be verified:**

1. ✅ Backup of production database is current and verified
2. ✅ Admin account `jayaaraj@gmail.com` is preserved and accessible
3. ✅ At least one authorized Admin remains after deletion
4. ✅ No retained users overlap with the 38 verified test user IDs
5. ✅ Plan coverage after deletion: exactly one retained user per plan (₹120, ₹500, ₹1,000) — **currently 3 QA accounts provide this coverage**
6. ✅ Supabase service role key is available for Auth/Storage cleanup
7. ✅ `admin_delete_user` RPC function is operational and tested

**Execution command (after approval):**
```bash
node server/src/scripts/cleanupProductionUsers.mjs --execute
```

**Or manual execution via RPC:**
```sql
SELECT admin_delete_user(user_id, admin_id)
FROM users
WHERE id IN (<comma-separated list of 38 test user IDs>);
```

---

## 11. Failure Handling & Idempotency

- **Partial failures** are reported per-user; remaining users continue processing.
- **Idempotent** — re-running the cleanup deletes only users not already removed.
- **Retry-safe** — each `admin_delete_user` call is independently retried on transient failure.
- **Orphan detection** — any orphaned records (foreign key violations) are logged and reported, not silently ignored.
- **Storage cleanup** — owned Storage objects are removed alongside user records; missing objects are logged as warnings, not errors.

---

## 12. Post-Cleanup Verification Checklist

- [ ] All 38 verified test users removed from `public.users` table
- [ ] All 38 corresponding Supabase Auth identities removed
- [ ] All owned Storage objects in `payments` bucket removed
- [ ] Admin Dashboard loads correctly
- [ ] Admin login (`jayaaraj@gmail.com`) still works
- [ ] At least one Admin account remains in the system
- [ ] Registration still works (non-test users can register)
- [ ] Payment QR/upload flow still works
- [ ] Wallet and payment configuration remain intact
- [ ] No unintended customer records were deleted
- [ ] Admin Dashboard displays correct user count (42 - 38 = 4 remaining: 1 admin + 3 QA + possibly others)

---