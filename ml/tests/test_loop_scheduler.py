"""The runner: admission (one GPU job, thread caps, loads), budgets,
lost steps, restarts, the lock, and confirmations, with fake hosts that
run nothing."""

import dataclasses
import json
from collections.abc import Callable
from pathlib import Path

import pytest
from loopkit import DMC, EVAL, Clock, FakeHost, make_layout, results, spec, write, write_results

from cardgame_ml.loop.evals import Estimate
from cardgame_ml.loop.executors import LOST, HostExecutor, LocalExecutor, Places
from cardgame_ml.loop.layout import Layout
from cardgame_ml.loop.leaderboard import row
from cardgame_ml.loop.methods import METHODS, Context
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.promotion import assess
from cardgame_ml.loop.records import Records, RunRecord, RunStatus, StepRecord, StepStatus
from cardgame_ml.loop.scheduler import (
    MAX_BACKOFF_SECONDS,
    Runner,
    RunnerLock,
    Usage,
    Want,
    admit,
    backoff,
)
from cardgame_ml.loop.spec import load_spec, parse_spec
from cardgame_ml.loop.steps import Step


def want(host: str = "mac", threads: int = 1, gpu: bool = False, name: str = "s") -> Want:
    return Want(Step(name=name, argv=("true",), host=host, threads=threads, gpu=gpu))


@pytest.fixture
def layout(tmp_path: Path) -> Layout:
    return make_layout(tmp_path)


@pytest.fixture
def policy(layout: Layout) -> Policy:
    return Policy.load(layout.policy)


def names(wants: list[Want]) -> list[str]:
    return [w.step.name for w in wants]


def test_one_gpu_job_at_a_time(policy: Policy) -> None:
    loads = {"mac": 1.0, "home": 1.0}
    wants = [want(gpu=True, name="a"), want(gpu=True, name="b"), want(name="c")]
    assert names(admit(wants, Usage(), policy.hosts, loads, False)) == ["a", "c"]
    busy = Usage(gpu=True)
    assert names(admit(wants, busy, policy.hosts, loads, False)) == ["c"]
    # An interactive training run holds the GPU: the loop leaves it alone.
    assert names(admit(wants, Usage(), policy.hosts, loads, True)) == ["c"]
    # No GPU on the home server.
    assert admit([want("home", gpu=True)], Usage(), policy.hosts, loads, False) == []


def test_thread_caps_loads_and_reservation(policy: Policy) -> None:
    loads: dict[str, float | None] = {"mac": 1.0, "home": 1.0}
    wants = [want(threads=8, name="a"), want(threads=8, name="b"), want(threads=6, name="c")]
    assert names(admit(wants, Usage(), policy.hosts, loads, False)) == ["a", "c"]
    # A step bigger than the cap starts only on an idle host.
    assert names(admit([want(threads=20)], Usage(), policy.hosts, loads, False)) == ["s"]
    held = Usage(threads={"mac": 2})
    assert admit([want(threads=20)], held, policy.hosts, loads, False) == []
    # A GPU step waiting for threads keeps later steps off its host.
    wants = [want(threads=12, gpu=True, name="train"), want(threads=2, name="small")]
    assert admit(wants, Usage(threads={"mac": 4}), policy.hosts, loads, False) == []
    # The home server: nothing new above its load cap or while unreachable.
    home = [want("home", threads=2)]
    assert admit(home, Usage(), policy.hosts, {"home": 7.5}, False) == []
    assert admit(home, Usage(), policy.hosts, {"home": None}, False) == []
    assert names(admit(home, Usage(), policy.hosts, {"home": 3.0}, False)) == ["s"]


class Setup:
    def __init__(self, layout: Layout, policy: Policy) -> None:
        self.layout, self.policy = layout, policy
        self.clock = Clock()
        self.hosts = {name: FakeHost(host) for name, host in policy.hosts.items()}
        self.elsewhere: list[str] = []
        self.said: list[str] = []
        self.runner = self.make()

    def make(self) -> Runner:
        hosts: dict[str, HostExecutor] = dict(self.hosts)
        return Runner(
            self.layout,
            self.policy,
            hosts,
            git=None,
            clock=self.clock,
            gpu_elsewhere=lambda _own: self.elsewhere,
            say=self.said.append,
        )

    def run(self, run_id: str) -> RunRecord:
        return self.runner.records.by_id()[run_id]

    def step(self, run_id: str, name: str) -> StepRecord:
        return self.run(run_id).step(name)

    def end(self, run_id: str, step: str, code: int | str = 0) -> None:
        record = self.step(run_id, step)
        self.hosts[record.step.host].end(record, code)


