#!/usr/bin/env bash
# Deploys origin/main when it is not what runs yet and its CI run is green:
# builds the image, ships it to the Seoul instance (which serves
# cards.buttercrab.io) and checks the site reports the new commit at
# /version, then restarts the bot worker here on the same image. Run from a
# checkout used only for deploying; a systemd timer
# (deploy/card-game-update.timer) runs it every two minutes, so a commit
# whose CI is still running is picked up on a later run. Pass --force to
# deploy anyway (now, and even if it is already deployed), and set
# SKIP_CI_CHECK=1 to deploy without asking GitHub (say, when it is down).
#
# What is deployed is the commit in $state_dir/deployed, written only once
# Seoul serves it and the worker runs it, so a failed build, ship or
# restart is tried again: after 10 minutes, then 20, up to an hour apart,
# until it works or main moves. Every step is safe to repeat: Seoul is not
# shipped to again once it serves the commit. The worker is restarted only
# after Seoul is up, so a failed ship leaves both on the old build. GitHub
# hears of a deploy that fails or waits on CI for long through the
# deploy-watch workflow (.github/workflows/deploy-watch.yaml), which reads
# /version from outside; nothing here needs a token that can write.
#
# The image that ran before stays as card-game:previous, here and in
# Seoul, so deploy/rollback.sh puts it back with one command. Each build is
# also tagged with its commit; the last three are kept.
#
# The server saves its tables when stopped and restores them on start, so
# a deploy only drops connections for a moment and players rejoin where
# they were.
#
# Needs curl, jq and docker. GitHub allows 60 unauthenticated API calls an
# hour; this makes at most one a run (30 an hour). An optional read-only
# token goes in ~/.config/card-game/deploy.env as GITHUB_TOKEN=..., never in
# the repository; curl reads it from a private file, not its command line.
set -euo pipefail

# systemd's PATH leaves out Homebrew, where the home server's jq lives.
PATH="$PATH:/home/linuxbrew/.linuxbrew/bin"

repo=buttercrab/card-game
workflow=ci.yaml
seoul=cards-seoul
site=https://cards.buttercrab.io
keep=3
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/card-game"
# Seconds between checks that Seoul serves the new commit (tests set 0).
verify_pause="${DEPLOY_VERIFY_PAUSE:-5}"

# Set while a deploy is under way, so a failure is noted for the retry.
deploying=""
# curl's config with the GitHub token, if there is one.
auth_file=""

# Prints success, pending or failed for the push CI run of commit $1, or
# unknown when GitHub cannot be asked.
ci_state() {
  local auth=()
  if [[ -n "$auth_file" ]]; then
    auth=(--config "$auth_file")
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

# Writes the token where only this user can read it, for curl --config.
write_auth_file() {
  [[ -n "${GITHUB_TOKEN:-}" ]] || return 0
  auth_file="$(umask 077 && mktemp "${TMPDIR:-/tmp}/card-game-deploy.XXXXXX")"
  printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_TOKEN" >"$auth_file"
}

# Says $1 once per commit and state, so a waiting deploy does not fill the log.
say_once() {
  if [[ "$(cat "$state_dir/last-note" 2>/dev/null)" != "$1" ]]; then
    echo "$1"
    echo "$1" >"$state_dir/last-note"
  fi
}

image_id() {
  docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true
}

# The image the container $1 runs, if it exists.
running_image() {
  docker inspect -f '{{.Image}}' "$1" 2>/dev/null || true
}

# The commit the site serves, or nothing when it cannot say.
live_commit() {
  curl -fsS --max-time 10 "$site/version" 2>/dev/null | jq -r '.commit // empty' 2>/dev/null || true
}

# On exit: forgets the token file, and notes a deploy that failed so the
# next run waits a while before trying it again.
finish() {
  local status=$?
  [[ -n "$auth_file" ]] && rm -f "$auth_file"
  if [[ -n "$deploying" && $status -ne 0 ]]; then
    local count=0 commit tries at
    if read -r commit tries at <"$state_dir/failed" 2>/dev/null && [[ "$commit" == "$deploying" ]]; then
      count=$tries
    fi
    echo "$deploying $((count + 1)) $(date +%s)" >"$state_dir/failed"
    echo "deploying ${deploying:0:12} failed (try $((count + 1))); trying again later" >&2
  fi
  return "$status"
}

# Whether the last failed try of $1 was long enough ago to try again:
# 10 minutes after the first failure, 20 after the second, at most 60.
may_retry() {
  local commit tries at
  read -r commit tries at <"$state_dir/failed" 2>/dev/null || return 0
  [[ "$commit" == "$1" ]] || return 0
  local wait=$((tries * 600))
  ((wait > 3600)) && wait=3600
  (($(date +%s) - at >= wait))
}

# Ships the image to Seoul and waits until the site serves commit $1.
ship_seoul() {
  if [[ "$(live_commit)" == "$1" ]]; then
    echo "Seoul already serves ${1:0:12}"
    return 0
  fi
  # The Seoul instance is too small to compile Rust, so it gets the image.
  scp -q deploy/seoul/compose.yaml deploy/seoul/Caddyfile deploy/seoul/images.sh "$seoul:card-game/"
  docker save card-game:latest | gzip | ssh "$seoul" 'gunzip | bash card-game/images.sh load'
  # Starts it, putting back what ran before if it does not come up healthy.
  ssh "$seoul" 'bash card-game/images.sh up'
  for _ in 1 2 3 4 5 6; do
    if [[ "$(live_commit)" == "$1" ]]; then
      return 0
    fi
    sleep "$verify_pause"
  done
  echo "Seoul is up but $site/version does not report ${1:0:12}" >&2
  return 1
}

# Wrapped in a function so bash reads it all before `git reset` replaces
# this file mid-run.
main() {
  cd "$(dirname "$0")/.."
  for tool in curl jq docker; do
    command -v "$tool" >/dev/null || { echo "update.sh needs $tool" >&2; exit 1; }
  done
  mkdir -p "$state_dir"
  trap finish EXIT
  if [[ -f "$HOME/.config/card-game/deploy.env" ]]; then
    # shellcheck disable=SC1091
    source "$HOME/.config/card-game/deploy.env"
  fi
  write_auth_file

  git fetch --quiet origin main
  local target short force=false
  [[ "${1:-}" == "--force" ]] && force=true
  target="$(git rev-parse origin/main)"
  short="${target:0:12}"
  if [[ "$(cat "$state_dir/deployed" 2>/dev/null)" == "$target" && $force == false ]]; then
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
  if [[ $force == false ]] && ! may_retry "$target"; then
    say_once "deploying $short failed; waiting before trying again"
    exit 0
  fi

  deploying="$target"
  git reset --quiet --hard "$target"
  echo "deploying $(git log --oneline -1)"
  GIT_COMMIT="$target" docker compose -f deploy/compose.yaml build
  docker tag card-game:latest "card-game:$short"

  ship_seoul "$target"

  # Seoul is up on the new build: now the worker, on the same image.
  local old new
  old="$(running_image card-game-bots)"
  docker compose -f deploy/compose.yaml up --detach --no-build --wait --remove-orphans
  new="$(image_id card-game:latest)"
  if [[ -n "$old" && "$old" != "$new" ]]; then
    docker tag "$old" card-game:previous
  fi
  prune_images

  echo "$target" >"$state_dir/deployed"
  rm -f "$state_dir/failed"
  deploying=""
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
