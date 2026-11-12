# JSREE — Deployment Environment Verification Checklist (Render + Vercel)

**Generated:** 11 Nov 2026. **Rule:** values NOT verifiable from the workspace
are marked **BLOCKED** — they must be confirmed by a human with dashboard
access. Never mark them PASS from code inspection alone.

## A. Render backend (jsree-backend) — config-as-code says / dashboard says

| Item | Source | Status |
|------|--------|--------|
| Node.js 22 | `render.yaml` `NODE_VERSION: "22"` | PASS (code) — confirm dashboard shows same |
| Root directory `server` | `render.yaml` `rootDir: server` | PASS (code) |
| Start command `npm start` → `node src/index.js` | `render.yaml` build+start | PASS (code) |
| Health check `/api/health` | `render.yaml` `healthCheckPath` + live local boot 200 | PASS (verified locally; confirm Render health checks green) |
| `NODE_ENV=production` | `render.yaml` | PASS (code) |
| `CLIENT_URL=https://jsree.vercel.app` | `render.yaml` | PASS (code) — must match Vercel domain exactly |
| CORS allows exactly the Vercel origin + localhost dev | `cors.js` + live probe (204 + ACAO + credentials; evil origin → no ACAO) | PASS (verified) |
| `JWT_EXPIRES_IN=7d`, `JWT_SECRET` set | `render.yaml` sets expiry; **secret is dashboard-only (`sync: false`)** | **BLOCKED** — confirm non-empty, ≥32 chars, matches nothing public |
| `SUPABASE_URL` project ref matches intended DB | dashboard-only | **BLOCKED** — must equal the project you migrated |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` present | dashboard-only | **BLOCKED** — confirm set, never printed in logs |
| `PAYMENT_PROVIDER_MODE=none` | `render.yaml` explicitly `none` | PASS (code) — see accepted-limitations note below |
| `ADMIN_EMAIL` + `ADMIN_PASSWORD_HASH` (bcrypt) set | dashboard-only | **BLOCKED** — login returns `ADMIN_NOT_CONFIGURED` until set |
| `ADMIN_RECEIVER_NAME` decision | dashboard-only; DB `payment_config.receiver_name` currently **empty** | **BLOCKED — decision required**: set a name (receiver-name gate ON) or accept documented gate-OFF posture (verification history will show `RECEIVER_NAME_NOT_CONFIGURED` = N/A) |
| Rate limit posture | `app.js`: global 100/15m/IP, auth 20/15m/IP, **admin-login 10/15m/IP**, `trust proxy=1`, in-memory store | PASS (code, single-instance only — documented) |

## B. Vercel frontend (jsree client)

| Item | Source | Status |
|------|--------|--------|
| Root build: `vercel.json` rewrites SPA → `index.html` | root `vercel.json` | PASS (code) |
| Build command / output dir | dashboard (root project) | **BLOCKED** — confirm `npm run build` (or `npx vite build`) + `dist` |
| **`VITE_API_URL` = `https://<render-backend>/api` (absolute, ends in `/api`)** | `client/src/utils/api.js:14` defaults to relative `/api`; `client/vercel.json` has **NO `/api` proxy** → unset var = broken prod API calls | **BLOCKED — highest-risk dashboard item.** Verify build-time env var exists and points at Render |
| No server secrets in `VITE_*` vars | convention: only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public by design) | PASS (code) — re-check dashboard has no `SERVICE_ROLE`/`JWT_SECRET`/`ADMIN_*` |
| Preview/local behavior | QA preview baked `VITE_API_URL=http://localhost:5000/api` | PASS (verified in QA run) |

## C. Manual verification script (run with real dashboard values, never commit output)

1. Render → Environment → list keys; tick every **BLOCKED** row above.
2. `curl https://<render>/api/health` → 200 JSON.
3. From Vercel production: browser devtools → network → API base is the Render URL (not `jsree.vercel.app/api`).
4. `curl -H "Origin: https://evil.example.com" -X OPTIONS https://<render>/api/health -i` → no `access-control-allow-origin` for evil origin.
5. Admin login with operator password → 200 + token (only after `ADMIN_PASSWORD_HASH` set).
6. Payment Settings page → receiver UPI shown; receiver name reflects the A-row decision.

## D. Accepted payment-verification limitation (sign-off required)

With `PAYMENT_PROVIDER_MODE=none` the system verifies **screenshot OCR +
amount + receiver UPI + date window + duplicate-UTR ledger**. It does **not**
prove bank settlement. OCR evidence must never be represented as bank proof.
Auto-approval of fully-gated screenshots is the documented deterministic
policy; the legacy auto-approve switch does not exist. Any move to `live`
provider mode requires `PAYMENT_PROVIDER_VERIFY_URL` + `PAYMENT_PROVIDER_API_KEY`
and re-run of the provider regression suite.

## E. Admin password rotation procedure (no plaintext ever stored)

1. Generate a strong password in a password manager (never in git, never in logs).
2. `bcrypt` hash it locally (e.g. one-liner with `bcryptjs`, cost ≥ 10).
3. Render → Environment → update `ADMIN_PASSWORD_HASH` → redeploy/restart.
4. Verify: admin login works; wrong password → generic `INVALID_CREDENTIALS`.
5. Disable an admin by setting the `users.status` row to `inactive` —
   login now refuses with `ADMIN_DISABLED` (hardened 11 Nov 2026).
6. Never set `ADMIN_PASSWORD` (plaintext) — it is not read by the app.