@pytest.fixture
def setup(layout: Layout, policy: Policy) -> Setup:
    return Setup(layout, policy)


def test_a_dmc_run_from_queue_to_record(setup: Setup) -> None:
    layout = setup.layout
    write(layout, spec(DMC, id="first", priority=5))
    write(layout, spec(DMC, id="second", priority=1))
    write(layout, spec(EVAL, id="cpu-only"))
    setup.runner.tick()
    mac, home = setup.hosts["mac"], setup.hosts["home"]
    # One GPU job; the CPU-only run starts beside it on the home server.
    assert mac.started == ["first:train"]
    assert home.started == ["cpu-only:eval-parent"]
    assert [p.stem for p in layout.queue.glob("*.toml")] == ["second"]
    first = setup.run("first")
    folder = layout.experiments / first.folder
    assert (folder / "spec.toml").is_file()
    assert "optim" in (folder / "config.toml").read_text(encoding="utf-8")
    assert load_spec(folder / "spec.toml").id == "first"
    # Active records live outside the checkout until the run ends.
    assert not (folder / "run.json").exists()

    setup.end("first", "train")
    setup.runner.tick()
    # Training done: the GPU is free for the next, the run goes on.
    assert mac.started == ["first:train", "first:curve", "second:train"]
    for step in ("curve", "export"):
        setup.end("first", step)
        setup.runner.tick()
    # The home server's six threads are taken by the CPU-only run.
    assert home.started == ["cpu-only:eval-parent"]
    setup.end("cpu-only", "eval-parent")
    setup.runner.tick()
    assert home.started[-1] == "first:eval-hard"
    write_results(layout, setup.run("first"), "eval-hard", results("bot", "hard", 1.0, -5.0))
    setup.end("first", "eval-hard")
    setup.runner.tick()
    record = setup.run("first")
    assert record.status == "succeeded"
    assert (folder / "run.json").is_file()
    assert "first" in (folder / "summary.md").read_text(encoding="utf-8")
    board = (layout.loop / "leaderboard.md").read_text(encoding="utf-8")
    assert "[first]" in board
    assert (layout.plots / "scaling.csv").is_file()


def test_budget_stops_a_step(setup: Setup) -> None:
    write(setup.layout, spec(DMC, id="slow"))
    setup.runner.tick()
    setup.clock.advance(hours=10.5)
    setup.runner.tick()
    assert setup.hosts["mac"].stopped == [("train", False)]
    setup.clock.advance(seconds=30)
    setup.runner.tick()
    assert setup.hosts["mac"].stopped == [("train", False)]
    setup.clock.advance(seconds=200)
    setup.runner.tick()
    assert setup.hosts["mac"].stopped[-1] == ("train", True)
    setup.end("slow", "train", 143)
    setup.runner.tick()
    record = setup.run("slow")
    assert record.status == "timeout"
    assert record.step("train").status == "killed"


def test_cancel(setup: Setup) -> None:
    write(setup.layout, spec(DMC, id="unwanted"))
    setup.runner.tick()
    setup.layout.cancel.mkdir(parents=True)
    (setup.layout.cancel / "unwanted").write_text("", encoding="utf-8")
    setup.runner.tick()
    setup.end("unwanted", "train", LOST)
    setup.runner.tick()
    assert setup.run("unwanted").status == "cancelled"


def test_lost_steps_restart_then_give_up(setup: Setup) -> None:
    write(setup.layout, spec(DMC, id="flaky"))
    setup.runner.tick()
    for attempt in range(1, setup.policy.limits.max_attempts + 1):
        assert setup.step("flaky", "train").attempts == attempt
        setup.end("flaky", "train", LOST)
        setup.runner.tick()
    record = setup.run("flaky")
    assert record.status == "interrupted"
    assert "lost 3 times" in (record.failure or "")


