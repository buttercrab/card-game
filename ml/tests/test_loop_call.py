"""A researcher call is a critical section for the runner: in a real git
checkout, a tick during a call takes nothing from the queue and commits
nothing under ``research/loop``, and the call's check afterwards still
sees (and undoes) what the researcher did."""

import json
import subprocess
from pathlib import Path

import pytest
from loopkit import EVAL, Clock, FakeHost, make_layout, propose, results, spec, write, write_results

from cardgame_ml.loop.executors import HostExecutor
from cardgame_ml.loop.gitops import Git
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.researcher import Researcher
from cardgame_ml.loop.scheduler import Runner


def sh(repo: Path, *args: str) -> str:
    done = subprocess.run(
        ["git", "-C", str(repo), *args], capture_output=True, text=True, check=False
    )
    assert done.returncode == 0, done.stderr
    return done.stdout


class World:
    def __init__(self, tmp: Path) -> None:
        self.layout = layout = make_layout(tmp)
        (layout.loop / "researcher.md").write_text("# Instructions\n", encoding="utf-8")
        (layout.loop / "agenda.md").write_text("# Agenda\n", encoding="utf-8")
        self.policy = policy = Policy.load(layout.policy)
        repo = layout.repo
        sh(repo, "init", "--quiet", "-b", policy.loop_branch)
        sh(repo, "config", "user.name", "Test")
        sh(repo, "config", "user.email", "test@example.com")
        sh(repo, "config", "commit.gpgsign", "false")
        sh(repo, "add", "-A")
        sh(repo, "commit", "--quiet", "-m", "start")
        self.alive = True
        self.clock = Clock()
        self.hosts = {name: FakeHost(host) for name, host in policy.hosts.items()}
        self.said: list[str] = []
        self.researcher = Researcher(
            layout, policy, Git(repo), spawn=self.spawn, alive=lambda _: self.alive
        )
        hosts: dict[str, HostExecutor] = dict(self.hosts)
        self.runner = Runner(
            layout,
            policy,
            hosts,
            git=Git(repo),
            clock=self.clock,
            gpu_elsewhere=lambda _own: [],
            hooks=(self.researcher,),
            say=self.said.append,
        )

    def spawn(self, argv: list[str], cwd: Path, transcript: Path) -> int:
        transcript.parent.mkdir(parents=True, exist_ok=True)
        transcript.write_text(json.dumps({"total_cost_usd": 0.5}), encoding="utf-8")
        return 4242

    def committed(self, since: str) -> list[str]:
        """Paths committed after ``since``."""
        out = sh(self.layout.repo, "log", "--name-only", "--format=", f"{since}..HEAD")
        return sorted({line for line in out.splitlines() if line})

    def head(self) -> str:
        return sh(self.layout.repo, "rev-parse", "HEAD").strip()


@pytest.fixture
def world(tmp_path: Path) -> World:
    return World(tmp_path)


def test_a_tick_during_a_call_neither_takes_nor_commits_its_files(world: World) -> None:
    layout, runner = world.layout, world.runner
    write(layout, spec(EVAL, id="early", priority=1))
    runner.tick()
    home = world.hosts["home"]
    assert home.started == ["early:eval-parent"]
    # The queue ran dry: the same tick called the researcher.
    assert layout.researcher_call.exists()
    before = world.head()

    # The researcher, mid-call: a spec in its inbox, one straight into the
    # queue (which the runner's looser limits would happily start), and
    # its agenda.
    propose(layout, spec(EVAL, id="proposed"))
    write(layout, spec(EVAL, id="sneaked", priority=50))
    (layout.loop / "agenda.md").write_text("# Agenda\n\n- learnt\n", encoding="utf-8")
    # Meanwhile a run finishes, beating its parent.
    run = runner.records.by_id()["early"]
    write_results(layout, run, "eval-parent", results("bot", "x", 7.5, 0.8))
    home.end(run.step("eval-parent"), 0)
    world.clock.advance(minutes=1)
    runner.tick()

    assert home.started == ["early:eval-parent"]  # nothing taken from the queue
    assert runner.records.by_id()["early"].status == "succeeded"
    committed = world.committed(before)
    assert committed, "the finished run's records are committed"
    assert all(p.startswith("research/experiments/") for p in committed), committed
    # The researcher's files are still uncommitted for the call's check,
    # and the runner wrote nothing under research/loop: its confirmation
    # and the leaderboard wait.
    loop = {p for p in Git(layout.repo).changed() if p.startswith("research/loop/")}
    assert loop == {
        "research/loop/queue/sneaked.toml",
        "research/loop/inbox/proposed.toml",
        "research/loop/agenda.md",
    }
    assert (layout.held / "early-confirm.toml").is_file()
    assert not (layout.queue / "early-confirm.toml").exists()
    assert not (layout.loop / "leaderboard.md").exists()

    # The call ends: its check still sees the spec written into the queue.
    world.alive = False
    world.clock.advance(minutes=1)
    runner.tick()
    assert not layout.researcher_call.exists()
    entry = json.loads(layout.researcher_log.read_text(encoding="utf-8").splitlines()[-1])
    assert entry["outcome"] == "violation"
    assert entry["accepted"] == ["proposed"]
    assert "research/loop/queue/sneaked.toml" in layout.researcher_off.read_text(encoding="utf-8")
    assert not (layout.queue / "sneaked.toml").exists()
    assert (layout.queue / "proposed.toml").is_file()
    assert home.started == ["early:eval-parent"]
    committed = world.committed(before)
    assert "research/loop/queue/proposed.toml" in committed
    assert "research/loop/agenda.md" in committed
    assert "research/loop/queue/sneaked.toml" not in committed

    # The next tick catches up: the confirmation is queued and starts, the
    # leaderboard is written, and the checked spec runs.
    world.clock.advance(minutes=1)
    runner.tick()
    assert not (layout.held / "early-confirm.toml").exists()
    assert (layout.loop / "leaderboard.md").is_file()
    assert set(home.started[1:]) <= {"early-confirm:eval-parent", "proposed:eval-parent"}
    assert home.started[1] == "early-confirm:eval-parent"
    assert "research/loop/leaderboard.md" in world.committed(before)
    assert not Git(layout.repo).changed()
