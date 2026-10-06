# PROJECT LOGIC REPORT — ReferralHub / jsree

> Reverse-engineered purely from source code at commit `92e3433` (`perf: skip amount recovery once the UPI gate has failed`, 2026-10-04).
> Method: static reading of every route/controller/service/middleware/migration/config file, plus targeted runtime measurement notes carried over from earlier audit sessions.
> No code was modified to produce this document.

---

## 1. Executive Summary

**jsree / ReferralHub** is a paid-membership referral platform: a user registers, pays a one-time membership fee (₹120 / ₹500 / ₹1000) by uploading a UPI screenshot, an OCR pipeline auto-approves or rejects that screenshot, and only then does the account become active. Active users get a referral code, earn a flat 5% wallet bonus when someone they referred pays, move up Bronze/Silver/Gold tiers by referral count, and can send/receive "top-ups" to other users' wallets (each top-up is verified by the *same* OCR engine).

- **Frontend**: React 18 + Vite + Tailwind, SPA on Vercel (`https://jsree.vercel.app`).
- **Backend**: Node 22 / Express 4 (ESM), single process on Render Free (`https://jsree-backend.onrender.com/api`).
- **Data**: Supabase Postgres (15 tables, 12 migrations, **no RLS**) accessed through the supabase-js query builder with the service-role key; Supabase Storage bucket `payments` (public URLs) for screenshots and avatars.
- **Auth**: stateless JWT (`Authorization: Bearer`), bcrypt cost 12; admin identity comes from env vars, role re-read from DB per request.
- **Verification**: `tesseract.js` + `sharp` in-process; binary decision (approve/reject), every uncertainty → reject.
- **Scale signals**: 82 HTTP endpoints, ~19 services, 41 test files (~1,000 tests), no lint/typecheck script anywhere.

Core economic rule set (as implemented): 5% of an approved membership payment is credited to the referrer's wallet (`paymentService.js:138-146`); a completed top-up credits **both** sender and receiver wallets (`topupService.js:324-325`); nothing else mints money.

---

## 2. Repository Layout

```
referral-platform/
├── package.json              # root shim for Railway/Nixpacks (start → npm --prefix server start)
├── render.yaml               # Render Free blueprint (backend, Node 22, secrets sync:false)
├── nixpacks.toml             # root Nixpacks phases for Railway
├── railway.json, server/railway.json, server/vercel.json, */.vercel/project.json
├── README.md, BUG_TRACKER.md, CLIENT_HANDOVER_AUDIT.md, docs/OCI_MIGRATION.md
├── .env.example              # var NAMES only
├── supabase/migrations/      # 001_initial_schema.sql … 012_topup_expiry_and_wallet_idempotency.sql
├── client/                   # React SPA (Vite, Tailwind)
│   └── src/{App.jsx, components/, pages/{user,admin}/, contexts/, utils/, styles/, test/}
└── server/
    ├── package.json          # "main": "src/index.js", type: module, engines node>=22
    └── src/
        ├── index.js          # app assembly, middleware, mounts, timers, error handler
        ├── config/           # cors.js, paymentConfig.js
        ├── routes/           # 15 routers
        ├── controllers/      # 9 controllers
        ├── services/         # 19 services (business logic)
        ├── middleware/       # auth, validation, upload, cache, pagination
        ├── db/supabase.js    # service-role client
        ├── utils/helpers.js  # jwt/bcrypt/referral-code helpers
        ├── scripts/          # ~15 one-off migration/QA/e2e scripts
        └── tests/            # 41 files: unit (mocked) + integration (live DB)
```

Git: single line of history on `main`, 4 recent fix/perf commits (`9fec650`…`92e3433`), remote `ganapathiganapathi3174-cmyk/jsree`, working tree clean except one deliberately untracked diagnostic test (`server/src/tests/unit/diagnostic-full-verification.test.mjs`).

---

## 3. Technology Stack

| Layer | Technology (pinned in package.json) |
|---|---|
| UI | react 18.3.1, react-router-dom 6.26, lucide-react, react-hot-toast, qrcode, axios 1.7 |
| Styling | tailwindcss 3.4 + custom globals.css, `ThemeProvider` dark mode |
| API | express 4.21, express-rate-limit 7.4, express-validator 7.2, helmet 7.1, cors 2.8, cookie-parser 1.4, multer 1.4 (memoryStorage) |
| Auth | jsonwebtoken 9.0, bcryptjs 2.4 |
| DB/Storage | @supabase/supabase-js 2.45 (query builder), pg 8.22 (offline scripts only) |
| OCR/Images | tesseract.js 5.1, sharp 0.33 |
| Test | vitest 4.1.10 (server), vitest 2.1.9 + jsdom + @testing-library (client) |
| Build | Vite 5 (client), no server build (`node src/index.js`) |

No ORM, no queue, no cache layer (Redis absent), no WebSocket (chat polls), no TypeScript, no ESLint/Prettier config.

---

## 4. Deployment Topology & Environments

| Piece | Where | Notes |
|---|---|---|
| Frontend | Vercel, root `client/` | `client/vercel.json` rewrites `/:path* → /index.html`; **no `/api` proxy** → prod must set `VITE_API_URL=https://jsree-backend.onrender.com/api` |
| Backend | Render Free Web Service | `render.yaml`: rootDir `server`, `npm ci \|\| npm install`, start `npm start`, `healthCheckPath /api/health`, NODE_VERSION 22, NODE_ENV production |
| DB | Supabase (managed Postgres) | all app queries; migrations run by hand in SQL editor or scripts |
| Storage | Supabase Storage buckets | `payments` (screenshots + top-up proofs, path `payments/<id>/<file>` and `topups/<id>/<file>`), `avatars` |
| Legacy/alt | `nixpacks.toml` + `railway.json` (Railway), `docs/OCI_MIGRATION.md` (OCI Always-Free) | README still documents Railway as the live backend — see §21 |
| CDN/edge | Cloudflare in front of Render | explains occasional 502s observed during deploys |

Free-tier behaviour matters: Render Free spins down when idle → cold starts take seconds and a deploy/restart window emits a non-Express error page (no CORS headers) which browsers mis-report as a CORS preflight failure. Reproduced live: `OPTIONS` preflight → `204` with correct `access-control-allow-origin` 6/6 once warm; CORS config itself is correct (`server/src/config/cors.js`).

---

## 5. Backend Architecture & Request Lifecycle

`server/src/index.js` assembly order:

