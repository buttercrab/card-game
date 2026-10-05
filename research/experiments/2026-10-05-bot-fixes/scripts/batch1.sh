#!/bin/bash
cd "$(dirname "$0")" || exit 1
O="simple@aim_joker_call=false,spare_declarer_joker=false,bid_spread=0"
M0="$O,bid_base=6.5,misdeal_below_min=false"
M1="$O,bid_base=6.5,misdeal_below_min=true"
B="$O,bid_base=6.0,misdeal_below_min=true"
N=200000
./pair.sh misdeal "$M0" "$M1" "$M0" $N
./pair.sh bid_base6.0 "$M1" "$B" "$M1" $N
for s in 1.9 3 4; do
  ./pair.sh "spread$s" "$B" "$B,bid_spread=$s" "$B" $N
done
