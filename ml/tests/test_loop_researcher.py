"""The researcher: its command's tool limits, when it is called, and the
runner's checks of what it wrote (no real call: a fake process)."""

import dataclasses
import json
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from loopkit import DMC, EVAL, Clock, make_layout, spec, write

from cardgame_ml.loop import tomlw
from cardgame_ml.loop.layout import Layout
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.researcher import Researcher, allowed_path, command


class FakeCheckout:
    def __init__(self) -> None:
        self.paths: list[str] = []
        self.restored: list[str] = []

    def changed(self) -> list[str]:
        return list(self.paths)

    def restore(self, paths: list[str]) -> None:
        self.restored += paths

    def tracked(self, path: str) -> bool:
        return not path.endswith("new.py")


class Fake:
    """A researcher process the test runs by hand: ``act`` is what it does."""

    def __init__(self) -> None:
        self.argv: list[str] = []
        self.alive = True

    def spawn(self, argv: list[str], cwd: Path, transcript: Path) -> int:
        self.argv = argv
        transcript.parent.mkdir(parents=True, exist_ok=True)
        transcript.write_text(
            json.dumps({"total_cost_usd": 1.5, "num_turns": 9, "result": "queued two runs"}),
            encoding="utf-8",
        )
        return 4242


@pytest.fixture
def layout(tmp_path: Path) -> Layout:
    layout = make_layout(tmp_path)
    (layout.loop / "researcher.md").write_text("# Instructions\n", encoding="utf-8")
    return layout


@pytest.fixture
def policy(layout: Layout) -> Policy:
    return Policy.load(layout.policy)


def make(layout: Layout, policy: Policy) -> tuple[Researcher, Fake, FakeCheckout]:
    fake, git = Fake(), FakeCheckout()
    researcher = Researcher(layout, policy, git, spawn=fake.spawn, alive=lambda _: fake.alive)
    return researcher, fake, git


def test_the_command_limits_its_tools(policy: Policy) -> None:
    argv = command(policy, "prompt")
    allowed = argv[argv.index("--allowedTools") + 1 : argv.index("--disallowedTools")]
    assert "Write(research/loop/**)" in allowed
    assert [a for a in allowed if a.startswith("Bash")] == [
        "Bash(uv run --project ml python -m cardgame_ml.loop validate:*)"
    ]
    assert not any(a in ("Bash", "Write", "Edit", "WebFetch") for a in allowed)
    assert "Read(research/evals/**)" in argv
    assert argv[argv.index("--permission-mode") + 1] == "dontAsk"
    assert argv[argv.index("--model") + 1] == policy.researcher.model
    assert argv[argv.index("--tools") + 1] == "Read,Glob,Grep,Write,Edit,Bash"


@pytest.mark.parametrize(
    ("path", "ok"),
    [
        ("research/loop/queue/x.toml", True),
        ("research/loop/agenda.md", True),
        ("research/loop/requests.md", True),
        ("research/loop/configs/dmc-big.toml", True),
        ("research/experiments/2026-10-06-x/notes.md", True),
        ("research/experiments/2026-10-06-x/summary.md", False),
        ("research/loop/policy.toml", False),
        ("research/loop/researcher.md", False),
        ("research/loop/leaderboard.md", False),
        ("research/evals/v1/suite.json", False),
        ("ml/src/cardgame_ml/new.py", False),
    ],
)
def test_where_it_may_write(path: str, ok: bool) -> None:
    assert allowed_path(path) is ok


def test_when_it_is_called(layout: Layout, policy: Policy) -> None:
    researcher, fake, _ = make(layout, policy)
    clock = Clock()
    assert researcher.not_due(clock()) is None  # an empty queue
    for k in range(policy.researcher.low_water):
        write(layout, spec(EVAL, id=f"queued-{k}"))
    assert "runnable specs queued" in (researcher.not_due(clock()) or "")
    for path in layout.queue.glob("*.toml"):
        path.unlink()
    researcher(None, clock())
    assert fake.argv
    assert "--model" in fake.argv
    assert researcher.not_due(clock()) == "a call is under way"
    fake.alive = False
    clock.advance(minutes=5)
    assert researcher(None, clock()) is True  # settled and logged
    entry = json.loads(layout.researcher_log.read_text(encoding="utf-8"))
    assert entry["outcome"] == "ok"
    assert entry["total_cost_usd"] == 1.5
    assert "last call" in (researcher.not_due(clock()) or "")
    clock.advance(hours=policy.researcher.min_interval_hours + 0.1)
    assert researcher.not_due(clock()) is None
    layout.researcher_off.write_text("off", encoding="utf-8")
    assert "switched off" in (researcher.not_due(clock()) or "")