1. `app.set('trust proxy', 1)` (`:31`) — required for correct client IPs behind Cloudflare/Render.
2. `helmet()` (`:33`) — defaults, no CSP tuning.
3. `cors(buildCorsOptions())` (`:39-41`).
4. `cookieParser()` (`:42`) — enabled but **no cookie is ever set**; auth is header-only.
5. `express.json({ limit: '10mb' })`, `express.urlencoded({ extended: true, limit: '10mb' })` (`:43-44`).
6. `limiter` — 100 req / 15 min, mounted on `/api/` (`:51`).
7. `authLimiter` — 20 req / 15 min, mounted on `/api/auth/login`, `/api/auth/admin-login`, `/api/auth/register` (`:58-60`).
8. 15 routers (`:62-76`).
9. `GET /api/health` (`:78`), `GET /api/cache-stats` (`:82`).
10. 4-arg error handler → `500 { success:false, message:'Internal server error', code:'INTERNAL_ERROR' }` (`:86`).
11. 5-minute timer `autoExpireStalePayments()` (`:101-110`) — bulk-expires stale payments/top-ups.

Layering convention: **route → controller (HTTP/status mapping) → service (business logic + DB) → supabase client**. Errors are thrown as `{ message, code }` and mapped to HTTP codes in controllers. Two routers (`notifications`, `wallet`, `export`, `receipts`, `security`, `referral-tiers`) keep handlers inline.

---

## 6. Frontend Architecture

**Routes** (`client/src/App.jsx`): public `/`, `/register`, `/login`, `/payment-status`, `/admin/login`, `*`; user (ProtectedRoute + Layout) `/dashboard`, `/profile`, `/payment`, `/topups`, `/referrals`, `/plan-change`, `/chat`, `/history`, `/wallet`, `/notifications`, `/receipts`, `/security`; admin (`adminOnly`) `/admin`, `/users`, `/payments`, `/topups`, `/inactive-users`, `/plan-changes`, `/chat`, `/audit-logs`, `/financial-reports`, `/suspicious-activity`.

**State**: no global store — `localStorage.token` + `localStorage.user` (JSON with `role`, `status`, `current_plan`), `localStorage.darkMode`. `ProtectedRoute` decides: no token → `/login` (or `/admin/login`); `adminOnly && role!=='admin'` → `/login`; non-admin on `/admin*` → `/login`; non-admin with `status ∈ {pending,inactive,suspended}` → `/payment-status`.

**API layer** (`client/src/utils/api.js`): `axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', withCredentials:true, timeout:120000 })`; request interceptor injects `Authorization: Bearer <token>`; response interceptor on 401 clears storage and hard-redirects (`/admin*` → `/admin/login`, else `/login`). No request/response caching, no retry; exports use `responseType:'blob'`.

**Notable frontend facts**: no code splitting/lazy routes; pages call `api.*` inline (no service layer); duplicate logout logic in `Navbar` and `Sidebar`; `DataTable.jsx` and `Skeleton.jsx` are never imported; `.env.example` advertises `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` which are never referenced (dead config).

---

## 7. Database Schema (15 tables)

No PostgreSQL enums and **no RLS / no policies / no GRANTs** anywhere — access control is entirely application-level plus `SECURITY DEFINER` functions with in-function RBAC.

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `users` | accounts | `email` UNIQUE, `password_hash`, `full_name`, `mobile`, `role` ∈ {user,admin}, `status` ∈ {pending,active,inactive,suspended,deleted} DEFAULT 'pending', `current_plan` ∈ {120,500,1000}, `referral_code` UNIQUE, `referred_by` → users (self-FK), `wallet_balance` NUMERIC(10,2) DEFAULT 0 [002], `referral_tier` DEFAULT 'Bronze' [002], `avatar_url` [005], `inactive_reason`, `inactive_since`, `is_deleted`, `deleted_at` |
| `payments` | membership payments | `user_id` FK, `selected_plan`, `expected_amount`, `screenshot_url`, `screenshot_hash` + idx [008], `upi_id`, `receiver_upi` [011], `transaction_id` (the UTR once approved), `status` ∈ {pending,processing,approved,rejected,manual_review}, `rejection_reason`, `verification_attempts`, `verification_result` JSONB, `submitted_at/verified_at/approved_at/rejected_at`, `expires_at` + partial idx WHERE status='pending' [011], `payment_request_created_at` [011], `payment_type` DEFAULT 'MEMBERSHIP' [012] |
| `referrals` | referral edges | `referrer_id`, `referred_user_id` UNIQUE, `referral_code`, `status` ∈ {pending,active,inactive,disabled} |
| `topups` | peer top-ups | `sender_id`, `receiver_id`, `amount` > 0, `plan` ∈ {120,500,1000}, `status` ∈ {created,payment_pending,proof_submitted,verification_pending,approved,completed,rejected,manual_review}, `reference_id`, `screenshot_url`, `screenshot_hash` + idx [012], `verification_result`, `verified_at` [006], `expires_at` + partial idx [012], `receiver_upi`, `payment_type` DEFAULT 'TOPUP' [012] |
| `plan_change_requests` | plan upgrades | `user_id`, `current_plan`, `requested_plan`, `reason`, `admin_note`, `status` ∈ {pending,approved,rejected}, `processed_at` |
| `conversations` / `messages` | support chat | `conversations.user_id` FK; `messages.conversation_id` FK CASCADE, `sender_id`, `sender_role` ∈ {user,admin}, `message`, `read_at` |
| `audit_logs` | immutable trail | `actor_id` nullable, `actor_role` ∈ {user,admin,system}, `action`, `target_id`, `target_type`, `metadata` JSONB, `ip_address` |
| `notifications` | inbox | `user_id` CASCADE, `type` ∈ 11 values, `title`, `message`, `read`, `metadata`; idx `(user_id,read)` |
| `wallet_transactions` | ledger | `user_id` CASCADE, `type` ∈ {credit,debit,refund}, `amount` > 0, `description`, `reference_id`, `reference_type` ∈ {payment,topup,plan_change,referral_bonus}, `balance_after`, **UNIQUE `(user_id,reference_type,reference_id)` WHERE reference_id IS NOT NULL** [012] |
| `referral_tiers` | tiers | `name` UNIQUE, `min_referrals`, `bonus_percentage`, `color` — seeded Bronze 1/5%, Silver 3/10%, Gold 5/15% |
| `ip_logs` | auth forensics | `user_id` SET NULL, `ip_address`, `user_agent`, `event_type` ∈ {login,register,payment,password_change,admin_action}, `metadata` |
| `suspicious_activity` | fraud queue | `user_id`, `ip_address`, `activity_type` ∈ {multiple_accounts_same_ip,rapid_payments,failed_login_attempts,unusual_location,bulk_referrals}, `severity`, `details`, `resolved`, `resolved_by` |
| `approved_utrs` | UTR dedup arbiter | `utr` **UNIQUE**, `reference_type` ∈ {payment,topup}, `reference_id`; idx on `reference_id` |
| `payment_config` | runtime config | `key` UNIQUE, `value` JSONB, `description`, `updated_by`; seeded `receiver_upi`, `payment_window_minutes=30`, `min_ocr_confidence=55`, `plans` |

