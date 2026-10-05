"""A run's record (``run.json``), rewritten as the run moves, so a
restarted runner picks every run up where it was.

The folder also holds ``spec.toml`` (the spec as queued), ``config.toml``
(the effective training config, for training kinds), ``results/<step>/``
(what each step wrote: eval results, the learning curve), ``summary.md``
(written when the run ends) and, from the researcher, ``notes.md``.
Step logs stay outside git; ``run.json`` points at them.

A record that does not read (not JSON, an unknown key, a crafted folder
or step name) is never acted on: ``Records`` moves it aside to its
quarantine with the reason beside it, says so, and carries on with the
others.
"""

import json
import os
import platform
import shutil
import sys
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Literal

from cardgame_ml import schema
from cardgame_ml.loop.evals import Comparison
from cardgame_ml.loop.safety import inside, name
from cardgame_ml.loop.steps import Role, Step
from cardgame_ml.runtime import write_text

SCHEMA = "loop-run/1"


class RunStatus(StrEnum):
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    TIMEOUT = "timeout"
    INTERRUPTED = "interrupted"
    """Its step was lost (the machine restarted) too many times."""
    CANCELLED = "cancelled"


FINISHED = frozenset(RunStatus) - {RunStatus.RUNNING}


class StepStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    KILLED = "killed"


def now_utc() -> datetime:
    return datetime.now(UTC)


def stamp(when: datetime) -> str:
    return when.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_stamp(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)


@dataclass
class StepRecord:
    step: Step
    status: StepStatus = StepStatus.PENDING
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

    def to_json(self) -> dict[str, object]:
        return schema.table(self)


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
    status: RunStatus = RunStatus.RUNNING
    ended: str | None = None
    bot: str | None = None
    """The bot the run measures (with ``{artifacts}`` for the store)."""
    model: str | None = None
    """The model the run trained, relative to the artifact store."""
    params: dict[str, object] = field(default_factory=dict[str, object])
    """The spec's config overrides and options: what this run varies."""
    environment: dict[str, str] = field(default_factory=dict[str, str])
    comparison: Comparison | None = None
    candidate: bool = False
    """Beat its parent beyond the interval: a confirmation is queued."""
    confirmed: bool | None = None
    """The confirmation's verdict, once it ran."""
    confirmation: str | None = None
    failure: str | None = None
    schema: Literal["loop-run/1"] = "loop-run/1"

    def __post_init__(self) -> None:
        name(self.folder, "run folder")

    @property
    def finished(self) -> bool:
        return self.status in FINISHED

    def current(self) -> StepRecord | None:
        """The step under way or next, if any is left."""
        for record in self.steps:
            if record.status in (StepStatus.PENDING, StepStatus.RUNNING):
                return record
        return None

    def step(self, name: str) -> StepRecord:
        for record in self.steps:
            if record.step.name == name:
                return record
        raise KeyError(name)

    def eval_step(self, baseline: str) -> StepRecord | None:
        """The suite run against ``baseline`` (as the spec names it)."""
        for record in self.steps:
            if record.step.role == Role.EVAL and record.step.baseline == baseline:
                return record
        return None

    def role(self, role: Role) -> StepRecord | None:
        """The first step with ``role``."""
        return next((r for r in self.steps if r.step.role == role), None)

    def to_json(self) -> dict[str, object]:
        return schema.table(self)

    @classmethod
    def from_json(cls, data: object, where: str = "run.json") -> "RunRecord":
        return schema.read(cls, data, where)


def environment() -> dict[str, str]:
    """What the runner itself runs on, for the record."""
    return {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "machine": platform.machine(),
        "cpus": str(os.cpu_count() or 0),
    }


def _stderr(line: str) -> None:
    print(line, file=sys.stderr)


class Records:
    """Every loop run's record. A finished run's is ``run.json`` in its
    folder under ``research/experiments`` (committed); an active run's
    lives in the runner's state (``<store>/loop/runs/<folder>.json``), so
    the checkout stays clean while steps that refuse uncommitted changes
    start.

    The records are read once and kept (``save`` keeps them current);
    ``refresh`` reads them again (the runner does, every tick). A record
    that does not read is moved to ``quarantine`` (by default
    ``<store>/loop/quarantine``) with a ``.reason.txt``, and ``say`` is
    told."""

    def __init__(
        self,
        experiments: Path,
        live: Path,
        *,
        quarantine: Path | None = None,
        say: Callable[[str], None] = _stderr,
    ) -> None:
        self.root, self.live = experiments, live
        self.quarantine = quarantine or live.parent / "quarantine"
        self.say = say
        self._loaded: dict[str, RunRecord] | None = None

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
            write_text(self.folder(record) / "run.json", text)
            live.unlink(missing_ok=True)
        else:
            self.live.mkdir(parents=True, exist_ok=True)
            write_text(live, text)
        if self._loaded is not None:
            self._loaded[record.folder] = record

    def refresh(self) -> None:
        """Reads the records again at the next look."""
        self._loaded = None

    def all(self) -> list[RunRecord]:
        if self._loaded is None:
            self._loaded = self._load()
        return sorted(self._loaded.values(), key=lambda r: (r.created, r.folder))

    def _load(self) -> dict[str, RunRecord]:
        found: dict[str, RunRecord] = {}
        for path in [*sorted(self.root.glob("*/run.json")), *sorted(self.live.glob("*.json"))]:
            try:
                record = RunRecord.from_json(
                    json.loads(path.read_text(encoding="utf-8")), str(path)
                )
            except (ValueError, UnicodeDecodeError) as e:
                # A JSON error, a schema error or an unsafe name: never acted on.
                self._set_aside(path, f"{type(e).__name__}: {e}")
                continue
            found[record.folder] = record
        return found

    def _set_aside(self, path: Path, reason: str) -> None:
        base = self.root if path.is_relative_to(self.root) else self.live
        when = stamp(now_utc()).replace(":", "")
        target = self.quarantine / when / base.name / path.relative_to(base)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(path, target)
        target.with_name(f"{target.name}.reason.txt").write_text(reason + "\n", encoding="utf-8")
        self.say(f"quarantined {path} (moved to {target}): {reason}")

    def by_id(self) -> dict[str, RunRecord]:
        """The latest record of each run id."""
        return {record.id: record for record in self.all()}

    def active(self) -> list[RunRecord]:
        return [r for r in self.all() if not r.finished]