def test_calls_per_day(layout: Layout, policy: Policy) -> None:
    researcher, _, _ = make(layout, policy)
    clock = Clock()
    layout.researcher_log.parent.mkdir(parents=True, exist_ok=True)
    with layout.researcher_log.open("w", encoding="utf-8") as log:
        for k in range(policy.researcher.max_calls_per_day):
            started = clock() - timedelta(hours=3 * (k + 1))
            log.write(json.dumps({"started": started.strftime("%Y-%m-%dT%H:%M:%SZ")}) + "\n")
    assert "calls in the last day" in (researcher.not_due(clock()) or "")


def call(layout: Layout, policy: Policy, act: Any) -> tuple[dict[str, Any], FakeCheckout]:
    """One call whose process does ``act(git)``, then the checks."""
    researcher, fake, git = make(layout, policy)
    clock = Clock()
    researcher.start(clock())
    act(git)
    fake.alive = False
    clock.advance(minutes=10)
    researcher(None, clock())
    return json.loads(layout.researcher_log.read_text(encoding="utf-8").splitlines()[-1]), git


def test_its_specs_are_validated(layout: Layout, policy: Policy) -> None:
    def act(git: FakeCheckout) -> None:
        write(layout, spec(EVAL, id="good-one"))
        write(layout, spec(DMC, id="too-long", budget={"wall_hours": 99.0}))
        write(
            layout,
            spec(
                DMC,
                id="peeks",
                config={
                    "base": "research/loop/configs/dmc-v1.toml",
                    "set": {"rules": "file:research/evals/v1/heldout-rules.json"},
                },
            ),
        )
        (layout.queue / "junk.toml").write_text("not toml [", encoding="utf-8")
        git.paths = [f"research/loop/queue/{p.name}" for p in layout.queue.glob("*.toml")]

    entry, git = call(layout, policy, act)
    assert entry["accepted"] == ["good-one"]
    rejected = {r["file"] for r in entry["rejected"]}
    assert rejected == {"too-long.toml", "peeks.toml", "junk.toml"}
    assert sorted(p.name for p in layout.queue.glob("*.toml")) == ["good-one.toml"]
    reason = (layout.rejected / "peeks.reason.txt").read_text(encoding="utf-8")
    assert "names the evals" in reason
    assert entry["outcome"] == "ok"
    assert git.restored == []


def test_new_methods_are_requests_not_specs(layout: Layout, policy: Policy) -> None:
    def act(_: FakeCheckout) -> None:
        write(layout, spec(DMC, id="ppo-try", method="ppo"))

    entry, _ = call(layout, policy, act)
    assert entry["accepted"] == []
    assert "unknown 'ppo'" in entry["rejected"][0]["reasons"][0]


def test_limits_per_call_and_gpu_hours(layout: Layout, policy: Policy) -> None:
    def act(_: FakeCheckout) -> None:
        for k in range(policy.limits.max_specs_per_call + 2):
            write(layout, spec(EVAL, id=f"many-{k:02d}"))

    entry, _ = call(layout, policy, act)
    assert len(entry["accepted"]) == policy.limits.max_specs_per_call
    assert len(entry["rejected"]) == 2

    def gpu(_: FakeCheckout) -> None:
        for k in range(20):
            write(layout, spec(DMC, id=f"gpu-{k:02d}"))

    roomy = dataclasses.replace(
        policy, limits=dataclasses.replace(policy.limits, max_specs_per_call=50)
    )
    entry, _ = call(layout, roomy, gpu)
    hours = DMC["budget"]["train_hours"]
    assert len(entry["accepted"]) == int(policy.limits.max_gpu_hours_queued // hours)
    assert any("GPU hours" in r["reasons"][0] for r in entry["rejected"])


def test_writing_elsewhere_switches_it_off(layout: Layout, policy: Policy) -> None:
    def act(git: FakeCheckout) -> None:
        git.paths = [
            "research/loop/agenda.md",
            "research/loop/policy.toml",
            "ml/src/cardgame_ml/new.py",
        ]

    entry, git = call(layout, policy, act)
    assert entry["outcome"] == "violation"
    assert git.restored == ["research/loop/policy.toml"]
    assert "policy.toml" in layout.researcher_off.read_text(encoding="utf-8")


def test_confirmations_are_put_back(layout: Layout, policy: Policy) -> None:
    confirmation = spec(EVAL, id="x-confirm", confirms="x", tags=["search", "confirmation"])
    path = layout.queue / "x-confirm.toml"
    path.write_text(tomlw.dumps(confirmation), encoding="utf-8")
    original = path.read_text(encoding="utf-8")

    def act(_: FakeCheckout) -> None:
        path.unlink()

    call(layout, policy, act)
    assert path.read_text(encoding="utf-8") == original


def test_a_call_past_its_time_is_stopped(layout: Layout, policy: Policy) -> None:
    researcher, fake, _ = make(layout, policy)
    clock = Clock()
    researcher.start(clock())
    clock.advance(minutes=policy.researcher.timeout_minutes + 1)
    assert fake.alive
    researcher(None, clock())
    entry = json.loads(layout.researcher_log.read_text(encoding="utf-8"))
    assert entry["outcome"] == "timeout"
