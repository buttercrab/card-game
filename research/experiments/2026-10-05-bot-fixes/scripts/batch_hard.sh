#!/bin/bash
# Search-bot measurements: one search seat against simple bots.
cd "$(dirname "$0")" || exit 1
N=${1:-1000}
OLD="bid_base=6.5,aim_joker_call=false,spare_declarer_joker=false,misdeal_below_min=false,bid_spread=0"
for p in gshs default; do
  out=$(nice -n 10 ./sim2 --preset "$p" --games "$N" --bots search --field simple --focus "search:200:1:0" --baseline "search:200:1:0@replay_redeals=true" --view-every 0 --threads 4 2>&1)
  echo "hard-redeal0 | $p | $out" | tee -a results.log
  out=$(nice -n 10 ./sim2 --preset "$p" --games "$N" --bots search --field simple --focus "search:200:1:0" --baseline "search:200:1:0@replay_redeals=true,$OLD" --view-every 0 --threads 4 2>&1)
  echo "hard-all | $p | $out" | tee -a results.log
done
