#!/usr/bin/env bash
# Runs deploy/update.sh and deploy/watch.sh against stand-ins for docker,
# ssh, scp, curl and gh (deploy/test/bin), in a throwaway directory with
# its own git origin. Nothing here reaches a server or GitHub.
#
#   bash deploy/test/run.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d "${TMPDIR:-/tmp}/card-game-deploy-test.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT

export FAKE="$tmp/fake"
mkdir -p "$FAKE" "$tmp/t" "$tmp/home/.config/card-game" "$tmp/state"
failures=0

check() {
  local what="$1"
  shift
  if "$@"; then
    echo "ok   $what"
  else
    echo "FAIL $what" >&2
    failures=$((failures + 1))
  fi
}

fails() { ! "$@"; }
equals() { [[ "$1" == "$2" ]] || { echo "     expected '$2', got '$1'" >&2; return 1; }; }
count() { grep -c -- "$1" "$FAKE/log" 2>/dev/null || true; }

# --- update.sh ---------------------------------------------------------

export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
git init --quiet --bare --initial-branch=main "$tmp/origin.git"
git clone --quiet "$tmp/origin.git" "$tmp/work" 2>/dev/null
cp -R "$repo_root/deploy" "$tmp/work/deploy"

push() {
  echo "$1" >"$tmp/work/change"
  git -C "$tmp/work" add -A
  git -C "$tmp/work" commit --quiet -m "$1"
  git -C "$tmp/work" push --quiet origin HEAD:main
  git -C "$tmp/work" rev-parse HEAD
}

a="$(push one)"
git clone --quiet "$tmp/origin.git" "$tmp/checkout"

update() {
  PATH="$here/bin:$PATH" TMPDIR="$tmp/t" HOME="$tmp/home" XDG_STATE_HOME="$tmp/state" DEPLOY_VERIFY_PAUSE=0 \
    "$tmp/checkout/deploy/update.sh" "$@" >>"$tmp/out" 2>&1
}
deployed() { cat "$tmp/state/card-game/deployed" 2>/dev/null || true; }

echo success >"$FAKE/ci"
echo "GITHUB_TOKEN=secret-token-123" >"$tmp/home/.config/card-game/deploy.env"
check "a first run deploys main" update
check "  Seoul serves it" equals "$(cat "$FAKE/live")" "$a"
check "  the worker runs it" equals "$(cat "$FAKE/bots")" "sha-$a"
check "  it is recorded as deployed" equals "$(deployed)" "$a"
check "  the token never reaches curl's command line" equals "$(count TOKEN-ON-COMMAND-LINE)" 0
check "  curl reads the token from a private file" equals "$(count 'auth-file 600')" 1
check "  the token file is gone afterwards" test -z "$(ls -A "$tmp/t")"

builds="$(count 'compose build')"
check "a rerun with nothing new does nothing" update
check "  and builds nothing" equals "$(count 'compose build')" "$builds"

b="$(push two)"
touch "$FAKE/fail-seoul"
check "a failed ship to Seoul fails the run" fails update
check "  the worker keeps the old build" equals "$(cat "$FAKE/bots")" "sha-$a"
check "  the old commit stays deployed" equals "$(deployed)" "$a"
check "  the failure is noted" equals "$(cut -d' ' -f1-2 "$tmp/state/card-game/failed")" "$b 1"

builds="$(count 'compose build')"
check "right after a failure it waits" update
check "  without building" equals "$(count 'compose build')" "$builds"

rm "$FAKE/fail-seoul"
echo "$b 1 0" >"$tmp/state/card-game/failed"
check "once the wait is over it tries again" update
check "  Seoul serves the new commit" equals "$(cat "$FAKE/live")" "$b"
check "  the worker runs it" equals "$(cat "$FAKE/bots")" "sha-$b"
check "  the worker's old image is previous" equals "$(cat "$FAKE/previous")" "sha-$a"
check "  it is recorded as deployed" equals "$(deployed)" "$b"
check "  the failure is forgotten" test ! -e "$tmp/state/card-game/failed"

