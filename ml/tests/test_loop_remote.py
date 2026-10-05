"""The home server's executor, through a fake ``ssh``: the scripts it
sends (niced, in its own session, in the scratch folder) and how it reads
the answers."""

import subprocess
from pathlib import Path

from loopkit import make_layout

from cardgame_ml.loop.executors import LOST, UNKNOWN, RemoteExecutor
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.records import RunRecord, StepRecord
from cardgame_ml.loop.steps import Step


class FakeSsh:
    """Answers the scripts in turn (``None``: the host did not answer)."""

    def __init__(self, *answers: str | None) -> None:
        self.answers: list[str | None] = list(answers)
        self.scripts: list[str] = []

    def __call__(
        self, argv: list[str], stdin: str | None, timeout: float
    ) -> subprocess.CompletedProcess[str] | None:
        assert argv[0] == "ssh"
        assert argv[-2:] == ["bash", "-s"]
        self.scripts.append(stdin or "")
        answer = self.answers.pop(0) if self.answers else ""
        return None if answer is None else subprocess.CompletedProcess(argv, 0, answer, "")


def test_remote_steps_through_ssh(tmp_path: Path) -> None:
    layout = make_layout(tmp_path)
    policy = Policy.load(layout.policy)
    ssh = FakeSsh()

    def host() -> RemoteExecutor:
        return RemoteExecutor(
            policy.hosts["home"],
            repo=layout.repo,
            artifacts=layout.artifacts,
            experiments=layout.experiments,
            shell=ssh,
        )

    ssh.answers = ["3.25\n"]
    assert host().load() == 3.25
    ssh.answers = [None]
    assert host().load() is None

    run = RunRecord(
        id="r",
        folder="f",
        method="eval-only",
        tags=[],
        parent=None,
        confirms=None,
        priority=0,
        commit="abcdef0123456789",
        dirty=False,
        created="2026-10-06T00:00:00Z",
        deadline="2026-10-07T00:00:00Z",
        wall_hours=1.0,
        gpu=False,
        steps=[],
    )
    argv = ("{eval}", "run", "--bot", "x y", "--commit", "{commit}", "--out", "{out}")
    record = StepRecord(Step("eval-hard", argv, "home", 6))
    home = host()
    # The home directory, then the code is there already, then the pid.
    ssh.answers = ["/home/me\n", "yes\n", "4321\n"]
    home.start(run, record, layout.logs / "f" / "eval-hard.log")
    assert record.pid == 4321
    assert record.workdir == "/home/me/research/card-game/runs/f/eval-hard"
    script = ssh.scripts[-1]
    assert "cd -- /home/me/research/card-game/code/abcdef012345" in script
    assert "nohup setsid nice -n 15" in script
    assert "'x y'" in script
    assert "--commit abcdef0123456789" in script
    assert "/runs/f/eval-hard/out" in script
    assert "-j 6 -p eval" in script

    for answer, expected in (
        ("0\n", 0),
        ("2\n", 2),
        ("running\n", "running"),
        ("lost\n", LOST),
        (None, UNKNOWN),
    ):
        ssh.answers = [answer]
        assert home.poll(record) == expected
    home.stop(record, force=False)
    assert "kill -TERM -- -4321" in ssh.scripts[-1]
