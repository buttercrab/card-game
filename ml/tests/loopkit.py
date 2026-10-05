"""Shared pieces for the experiment loop's tests: a scratch repository
with the real policy, specs as mappings, eval results, a fake host that
runs nothing, and a clock the test moves."""

import copy
import json
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from cardgame_ml.loop import tomlw
from cardgame_ml.loop.executors import LOST, RUNNING, Poll
from cardgame_ml.loop.layout import Layout
from cardgame_ml.loop.policy import Host
from cardgame_ml.loop.records import RunRecord, StepRecord

REPO = Path(__file__).resolve().parents[2]


def make_layout(tmp: Path) -> Layout:
    """A scratch checkout holding the loop's policy and base configs."""
    repo = tmp / "repo"
    for path in ("research/loop/policy.toml", "research/loop/configs/dmc-v1.toml"):
        (repo / path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / path, repo / path)
    for folder in ("research/loop/queue", "research/experiments"):
        (repo / folder).mkdir(parents=True, exist_ok=True)
    return Layout(repo, tmp / "store" / "loop")


DMC: dict[str, Any] = {
    "id": "dmc-test",
    "hypothesis": "A smaller learning rate ends higher on the ladder at the same budget.",
    "method": "dmc",
    "tags": ["hparam"],
    "priority": 10,
    "seeds": [7],
    "budget": {"wall_hours": 10.0, "train_hours": 5.0, "hands": 1000000, "gpu": True},
    "resources": {"host": "mac", "threads": 12, "eval_host": "home", "eval_threads": 6},
    "evals": {
        "curve": True,
        "suite": "v1",
        "parts": ["ladder", "presets", "heldout"],
        "baselines": ["hard"],
        "cost": False,
    },
    "config": {"base": "research/loop/configs/dmc-v1.toml", "set": {"optim.lr": 0.0001}},
}

EVAL: dict[str, Any] = {
    "id": "eval-test",
    "hypothesis": "More samples do not make the search stronger on presets.",
    "method": "search-tuning",
    "tags": ["search"],
    "parent": "bot:hard",
    "seeds": [1],
    "budget": {"wall_hours": 4.0, "gpu": False},
    "resources": {"host": "home", "threads": 4, "eval_host": "home", "eval_threads": 4},
    "evals": {
        "curve": False,
        "suite": "v1",
        "parts": ["presets"],
        "baselines": ["parent"],
        "cost": False,
    },
    "options": {"bot": "search:400:1:0"},
}


def spec(base: dict[str, Any], **changes: Any) -> dict[str, Any]:
    """``base`` with top-level keys replaced (tables merged one level)."""
    out = copy.deepcopy(base)
    for key, value in changes.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = {**out[key], **value}
        else:
            out[key] = value
    return out


def write(layout: Layout, data: dict[str, Any], name: str | None = None) -> Path:
    path = layout.queue / f"{name or data['id']}.toml"
    path.write_text(tomlw.dumps(data), encoding="utf-8")
    return path


def propose(layout: Layout, data: dict[str, Any], name: str | None = None) -> Path:
    """A spec the researcher writes: into its inbox, never the queue."""
    layout.inbox.mkdir(parents=True, exist_ok=True)
    path = layout.inbox / f"{name or data['id']}.toml"
    path.write_text(tomlw.dumps(data), encoding="utf-8")
    return path


def estimate(mean: float, ci95: float = 0.3, n: int = 1000) -> dict[str, Any]:
    return {"mean": mean, "ci95": ci95, "n": n}


def results(
    bot: str, baseline: str | None, rating: float, diff: float | None = None, ci95: float = 0.3
) -> dict[str, Any]:
    """An ``eval-results/1`` record with a ladder and presets."""

    def summary() -> dict[str, Any]:
        return {
            "bot": estimate(rating, ci95),
            "baseline": None if diff is None else estimate(rating - diff, ci95),
            "diff": None if diff is None else estimate(diff, ci95),
        }

    return {
        "schema": "eval-results/1",
        "suite": {"name": "v1", "game": "mighty", "sha256": "x", "quick": False},
        "bot": bot,
        "baseline": baseline,
        "reproducible": True,
        "run": {
            "commit": "c",
            "dirty": False,
            "started": "t",
            "wall_seconds": 10.0,
            "threads": 4,
            "command": [],
        },
        "machine": {},
        "ladder": {"rungs": [], "rating": summary(), "seconds": 1.0},
        "presets": {"tables": [], "average": summary(), "seconds": 1.0},
        "heldout": None,
        "matches": None,
        "cost": None,
        "puzzles": {"passed": 6, "scored": 6, "baseline_passed": None, "puzzles": []},
    }


def write_results(layout: Layout, run: RunRecord, step: str, data: dict[str, Any]) -> None:
    out = layout.experiments / run.folder / "results" / step
    out.mkdir(parents=True, exist_ok=True)
    (out / "results.json").write_text(json.dumps(data), encoding="utf-8")


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 10, 6, 1, 0, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **delta: float) -> None:
        self.now += timedelta(**delta)


class FakeHost:
    """A host that runs nothing: steps stay running until the test says
    how they ended."""

    def __init__(self, host: Host) -> None:
        self.host = host
        self.loads: float | None = 0.0
        self.polls: dict[int, Poll] = {}
        self.started: list[str] = []
        self.stopped: list[tuple[str, bool]] = []
        self._pid = 1000

    def load(self) -> float | None:
        return self.loads

    def start(self, run: RunRecord, record: StepRecord, log: Path) -> None:
        self._pid += 1
        record.pid, record.log = self._pid, str(log)
        self.polls[self._pid] = RUNNING
        self.started.append(f"{run.id}:{record.step.name}")

    def poll(self, record: StepRecord) -> Poll:
        return self.polls.get(record.pid or 0, LOST)

    def stop(self, record: StepRecord, force: bool) -> None:
        self.stopped.append((record.step.name, force))

    def collect(self, run: RunRecord, record: StepRecord, log: Path) -> None:
        pass

    def end(self, record: StepRecord, code: Poll) -> None:
        assert record.pid is not None
        self.polls[record.pid] = code
