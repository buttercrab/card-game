"""How much of the payoff is predictable at bidding time (experiment 4), and
what the training data at bidding decisions looked like (experiment 5).

    python analyze_signal.py results/   # reads signal/*.jsonl, train-replica.jsonl

R² is 1 - SSE/SST on the payoff. "raw" uses the predictor as it is (points);
"fit" calibrates it (or fits the features) by ordinary least squares,
scored out of fold (5 folds by deal, so no hand is in both). numpy only."""

import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

FOLDS = 5


def r2(y: np.ndarray, p: np.ndarray) -> float:
    return float(1 - ((y - p) ** 2).sum() / ((y - y.mean()) ** 2).sum())


def cv_fit(x: np.ndarray, y: np.ndarray, groups: np.ndarray) -> float:
    """Out-of-fold R² of OLS (with intercept) on ``x``."""
    x = np.column_stack([np.ones(len(x)), x])
    pred = np.zeros(len(y))
    fold = groups % FOLDS
    for k in range(FOLDS):
        tr, te = fold != k, fold == k
        beta, *_ = np.linalg.lstsq(x[tr], y[tr], rcond=None)
        pred[te] = x[te] @ beta
    return r2(y, pred)


def simple_features(rows: list[dict]) -> np.ndarray:
    kind = np.array([[r["kind"] == k for k in ("bid", "pass", "misdeal")] for r in rows], float)
    est = np.array([r["estimate"] for r in rows], float)
    has_need = np.array([r["needed"] is not None for r in rows], float)
    gap = np.array(
        [(r["estimate"] - r["needed"]) if r["needed"] is not None else 0.0 for r in rows]
    )
    pos = np.array([[r["position"] == p for p in range(5)] for r in rows], float)
    count = np.array([r["count"] for r in rows], float)
    nt = np.array([r["no_trump"] for r in rows], float)
    best = np.array([r["best_count"] for r in rows], float)
    before = np.array([r["bids_before"] for r in rows], float)
    cols = [
        kind[:, :2],
        est[:, None],
        has_need[:, None],
        gap[:, None],
        pos[:, 1:],
        count[:, None],
        nt[:, None],
        best[:, None],
        before[:, None],
    ]
    # The hand's strength matters differently when bidding and passing.
    cols += [
        kind[:, :2] * est[:, None],
        kind[:, :2] * gap[:, None],
        kind[:, :2] * est[:, None] ** 2,
        kind[:, :1] * count[:, None],
    ]
    return np.column_stack(cols)


