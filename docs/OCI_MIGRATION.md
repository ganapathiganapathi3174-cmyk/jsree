# JSREE backend migration: Railway → OCI Always Free (infrastructure only)

No application code was changed for this migration. The container runs the
existing app unchanged (`node src/index.js`). Supabase stays as-is; no
migrations were run.

## 0. Pre-provisioning safety (read before clicking anything)

Provision ONLY resources carrying the Console label **Always Free-eligible**,
in the tenancy **home region**. Verified against Oracle docs
(`docs.oracle.com/.../freetier_topic-Always_Free_Resources.htm`,
`oracle.com/cloud/free`):

| RESOURCE | TYPE | REGION | FREE LIMIT | ACTUAL CONFIG | CHARGE RISK |
|---|---|---|---|---|---|
| Compute | VM.Standard.A1.Flex (Ampere ARM) | home region only | 2 OCPUs + 12 GB RAM total across A1 instances (conservative; docs also describe up to 3000 OCPU-hrs/18000 GB-hrs monthly) | 1 instance: 2 OCPUs, 12 GB RAM | None if kept within limit; exceeding OCPUs/RAM or provisioning outside home region bills |
| Boot volume | Block Volume (boot) | home region only | 200 GB total boot+block, min ~50 GB per boot volume | 50 GB default boot volume | None if total block storage ≤ 200 GB; raising boot size eats the allotment |
| Volume backups | Boot/block backups | home region only | 5 total | none created by default | Creating a 6th backup fails (no charge, just blocked) — stay ≤ 5 |
| Networking | VCN + public subnet + Internet Gateway + 1 ephemeral public IPv4 | home region only | Always Free (VNICs scale with OCPUs) | 1 VCN, 1 subnet, IGW, 1 public IP | None; do NOT attach a paid LB — Caddy on the VM terminates HTTPS, no load balancer provisioned |
| OS image | Ubuntu LTS (or Oracle Linux), ARM build | — | Always Free-eligible images only | Ubuntu 24.04 LTS ARM | None if the chosen image shows the Always Free label |
| Monitoring/Alarms/Notifications/Logging | OCI Observability | home region | Always Free (per Free Tier page) | CPU/health/disk alarms + email topic (below) | None |
| Email alerts | Notifications topic + email subscription; Budgets | — | Always Free | budget alerts ~50/75/80/90/95% + trial emails | None |
| NOT provisioned | Load balancer, paid DB, paid monitoring/CDN/backup | — | — | intentionally absent | — |

STOP conditions: any resource without the Always Free label, any prompt to
upgrade/pay, home-region capacity errors ("out of host capacity"), or a shape
other than A1.Flex/E2.1.Micro. If A1 capacity is unavailable in the home
region: **"Always Free capacity unavailable in the selected home region."**
Wait or change availability domain — do NOT provision paid capacity.

Idle-reclamation warning: Oracle may reclaim idle Always Free instances
(CPU p95 < 20% AND network < 20% AND memory < 20% over 7 days). Production
traffic plus the external `/api/health` ping (Monitoring section) keeps the
instance above idle. If reclaimed, follow Recovery.

## 1. Provision the VM (manual, Console)

1. Console → Compute → Instances → Create instance → **home region**,
   availability domain with A1 capacity.
2. Image: Ubuntu 24.04 LTS **ARM** (must show Always Free-eligible).
3. Shape: VM.Standard.A1.Flex → **2 OCPUs, 12 GB RAM**.
4. Networking: new VCN (10.0.0.0/16), public subnet, assign public IPv4,
   Internet Gateway route. Security list ingress: `0.0.0.0/0` TCP **22, 80, 443**
   (egress: all). Do NOT expose 5000 publicly.
5. Boot volume: **50 GB** default. SSH: add your public key.
6. Create. Note the public IP as `<OCI-IP>`.

## 2. VM setup (once)

```bash
ssh ubuntu@<OCI-IP>
git clone <repo-url> /opt/jsree && cd /opt/jsree
sudo ./deploy/scripts/setup-vm.sh
```

## 3. Environment (on the VM only, never commit)

```bash
cp server/.env.example server/.env        # then paste REAL Railway values
cp deploy/.env.example deploy/.env        # then set BACKEND_HOST + NOTIFY_EMAIL
```

