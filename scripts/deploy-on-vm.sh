#!/usr/bin/env bash
# Deploys one commit of this repository to the VM it runs on.
#
# CI executes this through `az vm run-command create`, authenticating to Azure
# with a short-lived OIDC token. The VM then pulls its own code outbound using a
# read-only deploy key held here, so CI needs no inbound access: no SSH into the
# VM, no open port 22, no self-hosted runner, and no secret in the repository.
#
# The deploy key is named explicitly through GIT_SSH_COMMAND rather than left to
# ~/.ssh/config, so the only SSH state this depends on is the key itself and the
# pinned host keys in ~/.ssh/known_hosts.
#
# Azure runs this as root. The work itself is handed to the unprivileged admin
# user, who owns both the checkout and the deploy key, through a non-login shell
# — a login shell sources ~/.bash_logout, whose tty-dependent `clear_console`
# can replace a successful exit status with a failure.
#
# Run Command returns only the last few KB of output, so the build is kept quiet
# and the health check runs last: the verdict is the part that survives.
#
# Safe to run by hand on the VM to recover it:
#   sudo bash scripts/deploy-on-vm.sh
set -euo pipefail

# CI rewrites this placeholder with the commit it just tested, so the VM runs
# that exact revision rather than racing whatever main points at by then. Left
# unsubstituted — a manual run — it falls back to the tip of main.
DEPLOY_COMMIT="__DEPLOY_COMMIT__"

# Tested by shape rather than against the placeholder's literal text: the
# substitution rewrites every occurrence of that text in this file, so a
# comparison against it would be rewritten too and always match.
if printf '%s' "$DEPLOY_COMMIT" | grep -qE '^[0-9a-f]{40}$'; then
  DEPLOY_REF="$DEPLOY_COMMIT"
else
  DEPLOY_REF="origin/main"
fi

ADMIN="azureuser"
HOME_DIR="/home/${ADMIN}"
PAYLOAD="$(mktemp /tmp/resume-rag-deploy.XXXXXX)"
trap 'rm -f "$PAYLOAD"' EXIT

# Quoted heredoc: nothing below is expanded by this shell. The values the inner
# script needs arrive as environment variables, which keeps it free of the
# escaping that nesting a script inside a quoted argument would require.
cat > "$PAYLOAD" <<'INNER'
set -euo pipefail

if [ ! -d "$CHECKOUT/.git" ]; then
  git clone "$REPO_URL" "$CHECKOUT"
fi
cd "$CHECKOUT"

if [ "$DEPLOY_REF" = "origin/main" ]; then
  git fetch --depth 1 origin main
  git reset --hard FETCH_HEAD
else
  git fetch --depth 1 origin "$DEPLOY_REF"
  git reset --hard "$DEPLOY_REF"
fi
git clean -fd
echo "deploying $(git rev-parse --short HEAD)"

# Pin the compose project to the one that already owns the live volumes. Left
# unset the name comes from the directory, so compose would create empty
# volumes and Caddy would request a fresh certificate.
export COMPOSE_PROJECT_NAME="$PROJECT"

# .env holds the secrets and deliberately lives outside the checkout, where
# 'git reset --hard' and 'git clean' cannot reach it.
docker compose --progress quiet --env-file "$ENV_FILE" up -d --build --remove-orphans

# A 64GB OS disk fills up quickly with layers from repeated rebuilds.
docker image prune -f >/dev/null

# Only caddy publishes ports, so probe it rather than the app's unpublished
# 8000. --resolve keeps the connection local while still sending the real
# hostname as SNI; a Host header alone fails, because caddy holds no
# certificate for 127.0.0.1 and aborts the handshake before reading any header.
# -k tolerates a renewal window serving an internal certificate, which is not
# the same as the app being down — CI separately fetches the public URL, and
# that is what validates the real certificate.
domain=$(grep '^DOMAIN=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r')
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null -k --resolve "${domain}:443:127.0.0.1" "https://${domain}/"; then
    echo "HEALTHCHECK PASS: ${domain} responding"
    exit 0
  fi
  sleep 4
done
echo "HEALTHCHECK FAIL: no response within 120s"
docker compose --env-file "$ENV_FILE" logs --tail=30
exit 1
INNER

chown "$ADMIN" "$PAYLOAD"

runuser -u "$ADMIN" -- env \
  REPO_URL="git@github.com:ryanhillman/resume-rag.git" \
  GIT_SSH_COMMAND="ssh -i ${HOME_DIR}/.ssh/github-deploy -o IdentitiesOnly=yes" \
  CHECKOUT="${HOME_DIR}/repo" \
  ENV_FILE="${HOME_DIR}/.env" \
  PROJECT="$ADMIN" \
  DEPLOY_REF="$DEPLOY_REF" \
  bash "$PAYLOAD"
