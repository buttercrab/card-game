#!/bin/bash
# 초보 against 보통 in a field of 보통, before (old binary) and after.
cd "$(dirname "$0")"
for p in gshs default; do
  for bin in base/sim ./sim; do
    out=$(nice -n 10 $bin --preset $p --games 100000 --bots search --field normal --focus easy --baseline normal --view-every 0 --threads 2 2>&1)
    echo "easy-vs-normal $bin | $p | $out" | tee -a results.log
  done
done