`server/.env` required keys (same names/values as Railway production):
`SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET,
JWT_EXPIRES_IN, ADMIN_EMAIL, ADMIN_PASSWORD_HASH, ADMIN_UPI_ID, DATABASE_URL,
CLIENT_URL=https://jsree.vercel.app, PORT=5000, NODE_ENV=production`.
Never print secrets; never commit `server/.env` or `deploy/.env`.

## 4. DNS + HTTPS

`api.jsree.vercel.app` is NOT possible (Vercel owns `vercel.app`; its
subdomains cannot point at OCI). Use a hostname on a domain you control:

- DNS: `A api.yourdomain.com → <OCI-IP>` (this is `BACKEND_HOST`).
- Caddy (`deploy/Caddyfile`) issues/renews the certificate automatically.
- Frontend stays `https://jsree.vercel.app`. After DNS+HTTPS verify, switch
  Vercel env `VITE_API_URL` from the Railway URL to
  `https://<BACKEND_HOST>/api` and redeploy the frontend. No client code change.

## 5. Deploy / restart / rollback / health

```bash
./deploy/scripts/deploy.sh        # pull + build + up + health-gate
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f api
curl -s http://127.0.0.1:5000/api/health     # on VM, expect HTTP 200
curl -s https://<BACKEND_HOST>/api/health    # public, expect HTTP 200
sudo reboot                    # auto-start check: stack returns by itself
docker restart jsree-api-1     # crash check: restart policy revives it
./deploy/scripts/rollback.sh <commit-sha>    # rollback api to a commit
```

Auto-start: `restart: unless-stopped` on both services + `systemctl enable
docker` → VM reboot, Docker restart, Node crash, and Caddy restart all
recover without human action.

## 6. Verification (no real-money payments)

Railway stays UP until this passes; only then switch `VITE_API_URL`:

1. `GET /api/health` → 200.
2. Frontend loads; register/login/user-login/admin-login succeed.
3. Payment creation, screenshot upload, TopUp, config endpoints respond per
   existing contracts (use mocked/test fixtures only).
4. Payment-safety spot checks (behavior unchanged, code untouched):
   shared verification engine for membership + TopUp, amount/UPI/UTR/date-time/
   expiry/OCR-confidence rules, hash dedup, UTR duplicate protection,
   wallet credit only after approval, idempotency, crash reconciliation,
   admin authorization.

## 7. Monitoring + free-limit/expiry alerts (Always Free only)

- OCI Monitoring alarms (email via Notifications topic): instance CPU high,
  VNIC throughput, boot-volume utilization, container unhealthy
  (`docker compose ps` via cron → email on non-healthy), HTTPS cert (Caddy
  renews automatically; alarm on `https://<BACKEND_HOST>/api/health` failing
  from an external uptime ping every 5 min — this ping also guards against
  idle reclamation).
- Budgets (closest-supported thresholds): cost/usage alerts at ~50/75/80/90/
  95%. Trial: OCI emails trial-expiry notices automatically — do not
  duplicate; these alarms add coverage. Interpret correctly:
  **trial expiry ≠ Always Free stop** (Always Free has no 30-day expiry and
  survives trial end; over-quota trial A1 instances are disabled/deleted 30
  days after trial end unless upgraded — hence the 2 OCPU/12 GB cap above);
  **limit breach** = provisioning blocked; **suspension** = account email +
  Console banner, follow Recovery.
- Disk-full guard: cron `df -h /` alert at >80%; `docker system prune` only
  manually during maintenance windows.

## 8. Recovery

- Container down: `docker compose up -d` in `deploy/`; logs via `docker
  compose logs`.
- VM lost/reclaimed: repeat sections 1–5 in the home region (repo is the
  single source of code; only `server/.env` values must be re-entered from
  the kept Railway copy), restore DNS A record, verify section 6.
- Full rollback: point `VITE_API_URL` back to
  `https://jsree-backend-production.up.railway.app/api` and redeploy the
  frontend. **Do NOT delete the Railway project until the OCI cutover is
  verified and the completion report is accepted.**

## 9. Remaining manual steps (cannot be done from this checkout)

1. Create the OCI Always Free VM (§1) — needs your tenancy + home region.
2. Paste production secrets into `server/.env` on the VM (§3).
3. Point your domain A record at the VM; set `BACKEND_HOST` (§4).
4. Run verification (§6), then switch `VITE_API_URL` on Vercel.
5. Configure OCI alarms/budgets/email (§7).
