#!/bin/bash
# Against four 고수: 1 000 paired deals per variant (the field is slow:
# four searching seats). Waits for the 보통 batch and the signal runs.
set -e
cd /Users/jaeyong/Development/Github/card-game/.claude/worktrees/agent-a199a6aff6c91e76e
LAB=$PWD/target/release/lab
A=$HOME/card-game-artifacts/assess-2026-10-06
D=$A/dmc-v2-final
while pgrep -f "lab --threads [35] --out $A/results/(normal|signal)" > /dev/null; do sleep 20; done
mkdir -p $A/results/hard
run() { # name spec
  nice -n 10 $LAB --threads 8 --out $A/results/hard/$1.jsonl declare --deals 1000 --bot "$2" --field hard 2>/dev/null
  echo "hard/$1 done $(date +%T)"
}
run normal normal
run dmc "dmc:$D"
run bidexch-normal_play-dmc "phased:normal+normal+dmc:$D"
run bid-normal_rest-dmc "phased:normal+dmc:$D+dmc:$D"  # stopped at 511 deals
