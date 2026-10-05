"""`lab exchange` results: the declarer's payoff by exchange variant, paired
with the recorded (보통) exchange on the same hand, and what each variant
called and discarded.

    python analyze_exchange.py results/exchange/variants.jsonl"""

import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

rows = [json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines() if line]
names = list(dict.fromkeys(r["variant"] for r in rows))
print(
    "| Variant | Hands | Declarer payoff | vs recorded 보통 exchange (paired) | Made | "
    "Trump changed | Friend calls (top 5) |"
)
print("| --- | ---: | --- | --- | ---: | ---: | --- |")


def call_name(call: object) -> str:
    if isinstance(call, dict):
        ((k, v),) = call.items()
        return f"{k}:{v}"
    return str(call)


for n in names:
    rs = [r for r in rows if r["variant"] == n]
    pay = np.array([r["payoff"] for r in rs], float)
    diff = pay - np.array([r["base"] for r in rs], float)
    made = np.mean([r["team_points"] >= r["contract"]["count"] for r in rs])
    changed = np.mean([r["contract"]["trump"] != r["base_contract"]["trump"] for r in rs])
    calls = Counter(call_name(r["call"]) for r in rs).most_common(5)

    def ci(x: np.ndarray) -> str:
        return f"{x.mean():+.2f} ± {1.96 * x.std(ddof=1) / np.sqrt(len(x)):.2f}"

    print(
        f"| {n} | {len(rs)} | {ci(pay)} | {ci(diff)} | {100 * made:.0f}% | {100 * changed:.1f}% | "
        + ", ".join(f"{c} {k}" for c, k in calls)
        + " |"
    )
print()
print("Example discards (first 5 hands of each variant):")
for n in names:
    rs = [r for r in rows if r["variant"] == n][:5]
    print(f"- {n}: " + " | ".join(json.dumps(r["discards"], ensure_ascii=False) for r in rs))
