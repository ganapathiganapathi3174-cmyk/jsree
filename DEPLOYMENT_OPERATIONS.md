# Deployment Checklist & Supabase Operations Guide

Authorized operations only. Every step states its pre-condition; if the
pre-condition is not met, STOP at the boundary and record what is missing.
Never run these against an unconfirmed project ref. Never paste credentials
into this file, the repo, or shell history that is committed anywhere.

---

## 0. Pre-flight (must pass before anything below)

- [ ] You have an **explicitly authorized** Supabase project (a dedicated
      TEST project first; production only via your org's change process).
- [ ] You know the project ref (`https://<REF>.supabase.co`) and it matches
      the environment you were authorized to touch.
- [ ] `DATABASE_URL` (direct Postgres connection string) is available for
      that project from Supabase Dashboard → Settings → Database.
- [ ] Server env for the target is configured per `.env.example`:
      `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`,
      `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`,
      `ADMIN_UPI_ID`, `ADMIN_RECEIVER_NAME`.
- [ ] `PAYMENT_PROVIDER_MODE` is unset or `none`, and `PAYMENT_AUTO_APPROVE`
      is NOT `true` (see section 6).
- [ ] No stale/legacy `.env` from old snapshots is being used.

Current repo state note: **no authorized credentials exist in this
workspace** (no `.env`; Docker absent so no local Supabase stack). Every
networked step below is therefore a documented manual procedure, executed
by an operator with the credentials — not from this audit session.

---

## 1. Make the `payments` storage bucket private

The bucket is created `public: true` by `server/src/scripts/run-migration.js`.
The app no longer needs public access: every preview streams through an
authenticated backend proxy that uses `storage.download()` with the
service-role key, so flipping the bucket private requires **zero code
changes**.

### 1a. Review (read-only, run any time with service-role creds)

```bash
# via Supabase CLI (linked to the authorized project):
supabase storage buckets list
# expect: id=payments, public=true  (and id=avatars, public=true — see note)
```

`avatars` stays public by design (profile pictures). Only `payments` changes.

### 1b. Flip (manual, Dashboard — preferred, auditable)

Supabase Dashboard → Storage → `payments` → Settings → turn **Public bucket
OFF** → Save.

### 1b-alt. Flip (SQL, equivalent — run in Dashboard SQL Editor, review first)

```sql
update storage.buckets set public = false where id = 'payments';
select id, public from storage.buckets where id = 'payments';  -- expect public=false
```

### 1c. Revoke any already-issued public URLs

Public URLs are capability URLs: anyone holding the old URL could fetch the
object while the bucket is public. After the flip, object GETs via
`/object/public/...` must fail for unauthenticated clients (verified in
section 3). No separate "revoke" step exists — privacy of the bucket is the
revocation.

---

## 2. Verify all screenshot previews go through authenticated proxies

Code is already wired; this is the live verification matrix. Start the API
(`node server/src/index.js` with the target env) and obtain three JWTs:

- `TOKEN_USER_PENDING` — a user with a pending registration payment
- `TOKEN_USER_ACTIVE` — an active user who submitted a top-up proof
- `TOKEN_ADMIN` — admin JWT (login via the admin endpoint)

For each, the proxy must return **200 + image bytes** (`content-type` starts
with `image/`), never a redirect to a public URL.

| Surface | Endpoint | Token | Expected |
|---|---|---|---|
| Registration proof (user PaymentStatus page) | `GET /payments/:paymentId/screenshot` | `TOKEN_USER_PENDING` | 200 image |
| User top-up proof (user TopUps page) | `GET /topups/:topupId/proof` | `TOKEN_USER_ACTIVE` | 200 image |
| Admin payments review | `GET /admin/payments/:paymentId/screenshot` | `TOKEN_ADMIN` | 200 image |
| Admin top-ups review | `GET /admin/topups/:topupId/screenshot` | `TOKEN_ADMIN` | 200 image |

```bash
API=https://<your-api-host>   # or http://localhost:3000

curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  -H "Authorization: Bearer $TOKEN_USER_PENDING" \
  "$API/payments/$PAYMENT_ID/screenshot"          # expect 200 image/*

curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  -H "Authorization: Bearer $TOKEN_USER_ACTIVE" \
  "$API/topups/$TOPUP_ID/proof"                   # expect 200 image/*

curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  -H "Authorization: Bearer $TOKEN_ADMIN" \
  "$API/admin/payments/$PAYMENT_ID/screenshot"    # expect 200 image/*

curl -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  -H "Authorization: Bearer $TOKEN_ADMIN" \
  "$API/admin/topups/$TOPUP_ID/screenshot"        # expect 200 image/*
```

### 2b. Negative auth checks (must fail)

```bash
# no token -> 401
curl -s -o /dev/null -w '%{http_code}\n' "$API/payments/$PAYMENT_ID/screenshot"
# wrong user's token on someone else's topup -> 403 (sender/receiver/admin only)
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN_OTHER_USER" "$API/topups/$TOPUP_ID/proof"
# inactive/pending user hitting active-only topup route -> 403
curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN_USER_PENDING" "$API/topups/$TOPUP_ID/proof"
```

### 2c. Browser pass

Open each of the four surfaces in the app (Payment Status page, user TopUps,
admin Payments, admin TopUps) and confirm the image renders after the bucket
is private. All four use `client/src/components/PaymentScreenshot.jsx`,
which fetches the proxy endpoint with the session token.

---

## 3. Confirm direct public URLs no longer grant access

After section 1, from a **logged-out** context (no cookies, no Authorization
header), take a stored `screenshot_url` value from the `payments` or `topups`
table (visible to admins only — do not paste it into tickets) and request it:

```bash
# URL shape: https://<REF>.supabase.co/storage/v1/object/public/payments/<path>
curl -s -o /dev/null -w '%{http_code}\n' "$PUBLIC_URL"
# expect: 400 or 403 (NOT 200). 200 = bucket still public -> back to section 1.
```

Also confirm the bucket listing is not enumerable:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  "https://<REF>.supabase.co/storage/v1/list/payments"
# expect: non-200 without service-role key
```

Record the two status codes in the deployment log.

---

## 4. Apply migration 017 — authorized TEST project only

### 4a. Review history (done in this audit; re-confirm before applying)

- Files: `supabase/migrations/001 … 017` (017 = `payment_verifications`,
  append-only history; RLS enabled, **no policies** → service-role only).
- 017 is additive (`CREATE TABLE IF NOT EXISTS` + indexes + RLS); it does
  not alter existing tables and is safe to re-run.
- 017 is **not yet applied to any database** from this workspace.
- Optional read-only pre-check of target schema (Dashboard SQL Editor):

```sql
select to_regclass('public.payment_verifications');  -- expect null before, table name after
select relrowsecurity from pg_class
 where oid = 'public.payments'::regclass;            -- expect true (RLS on existing tables)
```

### 4b. Apply — guarded script (preferred; refuses without explicit env)

The script at `server/src/scripts/apply-migration-guarded.mjs` runs the file
in a transaction with an advisory lock and **refuses** unless all guard env
vars are set and the Supabase project ref matches the stated target. It also
refuses non-"test" refs unless `ALLOW_NON_TEST_TARGET=I_UNDERSTAND`.

```bash
export DATABASE_URL='postgres://...<from Dashboard, test project>...'
export SUPABASE_URL='https://<TEST_REF>.supabase.co'
export MIGRATION_TARGET_PROJECT_REF='<TEST_REF>'
export MIGRATION_CONFIRM='017_payment_verification_history.sql'

node server/src/scripts/apply-migration-guarded.mjs 017_payment_verification_history.sql
# expect: "DONE: migration applied and committed." plus "RLS enabled: true"
```

Expected console proof (safe to paste, contains no secrets):

```
Target project ref : <TEST_REF>
Migration          : 017_payment_verification_history.sql
Table before/after : (absent) -> payment_verifications
RLS enabled        : true
DONE: migration applied and committed.
```

### 4c. Apply — alternative (Dashboard SQL Editor)

Paste the **contents of `017_payment_verification_history.sql`** (reviewed in
4a) into the SQL Editor of the authorized TEST project and run once. Then
re-run the 4a pre-check: `to_regclass` must now return
`payment_verifications`.

### 4d. Boundary

- Production: do **not** run 4b/4c against production from this checklist.
  Production application follows your org's release process, after the test
  project has soaked (section 5 suites green on test).
- If `DATABASE_URL` / service-role key is unavailable → stop here; the
  migration stays unapplied. Nothing in the running app depends on 017
  existing (history writes are best-effort audit rows).

---

## 5. Run integration tests only with valid isolated credentials

Integration suites (`api.test`, `business-rules.test`, `cache-stats-auth.test`,
and the DB paths inside `seed-default-users.test.js`) query a **real**
database. They must not run against production or against placeholder URLs.

### 5a. Env gate (all required, from the authorized TEST project)

```bash
export SUPABASE_URL='https://<TEST_REF>.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='<test project service-role key>'
export SUPABASE_ANON_KEY='<test project anon key>'
export JWT_SECRET='<random 32+ char secret for the test env>'
# optional but recommended for full-fidelity suites:
export ADMIN_EMAIL=... ADMIN_PASSWORD_HASH=... ADMIN_UPI_ID=... ADMIN_RECEIVER_NAME=...
```

Preflight — confirm you are on the right project before running anything:

```bash
node -e "console.log(new URL(process.env.SUPABASE_URL).host)"   # must print <TEST_REF>.supabase.co
```

### 5b. Run

```bash
cd server
npx vitest run src/tests/integration
npx vitest run src/tests/unit/seed-default-users.test.js
```

### 5c. Boundary

- With **no** env (current workspace state): integration suites are
  **expected to fail** (client cannot construct / queries hit nothing).
  This is environmental, not a code regression. Offline suites
  (payment-*, sender-name, provider, decision, admin-rbac) already pass
  with placeholder env and are not re-run here.
- Never point these suites at production. Never "fix" a failing integration
  test by weakening assertions.

---

## 6. Keep payment auto-approval disabled until a real sandbox E2E exists

### 6a. Current state (verified in code)

- `PAYMENT_PROVIDER_MODE` unset → `none`. No provider credentials exist.
- Engine-approved proofs **retain** `PENDING_VERIFICATION` / manual review;
  no automatic settlement path is active.
- `PAYMENT_AUTO_APPROVE` enables only on the literal string `'true'`
  (`paymentConfig.js:isPaymentAutoApproveEnabled`). Provider mode `mock` is
  refused in production (degrades to `none`).

### 6b. Confirm on the target env before every deploy

```bash
# in the server env file for the target — expect both lines ABSENT or:
# PAYMENT_PROVIDER_MODE=none
# (no line) PAYMENT_AUTO_APPROVE=            <- must NOT be 'true'

node -e "
  const { isPaymentAutoApproveEnabled } = await import('./src/config/paymentConfig.js');
  console.log('autoApprove:', isPaymentAutoApproveEnabled());
" --input-type=module
# expect: autoApprove: false
```

### 6c. Gate to ever enable (all must be true — currently none are)

- [ ] A real provider sandbox account exists (verify URL + API key).
- [ ] One genuine sandbox transaction has been verified end-to-end:
      upload → engine decision → provider confirmation → DB status →
      activation/wallet credit → exactly-once (no double credit on retry).
- [ ] Failure paths tested: provider timeout, wrong amount, replayed UTR.
- [ ] Change approved by the payment owner; `PAYMENT_AUTO_APPROVE=true`
      added last, with monitoring on `payment_verifications` +
      `audit_logs` for the first live traffic.

Do **not** simulate this with the mock provider or by pre-setting statuses.

---

## 7. Confirm registration activation and wallet credit are idempotent

### 7a. What the code guarantees (verified this audit)

- Registration approval runs inside `approve_initial_payment` (migration
  004), which **early-returns unless the payment is still `pending`** and
  activates the user in the same transaction; RPC is service-role only
  (migration 014). The service layer additionally treats re-activation of an
  already-active user as a no-op (guarded update, `paymentService.js`).
- Wallet credits go through `credit_wallets_atomic` (migration 015) with
  idempotency keys (migration 012); top-up credit is gated by an atomic
  status transition (`topupService.js`), so a double-claim cannot credit
  twice. UTR reuse is blocked by the partial unique index (003) +
  `approved_utrs` (007) → `DUPLICATE_UTR`.

### 7b. Live verification on the TEST project (after section 4/5)

1. Approve a pending registration payment twice (second call may be a retry
   of the same admin action or a second admin):

```sql
-- expect user stays single 'active', payment stays 'approved',
-- and created_at of wallet/referral effects does not duplicate:
select id, status, updated_at from payments where id = '<PID>';
select id, status, current_plan from users where id = '<UID>';
```

2. Claim/retry a top-up credit twice (API retry or replayed claim):

```sql
-- expect exactly ONE wallet_transaction row per topup idempotency key:
select count(*), min(amount) from wallet_transactions
 where idempotency_key like '%<TOPUP_ID>%';
-- expect: 1 row
```

3. Re-submit an already-approved UTR (payment or top-up):
   expect `DUPLICATE_UTR` / rejection — no second approval, no credit.

Automated coverage already passing offline: `wallet-service`,
`topup-verification`, `topup-claim`, `topup-direct`, `parity-membership-topup`
(140/140 in the last audit run). The live steps above close the loop on a
real database.

---

## Deployment gate summary

| # | Gate | Status from this workspace |
|---|---|---|
| 1 | Bucket private | **Ops action** — code ready; needs authorized Supabase access |
| 2 | Proxies verified live | **Code-verified offline** (see §8); live matrix pending ops |
| 3 | Public URLs dead | **Ops action** — depends on gate 1 |
| 4 | 017 on TEST project | **Guard script verified offline** (see §8); live apply pending creds |
| 5 | Integration suites on isolated creds | **Ops action** — blocked: no authorized env here |
| 6 | Auto-approve off | **Code-verified** (`none` / flag default off); re-check per env |
| 7 | Activation + credit idempotent | **Code+test verified offline**; live double-run pending gate 5 |

---

## 8. Verified results from the offline readiness audit (this workspace)

Environment: no authorized Supabase credentials exist here (no `.env`;
Docker absent → no local stack). All results below are OFFLINE verifications
against code and mocked dependencies. Placeholder values used below are
non-secrets against the non-routable `.invalid` domain; no network calls to
any Supabase project were made.

### 8.1 New offline regression tests (added this audit)

| File | Covers | Result |
|---|---|---|
| `server/src/tests/unit/screenshot-proxy-access.test.js` | All four proxy services/controllers: owner/sender/receiver/admin allowed; other user + unauthenticated + pending user rejected (403/401); missing row → 404; storage failure → generic 404 `SCREENSHOT_UNAVAILABLE` with **no secret leakage** (asserts underlying storage error text never surfaces); `Cache-Control: private, no-store` on success | **26/26 pass** |
| `server/src/tests/unit/migration-guard.test.js` | `apply-migration-guarded.mjs` refusal paths: missing env, wrong `MIGRATION_CONFIRM`, target-ref mismatch, non-test ref without `ALLOW_NON_TEST_TARGET`, malformed/unknown filename, secrets never printed | **8/8 pass** |
| `server/src/tests/unit/admin-approve-idempotency.test.js` | `approvePayment`/`rejectPayment` second-run → `PAYMENT_NOT_PENDING` with **no update/UTR/credit side effects**; proof-less approval blocked | **4/4 pass** |

Command: `npx vitest run screenshot-proxy-access admin-approve-idempotency migration-guard`
→ `Test Files 3 passed (3) | Tests 38 passed (38)`

### 8.2 Full suites (exact commands and counts)

```bash
cd server
# vitest, offline (placeholder non-secret env so the client can construct):
SUPABASE_URL=https://supabase-unit-test.invalid \
SUPABASE_SERVICE_ROLE_KEY=placeholder-... SUPABASE_ANON_KEY=placeholder-... \
npx vitest run
# -> Test Files 58 passed | 7 failed (all environmental, below)
#    Tests 1543 passed | 2 failed | 5 skipped (1550)

node --test src/tests/unit/helpers.test.js src/tests/unit/cache.test.js src/tests/unit/pagination.test.js
# -> tests 28 | pass 28 | fail 0   (these 3 files use node:test, not vitest)

cd ../client
npm test          # -> Test Files 6 passed | Tests 20 passed
npm run build     # -> built in ~21s (474 kB JS / 49.7 kB CSS)
```

The 7 vitest "failed files" are all environmental, not regressions:
`integration/api`, `integration/business-rules`, `integration/cache-stats-auth`
(need a real database — 5 tests skipped/failed without one);
`unit/seed-default-users` (2 cases need DB/network);
`unit/cache`, `unit/helpers`, `unit/pagination` are `node:test` files that
vitest cannot collect (they pass under `node --test`, shown above).

### 8.3 Payment-approval safety (verified at runtime, no env set)

```bash
node --input-type=module -e "const c=await import('./src/config/paymentConfig.js'); \
  const p=await import('./src/services/paymentProviderService.js'); \
  console.log(c.isPaymentAutoApproveEnabled(), p.getProviderMode());"
# -> false none

NODE_ENV=production PAYMENT_PROVIDER_MODE=mock node --input-type=module -e "..." 
# -> logs 'PAYMENT_PROVIDER_MODE=mock is refused in production; falling back to none'
# -> providerMode: none
```

- Missing provider verification → engine outcome parks as
  `PENDING_VERIFICATION`/`manual_review` (no settlement path) — covered by
  `payment-provider-service` + decision suites in the 1543 above.
- No payment statuses were manually altered; no provider success simulated.

### 8.4 Migration 017 status

- SQL reviewed (additive, `IF NOT EXISTS`, RLS enabled, no policies =
  service-role only). **Not applied to any database** — no authorized TEST
  credentials exist here. Guard script verified to refuse every unauthorized
  invocation (§8.1). Live apply remains a §4 operator action.

### 8.5 What was NOT verified here (unchanged boundaries)

1. Live bucket-private flip and live proxy matrix (§1–3) — needs Dashboard
   or service-role access to the authorized project.
2. Integration suites against a real isolated database (§5).
3. Live double-approval / double-credit run on a real database (§7b).
4. Any real provider sandbox transaction (§6c) — provider not configured.

If any required credential or the provider sandbox is missing, stop at that
gate, record the exact missing item (env var name, project ref, provider
account), and hand off to the operator who holds that access.
