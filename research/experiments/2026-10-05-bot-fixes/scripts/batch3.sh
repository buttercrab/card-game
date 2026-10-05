#!/bin/bash
cd "$(dirname "$0")" || exit 1
N=200000
J0="simple@aim_joker_call=false,spare_declarer_joker=false"
J1="simple@aim_joker_call=true,spare_declarer_joker=false"
J2="simple"
bash pair.sh bid_base5.5 "$J0" "$J0,bid_base=5.5" "$J0" $N
bash pair.sh aim_joker_call "$J0" "$J1" "$J0" $N
bash pair.sh spare_declarer_joker "$J1" "$J2" "$J1" $N
# Temper: the old bold and careful seats against the new ones, in a field of the new bot.
bash pair.sh temper+0.4vs0.2 "$J2" "simple@bid_base=6.4" "simple@bid_base=6.2" $N
bash pair.sh temper-0.4vs-0.2 "$J2" "simple@bid_base=5.6" "simple@bid_base=5.8" $N