def test_a_failed_step_fails_the_run(setup: Setup) -> None:
    write(setup.layout, spec(DMC, id="broken"))
    setup.runner.tick()
    log = Path(setup.step("broken", "train").log or "")
    log.parent.mkdir(parents=True, exist_ok=True)
    log.write_text("loading\nValueError: no such table\n", encoding="utf-8")
    setup.end("broken", "train", 1)
    setup.runner.tick()
    record = setup.run("broken")
    assert record.status == "failed"
    assert "no such table" in (record.failure or "")
    assert setup.hosts["mac"].started == ["broken:train"]


def test_a_restarted_runner_adopts_running_steps(setup: Setup) -> None:
    write(setup.layout, spec(DMC, id="long"))
    setup.runner.tick()
    pid = setup.step("long", "train").pid
    restarted = setup.make()
    restarted.tick()
    # Still running under the same process: nothing started again.
    assert setup.hosts["mac"].started == ["long:train"]
    assert restarted.records.by_id()["long"].step("train").pid == pid
    setup.end("long", "train")
    restarted.tick()
    assert restarted.records.by_id()["long"].step("curve").status == "running"


def test_gpu_held_elsewhere_and_pause(setup: Setup) -> None:
    write(setup.layout, spec(DMC, id="waits"))
    setup.elsewhere = ["123 python -m cardgame_ml.train.dmc --config dmc-v1"]
    setup.runner.tick()
    assert setup.hosts["mac"].started == []
    setup.elsewhere = []
    setup.layout.pause.parent.mkdir(parents=True, exist_ok=True)
    setup.layout.pause.write_text("", encoding="utf-8")
    setup.runner.tick()
    assert setup.hosts["mac"].started == []
    setup.layout.pause.unlink()
    setup.runner.tick()
    assert setup.hosts["mac"].started == ["waits:train"]


def test_specs_wait_for_parents_and_artifacts(setup: Setup) -> None:
    layout = setup.layout
    write(layout, spec(EVAL, id="parent-run", parent=None, evals={"baselines": ["hard"]}))
    write(layout, spec(EVAL, id="child", parent="parent-run", priority=50))
    write(layout, spec(EVAL, id="needs-model", requires=["models/m/model.onnx"], priority=40))
    setup.runner.tick()
    assert setup.hosts["home"].started == ["parent-run:eval-hard"]
    setup.end("parent-run", "eval-hard")
    setup.runner.tick()
    assert setup.hosts["home"].started[-1] == "child:eval-parent"
    setup.end("child", "eval-parent")
    setup.runner.tick()
    assert setup.hosts["home"].started[-1] == "child:eval-parent"
    model = layout.artifacts / "models" / "m" / "model.onnx"
    model.parent.mkdir(parents=True)
    model.write_text("", encoding="utf-8")
    setup.runner.tick()
    assert setup.hosts["home"].started[-1] == "needs-model:eval-parent"


def test_invalid_specs_are_rejected_with_reasons(setup: Setup) -> None:
    write(setup.layout, spec(DMC, id="greedy", budget={"wall_hours": 100.0}))
    setup.runner.tick()
    reason = setup.layout.rejected / "greedy.reason.txt"
    assert "over the policy" in reason.read_text(encoding="utf-8")
    assert not list(setup.layout.queue.glob("*.toml"))


def test_replicates_split(setup: Setup) -> None:
    write(setup.layout, spec(EVAL, id="twice", seeds=[1, 2]))
    setup.runner.tick()
    started = setup.hosts["home"].started
    assert started == ["twice-s1:eval-parent"]
    assert [p.stem for p in setup.layout.queue.glob("*.toml")] == ["twice-s2"]


def finish_eval(setup: Setup, run_id: str, rating: float, diff: float | None = None) -> None:
    run = setup.run(run_id)
    for record in run.steps:
        if record.step.name.startswith("eval-"):
            data = results("bot", "x", rating, diff)
            write_results(setup.layout, run, record.step.name, data)
    setup.end(run_id, run.current().step.name if run.current() else "")  # type: ignore[union-attr]
    setup.runner.tick()


