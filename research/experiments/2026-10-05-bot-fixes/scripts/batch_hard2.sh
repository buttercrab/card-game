#!/bin/bash
# More search-bot games, on fresh deals (seed 1000).
cd "$(dirname "$0")" || exit 1
OLD="bid_base=6.5,aim_joker_call=false,spare_declarer_joker=false,misdeal_below_min=false,bid_spread=0"
for p in gshs default; do
  out=$(nice -n 10 ./sim2 --preset $p --games 3000 --seed 1000 --bots search --field simple --focus "search:200:1:0" --baseline "search:200:1:0@replay_redeals=true,$OLD" --view-every 0 --threads 4 2>&1)
  echo "hard-all-2 | $p | $out" | tee -a results.log
  out=$(nice -n 10 ./sim2 --preset $p --games 2000 --seed 1000 --bots search --field simple --focus "search:200:1:0" --baseline "search:200:1:0@replay_redeals=true" --view-every 0 --threads 4 2>&1)
  echo "hard-redeal0-2 | $p | $out" | tee -a results.log
done
