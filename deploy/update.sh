#!/usr/bin/env bash
# Deploys origin/main when it has moved and its CI run is green: rebuilds
# the image, restarts the bot worker here, then ships the same image to the
# Seoul instance, which serves cards.buttercrab.io. Run from a checkout
# used only for deploying; a systemd timer (deploy/card-game-update.timer)
# runs it every two minutes, so a commit whose CI is still running is
# picked up on a later run. Pass --force to rebuild anyway, and set
# SKIP_CI_CHECK=1 to deploy without asking GitHub (say, when it is down).
#
# The image that ran before stays as card-game:previous, here and in
# Seoul, so deploy/rollback.sh puts it back with one command. Each build is
# also tagged with its commit; the last three are kept.
#
# The server saves its tables when stopped and restores them on start, so
# a deploy only drops connections for a moment and players rejoin where
# they were.
#
# Needs curl and jq. GitHub allows 60 unauthenticated API calls an hour;
# this makes at most one a run (30 an hour). An optional token (read-only,
# public repositories) goes in ~/.config/card-game/deploy.env as
# GITHUB_TOKEN=..., never in the repository.
set -euo pipefail

repo=buttercrab/card-game
workflow=ci.yaml
seoul=cards-seoul
keep=3
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/card-game"

# Prints success, pending or failed for the push CI run of commit $1, or
# unknown when GitHub cannot be asked.
ci_state() {
  local auth=()
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  fi
  local runs
  if ! runs=$(curl -fsS --max-time 20 "${auth[@]}" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/$repo/actions/workflows/$workflow/runs?head_sha=$1&event=push&per_page=1"); then
    echo unknown
    return
  fi
  jq -r '
    .workflow_runs[0] as $run
    | if $run == null then "pending"
      elif $run.status != "completed" then "pending"
      elif $run.conclusion == "success" then "success"
      else "failed" end' <<<"$runs" 2>/dev/null || echo unknown
}

# Says $1 once per commit and state, so a waiting deploy does not fill the log.
say_once() {
  mkdir -p "$state_dir"
  if [[ "$(cat "$state_dir/last-note" 2>/dev/null)" != "$1" ]]; then
    echo "$1"
    echo "$1" >"$state_dir/last-note"
  fi
}

image_id() {
  docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true
}

# Wrapped in a function so bash reads it all before `git reset` replaces
# this file mid-run.
main() {
  cd "$(dirname "$0")/.."
  for tool in curl jq docker; do
    command -v "$tool" >/dev/null || { echo "update.sh needs $tool" >&2; exit 1; }
  done
  if [[ -f "$HOME/.config/card-game/deploy.env" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.config/card-game/deploy.env"
  fi

  git fetch --quiet origin main
  local target short
  target="$(git rev-parse origin/main)"
  short="${target:0:12}"
  if [[ "$(git rev-parse HEAD)" == "$target" && "${1:-}" != "--force" ]]; then
    exit 0
  fi
  if [[ "${SKIP_CI_CHECK:-}" != 1 ]]; then
    local state
    state="$(ci_state "$target")"
    case "$state" in
      success) ;;
      pending)
        say_once "waiting for CI on $short"
        exit 0
        ;;
      failed)
        say_once "CI failed on $short; not deploying it"
        exit 0
        ;;
      *)
        say_once "could not ask GitHub about $short; trying again later"
        exit 0
        ;;
    esac
  fi

  git reset --quiet --hard "$target"
  echo "deploying $(git log --oneline -1)"
  local old new
  old="$(image_id card-game:latest)"
  docker compose -f deploy/compose.yaml up --detach --build --wait --remove-orphans
  new="$(image_id card-game:latest)"
  docker tag card-game:latest "card-game:$short"
  if [[ -n "$old" && "$old" != "$new" ]]; then
    docker tag "$old" card-game:previous
  fi
  prune_images

  # The Seoul instance is too small to compile Rust, so it gets the image.
  scp -q deploy/seoul/compose.yaml deploy/seoul/Caddyfile deploy/seoul/images.sh "$seoul:card-game/"
  docker save card-game:latest | gzip | ssh "$seoul" 'gunzip | bash card-game/images.sh load'
  ssh "$seoul" 'cd card-game && docker compose up --detach --wait && docker exec caddy caddy reload --config /etc/caddy/Caddyfile'
  say_once "deployed $short"
}

# Keeps the newest $keep commit-tagged builds (plus latest and previous)
# and removes untagged leftovers.
prune_images() {
  local tag n=0
  while read -r tag; do
    if [[ "$tag" =~ ^[0-9a-f]{12}$ ]]; then
      n=$((n + 1))
      if ((n > keep)); then
        docker image rm "card-game:$tag" >/dev/null || true
      fi
    fi
  done < <(docker image ls card-game --format '{{.Tag}}')
  docker image prune --force >/dev/null
}

main "$@"
