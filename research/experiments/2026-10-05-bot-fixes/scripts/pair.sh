#!/bin/bash
# pair.sh NAME FIELD FOCUS BASELINE [GAMES] [PRESETS]
# Paired sim run of FOCUS vs BASELINE in one seat, FIELD elsewhere.
cd "$(dirname "$0")" || exit 1
name=$1; field=$2; focus=$3; base=$4; games=${5:-40000}; presets=${6:-"gshs default"}
for p in $presets; do
  out=$(nice -n 10 ./sim --preset "$p" --games "$games" --bots search --field "$field" --focus "$focus" --baseline "$base" --view-every 0 --threads 4 2>&1)
  echo "$name | $p | $out" | tee -a results.log
done
