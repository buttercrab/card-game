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
from cardgame_ml.loop.safety import researcher_environment


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


def _between(argv: list[str], start: str, end: str | None) -> list[str]:
    return argv[argv.index(start) + 1 : argv.index(end) if end else len(argv)]


def test_the_command_limits_its_tools(policy: Policy, layout: Layout) -> None:
    argv = command(policy, "prompt", layout.repo)
    repo = layout.repo.resolve().as_posix()
    allowed = _between(argv, "--allowedTools", "--disallowedTools")
    denied = _between(argv, "--disallowedTools", None)
    # No shell at all: not among its tools, and denied besides.
    assert argv[argv.index("--tools") + 1] == "Read,Glob,Grep,Write,Edit"
    assert not any(a.startswith("Bash") for a in allowed)
    assert {"Bash", "WebFetch", "WebSearch", "Task"} <= set(denied)
    # The exact allow-list: reads of research/ and docs/, writes of its own files.
    assert sorted(allowed) == sorted(
        [
            f"Read(/{repo}/research/**)",
            f"Read(/{repo}/docs/**)",
            f"Write(/{repo}/research/loop/queue/*.toml)",
            f"Edit(/{repo}/research/loop/queue/*.toml)",
            f"Write(/{repo}/research/loop/configs/*.toml)",
            f"Write(/{repo}/research/loop/agenda.md)",
            f"Edit(/{repo}/research/loop/agenda.md)",
            f"Write(/{repo}/research/loop/requests.md)",
            f"Edit(/{repo}/research/loop/requests.md)",
            f"Write(/{repo}/research/loop/withdraw.txt)",
            f"Edit(/{repo}/research/loop/withdraw.txt)",
            f"Write(/{repo}/research/experiments/*/notes.md)",
            f"Edit(/{repo}/research/experiments/*/notes.md)",
        ]
    )
    assert all(a.startswith(f"{a.split('(')[0]}(//") for a in allowed)  # absolute paths only
    for tool in ("Read", "Write", "Edit"):
        assert f"{tool}(/{repo}/research/evals/**)" in denied
    for secret in ("Read(~/.ssh/**)", "Read(//**/site.env)", "Read(//**/.env)"):
        assert secret in denied
    assert argv[argv.index("--permission-mode") + 1] == "dontAsk"
    assert argv[argv.index("--setting-sources") + 1] == "project"
    assert argv[argv.index("--model") + 1] == policy.researcher.model
    assert float(argv[argv.index("--max-budget-usd") + 1]) == policy.researcher.max_budget_usd
    assert argv[argv.index("--add-dir") + 1] == f"{repo}/docs"


def test_every_write_rule_is_a_place_it_may_write(policy: Policy, layout: Layout) -> None:
    """The tool rules and the runner's own check say the same."""
    repo = layout.repo.resolve().as_posix()
    argv = command(policy, "prompt", layout.repo)
    for allow in _between(argv, "--allowedTools", "--disallowedTools"):
        tool, pattern = allow[:-1].split("(", 1)
        if tool == "Read":
            continue
        example = pattern.removeprefix(f"/{repo}/").replace("*.toml", "x.toml").replace("*", "x")
        assert allowed_path(example), allow


def test_it_starts_in_research_with_a_clean_environment(layout: Layout, policy: Policy) -> None:
    seen: dict[str, Path] = {}

    def spawn(argv: list[str], cwd: Path, transcript: Path) -> int:
        seen["cwd"] = cwd
        return 1

    Researcher(layout, policy, FakeCheckout(), spawn=spawn).start(Clock()())
    assert seen["cwd"] == layout.repo.resolve() / "research"
    env = researcher_environment(
        {"HOME": "/h", "PATH": "/bin", "BOT_TOKEN": "x", "STATS_TOKEN": "y", "AWS_SECRET": "z"}
    )
    assert env == {"HOME": "/h", "PATH": "/bin"}


