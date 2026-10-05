#!/bin/bash
# 기본, search bot, everything against the old, fresh deals (seed 1000).
cd "$(dirname "$0")"
OLD="bid_base=6.5,aim_joker_call=false,spare_declarer_joker=false,misdeal_below_min=false,bid_spread=0"
out=$(nice -n 10 ./sim2 --preset default --games 2000 --seed 1000 --bots search --field simple --focus "search:200:1:0" --baseline "search:200:1:0@replay_redeals=true,$OLD" --view-every 0 --threads 4 2>&1)
echo "hard-all-2 | default | $out" | tee -a results.log