Indexes worth noting: `idx_payments_expires_at` (partial, `status='pending'`), `idx_topups_expires_at` (partial), `idx_wallet_tx_idempotency` (partial unique), `idx_payments_screenshot_hash`, `idx_topups_screenshot_hash`. `idx_payments_transaction_id_unique` was added in 003 and **dropped in 007** (UTR uniqueness moved to `approved_utrs`).

---

## 8. Migrations 001 → 012

| # | File / change |
|---|---|
| 001 | initial: uuid-ossp, 8 tables (users, payments, referrals, topups, plan_change_requests, conversations, messages, audit_logs), 24 indexes, 2 trigger functions + 6 triggers |
| 002 | + notifications, wallet_transactions, referral_tiers (seeded), ip_logs, suspicious_activity; + `users.wallet_balance`, `users.referral_tier` |
| 003 | de-dupes `payments.transaction_id` (deletes older duplicates) then adds partial UNIQUE |
| 004 | + `SECURITY DEFINER` RPCs `approve_initial_payment`, `delete_pending_registration` |
| 005 | + `users.avatar_url` |
| 006 | + `topups.verification_result`, `topups.verified_at` |
| 007 | + `approved_utrs`, backfills from approved/completed rows, **drops** `idx_payments_transaction_id_unique` |
| 008 | rebuilds status CHECKs to add `manual_review`; + `payments.screenshot_hash` + index |
| 009 | + `admin_delete_user`, `admin_delete_topup` SECURITY DEFINER RPCs |
| 010 | rebuilds topups status CHECK to add `approved` |
| 011 | + `payments.expires_at`, `receiver_upi`, `payment_request_created_at`, partial expiry index; + `payment_config` table (seeded, indexed, updated_at trigger) |
| 012 | + `topups.expires_at/receiver_upi/screenshot_hash/payment_type`, `payments.payment_type='MEMBERSHIP'`, expiry + hash indexes, `idx_wallet_tx_idempotency` |

Caution: 003 and 011/012 backfill a **hard-coded production UPI** `jayarajj126-3@okicici` (also the code fallback in `config/paymentConfig.js:16`).

---

## 9. Database Functions & Triggers

- `generate_referral_code()` — BEFORE INSERT trigger on `users`, fills `referral_code` when `role='user'`.
- `update_updated_at_column()` — BEFORE UPDATE triggers on users/payments/topups/plan_change_requests/conversations/payment_config.
- `approve_initial_payment(p_payment_id, p_admin_id)` — SECURITY DEFINER; locks + approves payment, activates user/plan, ensures referral code, inserts notification (used by admin approve path).
- `delete_pending_registration(p_payment_id, p_admin_id)` — SECURITY DEFINER; deletes an unapproved registration and children, raises `FINANCIAL_HISTORY_EXISTS` when financial rows exist, writes audit log.
- `admin_delete_user(p_user_id, p_admin_id)` / `admin_delete_topup(p_topup_id, p_admin_id)` — SECURITY DEFINER with `SET search_path=public`, child-first cascade (no FK cascade on most user children), returns storage paths, writes audit row.

Because app-level queries run as **service role**, the SECURITY DEFINER functions are the only RBAC boundary inside the database. There is no row-level security: any leaked service-role key is full read/write.

---

## 10. Configuration & Environment Variables

Server (`server/.env`, loaded by `dotenv` in `db/supabase.js` chain; `.env*` gitignored):

| Var | Purpose | Fallback in code |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | DB + storage access (service role used for all app queries) | none — required |
| `JWT_SECRET` | HS256 signing key | missing → `process.exit(1)` on first token use (`helpers.js:5-12`, lazy) |
| `JWT_EXPIRES_IN` | token lifetime | `7d` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH` | admin credential pair (no DB row required; admin auto-created on first login) | `adminLogin` → 500 `ADMIN_NOT_CONFIGURED` if unset |
| `ADMIN_UPI_ID` | receiver UPI shown on QR/config | `jayarajj126-3@okicici` |
| `PORT`, `NODE_ENV` | runtime | Render injects `PORT` |
| `CLIENT_URL` (+ `CLIENT_URLS`, `FRONTEND_URL` read by `cors.js`) | CORS allow-list | hard-coded `https://jsree.vercel.app`, `http://localhost:5173`, `http://localhost:3000` |
| `DATABASE_URL` | offline migration scripts only | — |
| `PAYMENT_TIME_WINDOW_MINUTES` | screenshot freshness window | `30` |
| `MIN_OCR_CONFIDENCE_APPROVE` | OCR confidence floor | `55` |
| `NORMALIZE_UTRS_FOR_DUPLICATE` | UTR normalization switch | off |
| `QA_SEED_PASSWORD` | QA seed script | — |