@pytest.mark.parametrize(
    ("path", "ok"),
    [
        ("research/loop/queue/x.toml", True),
        ("research/loop/agenda.md", True),
        ("research/loop/requests.md", True),
        ("research/loop/withdraw.txt", True),
        ("research/loop/configs/dmc-big.toml", True),
        ("research/experiments/2026-10-06-x/notes.md", True),
        ("research/experiments/2026-10-06-x/summary.md", False),
        ("research/experiments/../notes.md", False),
        ("research/loop/queue/x.txt", False),
        ("research/loop/queue/sub/x.toml", False),
        ("research/loop/queue/-x.toml", False),
        ("research/loop/queue/../policy.toml", False),
        ("research/loop/configs/../../../ml/x.toml", False),
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
            entry = {"started": started.strftime("%Y-%m-%dT%H:%M:%SZ"), "total_cost_usd": 0.1}
            log.write(json.dumps(entry) + "\n")
    assert "calls in the last day" in (researcher.not_due(clock()) or "")


def _log_calls(layout: Layout, *calls: tuple[float, float | None]) -> None:
    """Calls (hours ago, cost or None) in the researcher's log."""
    now = Clock()()
    layout.researcher_log.parent.mkdir(parents=True, exist_ok=True)
    with layout.researcher_log.open("w", encoding="utf-8") as log:
        for hours, cost in calls:
            started = (now - timedelta(hours=hours)).strftime("%Y-%m-%dT%H:%M:%SZ")
            entry: dict[str, Any] = {"started": started}
            if cost is not None:
                entry["total_cost_usd"] = cost
            log.write(json.dumps(entry) + "\n")


def test_the_daily_spend_cap(layout: Layout, policy: Policy) -> None:
    r = policy.researcher
    researcher, fake, _ = make(layout, policy)
    clock = Clock()
    room = r.max_usd_per_day - r.max_budget_usd
    # Just room for one more whole call: it is due.
    _log_calls(layout, (5.0, room / 2), (10.0, room / 2))
    assert researcher.spent(clock()) == pytest.approx(room)
    assert researcher.not_due(clock()) is None
    # A little more and a whole call no longer fits: stopped for the day.
    _log_calls(layout, (5.0, room / 2), (10.0, room / 2 + 0.01))
    assert "spent in the last day" in (researcher.not_due(clock()) or "")
    with pytest.raises(RuntimeError, match="spent"):
        researcher.start(clock())
    assert fake.argv == []
    # A call that reported no cost (killed, say) counts as a whole call.
    _log_calls(
        layout, *[(3.0 + k, None) for k in range(int(r.max_usd_per_day // r.max_budget_usd))]
    )
    assert "spent in the last day" in (researcher.not_due(clock()) or "")
    # Calls over a day old do not count.
    _log_calls(layout, (25.0, r.max_usd_per_day), (30.0, None))
    assert researcher.spent(clock()) == 0.0
    assert researcher.not_due(clock()) is None


def test_cost_and_tokens_are_logged(layout: Layout, policy: Policy) -> None:
    researcher, _, _ = make(layout, policy)
    clock = Clock()
    transcript = layout.state / "t.json"
    transcript.parent.mkdir(parents=True, exist_ok=True)
    transcript.write_text(
        json.dumps(
            {"total_cost_usd": 0.7, "usage": {"input_tokens": 10, "output_tokens": 5, "x": "y"}}
        ),
        encoding="utf-8",
    )
    call_ = {"started": "2026-10-06T00:00:00Z", "transcript": str(transcript)}
    entry = researcher.settle({**call_, "before": {"changed": [], "queue": {}}}, clock(), "ok")
    assert entry["total_cost_usd"] == 0.7
    assert entry["tokens"] == {"input_tokens": 10, "output_tokens": 5}


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


def test_it_withdraws_specs_by_name_only(layout: Layout, policy: Policy) -> None:
    write(layout, spec(EVAL, id="stale-one"))
    write(layout, spec(EVAL, id="kept-one"))
    confirmation = spec(EVAL, id="x-confirm", confirms="x", tags=["search", "confirmation"])
    (layout.queue / "x-confirm.toml").write_text(tomlw.dumps(confirmation), encoding="utf-8")

    def act(git: FakeCheckout) -> None:
        (layout.loop / "withdraw.txt").write_text(
            "# no longer worth it\nstale-one.toml\nx-confirm.toml\n../policy.toml\n"
            "-rf.toml\n/etc/passwd\n../configs/dmc-v1.toml\nmissing.toml\n",
            encoding="utf-8",
        )
        git.paths = ["research/loop/withdraw.txt"]

    entry, _ = call(layout, policy, act)
    assert entry["outcome"] == "ok"
    assert entry["withdrawn"] == ["stale-one.toml"]
    queued = sorted(p.name for p in layout.queue.glob("*.toml"))
    assert queued == ["kept-one.toml", "x-confirm.toml"]
    assert (layout.rejected / "stale-one.toml").is_file()
    assert layout.policy.is_file()
    assert (layout.loop / "configs" / "dmc-v1.toml").is_file()
    assert not (layout.loop / "withdraw.txt").exists()


def test_changing_an_existing_base_config_switches_it_off(layout: Layout, policy: Policy) -> None:
    def act(git: FakeCheckout) -> None:
        git.paths = ["research/loop/configs/dmc-v1.toml"]  # tracked: an existing config

    entry, git = call(layout, policy, act)
    assert entry["outcome"] == "violation"
    assert git.restored == ["research/loop/configs/dmc-v1.toml"]


def test_the_next_briefing_says_what_was_refused(layout: Layout, policy: Policy) -> None:
    def act(_: FakeCheckout) -> None:
        write(layout, spec(DMC, id="too-long", budget={"wall_hours": 99.0}))

    call(layout, policy, act)
    researcher, _, _ = make(layout, policy)
    text = researcher.briefing(Clock()()).text(policy)
    assert "refused after your last call" in text
    assert "too-long.toml" in text
    assert "wall hours" in text
