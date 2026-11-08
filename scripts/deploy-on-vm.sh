#!/usr/bin/env bash
# Deploys one commit to the VM it runs on. CI invokes this through
# `az vm run-command create` with COMMIT=<sha> prepended, and the VM pulls that
# revision itself, so CI needs no inbound access to it.
#
# By hand: sudo COMMIT=<sha> bash scripts/deploy-on-vm.sh
set -euo pipefail

CHECKOUT=/opt/resume-rag
ENV_FILE=/home/azureuser/.env
REF="${COMMIT:-main}"

# Azure runs this as root, and git refuses to work in another user's checkout,
# hence a root-owned one. The key and known_hosts stay with the admin user.
export GIT_SSH_COMMAND="ssh -i /home/azureuser/.ssh/github-deploy -o IdentitiesOnly=yes -o UserKnownHostsFile=/home/azureuser/.ssh/known_hosts -o StrictHostKeyChecking=yes"

[ -d "$CHECKOUT/.git" ] ||
  git clone --depth 1 git@github.com:ryanhillman/resume-rag.git "$CHECKOUT"
cd "$CHECKOUT"

# GitHub serves a bare commit as readily as a branch, so one fetch covers both.
git fetch --depth 1 origin "$REF"
git reset --hard FETCH_HEAD
git clean -fd
echo "deploying $(git rev-parse --short HEAD)"

# Unset, compose names the project after the directory and would build empty
# volumes, losing Caddy's certificate.
export COMPOSE_PROJECT_NAME=azureuser

# .env holds the secrets and sits outside the checkout, beyond git's reach.
# Quiet because Run Command returns only the last few KB of output; CI fetches
# the public URL afterwards, and that is what decides success.
docker compose --progress quiet --env-file "$ENV_FILE" up -d --build --remove-orphans

# Layers from repeated rebuilds fill a 64GB disk.
docker image prune -f >/dev/null
