"""``python -m cardgame_ml.loop status``: what the loop is doing now.

The runner, running steps and their budgets, the queue and why each spec
waits, who has the GPU, threads in use against each host's cap and its
load, the researcher's last call and the next daily report.
"""

import json
import os
from collections.abc import Callable
from datetime import datetime, timedelta

from cardgame_ml.loop.daily import due
from cardgame_ml.loop.layout import Layout
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.queue import read_queue, waiting_for
from cardgame_ml.loop.records import Records, StepStatus, parse_stamp
from cardgame_ml.loop.scheduler import Usage, holder


def status(  # noqa: PLR0913
    layout: Layout,
    policy: Policy,
    now: datetime,
    *,
    loads: dict[str, float | None],
    other_training: list[str],
    researcher_not_due: Callable[[datetime], str | None] | None = None,
    records: Records | None = None,
) -> str:
    records = records or Records(layout.experiments, layout.live)
    active = records.active()
    runs = records.by_id()
    lines = [f"runner: {holder(layout.lock) or 'not running'}"]
    if layout.pause.exists():
        lines.append("paused: no new steps start (remove the pause file to resume)")
    lines.append(f"active runs: {len(active)}")
    for run in active:
        current = run.current()
        left = parse_stamp(run.deadline) - now
        step = (
            f"{current.step.name} on {current.step.host} ({current.status}, "
            f"attempt {current.attempts})"
            if current
            else "finishing"
        )
        lines.append(f"  {run.id}: {step}; {_hours(left)} of budget left")
    queue = read_queue(layout.queue)
    lines.append(f"queue: {len(queue)} specs")
    for item in queue:
        if item.spec is None:
            lines.append(f"  {item.path.name}: unreadable ({item.error})")
            continue
        why = waiting_for(item.spec, runs, layout.artifacts) or "ready"
        lines.append(
            f"  {item.spec.id} [{item.spec.method}, priority {item.spec.priority}, "
            f"{item.spec.budget.wall_hours} h{', GPU' if item.spec.budget.gpu else ''}]: {why}"
        )
    usage = Usage.of(active)
    gpu_runs = [
        f"{r.id}:{s.step.name}"
        for r in active
        for s in r.steps
        if s.status == StepStatus.RUNNING and s.step.gpu
    ]
    lines.append(f"GPU: {', '.join(gpu_runs) or 'free'}")
    for other in other_training:
        lines.append(f"  not ours, holding it: {other}")
    for name, host in policy.hosts.items():
        load = loads.get(name)
        load_text = "unreachable" if load is None else f"load {load:.1f}"
        held = f"{usage.threads.get(name, 0)}/{host.threads}"
        cap = f" (no new steps above {host.max_load:g})" if host.max_load < 1e9 else ""  # noqa: PLR2004
        lines.append(f"{name}: {held} threads in loop steps; {load_text}{cap}")
    calls = _calls(layout)
    if calls:
        last = calls[-1]
        lines.append(f"researcher: last call {last['started']} ({last.get('outcome', '?')})")
    else:
        lines.append("researcher: never called")
    if researcher_not_due is not None:
        lines.append(f"  next: {researcher_not_due(now) or 'due now'}")
    day = due(layout, policy, now)
    if day is not None:
        lines.append(f"daily report: {day} is due")
    else:
        local = now.astimezone()
        next_at = local.replace(hour=policy.report_hour, minute=0, second=0, microsecond=0)
        if next_at <= local:
            next_at += timedelta(days=1)
        lines.append(
            f"daily report: next at {next_at.strftime('%Y-%m-%d %H:%M')} "
            f"(for {(next_at.date() - timedelta(days=1)).isoformat()})"
        )
    lines.append(f"mac load: {' '.join(f'{x:.1f}' for x in os.getloadavg())}")
    return "\n".join(lines)


def _calls(layout: Layout) -> list[dict[str, str]]:
    if not layout.researcher_log.is_file():
        return []
    text = layout.researcher_log.read_text(encoding="utf-8")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def _hours(delta: timedelta) -> str:
    return f"{delta.total_seconds() / 3600:.1f} h"
