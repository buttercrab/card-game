"""The learning curve and throughput of a DMC run, from its log:

    uv run python -m cardgame_ml.train.dmc.report --run dmc-v1 --out <curve.json>

writes JSON (every point of the curve: hands, decisions, learner steps,
wall time and each opponent's points per seat-hand; and the throughput
lines, averaged over each stretch between points) and prints the curve
as a Markdown table.
"""

import argparse
import json
import math
from pathlib import Path
from typing import Any

from cardgame_ml import runs


def read_log(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def curve(log: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The curve's points in order, each with the mean throughput and
    losses by phase of the stretch of training that led to it."""
    points: list[dict[str, Any]] = []
    stretch: list[dict[str, Any]] = []
    for entry in log:
        if entry["event"] == "train":
            stretch.append(entry)
        elif entry["event"] == "curve":
            point = {k: entry[k] for k in ("hands", "decisions", "step", "seconds", "scores")}
            point["throughput"] = _mean([e["throughput"] for e in stretch])
            point["phases"] = _phases(stretch)
            points.append(point)
            stretch = []
    return points


def _mean(rows: list[dict[str, Any]]) -> dict[str, float]:
    keys = {k for row in rows for k, v in row.items() if isinstance(v, int | float)}
    out: dict[str, float] = {}
    for key in sorted(keys):
        values = [float(r[key]) for r in rows if isinstance(r.get(key), int | float)]
        out[key] = sum(values) / len(values)
    return out


def _phases(stretch: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    """Each phase's variance explained and MSE, weighted by decisions."""
    sums: dict[str, list[float]] = {}
    for entry in stretch:
        for name, p in entry["phases"].items():
            if math.isnan(p["explained"]):
                continue
            s = sums.setdefault(name, [0.0, 0.0, 0.0])
            s[0] += p["decisions"]
            s[1] += p["decisions"] * p["mse"]
            s[2] += p["decisions"] * p["explained"]
    return {
        name: {"decisions": n, "mse": mse / n, "explained": explained / n}
        for name, (n, mse, explained) in sums.items()
        if n
    }


def table(points: list[dict[str, Any]]) -> str:
    """The curve as Markdown: points per seat-hand against each opponent."""
    opponents = list(points[0]["scores"]) if points else []
    head = "| hands | decisions | hours | " + " | ".join(opponents) + " |"
    rule = "| ---: | ---: | ---: | " + " | ".join("---:" for _ in opponents) + " |"
    rows = [head, rule]
    for p in points:
        scores = " | ".join(
            f"{p['scores'][o]['mean']:+.2f} ± {p['scores'][o]['ci95']:.2f}" for o in opponents
        )
        rows.append(
            f"| {p['hands']:,} | {p['decisions']:,} | {p['seconds'] / 3600:.2f} | {scores} |"
        )
    return "\n".join(rows)


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="python -m cardgame_ml.train.dmc.report", description=__doc__
    )
    parser.add_argument("--run", required=True, help="the run's name")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    log = read_log(runs.run_dir(args.run) / "log.jsonl")
    points = curve(log)
    starts = [e for e in log if e["event"] in ("start", "resume", "end")]
    result = {"run": args.run, "sessions": starts, "curve": points}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(table(points))


if __name__ == "__main__":
    main()
