"""The learning curve and throughput of a DMC run, from its log:

    uv run python -m cardgame_ml.train.dmc.report --run dmc-v1 --out <curve.json>

writes a ``CurveReport`` as JSON (every point of the curve: hands,
decisions, learner steps, wall time and each opponent's points per
seat-hand; and the throughput lines, averaged over each stretch between
points) and prints the curve as a Markdown table. The experiment loop's
leaderboard, summaries and plots read the same ``CurveReport``.
"""

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from cardgame_ml import schema
from cardgame_ml.runs import RunDir
from cardgame_ml.runtime import write_json

CURVE_FILE = "curve.json"
"""What the report is called in the folder it is written to."""


@dataclass(frozen=True)
class Score:
    """Points per seat-hand: mean, 95% half-width, deals."""

    mean: float
    ci95: float
    n: int


@dataclass(frozen=True)
class PhaseFit:
    """How well a phase of the hand is learnt over a stretch of training."""

    decisions: float
    mse: float
    explained: float


@dataclass(frozen=True, kw_only=True)
class CurvePoint:
    hands: int
    decisions: int
    step: int
    seconds: float
    scores: dict[str, Score]
    """By opponent."""
    throughput: dict[str, float]
    """The mean of the throughput lines since the previous point."""
    phases: dict[str, PhaseFit]


@dataclass(frozen=True, kw_only=True)
class CurveReport:
    run: str
    parameters: int | None = None
    """The network's size, as its first session reported it."""
    sessions: tuple[dict[str, object], ...] = ()
    """The log's ``start``, ``resume`` and ``end`` lines."""
    curve: tuple[CurvePoint, ...] = ()

    def write(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        write_json(path, schema.table(self), indent=1)

    @classmethod
    def load(cls, path: Path) -> "CurveReport":
        return schema.read(cls, json.loads(path.read_text(encoding="utf-8")), str(path))


def read_log(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def curve(log: list[dict[str, Any]]) -> list[CurvePoint]:
    """The curve's points in order, each with the mean throughput and
    losses by phase of the stretch of training that led to it."""
    points: list[CurvePoint] = []
    stretch: list[dict[str, Any]] = []
    for entry in log:
        if entry["event"] == "train":
            stretch.append(entry)
        elif entry["event"] == "curve":
            point = {k: entry[k] for k in ("hands", "decisions", "step", "seconds", "scores")}
            point["throughput"] = _mean([e["throughput"] for e in stretch])
            point["phases"] = _phases(stretch)
            points.append(schema.read(CurvePoint, point, "curve point"))
            stretch = []
    return points


def report(run: str, log: list[dict[str, Any]]) -> CurveReport:
    starts = [e for e in log if e["event"] == "start"]
    return CurveReport(
        run=run,
        parameters=starts[0].get("parameters") if starts else None,
        sessions=tuple(e for e in log if e["event"] in ("start", "resume", "end")),
        curve=tuple(curve(log)),
    )


def _mean(rows: list[dict[str, Any]]) -> dict[str, float]:
    keys = {k for row in rows for k, v in row.items() if _number(v)}
    out: dict[str, float] = {}
    for key in sorted(keys):
        values = [float(r[key]) for r in rows if _number(r.get(key))]
        out[key] = sum(values) / len(values)
    return out


def _number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


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


def table(points: list[CurvePoint] | tuple[CurvePoint, ...]) -> str:
    """The curve as Markdown: points per seat-hand against each opponent."""
    opponents = list(points[0].scores) if points else []
    head = "| hands | decisions | hours | " + " | ".join(opponents) + " |"
    rule = "| ---: | ---: | ---: | " + " | ".join("---:" for _ in opponents) + " |"
    rows = [head, rule]
    for p in points:
        scores = " | ".join(f"{p.scores[o].mean:+.2f} ± {p.scores[o].ci95:.2f}" for o in opponents)
        rows.append(f"| {p.hands:,} | {p.decisions:,} | {p.seconds / 3600:.2f} | {scores} |")
    return "\n".join(rows)


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="python -m cardgame_ml.train.dmc.report", description=__doc__
    )
    parser.add_argument("--run", required=True, help="the run's name")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = report(args.run, read_log(RunDir.named(args.run).log))
    result.write(args.out)
    print(table(result.curve))


if __name__ == "__main__":
    main()
