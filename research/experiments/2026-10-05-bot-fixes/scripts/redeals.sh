#!/bin/bash
# Redeals per hand for a table of simple bots, old misdeal rule vs new.
cd "$(dirname "$0")" || exit 1
for p in gshs default; do
  for b in "simple@misdeal_below_min=false" "simple"; do
    nice -n 10 ./lab --threads 2 --preset $p --out rd.jsonl gen --deals 20000 --bot "$b" > /dev/null 2>&1
    python3 - "$p" "$b" <<'EOF'
import json, sys
n = deals = mis = 0
for line in open('rd.jsonl'):
    r = json.loads(line)
    n += 1
    deals += sum(1 for a in r['log'] if isinstance(a, dict) and 'Deal' in a) - 1
    mis += sum(1 for a in r['log'] if a == 'Misdeal')
print(f"{sys.argv[1]} {sys.argv[2]}: redeals/hand {deals/n:.3f}, misdeals/hand {mis/n:.3f}")
EOF
  done
done
