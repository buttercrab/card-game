#!/usr/bin/env bash
# Deploys origin/main when it has moved: rebuilds the image, restarts the
# bot worker here, then ships the same image to the Seoul instance, which
# serves cards.buttercrab.io. Run from
# a checkout used only for deploying; a systemd timer
# (deploy/card-game-update.timer) runs it every two minutes. Pass --force to
# rebuild anyway. Tables are saved in a volume, so a restart only drops
# connections for a moment and players rejoin where they were.
set -euo pipefail

# Wrapped in a function so bash reads it all before `git reset` replaces
# this file mid-run.
main() {
  cd "$(dirname "$0")/.."

  # Problem reports go out even when there is nothing to deploy.
  deploy/reports.sh || echo "filing reports failed" >&2

  git fetch --quiet origin main
  if [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" && "${1:-}" != "--force" ]]; then
    exit 0
  fi
  git reset --quiet --hard origin/main
  echo "deploying $(git log --oneline -1)"
  docker compose -f deploy/compose.yaml up --detach --build --wait --remove-orphans

  # The Seoul instance is too small to compile Rust, so it gets the image.
  seoul=cards-seoul
  scp -q deploy/seoul/compose.yaml deploy/seoul/Caddyfile "$seoul:card-game/"
  docker save card-game:latest | gzip | ssh "$seoul" 'gunzip | docker load --quiet'
  ssh "$seoul" 'cd card-game && docker compose up --detach --wait && docker exec caddy caddy reload --config /etc/caddy/Caddyfile'
}

main "$@"
