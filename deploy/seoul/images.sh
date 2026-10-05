#!/usr/bin/env bash
# The game's images on a machine that runs them: card-game:latest, and
# card-game:previous, the one that ran before it. deploy/update.sh copies
# this next to the Seoul compose file and runs `load`; deploy/rollback.sh
# runs `rollback` here and does the same at home.
#
#   images.sh load       read `docker save` output on stdin; the old latest
#                        becomes previous, and older leftovers are removed
#   images.sh rollback   swap latest and previous (run again to undo)
set -euo pipefail

image_id() {
  docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true
}

case "${1:-}" in
  load)
    old="$(image_id card-game:latest)"
    docker load --quiet >/dev/null
    new="$(image_id card-game:latest)"
    if [[ -n "$old" && "$old" != "$new" ]]; then
      docker tag "$old" card-game:previous
    fi
    # The image previous pointed at before is untagged now.
    docker image prune --force >/dev/null
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
    echo "usage: $0 load|rollback" >&2
    exit 2
    ;;
esac
