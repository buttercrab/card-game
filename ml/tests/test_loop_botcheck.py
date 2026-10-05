"""Whether a bot's runs reproduce is ``eval check-bot``'s to say: the
loop's side of it, with the command stubbed, and once with the real
binary when one is built."""

import subprocess
from pathlib import Path

import pytest
from loopkit import EVAL, REPO, make_layout, spec

from cardgame_ml.loop.botcheck import (
    CARGO_EVAL,
    BotCheck,
    BotCheckError,
    check_bot,
    check_bot_argv,
    run_command,
)
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.spec import parse_spec
from cardgame_ml.loop.validate import Known, check


class Answer:
    """A runner that answers every command with the same output."""

    def __init__(self, stdout: str, code: int = 0, stderr: str = "") -> None:
        self.out = (stdout, code, stderr)
        self.calls: list[tuple[list[str], Path]] = []

    def __call__(self, argv: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
        self.calls.append((argv, cwd))
        stdout, code, stderr = self.out
        return subprocess.CompletedProcess(argv, code, stdout, stderr)


def test_check_bot_runs_eval_in_the_checkout(tmp_path: Path) -> None:
    run = Answer('{"spec": "hard", "kind": "search", "reproducible": true, "reason": "r"}\n')
    assert check_bot("hard", tmp_path, run=run) == BotCheck("search", True, "r")
    argv, cwd = run.calls[0]
    assert argv == [*CARGO_EVAL, "check-bot", "--json", "--", "hard"]
    assert cwd == tmp_path
    # A spec that looks like a flag stays the spec.
    assert check_bot_argv("--out=/")[-2:] == ["--", "--out=/"]


@pytest.mark.parametrize(
    ("stdout", "code", "stderr", "message"),
    [
        ('{"spec": "x", "error": "unknown bot \\"x\\""}\n', 1, "", 'unknown bot "x"'),
        ("", 101, "error: could not compile `eval`\n", "could not compile"),
        ("not json\n", 0, "", "exited 0"),
        ('{"spec": "x", "kind": "search", "reproducible": "yes", "reason": "r"}', 0, "", "said"),
        ('{"spec": "x", "kind": "search", "reproducible": true}', 0, "", "reason"),
        ('{"spec": "x", "kind": "search", "reproducible": true, "reason": "r"}', 1, "", "exit 1"),
    ],
)
def test_check_bot_errors_are_reported(
    tmp_path: Path, stdout: str, code: int, stderr: str, message: str
) -> None:
    with pytest.raises(BotCheckError, match=message):
        check_bot("x", tmp_path, run=Answer(stdout, code, stderr))


def test_check_bot_that_cannot_run_is_an_error(tmp_path: Path) -> None:
    with pytest.raises(BotCheckError, match="could not run"):
        check_bot("hard", tmp_path, command=[str(tmp_path / "no-such-eval")], run=run_command)


def _problems(tmp_path: Path, **changes: object) -> list[str]:
    layout = make_layout(tmp_path)
    policy = Policy.load(layout.policy)
    return check(
        parse_spec(spec(EVAL, **changes), "t"), policy, layout.repo, Known([], []), researcher=False
    )


@pytest.mark.parametrize("bot", ["search", "search:400", "search:200:1:150"])
def test_a_bot_on_a_clock_needs_clock_true(tmp_path: Path, bot: str) -> None:
    """Regression: a pattern over the name took ``search`` and
    ``search:400``, on the default budget, as reproducible."""
    found = _problems(tmp_path, options={"bot": bot})
    assert any("on a clock" in p for p in found), found
    assert _problems(tmp_path, options={"bot": bot, "clock": True}) == []


def test_search_tuning_takes_every_kind_of_search(tmp_path: Path) -> None:
    """Regression: ``hybrid:`` was not taken for a search."""
    assert _problems(tmp_path, options={"bot": "hybrid:{artifacts}/models/m:40"}) == []
    found = _problems(tmp_path, options={"bot": "dmc:{artifacts}/models/m:2"})
    assert any("must be a search" in p and "not dmc" in p for p in found), found
    found = _problems(
        tmp_path, method="eval-only", tags=["eval"], options={"bot": "dmc:{artifacts}/models/m:2"}
    )
    assert found == []


def test_a_bot_eval_cannot_read_is_refused(tmp_path: Path) -> None:
    found = _problems(tmp_path, options={"bot": "search:20:1:0:junk"})
    assert any("search:20:1:0:junk" in p and "CHECKED_BOTS" in p for p in found), found


def _built_eval() -> Path | None:
    """The newest ``eval`` built in this checkout, if any."""
    built = [REPO / "target" / kind / "eval" for kind in ("release", "debug")]
    found = [p for p in built if p.is_file()]
    return max(found, key=lambda p: p.stat().st_mtime) if found else None


@pytest.mark.skipif(_built_eval() is None, reason="no eval built in target/ (cargo build -p eval)")
def test_the_real_eval_check_bot(tmp_path: Path) -> None:
    binary = _built_eval()
    assert binary is not None

    def real(bot: str) -> BotCheck:
        return check_bot(bot, tmp_path, command=[str(binary)], run=run_command)

    assert real("search:400:1:0") == BotCheck("search", True, real("search:400:1:0").reason)
    for bot in ("search", "search:400", "search:200:1:150"):
        assert not real(bot).reproducible, bot
    assert real("hard@endgame=3").reproducible
    hybrid = real("hybrid:{artifacts}/models/m:40")
    assert (hybrid.kind, hybrid.reproducible) == ("hybrid", True)
    assert real("dmc:{artifacts}/models/dmc-v1").kind == "dmc"
    with pytest.raises(BotCheckError, match="takes no settings"):
        real("random@bid_base=7")
