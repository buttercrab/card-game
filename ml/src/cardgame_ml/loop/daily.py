"""The daily report, ``research/reports/YYYY-MM-DD.md``: what ran that
day, its results, the best so far, what was notable, what failed, what
the researcher did, what is queued next and the compute used (GPU hours,
thread-hours on the Mac and the home server).

The runner writes yesterday's once the policy's ``report_hour`` has
passed; ``python -m cardgame_ml.loop report --daily <date>`` writes any.
"""

import json
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any

from cardgame_ml.loop.layout import Layout
from cardgame_ml.loop.leaderboard import Row, rows
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.queue import read_queue, waiting_for
from cardgame_ml.loop.records import Records, RunRecord, RunStatus, now_utc, parse_stamp


def due(layout: Layout, policy: Policy, now: datetime) -> date | None:
    """Yesterday, if its report is due and not written."""
    local = now.astimezone()
    if local.hour < policy.report_hour:
        return None
    day = local.date() - timedelta(days=1)
    return None if (layout.reports / f"{day.isoformat()}.md").exists() else day


def day_span(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time(0)).astimezone()
    return start, start + timedelta(days=1)


def overlap_hours(start: str | None, end: str | None, span: tuple[datetime, datetime]) -> float:
    if start is None:
        return 0.0
    a = max(parse_stamp(start), span[0])
    b = min(parse_stamp(end) if end else now_utc(), span[1])
    return max((b - a).total_seconds(), 0.0) / 3600


def compute_on(runs: list[RunRecord], span: tuple[datetime, datetime]) -> dict[str, float]:
    used: dict[str, float] = {"gpu": 0.0}
    for run in runs:
        for s in run.steps:
            hours = overlap_hours(s.started, s.ended, span)
            if s.step.gpu:
                used["gpu"] += hours
            used[s.step.host] = used.get(s.step.host, 0.0) + hours * s.step.threads
    return used


def researcher_calls(layout: Layout, span: tuple[datetime, datetime]) -> list[dict[str, Any]]:
    if not layout.researcher_log.is_file():
        return []
    calls: list[dict[str, Any]] = []
    for line in layout.researcher_log.read_text(encoding="utf-8").splitlines():
        if line.strip():
            entry = json.loads(line)
            if span[0] <= parse_stamp(entry["started"]) < span[1]:
                calls.append(entry)
    return calls


def write_daily(layout: Layout, policy: Policy, day: date, records: Records | None = None) -> Path:
    span = day_span(day)
    records = records or Records(layout.experiments, layout.live)
    runs = records.all()

    def within(stamp_: str | None) -> bool:
        return stamp_ is not None and span[0] <= parse_stamp(stamp_) < span[1]

    started = [r for r in runs if within(r.created)]
    ended = [r for r in runs if within(r.ended)]
    touched = [r for r in runs if any(overlap_hours(s.started, s.ended, span) for s in r.steps)]
    board = [r for r in rows(layout, policy, records) if r.rating is not None]
    by_id = {r.id: r for r in board}
    used = compute_on(touched, span)
    lines = [
        f"# Experiment loop: {day.isoformat()}",
        "",
        f"{len(started)} runs started, {len(ended)} ended "
        f"({sum(r.status == RunStatus.SUCCEEDED for r in ended)} succeeded). Compute: "
        f"**{used['gpu']:.1f} GPU h**, "
        + ", ".join(f"{h} {v:.0f} thread-h" for h, v in used.items() if h != "gpu")
        + ".",
        "",
        "## Results",
        "",
    ]
    if ended:
        lines += [
            f"| run | method | status | rating | vs {policy.protocol.baseline} | vs parent "
            "| confirmed |",
            "| --- | --- | --- | ---: | ---: | ---: | --- |",
        ]
        for r in ended:
            row = by_id.get(r.id)
            lines.append(
                f"| [{r.id}](../experiments/{r.folder}/summary.md) | {r.method} | {r.status} "
                f"| {_e(row, 'rating')} | {_e(row, 'vs_hard')} | {_e(row, 'vs_parent')} "
                f"| {_confirmed(r)} |"
            )
    else:
        lines.append("No run ended.")
    lines += ["", "## Best so far", ""]
    for r in board[:5]:
        lines.append(
            f"- {r.id} ({r.method}): rating {_e(r, 'rating')}, vs {policy.protocol.baseline} "
            f"{_e(r, 'vs_hard')}" + (", confirmed" if r.confirmed else "")
        )
    if not board:
        lines.append("Nothing scored yet.")
    lines += ["", "## Notable", ""]
    notable = _notable(ended, layout, span)
    lines += notable or ["Nothing beyond the results above."]
    failures = [r for r in ended if r.status != RunStatus.SUCCEEDED]
    lines += ["", "## Failures", ""]
    lines += [f"- {r.id}: {r.status}: {r.failure or 'no detail'}" for r in failures] or ["None."]
    lines += ["", "## Researcher", ""]
    calls = researcher_calls(layout, span)
    lines += [
        f"- {c['started']}: {c.get('outcome', '?')}; queued {len(c.get('accepted', []))}, "
        f"rejected {len(c.get('rejected', []))}" + (f" ({c['note']})" if c.get("note") else "")
        for c in calls
    ] or ["Not called."]
    lines += ["", "## Running and next", ""]
    for r in runs:
        if not r.finished:
            current = r.current()
            lines.append(f"- running: {r.id} ({current.step.name if current else '?'})")
    by_run = records.by_id()
    for item in read_queue(layout.queue)[:10]:
        if item.spec is not None:
            why = waiting_for(item.spec, by_run, layout.artifacts)
            lines.append(
                f"- queued: {item.spec.id} ({item.spec.method}, priority {item.spec.priority})"
                + (f": {why}" if why else "")
            )
    layout.reports.mkdir(parents=True, exist_ok=True)
    path = layout.reports / f"{day.isoformat()}.md"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def _notable(ended: list[RunRecord], layout: Layout, span: tuple[datetime, datetime]) -> list[str]:
    out: list[str] = []
    for r in ended:
        if r.candidate:
            out.append(f"- **{r.id} beat its parent**; confirmation `{r.confirmation}` queued.")
        if r.confirms is not None:
            verdict = "confirmed" if r.comparison and r.comparison.beats else "not confirmed"
            out.append(f"- {r.confirms}: {verdict} on fresh deals by {r.id}.")
    for notes in sorted(layout.experiments.glob("*/notes.md")):
        modified = datetime.fromtimestamp(notes.stat().st_mtime).astimezone()
        if span[0] <= modified < span[1]:
            out.append(
                f"- Notes: [{notes.parent.name}](../experiments/{notes.parent.name}/notes.md)"
            )
    return out


def _e(row: Row | None, field: str) -> str:
    value = getattr(row, field) if row else None
    return "-" if value is None else f"{value.mean:+.2f} ± {value.ci95:.2f}"


def _confirmed(r: RunRecord) -> str:
    return {None: "-", True: "yes", False: "no"}[r.confirmed]
