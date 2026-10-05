"""The leaderboard: every loop run (and the policy's reference bots) on
one table, best rating first, written as ``research/loop/leaderboard.md``
and ``leaderboard.json``; plus the plots' data and charts in
``research/loop/plots/`` (learning curves, rating by hands and by GPU
hours, for the scaling study).

Columns: the method and what the run varied, self-play hands, model
parameters, compute (GPU hours, thread-hours), the rating against the
ladder, against 고수 deal by deal (the ladder's rating difference, then
presets and held-out rule sets), think time, status, and whether a win
was confirmed on fresh deals.
"""

import csv
import io
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from cardgame_ml.loop import svg
from cardgame_ml.loop.evals import Estimate, EvalResult
from cardgame_ml.loop.layout import Layout
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.promotion import eval_results
from cardgame_ml.loop.records import Records, RunRecord
from cardgame_ml.loop.summary import compute

SCHEMA = "loop-leaderboard/1"


@dataclass(frozen=True)
class Row:
    id: str
    folder: str | None
    method: str
    tags: list[str]
    params: dict[str, object]
    status: str
    hands: int | None
    parameters: int | None
    gpu_hours: float
    thread_hours: dict[str, float]
    rating: Estimate | None
    vs_hard: Estimate | None
    presets_vs_hard: Estimate | None
    heldout_vs_hard: Estimate | None
    think_median_ms: float | None
    think_p99_ms: float | None
    vs_parent: Estimate | None
    beats_parent: bool
    confirmed: bool | None
    reference: bool = False

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def curve(folder: Path) -> dict[str, Any] | None:
    path = folder / "results" / "curve" / "curve.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def row(record: RunRecord, folder: Path, baseline: str) -> Row:
    results = eval_results(folder)
    scored = results.get(f"eval-{baseline}")
    cost = results.get("cost")
    learned = curve(folder)
    hands = parameters = None
    if learned:
        points: list[dict[str, Any]] = learned.get("curve") or []
        hands = points[-1]["hands"] if points else None
        sessions: list[dict[str, Any]] = learned.get("sessions") or []
        starts = [s for s in sessions if s.get("event") == "start"]
        parameters = starts[0].get("parameters") if starts else None
    used = compute(record)
    timed = cost or scored
    comparison = record.comparison or {}
    diff = comparison.get("diff")
    return Row(
        id=record.id,
        folder=record.folder,
        method=record.method,
        tags=record.tags,
        params=record.params,
        status=record.status,
        hands=hands,
        parameters=parameters,
        gpu_hours=round(used["gpu"], 2),
        thread_hours={k[4:]: round(v, 1) for k, v in used.items() if k.startswith("cpu_")},
        rating=_get(scored, "ladder", "bot"),
        vs_hard=_get(scored, "ladder", "diff"),
        presets_vs_hard=_get(scored, "presets", "diff"),
        heldout_vs_hard=_get(scored, "heldout", "diff"),
        think_median_ms=timed.think_median_ms if timed else None,
        think_p99_ms=timed.think_p99_ms if timed else None,
        vs_parent=Estimate.from_json(diff) if diff is not None else None,
        beats_parent=bool(comparison.get("beats")),
        confirmed=record.confirmed,
    )


def reference_rows(layout: Layout, policy: Policy) -> list[Row]:
    rows: list[Row] = []
    for ref in policy.references:
        path = layout.repo / ref.results
        if not path.is_file():
            continue
        r = EvalResult.load(path)
        rows.append(
            Row(
                id=ref.name,
                folder=None,
                method="reference",
                tags=[],
                params={"bot": ref.bot},
                status="reference",
                hands=None,
                parameters=None,
                gpu_hours=0.0,
                thread_hours={},
                rating=_get(r, "ladder", "bot"),
                vs_hard=_get(r, "ladder", "diff"),
                presets_vs_hard=_get(r, "presets", "diff"),
                heldout_vs_hard=_get(r, "heldout", "diff"),
                think_median_ms=r.think_median_ms,
                think_p99_ms=r.think_p99_ms,
                vs_parent=None,
                beats_parent=False,
                confirmed=None,
                reference=True,
            )
        )
    return rows


def rows(layout: Layout, policy: Policy) -> list[Row]:
    records = Records(layout.experiments, layout.live)
    out = [
        row(r, records.folder(r), policy.protocol.baseline) for r in records.all()
    ] + reference_rows(layout, policy)
    return sorted(out, key=lambda r: (r.rating is None, -(r.rating.mean if r.rating else 0.0)))


def markdown(table: list[Row], policy: Policy) -> str:
    lines = [
        "# Leaderboard",
        "",
        "Written by `python -m cardgame_ml.loop report`; do not edit. Ratings are suite "
        f"{policy.protocol.suite}'s ladder (points per seat-hand, mean over rungs, 95% "
        f'intervals); "vs {policy.protocol.baseline}" columns are deal-by-deal differences '
        "against it. A win counts once **confirmed** on fresh deals.",
        "",
        "| run | method | varied | status | hands | params | GPU h | thread-h | rating "
        f"| vs {policy.protocol.baseline} | presets | held-out | think ms | vs parent "
        "| confirmed |",
        "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: "
        "| ---: | ---: | --- |",
    ]
    for r in table:
        name = f"[{r.id}](../experiments/{r.folder})" if r.folder else f"**{r.id}**"
        think = (
            f"{r.think_median_ms:.0f}/{r.think_p99_ms:.0f}"
            if r.think_median_ms is not None and r.think_p99_ms is not None
            else "-"
        )
        parent = _est(r.vs_parent) + (" ✓" if r.beats_parent else "")
        confirmed = {None: "-", True: "**yes**", False: "no"}[r.confirmed]
        lines.append(
            f"| {name} | {r.method} | {_params(r.params)} | {r.status} | {_count(r.hands)} "
            f"| {_count(r.parameters)} | {r.gpu_hours:.1f} | {sum(r.thread_hours.values()):.0f} "
            f"| {_est(r.rating)} | {_est(r.vs_hard)} | {_est(r.presets_vs_hard)} "
            f"| {_est(r.heldout_vs_hard)} | {think} | {parent} | {confirmed} |"
        )
    return "\n".join(lines) + "\n"


