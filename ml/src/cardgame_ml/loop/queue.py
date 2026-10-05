"""The queue: spec files in ``research/loop/queue/``, highest priority
first (ties by file name). A spec waits until the runs it follows have
finished well and the artifacts it needs exist; one that can never run
(its parent failed) is reported, not dropped.
"""

import shutil
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from cardgame_ml.loop.records import RunRecord, RunStatus
from cardgame_ml.loop.spec import Spec, SpecError, load_spec


@dataclass(frozen=True)
class Queued:
    path: Path
    spec: Spec | None
    error: str | None = None


def read_queue(queue: Path) -> list[Queued]:
    """Every spec file, parsed, in the order they run."""
    items: list[Queued] = []
    for path in sorted(queue.glob("*.toml")):
        try:
            items.append(Queued(path, load_spec(path)))
        except SpecError as e:
            items.append(Queued(path, None, str(e)))
    return sorted(items, key=lambda q: (-(q.spec.priority if q.spec else 0), q.path.name))


def waiting_for(spec: Spec, runs: Mapping[str, RunRecord], artifacts: Path) -> str | None:
    """Why ``spec`` cannot start yet (``None``: it can)."""
    parent = spec.parent_run()
    for dep in (*spec.after, *([parent] if parent else [])):
        record = runs.get(dep)
        if record is None:
            return f"waiting for {dep} to run"
        if not record.finished:
            return f"waiting for {dep} to finish"
        if record.status != RunStatus.SUCCEEDED:
            return f"blocked: {dep} {record.status}"
    for path in spec.requires:
        if not (artifacts / path).exists():
            return f"waiting for {path}"
    return None


def blocked(reason: str | None) -> bool:
    return reason is not None and reason.startswith("blocked")


def reject(path: Path, rejected: Path, reasons: list[str]) -> Path:
    """Moves a spec file out of the queue with why, beside it."""
    rejected.mkdir(parents=True, exist_ok=True)
    target = rejected / path.name
    shutil.move(path, target)
    target.with_suffix(".reason.txt").write_text("\n".join(reasons) + "\n", encoding="utf-8")
    return target
