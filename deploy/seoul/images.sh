#!/usr/bin/env bash
# The game's images on a machine that runs them: card-game:latest, and
# card-game:previous, the one that ran before it. deploy/update.sh copies
# this next to the Seoul compose file and runs `load`, then `up`;
# deploy/rollback.sh runs `rollback` here and does the same at home.
#
#   images.sh load       read `docker save` output on stdin; the image the
#                        server runs now becomes previous, and older
#                        leftovers are removed. Loading the same image
#                        again changes nothing.
#   images.sh up         start latest (and Caddy) and reload Caddy; if the
#                        server does not come up healthy, put back the
#                        image that ran before, start that, and fail
#   images.sh rollback   swap latest and previous (run again to undo)
set -euo pipefail

image_id() {
  docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true
}

# The image the server container runs, if there is one.
running() {
  docker inspect -f '{{.Image}}' card-game 2>/dev/null || true
}

case "${1:-}" in
  load)
    old="$(running)"
    [[ -n "$old" ]] || old="$(image_id card-game:latest)"
    docker load --quiet >/dev/null
    new="$(image_id card-game:latest)"
    if [[ -n "$old" && "$old" != "$new" ]]; then
      docker tag "$old" card-game:previous
    fi
    # The image previous pointed at before is untagged now.
    docker image prune --force >/dev/null
    ;;
  up)
    cd "$(dirname "$0")"
    before="$(running)"
    if ! docker compose up --detach --wait; then
      echo "the new server did not come up healthy" >&2
      if [[ -n "$before" && "$before" != "$(image_id card-game:latest)" ]]; then
        echo "putting back the image that ran before" >&2
        docker tag "$before" card-game:latest
        docker compose up --detach --wait cards || true
      fi
      exit 1
    fi
    docker exec caddy caddy reload --config /etc/caddy/Caddyfile
    ;;
  rollback)
    latest="$(image_id card-game:latest)"
    previous="$(image_id card-game:previous)"
    if [[ -z "$previous" ]]; then
      echo "no card-game:previous to roll back to" >&2
      exit 1
    fi
    docker tag "$previous" card-game:latest
    if [[ -n "$latest" ]]; then
      docker tag "$latest" card-game:previous
    fi
    ;;
  *)
    echo "usage: $0 load|up|rollback" >&2
    exit 2
    ;;
esac
