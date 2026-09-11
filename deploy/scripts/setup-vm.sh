#!/usr/bin/env bash
# OCI VM first-boot setup (infrastructure only). Run ONCE on a fresh Ubuntu LTS VM.
# Installs Docker Engine + Compose plugin, enables auto-start, opens 22/80/443.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (sudo ./setup-vm.sh)" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl gnupg lsb-release ufw

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker
docker --version
docker compose version

# Host firewall: SSH + HTTP + HTTPS only. Node port 5000 stays internal.
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose

echo "SETUP OK. Next: clone repo to /opt/jsree, create server/.env + deploy/.env (see docs/OCI_MIGRATION.md)."