Client: `VITE_API_URL` (fallback `/api`), `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (declared, unused), `VERCEL_OIDC_TOKEN` (Vercel-internal).

Runtime config table `payment_config` (admin-editable via `PUT /api/config`, cached 60 s in `configService`) holds `receiver_upi`, `payment_window_minutes`, `min_ocr_confidence`, `plans`; `GET /api/config/public` exposes the whitelisted subset minus the confidence value.

---

## 11. Authentication

- **Registration** (`authService.register`, `authService.js:7-105`): duplicate email → 409 `EMAIL_EXISTS`; duplicate mobile → 409 `MOBILE_EXISTS`; referral code uppercased, must exist and referrer `status` not inactive/deleted (400 `INVALID_REFERRAL` / `REFERRAL_INACTIVE`); generates own `REFxxxxxx` (9 chars) with a uniqueness loop; bcrypt cost 12; inserts user with `status:'pending'`, `role:'user'`; audit log + IP log + `checkMultipleAccountsSameIP` + `checkBulkReferrals`; returns `{ user, token }` (201).
- **Login** (`authService.login:107`): bcrypt compare → 401 `INVALID_CREDENTIALS`; `deleted` → 403 `ACCOUNT_DELETED`; `pending` → 403 `PAYMENT_NOT_APPROVED` (with `data.accountStatus`); `inactive`/`suspended` → 403 `ACCOUNT_NOT_ACTIVE`. **Token is only issued for `active` users** (plus admin path).
- **Admin login** (`authService.adminLogin:182`): compares `ADMIN_EMAIL` / `ADMIN_PASSWORD_HASH` (bcrypt), auto-creates the admin user row if absent, issues JWT with `role:'admin'`, writes audit + IP log.
- **Token**: `{ userId, role }`, HS256, `expiresIn = JWT_EXPIRES_IN || '7d'`; `verifyToken` returns `null` on failure. **No refresh, no revocation list** — `POST /auth/logout` only writes an audit row; the browser token is cleared client-side.
- **Request auth**: `middleware/auth.js` `authenticateToken` verifies the Bearer token and re-reads the user row (401 `TOKEN_REQUIRED`/`TOKEN_INVALID`/`USER_NOT_FOUND`).
- Frontend stores the raw JWT in `localStorage` (XSS-readable) and also sends cookies (`withCredentials:true`), though no cookie auth exists server-side.

---

## 12. Authorization & Gating

| Middleware | Rule | Applied to |
|---|---|---|
| `authenticateToken` | valid JWT + user row exists | all private routes |
| `requireAdmin` | `role==='admin'` else 403 `ADMIN_REQUIRED` | all `/api/admin/*` (router-level `admin.js:10-11`), `/api/config` GET/PUT, `/api/export/*`, `/api/security` admin routes |
| `requireActiveUser` | admins bypass; else `status==='active'` (pending → 403 `PAYMENT_NOT_APPROVED`, other → 403 `ACCOUNT_NOT_ACTIVE`) | `/users/dashboard`, `/referrals/my-code\|my-referrals`, `/topups/*`, `/plans/change-request\|my-requests`, `/wallet/*`, `/receipts/*` |
| `optionalAuth`, `extractUser` | non-blocking token parse | **never mounted** (dead) |

Public by design: `POST /auth/register`, `POST /auth/login`, `POST /auth/admin-login`, `GET /referrals/validate`, `GET /plans`, `GET /referral-tiers/tiers`, `GET /config/public`, `GET /health`, `GET /cache-stats`, `GET /payments/:id/status` (token-gated actually), plus `/payment-status` page (client-side token check).

Role/status enforcement is therefore split: server enforces per-route, `ProtectedRoute` mirrors it client-side for UX only.

---

## 13. Validation Layer

`middleware/validation.js` — express-validator chains, all terminating in `handleValidationErrors` → `400 { success:false, code:'VALIDATION_ERROR', field, errors:[...] }`:

- `validateRegistration` (`:17`): `name` 2–100 chars, `email` isEmail, `mobile` 10–15 chars of `[0-9+]`, `password` ≥ 6, `referralCode` optional 3–20, `plan` ∈ {120,500,1000}.
- `validateLogin` (`:45`): email + password present.
- `validatePayment` (`:56`): plan ∈ {120,500,1000}.
- `validatePlanChange` (`:70`): current/requested plan ∈ set, optional reason.
- `validateChatMessage` (`:81`): message 1–1000.
- `validateTopup` (`:63`) and `sanitize` (`:89`) exist but are **never used**.

Upload rules (`middleware/upload.js`): multer `memoryStorage`, MIME allow-list `image/jpeg, image/jpg, image/png, image/webp`, 5 MB max; `handleUploadError` → 400 `FILE_TOO_LARGE` / `INVALID_FILE_TYPE` / `UPLOAD_ERROR`. Avatar endpoint enforces a separate 2 MB cap inside `userController.uploadAvatar`.

Frontend validation: registration checks required/email/password≥6/confirm/plan but **never validates mobile format or referral-code shape**, and never reads the server's `errors[]` array — only `data.message` is shown ("Validation failed").

---

## 14. Complete API Inventory (82 endpoints)

**auth (6)** — `POST /api/auth/register` [+validateRegistration, authLimiter] · `POST /api/auth/login` [+validateLogin, authLimiter] · `POST /api/auth/admin-login` [+validateLogin, authLimiter] · `POST /api/auth/logout` · `GET /api/auth/profile` · `PUT /api/auth/change-password` (all `authenticateToken`).

**users (5)** — `GET/PUT /api/users/profile` · `GET /api/users/dashboard` [+requireActiveUser] · `PUT /api/users/avatar` [+uploadAvatar] · `DELETE /api/users/avatar`.

**payments (5)** — `POST /api/payments` [+validatePayment] · `POST /api/payments/:paymentId/screenshot` [+uploadScreenshot] · `POST /api/payments/:paymentId/verify` (manual re-verify) · `GET /api/payments/:paymentId/status` · `GET /api/payments`.

**referrals (3)** — `GET /api/referrals/my-code` · `GET /api/referrals/my-referrals` (both +requireActiveUser) · `GET /api/referrals/validate` (public).

**topups (5)** — `GET /api/topups` · `GET /api/topups/:topupId` · `POST /api/topups/:topupId/proof` [+uploadTopupProof] · `POST /api/topups/direct` [+uploadTopupProof] · `POST /api/topups/claim` (all +requireActiveUser).

**plans (3)** — `GET /api/plans` (public) · `POST /api/plans/change-request` [+validatePlanChange] · `GET /api/plans/my-requests`.

**chat (5)** — `GET /api/chat/conversations` · `GET /api/chat/unread/count` · `GET /api/chat/messages/:conversationId` · `POST /api/chat/messages` · `PUT /api/chat/read/:conversationId`.

**admin (25, router-level authenticateToken + requireAdmin)** — dashboard, users (`GET`, `GET :userId`, `PUT :userId/status`, `PATCH :userId/password`, `DELETE :userId`, `PUT users/activate`, `GET inactive-users`), payments (`GET`, `PUT :paymentId/approve`, `PUT :paymentId/reject`, `DELETE :paymentId`, `PUT payments/bulk-approve`, `PUT payments/bulk-reject`), topups (`GET`, `DELETE :topupId`), plan changes (`GET`, `PUT :requestId/approve`, `PUT :requestId/reject`, `DELETE :requestId`), chats (`GET`, `GET :conversationId/messages`, `PUT :conversationId/read`, `POST messages`), `GET audit-logs`.

**notifications (5, inline)** — `GET /`, `GET /unread-count`, `PUT /:id/read`, `PUT /read-all`, `DELETE /:id`.

**wallet (2, inline)** — `GET /balance`, `GET /transactions` (+requireActiveUser).

**referral-tiers (2, inline)** — `GET /tiers` (public), `GET /my-tier`.

**export (4, inline, admin)** — `GET /users`, `/payments`, `/topups`, `/financial-summary` (CSV).

**receipts (3, inline, requireActiveUser)** — `GET /my-receipts`, `GET /:paymentId`, `GET /:paymentId/html`.

**security (4, inline)** — `GET /ip-history` (user), `GET /suspicious`, `PUT /suspicious/:id/resolve`, `GET /check-multiple-accounts/:ip` (last three admin).

**config (3)** — `GET /public`, `GET /`, `PUT /` (last two admin).

**index (2, no auth)** — `GET /api/health` → `{success,message:'Server is running',timestamp}`; `GET /api/cache-stats` → `{size, keys[]}` of the in-memory cache.

README documents `GET /referrals/validate/:code` — actual route is query-param `GET /referrals/validate` (drift, §21).

---

## 15. Feature Flows

### 15.1 Registration + first payment (the critical path)
1. `POST /auth/register` (JSON) → user row `status='pending'` + JWT.
2. `POST /payments` (`paymentService.createPayment:160`) → validates plan, rejects if a `pending`/`manual_review` payment exists (`PENDING_EXISTS`) or an `approved` one exists (`PAYMENT_EXISTS`), inserts `status='pending'` with `expected_amount = PLAN_AMOUNTS[plan]`, `receiver_upi = RECEIVER_UPI`, `expires_at = now + 30 min`.
3. Frontend shows QR (`QRPaymentSection`, UPI URI built by `utils/upi.js`) + countdown, then `POST /payments/:id/screenshot` (multipart, field `screenshot`).
4. `paymentService.uploadScreenshot:190` gates: ownership (403), status ∈ {pending, manual_review} (400), **not expired** (410 `PAYMENT_EXPIRED`), SHA-256 hash not already on an **approved** payment (409 `DUPLICATE_SCREENSHOT`); uploads to bucket `payments`, stores `screenshot_url` + `screenshot_hash`, logs.
5. Controller then runs `paymentService.verifyPayment(paymentId, file.buffer)` synchronously (up to minutes); on throw it calls `recordVerificationFailure` which writes a non-decision marker (`decision:null, inconclusive:true`) so the row stays resubmittable but never looks approved.
6. Verification result → `approved` triggers `completeApproval` (§15.8); `rejected` → `rejection_reason` + notification.

### 15.2 Screenshot upload rules (both payments and top-ups)
- multipart, memoryStorage, 5 MB, jpg/png/webp only.
- `sha256(buffer)` duplicate check against **approved/completed** rows only — rejected proofs may be re-used.
- Storage path `payments/<paymentId>/<uuid>.<ext>`; URL obtained via `getPublicUrl` → **publicly fetchable** object URL.

### 15.3 OCR pipeline (`ocrService.js`, 1,135 lines)
Process-wide: `sharp.concurrency(1)` and `sharp.cache(false)` (`ocrService.js:28-29`) to bound peak memory; a single shared Tesseract worker with a scheduler queue (`getOCRScheduler:68`), exit hooks closing workers (`installOCRExitHooks:58`).

Stages (per verification):
1. **Primary pass** — `runOCR:642` on the raw buffer (preprocess via `preprocessImage:95`), returns text + mean confidence.
2. **Additional passes** — `runAdditionalOCRPasses:719`: upscaled (width 2400, `withoutEnlargement:false`) + thresholded variants; candidates unioned.
3. **Amount recovery (3 stages, all conditional)** — `runAmountRecoveryOCR:746` (horizontal strip crops), `runDeepAmountRecovery:799` (finer strips/regions), `verifyAmountWithCurrencyRecovery:909` (targets ₹-read-as-2 corruption, accepts only when a strategy yields the exact expected amount).
4. Extraction: `extractAmounts:214` (incl. `wordToNumber:179`), `extractUPIs:267`, `extractUTRs:320`, `extractDates:349`, `extractDateTimes:426`, `extractTransactionStatus:630`; normalizers `normalizeAmount/UPI/UTR`.
5. Matching: `matchAmount:890`, `matchUPI:1025`, `matchUPIWithRecovery:1050` (normalized + masked/GPay-suffix candidates), `isWithinTimeWindow:1116`, `isSameIstDay:611`, `isDemoScreenshot:875`.

**Measured profile** (same synthetic image, production-like settings): real flow = **128 OCR calls** (1 primary + 2 additional + 64 strip + 61 deep; currency recovery skipped when currency already matched) ≈ 75.6 s total (≈51.2 s OCR, ≈24.4 s non-OCR), peak RSS ≈ 318 MB. Worst case (all recovery + currency recovery) = **176 calls**. After commit `92e3433`: on a UPI mismatch the three amount-recovery stages are skipped → **3 calls / ≈11.5 s / ≈299 MB**, decision identical.

### 15.4 Decision engine (`verificationService.js`, 478 lines)
`runScreenshotVerification:90` orchestrates the pipeline; `decidePaymentVerification:53` is the pure gate function:

```
approved = upiMatch && amountMatch && dateValid && utrPresent
           && transactionStatusOk && ocrConfidence >= MIN_OCR_CONFIDENCE_APPROVE
rejected = otherwise      // no manual_review path — every uncertainty rejects
```

Gate order: **1 UPI → 2 amount → 3 date/time → 4 transaction status → 5 UTR → 6 confidence**, each returning a specific `reason` (`UPI_MISMATCH`, `AMOUNT_MISMATCH`, `INVALID_PAYMENT_DATE`, `TRANSACTION_FAILED`, `MISSING_UTR`, `LOW_OCR_CONFIDENCE`).

Additional rules around the pure function:
- `DEMO_SCREENSHOT` marker → instant reject (`:175-211`).
- UPI is resolved **before** amount recovery (`:213-225`, commit `92e3433`); when UPI fails, recovery is skipped and diagnostics keep primary-pass values — decision/reason provably unchanged.
- Date validity = same IST day **and** within `[now − 30 min, now + 30 min]` (`:287-296`).
- `transactionStatus?.status === 'success'` only (`:301`).
- Field-confidence gate: all five `fieldConfidence` entries must be `high` else downgrade to `LOW_FIELD_CONFIDENCE` (`:349-368`).
- Result payload includes `checks`, `detected`, `fieldConfidence`, `upiDiagnostics`, `ocrPassInfo` for admin debugging; `decision`/`reason` are the contract.

### 15.5 UTR duplicate protection
- `normalizeUtr:436` (strip whitespace, uppercase); `reserveApprovedUtr:451` = `INSERT` on `approved_utrs` (UNIQUE) → `23505` means duplicate; never SELECT-then-INSERT; `releaseApprovedUtr:470` compensates on later failure.
- Payments: `applyPaymentUtrPolicy:259` reserves **only on approve**; duplicate → reject `DUPLICATE_UTR`.
- Top-ups: same guard inside `applyTopupVerification` after the status flip.
- Only previously **approved** records live there, so a UTR from a rejected attempt never blocks a future approval.

### 15.6 Expiry (30-minute window)
- Set once at creation, immutable (`payment_request_created_at`, `expires_at`).
- Checked **pre-upload** (410), **pre-OCR** (410), and **post-OCR pre-commit** (if approved but expired → release UTR, reject `PAYMENT_EXPIRED`).
- Background sweeper `autoExpireStalePayments` (`paymentService.js:632`) every 5 minutes bulk-expires stale `payments` and top-ups in `created`/`payment_pending`.

### 15.7 Payment approval (`completeApproval`, `paymentService.js:61-158`)
Critical (rolled back together): ① payment → `approved` (guarded `WHERE status IN ('pending','manual_review')`) ② user → `active` + `current_plan = selected_plan` (only when currently `pending`) ③ ensure `referral_code` ④ create `payment_approved` notification — any failure triggers `rollbackApproval:56` (payment back to `pending`, user back to `pending`).
Non-blocking side effects: referrer eligibility check (`checkAndDeactivateReferrer`), **5 % wallet credit to the referrer** (`expected_amount * 0.05`, `reference_type='referral_bonus'`) + `wallet_credit` notification, tier upgrade checks for both user and referrer. Finally an audit entry.

Admin path uses the same logic via `approvePayment:474` (plus UTR reservation) or the DB RPC `approve_initial_payment`.

### 15.8 Top-ups
- `createTopup` / `createDirectTopup` insert with `expires_at = now + 30 min`; direct flow resolves the sponsor (referrer) as receiver.
- Proof upload reuses the identical gates (ownership, status, expiry, duplicate hash) and the **same** `runScreenshotVerification` engine with `expectedAmount = topup.amount`.
- `applyTopupVerification:251`: approve → single guarded status flip to `completed`; if 0 rows, reconcile via `creditSenderOnce`/`creditReceiverOnce`; then post-flip expiry recheck (revert to `rejected`), then UTR reservation, then credit **both** sender and receiver wallets (idempotent via `wallet_transactions` unique index + per-user existence check).
- `claimTopupForReceiver:120` is now effectively a no-op: completed top-ups return "already completed", anything else → 400 `NOT_CLAIMABLE` (leftover of the old two-phase claim design).
- `verifyTopup:390` (admin approve/reject) additionally sets the **receiver** to `status='inactive'` with `inactive_reason='inactive_due_to_referral_condition'` — a business rule inherited from the older referral-condition design; it is not applied by the auto-OCR path.

### 15.9 Wallet ledger
`walletService`: `getBalance` (reads `users.wallet_balance`), `credit:14` / `debit:41` do a **read-then-write** (`balance ± amount` then `update`) plus a `wallet_transactions` row with `balance_after` — not a single atomic SQL statement, but double-credit is prevented by the partial UNIQUE index + existence checks at call sites. `refund:71` is an alias of `credit` and is never called. No spending/withdrawal path exists: the balance is display-only plus top-up crediting.

### 15.10 Referrals & tiers
- Code = `'REF' + 6 chars` (`generateReferralCode`, both DB trigger and JS version).
- Link captured at registration (`users.referred_by`), row in `referrals` with `status='pending'`, activated on payment approval.
- Bonus: flat **5 % of the referred user's approved payment amount** (not tier-based); `referral_tiers.bonus_percentage` is stored but **not used in any payout calculation**.
- Tier upgrade `referralTierService.checkAndUpgradeTier:48` on every approval (both parties).

### 15.11 Plans & plan changes
`planService.PLANS` = `120 Basic / 500 Standard / 1000 Premium` (id is a string, amount numeric; DB `current_plan` is an integer CHECK'd to the same three values). Change request requires `status='active'`, different plan, no existing pending request; admin approve updates `plan_change_requests` + `users.current_plan` in one flow with audit; reject sets status + audit. No proration/refund logic.

### 15.12 Chat, notifications, receipts, export, audit, security
- Chat: one conversation per user (`getOrCreateConversation`), user/admin messages with `sender_role`, read markers, unread counts; frontend polls (no realtime).
- Notifications: 11 typed rows, unread count endpoint, read/read-all/delete scoped by `user_id`.
- Receipts: read-only DTO builder (`paymentReceiptService`) with HTML rendering; no DB writes.
- Export: CSV strings for users/payments/topups/financial summary (admin only).
- Audit: `auditService.logAction` inserts and **swallows errors** (never breaks a business flow).
- Security endpoints: IP history for self; suspicious-activity list/resolve and "who else used this IP" for admins.

### 15.13 Account status lifecycle
`pending → active` (payment approved) · `active → inactive` (admin, or referral condition via top-up verify) · `inactive → active` (admin `activateUser`) · `→ suspended` (admin) · `→ deleted` (admin cascade delete RPC or soft-delete flag). Dashboard access is gated by `requireActiveUser`; `getPaymentStatus` still works for pending users so they can retry before the 30-minute window closes.

---

## 16. Security Posture

**Strengths**: helmet defaults; CORS allow-list (never `*`) with server-side logging of blocked origins; `credentials:true`; bcrypt cost 12; JWT secret required (hard fail); rate limiting global (100/15 min) + auth (20/15 min); 10 MB JSON cap; parameterized queries throughout (supabase-js builders; raw SQL only in offline scripts); upload MIME + size allow-list; ownership checks on payment/topup/chat reads; admin routes uniformly double-guarded; unique UTR + screenshot-hash + wallet idempotency constraints; audit trail on privileged actions; secrets gitignored, only `.env.example` tracked.

**Findings (all code-verified)**:

| Severity | Finding |
|---|---|
| High | `GET /api/cache-stats` is **unauthenticated** and returns cache keys of the form `userId:originalUrl`, leaking active user IDs + visited paths (`index.js:82`, `middleware/cache.js:29`). Mitigating factor: `cacheMiddleware` is never mounted, so it always returns `{size:0,keys:[]}` in production. |
| High | Supabase Storage objects (payment screenshots, top-up proofs, avatars) are served via `getPublicUrl` → guessable `uuid.ext` URLs with **no signed URLs and no RLS**; anyone with the URL can read payment proof images (`paymentService.js:234`, `topupService.js:188`, `userController.js:117`). |
| Medium | CORS also allows **any `https://*.vercel.app` origin** (`config/cors.js:58-60`) — an attacker-controlled Vercel app can make credentialed cross-origin calls. |
| Medium | JWT in `localStorage` (XSS-exfiltratable), no revocation/refresh, 7-day lifetime; logout does not invalidate. |
| Medium | No RLS and app uses the service-role key for every query — a single leaked key bypasses all application checks. |
| Medium | `walletService.credit/debit` are read-then-write (race window), compensated only by call-site existence checks + unique index. |
| Low | Top-up approval credits **both** sender and receiver wallets for the same amount (`topupService.js:324-325`) — money is minted 2× per completed top-up. This may be intended ("sender re-credits their own balance"), but nothing in the code documents it; worth an explicit product decision. |
| Low | Rate limiter uses a single in-memory store → resets on each Render restart; Free-tier restarts weaken brute-force protection. |
| Low | `GET /referrals/validate` is public enumeration of referral codes (existence oracle). |
| Info | `cookie-parser` mounted but unused; `X-Powered-By` removed by helmet; `trust proxy 1` correct for Render+CF. |

---

## 17. Testing Strategy & Baseline

- Runner: `npx vitest run` inside `server/` (vitest is in `server/node_modules`; **no `test` script in package.json**, no lint/typecheck anywhere in the repo).
- **41 test files**, ~1,000+ assertions: pure unit tests for OCR extraction/normalization/matching (`ocr`, `gpay-*`, `provider-agnostic`, `strict-verification`, `futureproof-audit`, `hardening-audit-2`), decision/parity tests (`parity-membership-topup`, `verification-*`, `payment-verification*`), expiry (`expiry-lifecycle`, `expiry-security`, `payment-expiry`, `payment-timezone`), top-up flows (`topup-*`), auth/authz (`auth-role-separation`, `helpers`), admin/config/export (`admin-config`, `admin-delete`, `approved-utr`), CORS (`cors`), dead-in-prod middleware (`cache`, `pagination`), QA seeding (`seed-default-users`).
- **Integration**: `integration/api.test.js` + `integration/business-rules.test.js` need a live Supabase + server on `localhost:5000`.
- **Stable baseline** (unchanged before/after recent commits): 6 failed *files* — `cache`, `helpers`, `pagination` (node:test-style files vitest can't collect), `seed-default-users` (flaky 5 s DB timeouts), and the 2 integration files; latest run 4 failed tests / 1085 passed. The recent perf commits added `verification-shortcircuit.test.js` (6 tests) which fails 2/6 against the pre-change implementation (genuine guard) and passes now.
- Client tests: `RegisterPage.test.jsx`, `utils/api.test.js` (jsdom + testing-library), `npm test` = `vitest run`.

---

## 18. Dead Code & Leftovers (verified by repo-wide grep)

- **Dead file**: `server/src/services/registrationStatusService.js` (0 references; was introduced by BUG-012 fix, later superseded by `requireActiveUser`).
- **Dead exports**: `middleware/auth.js` → `optionalAuth`, `extractUser`; `middleware/validation.js` → `sanitize`, `validateTopup`; `middleware/cache.js` → `cacheMiddleware`, `clearCache`; `middleware/pagination.js` → `paginate`, `paginatedResponse` (tests only); `utils/helpers.js` → `validateEmail`, `formatDate`; `referralService.deactivateUser`; `ipLogService.getUsersForIP`; `suspiciousActivityService.checkRapidPayments`; `walletService.refund`; `db/supabase.js` → `supabaseAnon`.
- **Dead frontend**: `components/DataTable.jsx`, `components/Skeleton.jsx` (never imported); unused env `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- **Leftover scripts**: `server/src/scripts/*` (~15 one-off migration/e2e/check scripts, only `seedDefaultUsers.js` wired to `npm run seed:qa-users`), root `server/live-diag.mjs` (hardcoded prod URL + receiver UPI), `server/runtime-proof.mjs`, untracked `server/stderr.log`.
- **Unused imports**: `routes/chat.js:4` `validateChatMessage`, `routes/admin.js:3` `chatController`.
- No commented-out code blocks anywhere (only explanatory comments).

---

## 19. Known Issues & Open Risks

1. **Register 400 diagnosis (unresolved)** — Exhaustive enumeration of every 400 path reachable from `POST /auth/register`: `validateRegistration` field failures (`name` 2–100, `email` isEmail, `mobile` 10–15 `[0-9+]`, `password` ≥6, `referralCode` 3–20, `plan` ∈ set) and `authController` `INVALID_REFERRAL` / `REFERRAL_INACTIVE`. Ruled out: field-name mismatch (frontend emits exactly `name,email,mobile,password,referralCode,plan`), plan number-vs-string (both pass), duplicates (409), rate limit (429), missing `role` (hardcoded), malformed JSON (→500), global sanitizer (unused), Vercel rewrite (frontend calls Render directly), referral-code length (`REF`+6 = 9 ≤ 20). **Still needs the actual Network response body (`errors[]`) or the Render log to name the failing field** — the frontend only surfaces `data.message` ("Validation failed") and never renders `data.errors[]`.
2. **Frontend error surfacing gap** — the registration form cannot display per-field server errors (repo-wide grep: zero reads of `errors[]`).
3. **Client-side-only form validation** for mobile/name-length/referral-code; server is the only real gate (fine) but users get a generic failure.
4. **OCR latency/cost** — a full pass is 128 calls ≈ 75 s on the production image class; `runAdditionalOCRPasses` alone costs ≈21.6 s for 2 calls because `resize({width:2400, withoutEnlargement:false})` upscales a 892 px screenshot to 2400×4488 (≈43 MB buffer). Only 2 of those passes produced byte-identical duplicate buffers in the measured run. Only amounts feed these passes (UPI/date/UTR come from the primary pass), so further short-circuiting is possible.
5. **Free-tier 502 cold starts** masquerade as CORS failures in the browser console (no `access-control-allow-origin` on the error page).
6. **`manual_review` legacy status** is hidden from users (surfaced as `pending`) and resolved on next upload — correct, but the status still exists in the CHECK constraint and admin lists.
7. **README / BUG_TRACKER drift** — see §20.
8. **`claimTopup` two-phase API is vestigial** (always "already completed" or 400) while the frontend still shows a claim action.
9. **`referral_tiers.bonus_percentage` unused** in any payout (5 % is hard-coded).
10. **Test baseline is red** (6 files) — CI cannot be "green" today; two failures are environment-dependent (node:test files, live DB).
11. **No dependency scanning / lint / type checking** configured.
12. **`verifyTopup` admin-approve sets receiver to `inactive`** — an easy-to-miss side effect that will surprise operators.

---

## 20. Documentation Drift (docs vs code)

| Doc claim | Reality |
|---|---|
| README: backend live at `…up.railway.app` | Live backend is `https://jsree-backend.onrender.com/api` (`render.yaml`) |
| README: "all 4 migrations 001-004 applied" | 12 migrations exist (001…012) |
| README: `GET /referrals/validate/:code` | `GET /referrals/validate` (query param) |
| README: local backend port 5000 / env `ADMIN_PASSWORD` | dev proxy targets 5000; prod env is `ADMIN_PASSWORD_HASH` |
| README: storage bucket "private" with service-role read | code uses `getPublicUrl` (public objects) |
| `BUG_TRACKER.md`: 12/12 fixed, 0 remaining | still accurate as history, but the table's "P2 HIGH" heading is duplicated and the file predates expiry/UTR/OCR-hardening work |
| `.env.example`: `VITE_SUPABASE_*` | never referenced by client code |

---

## 21. Recent Engineering History (git log)

`92e3433` perf: skip amount recovery once UPI gate failed · `da61f30` perf: optimize OCR memory usage (sharp concurrency/cache) · `9fec650` fix: persist payment verification failures (`recordVerificationFailure`) · `db18ea2` fix: prevent register verification from hanging indefinitely · `7904a49` / `56c0552` / `987c2ca` GPay masked-UPI support · `7446b9a` payment expiry countdown + retry · `c52cb86` Render blueprint · `5d6fbe3` OCI containerization · `92124f0` server-authoritative 30-minute expiry · `c19c110` shared expiry + single verification engine for top-ups · `993c181`/`9c81ecb`/`a392699` currency-recovery hardening · `28c8d59`/`05a9fb4` parity + adversarial audit suites · `93d0290` CORS for admin-login.

---

## 22. Data Relationships (ER summary)

```
users 1─* payments            (user_id)
users 1─* referrals (referrer_id)      users 1─1 referrals (referred_user_id UNIQUE)
users 1─* topups (sender_id / receiver_id)
users 1─* plan_change_requests, conversations, audit_logs(actor), notifications,
          wallet_transactions, ip_logs, suspicious_activity
conversations 1─* messages (CASCADE)
payments/topups ──> approved_utrs (reference_id, UNIQUE utr)   [only approved rows]
users ──> users (referred_by self-FK)
payment_config: standalone key/value
referral_tiers: standalone seeded lookup (Bronze/Silver/Gold)
```

Money invariants: `users.wallet_balance` must equal the sum of that user's `wallet_transactions`; idempotency enforced by `idx_wallet_tx_idempotency (user_id, reference_type, reference_id)`. Minting points: membership approval → referrer +5 %; top-up completion → sender +amount **and** receiver +amount.

---

## 23. Operational Notes

- Health: `GET /api/health` (Render `healthCheckPath`) — app-level only, no DB ping.
- Scale-out: **single instance only** — rate limiter, cache map, OCR worker pool and expiry timer are all in-process; running 2 dynos would double OCR memory and split rate limits.
- Memory: Render Free 512 MB is the binding constraint (peak ≈ 318 MB during OCR); `sharp.concurrency(1)`/`cache(false)` were added specifically for this (`da61f30`).
- Deploys: push to `main` → Vercel (client) and Render (server) auto-build; there is **no CI** and Render does not publish commit statuses to GitHub, so deploy health must be checked in the Render dashboard.
- Migrations are applied manually (Supabase SQL editor / `server/src/scripts`), not on boot.

---

## 24. Frontend ↔ Backend Contract Notes

- Success shape: `{ success:true, ... }` / errors `{ success:false, message, code, field?, errors? }`; status codes are meaningful (400 validation, 401 auth, 403 role/status, 404 missing, 409 conflict/duplicate, 410 expired, 422 OCR failure, 429 rate limit, 500 fallback).
- The client only reads `message` (+ specific `code`s for `PAYMENT_NOT_APPROVED`, `ACCOUNT_NOT_ACTIVE`, `PAYMENT_EXPIRED`, `DUPLICATE_*`, OCR reject codes) — `field`/`errors[]` are ignored.
- Long-running verification: screenshot upload response carries the decision; timeout is 120 s client-side vs. up to ~75 s server OCR — a cold Render instance plus OCR can still exceed the client timeout (`isTimeoutError` helper exists for this).
- Statuses are normalized before display: `manual_review` → `pending` server-side (`paymentService.js:456`, `:468-470`).

---

## 25. Summary of the Two Recent Performance Changes (for continuity)

1. **`da61f30` — OCR memory**: `sharp.concurrency(1)` + `sharp.cache(false)` at `ocrService.js:28-29`, reducing peak RSS under the strip-crop storm (≈318 MB peak on Render Free 512 MB).
2. **`92e3433` — verification short-circuit**: `matchUPIWithRecovery` resolves Gate 1 first (`verificationService.js:213-232`); `skipAmountRecovery = upiMatch !== true` guards all three recovery stages (`:233-275`). Same image: 162 OCR calls / 43.3 s / 308 MB → **3 calls / 11.5 s / 299 MB**, decision identical (`rejected`/`UPI_MISMATCH`). Trade-off: when UPI fails, `checks.amount.detected`, `extractedAmounts`, `recoveredFromBands` and `fieldConfidence.amount` retain primary-pass values (diagnostics only; decision and reason unchanged). Regression guard: `server/src/tests/unit/verification-shortcircuit.test.js` (fails 2/6 on the old implementation).

---

## FINAL CHECKLIST (coverage verification)

- [x] **Architecture** — §5 (backend lifecycle), §6 (frontend), §4 (topology)
- [x] **Features / product rules** — §1, §15.10–15.13
- [x] **Flows** — §15.1 registration+payment, §15.4 decision, §15.7 approval, §15.8 top-ups, §15.13 status lifecycle
- [x] **API inventory** — §14 (82 endpoints, middleware per route)
- [x] **Database schema** — §7 (15 tables, constraints/indexes), §8 (migrations), §9 (functions/triggers), §22 (relationships)
- [x] **Auth** — §11 (register/login/admin/JWT), §12 (role/status gating)
- [x] **Validation** — §13 (server chains, uploads, client gaps)
- [x] **Payment lifecycle** — §15.1–15.7 (create → upload → verify → UTR → approve → side effects → expiry → sweeper)
- [x] **OCR** — §15.3 (pipeline, worker/sharp config, measured 128/176-call profile)
- [x] **Decision engine** — §15.4 (gates, reasons, field-confidence, demo/short-circuit rules)
- [x] **UTR / duplicate protection** — §15.5, plus screenshot-hash and wallet idempotency in §7/§15.2/§15.9
- [x] **Wallet & referral economics** — §15.9, §15.10 (5 % bonus, tier table, unused bonus_percentage)
- [x] **Security posture** — §16 (strengths + severity-rated findings)
- [x] **Configuration / env vars** — §10 (names + purpose only, no values)
- [x] **Tests** — §17 (inventory, baseline, red files)
- [x] **Deployment** — §4, §23 (Render/Vercel/Supabase, free-tier constraints, no CI)
- [x] **Dead code** — §18
- [x] **Known issues / open risks** — §19 (incl. unresolved Register-400 field)
- [x] **Documentation drift** — §20
- [x] **Recent change history** — §21, §25
- [x] **Frontend↔backend contract** — §24
- [x] **Operational runbook notes** — §23
- [x] **No code changes** — only this file was added; `git status` still shows exactly one pre-existing untracked file (`server/src/tests/unit/diagnostic-full-verification.test.mjs`); nothing committed or pushed.

**Open items requiring user input**: (a) the exact `errors[]` payload / Render log line for the failing registration field; (b) product decision on the dual wallet credit in top-ups (§16 Low); (c) whether `referral_tiers.bonus_percentage` was ever meant to drive payouts.