c="$(push three)"
touch "$FAKE/fail-worker"
check "a worker that does not start fails the run" fails update
check "  Seoul already serves it" equals "$(cat "$FAKE/live")" "$c"
check "  but it is not recorded as deployed" equals "$(deployed)" "$b"
rm "$FAKE/fail-worker"
echo "$c 1 0" >"$tmp/state/card-game/failed"
loads="$(count 'images.sh load')"
check "the retry finishes the deploy" update
check "  without shipping to Seoul again" equals "$(count 'images.sh load')" "$loads"
check "  the worker runs it" equals "$(cat "$FAKE/bots")" "sha-$c"
check "  it is recorded as deployed" equals "$(deployed)" "$c"

push four >/dev/null
echo pending >"$FAKE/ci"
builds="$(count 'compose build')"
check "a commit waiting for CI is left alone" update
check "  unbuilt" equals "$(count 'compose build')" "$builds"
check "  and the wait is said" grep -q "waiting for CI" "$tmp/out"
echo failure >"$FAKE/ci"
check "a commit with red CI is left alone" update
check "  unbuilt" equals "$(count 'compose build')" "$builds"

# --- watch.sh ----------------------------------------------------------

watch() {
  PATH="$here/bin:$PATH" REPO=o/r OWNER=owner SITE=https://site.test NOW="$(cat "$FAKE/now")" \
    bash "$repo_root/deploy/watch.sh" >>"$tmp/out" 2>&1
}
iso() { date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ; }
now=1800000000
echo "$now" >"$FAKE/now"
run_json() { printf '{"status":"%s","conclusion":"%s","head_sha":"%s","created_at":"%s","updated_at":"%s"}' "$@"; }

: >"$FAKE/log"
echo "$a" >"$FAKE/live"
echo "$a" >"$FAKE/head"
run_json completed success "$a" "$(iso $((now - 3600)))" "$(iso $((now - 3000)))" >"$FAKE/head_run"
cp "$FAKE/head_run" "$FAKE/green_run"
echo 41 >"$FAKE/open"
check "watch: when the site serves main it passes" watch
check "  and closes the open issue" equals "$(count 'issue close 41')" 1

echo "$b" >"$FAKE/head"
run_json completed success "$b" "$(iso $((now - 3600)))" "$(iso $((now - 50 * 60)))" >"$FAKE/head_run"
cp "$FAKE/head_run" "$FAKE/green_run"
echo behind >"$FAKE/compare"
check "watch: a green commit missing for 50 minutes fails" fails watch
check "  an issue is opened for the owner" equals "$(count 'issue create.*--assignee owner')" 1
check "  it says the deploy failed" grep -q "배포 실패" "$FAKE/issue-body"
check "watch: still behind fails again" fails watch
check "  without a second issue" equals "$(count 'issue create')" 1

rm -f "$FAKE/open"
: >"$FAKE/log"
run_json completed success "$b" "$(iso $((now - 900)))" "$(iso $((now - 10 * 60)))" >"$FAKE/head_run"
cp "$FAKE/head_run" "$FAKE/green_run"
check "watch: a green commit deploying for 10 minutes is fine" watch
check "  no issue" equals "$(count 'issue')" 1 # the list only

: >"$FAKE/log"
echo "$c" >"$FAKE/head"
run_json completed failure "$c" "$(iso $((now - 70 * 60)))" "$(iso $((now - 60 * 60)))" >"$FAKE/head_run"
run_json completed success "$b" "$(iso $((now - 3 * 3600)))" "$(iso $((now - 3 * 3600)))" >"$FAKE/green_run"
echo "$b" >"$FAKE/live"
check "watch: red CI on main for 70 minutes fails" fails watch
check "  it says deploys are blocked" grep -q "배포 막힘" "$FAKE/issue-body"
check "  but not that a deploy failed" fails grep -q "배포 실패" "$FAKE/issue-body"

: >"$FAKE/log"
rm -f "$FAKE/live"
check "watch: a site that does not answer is the uptime check's" watch
check "  GitHub is not asked" equals "$(count 'gh ')" 0

echo
if ((failures > 0)); then
  echo "$failures check(s) failed; output:" >&2
  cat "$tmp/out" >&2
  exit 1
fi
echo "all deploy checks passed"
