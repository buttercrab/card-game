"""Tables for `lab declare` runs on the same deals: the focus seat's points
by variant, paired with a baseline variant, its roles and contracts, and
where the difference to the baseline comes from (role transitions).

    python analyze_declare.py results/normal normal > results/normal.md

Reads every ``*.jsonl`` in the directory; numpy only."""

import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

Z = 1.96


def load(path: Path) -> dict[int, dict]:
    rows = [json.loads(line) for line in path.read_text().splitlines() if line]
    return {r["deal"]: r for r in rows}


def ci(x: np.ndarray) -> str:
    if len(x) < 2:
        return "–"
    return f"{x.mean():+.2f} ± {Z * x.std(ddof=1) / np.sqrt(len(x)):.2f}"


def share(x: np.ndarray) -> str:
    if len(x) == 0:
        return "–"
    return f"{100 * x.mean():.1f}%"


def role(r: dict) -> str:
    if r["declarer"] == r["focus"]:
        return "alone" if r.get("friend") in (None, r["focus"]) else "declarer"
    if r.get("friend") == r["focus"]:
        return "friend"
    return "defender"


ROLES = ("declarer", "alone", "friend", "defender")


def main() -> None:
    where, base_name = Path(sys.argv[1]), sys.argv[2]
    runs = {p.stem: load(p) for p in sorted(where.glob("*.jsonl"))}
    base = runs[base_name]
    names = [base_name] + sorted(n for n in runs if n != base_name)
    print(f"Baseline: {base_name}. 95% intervals; differences paired by deal.\n")
    print(
        "| Variant | Deals | Points per hand | Paired vs baseline | Declares | Made | "
        "Declarer payoff | Misdeals called /hand | Redeals /hand |"
    )
    print("| --- | ---: | --- | --- | ---: | ---: | --- | ---: | ---: |")
    summary = {}
    for n in names:
        run = runs[n]
        deals = sorted(set(run) & set(base))
        pay = np.array([run[d]["payoff"] for d in deals], float)
        diff = pay - np.array([base[d]["payoff"] for d in deals], float)
        rows = [run[d] for d in deals]
        dec = [r for r in rows if r["declarer"] == r["focus"]]
        made = np.array([r["team_points"] >= r["contract"]["count"] for r in dec], float)
        dpay = np.array([r["declarer_payoff"] for r in dec], float)
        mis = np.array([r.get("misdeals", 0) for r in rows], float)
        red = np.array([r["redeals"] for r in rows], float)
        print(
            f"| {n} | {len(deals)} | {ci(pay)} | {ci(diff) if n != base_name else '–'} | "
            f"{share(np.array([1.0] * len(dec) + [0.0] * (len(rows) - len(dec))))} | "
            f"{share(made)} | {ci(dpay)} | {mis.mean():.3f} | {red.mean():.3f} |"
        )
        summary[n] = {
            "deals": len(deals),
            "mean": pay.mean(),
            "diff": diff.mean(),
            "diff_ci": Z * diff.std(ddof=1) / np.sqrt(len(diff)) if len(diff) > 1 else None,
            "declare_rate": len(dec) / len(rows),
            "made": made.mean() if len(made) else None,
        }
    print(
        "\nBy role: share of hands, mean points in that role, and its contribution "
        "(share × mean) to points per hand.\n"
    )
    print("| Variant | " + " | ".join(ROLES) + " |")
    print("| --- |" + " --- |" * len(ROLES))
    for n in names:
        run = runs[n]
        rows = [run[d] for d in sorted(set(run) & set(base))]
        cells = []
        for ro in ROLES:
            x = np.array([r["payoff"] for r in rows if role(r) == ro], float)
            if len(x) == 0:
                cells.append("–")
                continue
            cells.append(
                f"{100 * len(x) / len(rows):.1f}% · {x.mean():+.1f} · {len(x) * x.mean() / len(rows):+.2f}"
            )
        print(f"| {n} | " + " | ".join(cells) + " |")
    print("\nContracts the focus seat played as declarer (count: hands, made, mean payoff):\n")
    for n in names:
        run = runs[n]
        dec = [r for r in run.values() if r["declarer"] == r["focus"]]
        by = Counter((r["contract"]["count"], r["contract"]["trump"] is None) for r in dec)
        parts = []
        for (count, nt), k in sorted(by.items()):
            hs = [
                r
                for r in dec
                if r["contract"]["count"] == count and (r["contract"]["trump"] is None) == nt
            ]
            m = np.mean([r["team_points"] >= count for r in hs])
            p = np.mean([r["declarer_payoff"] for r in hs])
            parts.append(f"{count}{'nt' if nt else ''}: {k}, {100 * m:.0f}%, {p:+.1f}")
        print(f"- **{n}**: " + "; ".join(parts))
    print(
        "\nRole transitions against the baseline on the same deal (rows: baseline's role, "
        "columns: the variant's): hands per 1 000, and the mean paired difference in those "
        "hands; the sum of share × difference over cells is the variant's paired difference.\n"
    )
    for n in names:
        if n == base_name:
            continue
        run = runs[n]
        deals = sorted(set(run) & set(base))
        print(f"**{n}**\n")
        print("| baseline \\ variant | " + " | ".join(ROLES) + " |")
        print("| --- |" + " --- |" * len(ROLES))
        for rb in ROLES:
            cells = []
            for rv in ROLES:
                ds = [d for d in deals if role(base[d]) == rb and role(run[d]) == rv]
                if not ds:
                    cells.append("–")
                    continue
                dd = np.array([run[d]["payoff"] - base[d]["payoff"] for d in ds], float)
                cells.append(
                    f"{1000 * len(ds) / len(deals):.0f} · {dd.mean():+.1f} ({len(ds) * dd.mean() / len(deals):+.2f})"
                )
            print(f"| {rb} | " + " | ".join(cells) + " |")
        print()
    (where / "summary.json").write_text(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
