"""A run's record (``run.json``), rewritten as the run moves, so a
restarted runner picks every run up where it was.

The folder also holds ``spec.toml`` (the spec as queued), ``config.toml``
(the effective training config, for training kinds), ``results/<step>/``
(what each step wrote: eval results, the learning curve), ``summary.md``
(written when the run ends) and, from the researcher, ``notes.md``.
Step logs stay outside git; ``run.json`` points at them.
"""

import dataclasses
import json
import os
import platform
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from cardgame_ml.loop.safety import UnsafePathError, inside, name
from cardgame_ml.loop.steps import Step

SCHEMA = "loop-run/1"
FINISHED = frozenset({"succeeded", "failed", "timeout", "interrupted", "cancelled"})


def now_utc() -> datetime:
    return datetime.now(UTC)


def stamp(when: datetime) -> str:
    return when.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_stamp(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)


@dataclass
class StepRecord:
    step: Step
    status: str = "pending"
    """``pending``, ``running``, ``done``, ``failed`` or ``killed``."""
    attempts: int = 0
    started: str | None = None
    ended: str | None = None
    exit_code: int | None = None
    pid: int | None = None
    """The process group's leader, on the step's host."""
    log: str | None = None
    workdir: str | None = None
    """Remote steps: the folder on the host holding the output, log, pid
    and exit files."""
    stopping: str | None = None
    """When SIGTERM was sent, if it was."""

    def hours(self, until: datetime | None = None) -> float:
        if self.started is None:
            return 0.0
        end = parse_stamp(self.ended) if self.ended else (until or now_utc())
        return max((end - parse_stamp(self.started)).total_seconds(), 0.0) / 3600

    def to_json(self) -> dict[str, Any]:
        out = dataclasses.asdict(self)
        out["step"]["argv"] = list(self.step.argv)
        return out

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "StepRecord":
        fields = dict(data)
        step = dict(fields.pop("step"))
        step["argv"] = tuple(step["argv"])
        return cls(Step(**step), **fields)


@dataclass
class RunRecord:
    id: str
    folder: str
    method: str
    tags: list[str]
    parent: str | None
    confirms: str | None
    priority: int
    commit: str
    dirty: bool
    created: str
    deadline: str
    wall_hours: float
    gpu: bool
    steps: list[StepRecord]
    status: str = "running"
    ended: str | None = None
    bot: str | None = None
    """The bot the run measures (with ``{artifacts}`` for the store)."""
    model: str | None = None
    """The model the run trained, relative to the artifact store."""
    params: dict[str, object] = field(default_factory=dict[str, object])
    """The spec's config overrides and options: what this run varies."""
    environment: dict[str, str] = field(default_factory=dict[str, str])
    comparison: dict[str, object] | None = None
    candidate: bool = False
    """Beat its parent beyond the interval: a confirmation is queued."""
    confirmed: bool | None = None
    """The confirmation's verdict, once it ran."""
    confirmation: str | None = None
    failure: str | None = None
    schema: str = SCHEMA

    @property
    def finished(self) -> bool:
        return self.status in FINISHED

    def current(self) -> StepRecord | None:
        """The step under way or next, if any is left."""
        for record in self.steps:
            if record.status in ("pending", "running"):
                return record
        return None

    def step(self, name: str) -> StepRecord:
        for record in self.steps:
            if record.step.name == name:
                return record
        raise KeyError(name)

    def to_json(self) -> dict[str, Any]:
        out = dataclasses.asdict(self)
        out["steps"] = [s.to_json() for s in self.steps]
        return out

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> "RunRecord":
        if data.get("schema") != SCHEMA:
            raise ValueError(f"not a {SCHEMA} record")
        fields = dict(data)
        name(fields.get("folder"), "run folder")
        fields["steps"] = [StepRecord.from_json(s) for s in fields["steps"]]
        return cls(**fields)


def environment() -> dict[str, str]:
    """What the runner itself runs on, for the record."""
    return {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "machine": platform.machine(),
        "cpus": str(os.cpu_count() or 0),
    }


class Records:
    """Every loop run's record. A finished run's is ``run.json`` in its
    folder under ``research/experiments`` (committed); an active run's
    lives in the runner's state (``<store>/loop/runs/<folder>.json``), so
    the checkout stays clean while steps that refuse uncommitted changes
    start."""

    def __init__(self, experiments: Path, live: Path) -> None:
        self.root, self.live = experiments, live

    def folder(self, record: RunRecord) -> Path:
        return inside(self.root, name(record.folder, "run folder"))

    def new_folder(self, run_id: str, when: datetime) -> str:
        day = when.astimezone().strftime("%Y-%m-%d")
        folder = name(f"{day}-{run_id}", "run folder")
        k = 2
        while (self.root / folder).exists() or (self.live / f"{folder}.json").exists():
            folder = name(f"{day}-{run_id}-{k}", "run folder")
            k += 1
        return folder

    def save(self, record: RunRecord) -> None:
        text = json.dumps(record.to_json(), indent=1, ensure_ascii=False) + "\n"
        live = inside(self.live, f"{name(record.folder, 'run folder')}.json")
        if record.finished:
            self.folder(record).mkdir(parents=True, exist_ok=True)
            _write(self.folder(record) / "run.json", text)
            live.unlink(missing_ok=True)
        else:
            self.live.mkdir(parents=True, exist_ok=True)
            _write(live, text)

    def all(self) -> list[RunRecord]:
        found: dict[str, RunRecord] = {}
        for path in [*sorted(self.root.glob("*/run.json")), *sorted(self.live.glob("*.json"))]:
            data: Any = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and cast(dict[str, Any], data).get("schema") == SCHEMA:
                try:
                    record = RunRecord.from_json(cast(dict[str, Any], data))
                except UnsafePathError:
                    continue  # a crafted record: never acted on
                found[record.folder] = record
        return sorted(found.values(), key=lambda r: (r.created, r.folder))

    def by_id(self) -> dict[str, RunRecord]:
        """The latest record of each run id."""
        return {record.id: record for record in self.all()}

    def active(self) -> list[RunRecord]:
        return [r for r in self.all() if not r.finished]


def _write(path: Path, text: str) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)
