#!/bin/bash
# Exp 4: bidding-time signal. B: five 보통; C: five networks at 2 points' temperature.
set -e
cd /Users/jaeyong/Development/Github/card-game/.claude/worktrees/agent-a199a6aff6c91e76e
LAB=$PWD/target/release/lab
A=$HOME/card-game-artifacts/assess-2026-10-06
D=$A/dmc-v2-final
O=$A/results/signal
mkdir -p $O
nice -n 10 $LAB --threads 3 --out $O/normal-table.jsonl bid-signal --deals 4000 --bot normal --net dmc:$D --worlds 100 --search-every 1 2>/dev/null
echo "B done $(date +%T)"
nice -n 10 $LAB --threads 3 --out $O/dmc-table.jsonl bid-signal --deals 300 --bot dmc:$D:2 --net dmc:$D --worlds 100 --search-every 3 2>/dev/null
echo "C done $(date +%T)"
