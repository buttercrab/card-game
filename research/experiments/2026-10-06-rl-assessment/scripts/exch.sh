#!/bin/bash
# Where the network's exchange loses: its discards (and trump change) vs
# its friend call, on hands 보통 bid, 보통 playing every seat afterwards.
set -e
LAB=/Users/jaeyong/Development/Github/card-game/.claude/worktrees/agent-a199a6aff6c91e76e/target/release/lab
cd $HOME/card-game-artifacts/assess-2026-10-06
mkdir -p results/exchange
nice -n 10 $LAB --threads 3 --out results/exchange/records.jsonl gen --deals 3000 --bot normal 2>/dev/null
nice -n 10 $LAB --threads 3 --out results/exchange/variants.jsonl exchange --records results/exchange/records.jsonl --play normal \
  --variant simple=bot:normal --variant net=bot:dmc:dmc-v2-final \
  --variant net-discards=split:dmc:dmc-v2-final/normal --variant net-call=split:normal/dmc:dmc-v2-final 2>/dev/null
echo "exchange done $(date +%T)"
