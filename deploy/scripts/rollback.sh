#!/usr/bin/env bash
# Roll back the api service to a previous Git commit (infrastructure only).
# Usage: ./rollback.sh <commit-sha>  (run from the repo root on the VM)
# Railway stays untouched as the standby rollback target (see docs/OCI_MIGRATION.md).
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <commit-sha>" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

CURRENT="$(git rev-parse --short HEAD)"
echo "Current: $CURRENT -> rolling back to: $1"
git fetch origin
git checkout "$1"
cd deploy
docker compose up -d --build api
sleep 30
docker compose exec -T api node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
echo "ROLLBACK OK. Previously on $CURRENT. To return: git checkout <sha> && docker compose up -d --build"
