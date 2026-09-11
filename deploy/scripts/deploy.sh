#!/usr/bin/env bash
# Deploy/refresh the JSREE backend stack on the OCI VM (infrastructure only).
# Usage: ./deploy.sh  (run from the repo root on the VM, e.g. /opt/jsree)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT/deploy"

if [[ ! -f ../server/.env ]]; then
  echo "ERROR: ../server/.env missing on the VM. Copy values from Railway (never commit)." >&2
  exit 1
fi
if [[ ! -f .env ]]; then
  echo "ERROR: deploy/.env missing. Copy from deploy/.env.example and set BACKEND_HOST." >&2
  exit 1
fi

set -a; . ./.env; set +a
git pull --ff-only
docker compose up -d --build

echo "Waiting for backend health..."
for i in $(seq 1 30); do
  if docker compose exec -T api node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    echo "HEALTH OK (attempt $i)."
    docker compose ps
    exit 0
  fi
  sleep 10
done

echo "ERROR: backend did not become healthy. Check: docker compose logs api" >&2
exit 1
