#!/usr/bin/env bash
# Installs the experiment loop's runner as a launchd user agent on this Mac.
# Run it by hand, after review; it is never run by the loop itself.
#
#   research/loop/ops/install.sh            # from any checkout of the repository
#
# It makes the loop's own checkout (a worktree on branch `loop`, by default
# ~/card-game-loop) so the runner never fights interactive work, syncs its
# Python environment (with PyTorch) and builds `eval` there, checks that
# `ssh home` works without a prompt, then writes and loads
# ~/Library/LaunchAgents/io.buttercrab.cards.loop.plist. Logs go to
# $CARDGAME_ARTIFACTS/loop/logs/runner.log (default ~/card-game-artifacts).
#
# Environment: LOOP_CHECKOUT (the worktree), LOOP_BRANCH (default loop),
# CARDGAME_ARTIFACTS.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(git -C "$here" rev-parse --show-toplevel)"
checkout="${LOOP_CHECKOUT:-$HOME/card-game-loop}"
branch="${LOOP_BRANCH:-loop}"
artifacts="${CARDGAME_ARTIFACTS:-$HOME/card-game-artifacts}"
label="io.buttercrab.cards.loop"
plist="$HOME/Library/LaunchAgents/$label.plist"

uv="$(command -v uv)" || { echo "uv is not on PATH" >&2; exit 1; }
command -v cargo >/dev/null || { echo "cargo is not on PATH" >&2; exit 1; }

if [ ! -d "$checkout" ]; then
    if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then
        git -C "$repo" worktree add "$checkout" "$branch"
    else
        git -C "$repo" worktree add -b "$branch" "$checkout" HEAD
    fi
fi
current="$(git -C "$checkout" rev-parse --abbrev-ref HEAD)"
if [ "$current" != "$branch" ]; then
    echo "$checkout is on $current, not $branch" >&2
    exit 1
fi

(cd "$checkout/ml" && "$uv" sync --locked --extra torch)
(cd "$checkout" && nice -n 10 cargo build --release --locked -p eval)

if ! ssh -o BatchMode=yes -o ConnectTimeout=10 home true 2>/dev/null; then
    echo "warning: 'ssh home' needs a prompt or is down; home-server steps will wait" >&2
fi

mkdir -p "$artifacts/loop/logs" "$HOME/Library/LaunchAgents"
sed -e "s|@UV@|$uv|g" \
    -e "s|@CHECKOUT@|$checkout|g" \
    -e "s|@ARTIFACTS@|$artifacts|g" \
    -e "s|@PATH@|$PATH|g" \
    "$here/$label.plist" > "$plist"
plutil -lint "$plist" >/dev/null

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "installed $label, running from $checkout ($branch)"
echo "status:  (cd $checkout/ml && uv run python -m cardgame_ml.loop status)"
echo "log:     tail -f $artifacts/loop/logs/runner.log"