def test_a_win_is_confirmed_on_fresh_deals(setup: Setup) -> None:
    layout = setup.layout
    write(layout, spec(EVAL, id="candidate", priority=1))
    setup.runner.tick()
    # Beats its parent (고수) deal by deal beyond the interval.
    finish_eval(setup, "candidate", 7.5, diff=0.8)
    record = setup.run("candidate")
    assert record.status == "succeeded"
    assert record.candidate
    assert record.confirmation == "candidate-confirm"
    # Queued and, the home server being free, started in the same tick.
    confirming = setup.run("candidate-confirm")
    confirm = load_spec(layout.experiments / confirming.folder / "spec.toml")
    assert confirm.evals.suite == setup.policy.protocol.confirm_suite
    assert confirm.evals.baselines == ("parent",)
    assert confirm.seeds == (1 + setup.policy.protocol.confirm_seed_shift,)
    assert confirm.confirms == "candidate"
    assert "confirmation" in confirm.tags
    argv = setup.run("candidate-confirm").step("eval-parent").step.argv
    assert argv[argv.index("--suite") + 1] == "research/loop/suites/v1-fresh-1"
    finish_eval(setup, "candidate-confirm", 7.4, diff=0.6)
    original = setup.run("candidate")
    assert original.confirmed is True
    assert setup.run("candidate-confirm").candidate is False


def test_a_draw_is_no_candidate(setup: Setup) -> None:
    write(setup.layout, spec(EVAL, id="level"))
    setup.runner.tick()
    finish_eval(setup, "level", 6.8, diff=0.1)
    record = setup.run("level")
    assert not record.candidate
    assert record.comparison is not None
    assert not list(setup.layout.queue.glob("*.toml"))


def test_the_lock_keeps_a_second_runner_out(layout: Layout) -> None:
    with RunnerLock(layout.lock), pytest.raises(SystemExit, match="another runner"):
        RunnerLock(layout.lock).__enter__()


def test_local_steps_record_exit_codes(layout: Layout, policy: Policy, tmp_path: Path) -> None:
    places = Places(layout.repo, layout.artifacts, layout.experiments)
    host = LocalExecutor(policy.hosts["mac"], places)
    run = RunRecord(
        id="r",
        folder="f",
        method="eval-only",
        tags=[],
        parent=None,
        confirms=None,
        priority=0,
        commit="c",
        dirty=False,
        created="2026-10-06T00:00:00Z",
        deadline="2026-10-07T00:00:00Z",
        wall_hours=1.0,
        gpu=False,
        steps=[],
    )
    wait: Callable[[StepRecord], object] = lambda r: _wait(host, r)  # noqa: E731
    ok = StepRecord(Step("ok", ("sh", "-c", "echo {commit} > {out}/x"), "mac", 1))
    host.start(run, ok, tmp_path / "logs" / "ok.log")
    assert wait(ok) == 0
    assert (layout.experiments / "f" / "results" / "ok" / "x").read_text().strip() == "c"
    bad = StepRecord(Step("bad", ("sh", "-c", "exit 3"), "mac", 1))
    host.start(run, bad, tmp_path / "logs" / "bad.log")
    assert wait(bad) == 3
    killed = StepRecord(Step("killed", ("sleep", "30"), "mac", 1))
    host.start(run, killed, tmp_path / "logs" / "killed.log")
    host.stop(killed, force=True)
    assert wait(killed) == LOST


def _wait(host: LocalExecutor, record: StepRecord) -> object:
    import time  # noqa: PLC0415

    for _ in range(200):
        result = host.poll(record)
        if result != "running":
            return result
        time.sleep(0.05)
    raise AssertionError("the step did not end")


