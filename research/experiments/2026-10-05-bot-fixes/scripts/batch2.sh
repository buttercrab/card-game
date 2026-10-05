#!/bin/bash
cd "$(dirname "$0")"
O="simple@aim_joker_call=false,spare_declarer_joker=false"
B="$O,bid_base=6.0,misdeal_below_min=true,bid_spread=0"
N=200000
for s in 5 7; do
  bash pair.sh "spread$s" "$B" "$B,bid_spread=$s" "$B" $N gshs
done