def table_dataset(path: Path) -> None:
    rows = [json.loads(line) for line in path.read_text().splitlines() if line]
    print(
        f"\n### {path.stem}: {len(rows)} bidding decisions, "
        f"{len({r['deal'] for r in rows})} hands\n"
    )
    thrown = np.array([r["thrown_in"] for r in rows])
    print(
        f"In deals later thrown in: {100 * thrown.mean():.1f}%; kinds: "
        + ", ".join(f"{k} {sum(r['kind'] == k for r in rows)}" for k in ("bid", "pass", "misdeal"))
    )
    print()
    print(
        "| Subset | n | SD payoff | Q raw | Q fit | simple fit | search raw | search fit | "
        "simple+search+Q fit |"
    )
    print("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
    subsets = {
        "all (DMC's label)": lambda r: True,
        "played deal only": lambda r: not r["thrown_in"],
        "played deal, bids": lambda r: not r["thrown_in"] and r["kind"] == "bid",
        "played deal, passes": lambda r: not r["thrown_in"] and r["kind"] == "pass",
    }
    for name, keep in subsets.items():
        sub = [
            r for r in rows if keep(r) and r["s_chosen"] is not None and r["q_chosen"] is not None
        ]
        if len(sub) < 50:
            continue
        y = np.array([r["payoff"] for r in sub], float)
        g = np.array([r["deal"] for r in sub])
        q = np.array([r["q_chosen"] for r in sub], float)
        s = np.array([r["s_chosen"] for r in sub], float)
        x = simple_features(sub)
        print(
            f"| {name} | {len(sub)} | {y.std():.1f} | {r2(y, q):.3f} | {cv_fit(q[:, None], y, g):.3f} | "
            f"{cv_fit(x, y, g):.3f} | {r2(y, s):.3f} | {cv_fit(s[:, None], y, g):.3f} | "
            f"{cv_fit(np.column_stack([x, s, q]), y, g):.3f} |"
        )
    # Bid or pass: where the network and the search disagree.
    both = [
        r
        for r in rows
        if not r["thrown_in"]
        and r["q_best_bid"] is not None
        and r["q_pass"] is not None
        and r["s_simple_bid"] is not None
        and r["s_pass"] is not None
    ]
    if both:
        qd = np.array([r["q_best_bid"] - r["q_pass"] for r in both])
        sd = np.array([r["s_simple_bid"] - r["s_pass"] for r in both])
        print(
            f"\nDecisions in a played deal where a bid and a pass were both legal: {len(both)}. "
            f"The network's best bid minus pass: mean {qd.mean():+.1f}, above 0 in "
            f"{100 * (qd > 0).mean():.1f}%. The search's (simple bot's cheapest bid in its "
            f"trump) minus pass: mean {sd.mean():+.1f}, above 0 in {100 * (sd > 0).mean():.1f}%, "
            f"above +3 in {100 * (sd > 3).mean():.1f}%. Correlation of the two: "
            f"{np.corrcoef(qd, sd)[0, 1]:.2f}."
        )
        lost = sd[(qd <= 0) & (sd > 0)]
        print(
            f"Where the search says bid and the network says pass: {len(lost)} decisions "
            f"({100 * len(lost) / len(both):.1f}%), the search's margin averaging {lost.mean():+.1f} points."
        )


def replica(path: Path) -> None:
    rows = [json.loads(line) for line in path.read_text().splitlines() if line]
    hands = len({r["hand"] for r in rows})
    names = ["bidding", "exchange", "early tricks", "late tricks"]
    print(
        f"\n### Training replica: {hands} self-play hands, {len(rows)} decisions "
        "(dmc-v2's final weights, its actors' exploration and exploring starts)\n"
    )
    print("| Phase | Decisions per hand | R² of Q(chosen) |")
    print("| --- | ---: | ---: |")
    for k, n in enumerate(names):
        sub = [r for r in rows if r["phase"] == k]
        y = np.array([r["payoff"] for r in sub])
        q = np.array([r["q"] for r in sub])
        print(f"| {n} | {len(sub) / hands:.1f} | {r2(y, q):.3f} |")
    bid = [r for r in rows if r["phase"] == 0]
    y = np.array([r["payoff"] for r in bid])
    q = np.array([r["q"] for r in bid])
    t = np.array([r["thrown_in"] for r in bid])
    acts = np.array([r["action"] for r in bid])
    is_bid = np.char.startswith(acts.astype(str), "bid ")
    forced = np.array([r["forced"] for r in bid])
    explored = np.array([r["explored"] for r in bid])
    y0 = np.where(t, 0.0, y)
    print()
    print(
        f"Bidding decisions: {len(bid) / hands:.1f} a hand, {100 * t.mean():.1f}% in deals later thrown in; "
        f"passes {100 * (acts == 'pass').mean():.1f}%, misdeals {100 * (acts == 'misdeal').mean():.1f}%, "
        f"bids {100 * is_bid.mean():.1f}% (forced by exploring starts {100 * forced.mean():.1f}%, "
        f"other exploration {100 * (explored & ~forced).mean():.1f}%)."
    )
    print(
        f"R² of Q(chosen): all {r2(y, q):.3f}; played deal only {r2(y[~t], q[~t]):.3f}; thrown-in only "
        f"{r2(y[t], q[t]):.3f}; against the deal-consistent target (0 for a thrown-in deal) {r2(y0, q):.3f}."
    )
    print(
        f"SD of the target: thrown-in {y[t].std():.1f}, played {y[~t].std():.1f}; mean target "
        f"thrown-in {y[t].mean():+.2f}."
    )
    for name, m in (("forced bids", forced), ("own bids (not forced)", is_bid & ~forced)):
        if m.sum():
            print(
                f"{name}: {m.sum()} ({m.sum() / hands:.2f} a hand), mean payoff {y[m].mean():+.1f}, "
                f"mean Q {q[m].mean():+.1f}."
            )
    dec = {}
    for r in rows:
        dec.setdefault(r["hand"], []).append(r)
    # The declarer's payoff in hands with a contract: the last bid of the played deal.
    pays, kinds, greedy_wins, counts = [], [], [], []
    for rs in dec.values():
        played = [
            r
            for r in rs
            if r["phase"] == 0 and not r["thrown_in"] and r["action"].startswith("bid ")
        ]
        if played:
            last = played[-1]
            pays.append(last["payoff"])
            kinds.append(last["forced"])
            greedy_wins.append(not last["explored"])
            counts.append(last["action"])
    pays_a, kinds_a = np.array(pays), np.array(kinds)
    if len(pays_a):
        print(
            f"Hands with a contract: {len(pays_a)} of {hands}; the declarer's mean payoff {pays_a.mean():+.1f} "
            f"(winning bid forced: {kinds_a.sum()}, mean {pays_a[kinds_a].mean() if kinds_a.any() else float('nan'):+.1f}; "
            f"not forced: mean {pays_a[~kinds_a].mean() if (~kinds_a).any() else float('nan'):+.1f})."
        )
        g = np.array(greedy_wins)
        print(
            f"The winning bid was the network's greedy choice in {g.sum()} hands "
            f"(mean declarer payoff {pays_a[g].mean() if g.any() else float('nan'):+.1f}), an exploratory "
            f"or forced one in {(~g).sum()} ({pays_a[~g].mean():+.1f}); commonest winning bids: "
            + ", ".join(f"{a} {n}" for a, n in Counter(counts).most_common(6))
            + "."
        )


def main() -> None:
    where = Path(sys.argv[1])
    if (where / "train-replica.jsonl").exists():
        replica(where / "train-replica.jsonl")
    for p in sorted((where / "signal").glob("*.jsonl")):
        table_dataset(p)


if __name__ == "__main__":
    main()
