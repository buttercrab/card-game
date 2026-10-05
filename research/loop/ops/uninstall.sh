#!/usr/bin/env bash
# Stops the experiment loop's runner and removes its launchd user agent.
# Steps already running go on in their own process groups (stop them with
# `python -m cardgame_ml.loop cancel <run>` first, or let them finish);
# the loop's checkout, records and logs are left as they are.
set -euo pipefail

label="io.buttercrab.cards.loop"
plist="$HOME/Library/LaunchAgents/$label.plist"

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || echo "$label was not loaded"
rm -f "$plist"
echo "removed $label; the checkout (git worktree list) and records stay"
