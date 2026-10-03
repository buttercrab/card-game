#!/usr/bin/env bash
# Deploys origin/main when it has moved: rebuilds the image and restarts the
# container. Run from a checkout used only for deploying; a systemd timer
# (deploy/card-game-update.timer) runs it every two minutes. Pass --force to
# rebuild anyway. Restarting closes every open table.
set -euo pipefail
cd "$(dirname "$0")/.."

git fetch --quiet origin main
if [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" && "${1:-}" != "--force" ]]; then
  exit 0
fi
git reset --quiet --hard origin/main
echo "deploying $(git log --oneline -1)"
docker compose -f deploy/compose.yaml up --detach --build --wait