def test_a_malformed_record_is_quarantined_and_the_rest_go_on(setup: Setup) -> None:
    write(setup.layout, spec(EVAL, id="fine"))
    setup.runner.tick()
    assert setup.hosts["home"].started == ["fine:eval-parent"]
    live = setup.layout.live
    (live / "junk.json").write_text("{not json", encoding="utf-8")
    good = json.loads(next(live.glob("*fine.json")).read_text(encoding="utf-8"))
    typo = {**good, "folder": "2026-10-06-typo", "colour": "red"}
    (live / "typo.json").write_text(json.dumps(typo), encoding="utf-8")
    setup.end("fine", "eval-parent")
    setup.runner.tick()
    assert setup.run("fine").status == RunStatus.SUCCEEDED
    assert sorted(p.name for p in live.iterdir()) == []
    quarantine = setup.layout.state / "quarantine"
    reasons = [p.read_text(encoding="utf-8") for p in quarantine.rglob("*.reason.txt")]
    assert len(reasons) == 2
    assert any("unknown colour" in r for r in reasons)
    assert sum(line.startswith("quarantined") for line in setup.said) == 2
    # Read once a tick: a third tick finds nothing more to set aside.
    setup.runner.tick()
    assert sum(line.startswith("quarantined") for line in setup.said) == 2


def test_failed_ticks_are_logged_and_back_off(
    setup: Setup, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken() -> None:
        raise OSError("disk hiccup")

    monkeypatch.setattr(setup.runner, "tick", broken)
    waits: list[float] = []
    setup.runner.serve(10.0, sleep=waits.append, ticks=6)
    assert waits == [10.0, 10.0, 20.0, 40.0, 80.0]
    assert any("tick failed (3 in a row): OSError: disk hiccup" in s for s in setup.said)
    assert any(s.startswith("Traceback") for s in setup.said)
    assert backoff(30.0, 20) == MAX_BACKOFF_SECONDS
    assert backoff(30.0, 0) == 30.0
    # A tick that works again resets the wait.
    outcomes = iter([True, True, True, True, False, False])

    def flaky() -> None:
        if next(outcomes):
            raise OSError("x")

    monkeypatch.setattr(setup.runner, "tick", flaky)
    waits.clear()
    setup.runner.serve(10.0, sleep=waits.append, ticks=6)
    assert waits == [10.0, 10.0, 20.0, 40.0, 10.0]


def test_a_slugged_baseline_is_found_by_its_role(layout: Layout, policy: Policy) -> None:
    """A protocol baseline that is no safe step name (its step is
    ``eval-baseline1``) is still the one runs are compared on."""
    baseline = "hard@endgame=3"
    policy = dataclasses.replace(
        policy, protocol=dataclasses.replace(policy.protocol, baseline=baseline)
    )
    parsed = parse_spec(spec(EVAL, parent=None, evals={"baselines": [baseline]}), "t")
    plan = METHODS["search-tuning"].plan(Context(parsed, policy, layout.repo, "x", None))
    assert [s.name for s in plan.steps] == ["eval-baseline1"]
    records = Records(layout.experiments, layout.live)

    def run(run_id: str, parent: str | None, rating: float) -> RunRecord:
        record = RunRecord(
            id=run_id,
            folder=f"2026-10-06-{run_id}",
            method="search-tuning",
            tags=["search"],
            parent=parent,
            confirms=None,
            priority=0,
            commit="c",
            dirty=False,
            created="2026-10-06T00:00:00Z",
            deadline="2026-10-07T00:00:00Z",
            wall_hours=4.0,
            gpu=False,
            steps=[StepRecord(step, StepStatus.DONE) for step in plan.steps],
            status=RunStatus.SUCCEEDED,
        )
        records.save(record)
        write_results(layout, record, "eval-baseline1", results("b", baseline, rating, 0.0))
        return record

    parent = run("parent-run", None, 1.0)
    child = run("child-run", "parent-run", 3.0)
    folder = records.folder(child)
    comparison = assess(child, folder, policy, records.by_id(), layout.experiments)
    assert comparison is not None
    assert (comparison.metric, comparison.paired, comparison.beats) == ("ladder", False, True)
    assert comparison.diff.mean == pytest.approx(2.0)
    assert row(child, folder, baseline).rating == Estimate(3.0, 0.3, 1000)
    assert row(parent, records.folder(parent), "hard").rating is None
    # The primary metric only: without it measured there is no comparison.
    primary = dataclasses.replace(policy.protocol, primary="heldout")
    unmeasured = dataclasses.replace(policy, protocol=primary)
    assert assess(child, folder, unmeasured, records.by_id(), layout.experiments) is None