def write_leaderboard(layout: Layout, policy: Policy) -> list[Path]:
    """Writes the leaderboard and the plots; returns what it wrote."""
    table = rows(layout, policy)
    layout.loop.mkdir(parents=True, exist_ok=True)
    written = [layout.loop / "leaderboard.md", layout.loop / "leaderboard.json"]
    written[0].write_text(markdown(table, policy), encoding="utf-8")
    data = {"schema": SCHEMA, "rows": [r.to_json() for r in table]}
    written[1].write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    written += write_plots(layout, policy, table)
    return written


def write_plots(layout: Layout, policy: Policy, table: list[Row]) -> list[Path]:
    plots = layout.plots
    plots.mkdir(parents=True, exist_ok=True)
    records = Records(layout.experiments, layout.live)
    runs = [r for r in table if not r.reference]
    scaling = io.StringIO()
    w = csv.writer(scaling, lineterminator="\n")
    w.writerow(
        [
            "run",
            "method",
            "tags",
            "parameters",
            "hands",
            "gpu_hours",
            "thread_hours",
            "rating",
            "rating_ci95",
            "vs_hard",
            "vs_hard_ci95",
        ]
    )
    for r in runs:
        w.writerow(
            [
                r.id,
                r.method,
                " ".join(r.tags),
                r.parameters or "",
                r.hands or "",
                r.gpu_hours,
                sum(r.thread_hours.values()),
                _num(r.rating, "mean"),
                _num(r.rating, "ci95"),
                _num(r.vs_hard, "mean"),
                _num(r.vs_hard, "ci95"),
            ]
        )
    curves = io.StringIO()
    c = csv.writer(curves, lineterminator="\n")
    c.writerow(["run", "hands", "hours", "opponent", "mean", "ci95"])
    by_opponent: dict[str, list[svg.Series]] = {o: [] for o in policy.protocol.curve.opponents}
    for record in records.all():
        learned = curve(records.folder(record))
        if not learned:
            continue
        points: list[dict[str, Any]] = learned.get("curve") or []
        for opponent, series in by_opponent.items():
            line = [
                (float(p["hands"]), float(p["scores"][opponent]["mean"]))
                for p in points
                if opponent in p["scores"]
            ]
            series.append(svg.Series(record.id, line))
        for p in points:
            scores: dict[str, dict[str, float]] = p["scores"]
            for opponent, score in scores.items():
                c.writerow(
                    [
                        record.id,
                        p["hands"],
                        round(p["seconds"] / 3600, 3),
                        opponent,
                        score["mean"],
                        score["ci95"],
                    ]
                )
    written: list[Path] = []
    for name, text in (("scaling.csv", scaling.getvalue()), ("curves.csv", curves.getvalue())):
        (plots / name).write_text(text, encoding="utf-8")
        written.append(plots / name)
    for opponent, series in by_opponent.items():
        path = plots / f"curve-{opponent}.svg"
        path.write_text(
            svg.chart(
                series[-len(svg.PALETTE) :],
                title=f"Learning curves: greedy, one seat against four {opponent}",
                x_label="self-play hands",
                y_label="points per seat-hand",
            ),
            encoding="utf-8",
        )
        written.append(path)
    scored = [r for r in runs if r.rating is not None]
    for name, key, label in (
        ("scaling-hands.svg", "hands", "self-play hands (log)"),
        ("scaling-gpu.svg", "gpu_hours", "GPU hours (log)"),
    ):
        groups: dict[str, list[tuple[float, float]]] = {}
        for r in scored:
            x = r.hands if key == "hands" else r.gpu_hours
            if x and r.rating is not None:
                groups.setdefault(r.method, []).append((float(x), r.rating.mean))
        path = plots / name
        path.write_text(
            svg.chart(
                [svg.Series(m, sorted(p)) for m, p in groups.items()],
                title=f"Rating on suite {policy.protocol.suite} by {label.split(' (')[0]}",
                x_label=label,
                y_label="rating (points per seat-hand)",
                log_x=True,
                lines=False,
            ),
            encoding="utf-8",
        )
        written.append(path)
    return written


def _get(result: EvalResult | None, part: str, which: str) -> Estimate | None:
    if result is None:
        return None
    summary = result.metric(part)
    return getattr(summary, which) if summary else None


def _est(e: Estimate | None) -> str:
    return "-" if e is None else f"{e.mean:+.2f} ± {e.ci95:.2f}"


def _num(e: Estimate | None, field: str) -> str:
    return "" if e is None else f"{getattr(e, field):.4f}"


def _count(n: int | None) -> str:
    if n is None:
        return "-"
    for size, suffix in ((1e9, "G"), (1e6, "M"), (1e3, "k")):
        if n >= size:
            return f"{n / size:.3g}{suffix}"
    return str(n)


def _params(params: dict[str, object]) -> str:
    if not params:
        return "-"
    text = ", ".join(f"{k}={v}" for k, v in params.items())
    return text if len(text) <= 60 else text[:57] + "…"  # noqa: PLR2004
