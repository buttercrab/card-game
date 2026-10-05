#!/bin/bash
# Exp 2/3 against four 보통: 10 000 paired deals per variant.
set -e
cd /Users/jaeyong/Development/Github/card-game/.claude/worktrees/agent-a199a6aff6c91e76e
LAB=$PWD/target/release/lab
A=$HOME/card-game-artifacts/assess-2026-10-06
D=$A/dmc-v2-final
O=$A/results/normal
mkdir -p "$O"
N=10000
run() { # name spec
  if [ ! -s "$O"/"$1".jsonl ] || [ "$(wc -l < "$O"/"$1".jsonl)" -lt "$N" ]; then
    nice -n 10 "$LAB" --threads 5 --out "$O"/"$1".jsonl declare --deals $N --bot "$2" --field normal 2>/dev/null
  fi
  echo "$1 done $(date +%T)"
}
run normal normal
run dmc "dmc:$D"
run bid-normal_rest-dmc "phased:normal+dmc:$D+dmc:$D"
run bid-dmc_rest-normal "phased:dmc:$D+normal+normal"
run bidexch-dmc_play-normal "phased:dmc:$D+dmc:$D+normal"
run bidexch-normal_play-dmc "phased:normal+normal+dmc:$D"
run dmc-h40k "dmc:$A/dmc-v2-h40k"
run dmc-h80k "dmc:$A/dmc-v2-h80k"
run bid-hard_rest-dmc "phased:hard+dmc:$D+dmc:$D"
run bid-hard_rest-normal "phased:hard+normal+normal"
run bid-normal_exch-dmc_play-normal "phased:normal+dmc:$D+normal"
