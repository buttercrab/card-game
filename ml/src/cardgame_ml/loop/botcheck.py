"""What a bot spec is, as ``eval`` reads it: ``eval check-bot --json``.

The loop never matches a bot's name itself to decide whether its runs
reproduce (a pattern missed ``hybrid:`` and took ``search`` and
``search:400``, which keep the search's default one-second budget, as
reproducible): it asks the parser the runs use. Models a spec names are
not loaded, so a spec checks before its model reaches the machine.
"""

import json
import subprocess
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from cardgame_ml import schema
from cardgame_ml.schema import SchemaError

CARGO_EVAL = ("cargo", "run", "--release", "--locked", "--quiet", "-p", "eval", "--")
"""How the loop runs ``eval`` here: built from the checkout when stale,
as the plan's ``build`` step builds it."""

TIMEOUT = 1800.0
"""Seconds, for a first build of ``eval`` included."""


@dataclass(frozen=True)
class BotCheck:
    kind: str
    """``random``, ``simple``, ``search``, ``belief``, ``dmc`` or ``hybrid``."""
    reproducible: bool
    """No clock in its decisions: a rerun gives the same results."""
    reason: str


class BotCheckError(ValueError):
    """The spec does not parse, or ``eval check-bot`` could not say."""


type Runner = Callable[[list[str], Path], subprocess.CompletedProcess[str]]
"""Runs a command in a folder, capturing its output as text."""


def run_command(argv: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        argv, cwd=cwd, capture_output=True, text=True, timeout=TIMEOUT, check=False
    )


RUN: Runner = run_command
"""The runner ``check_bot`` uses unless given one (tests stub it)."""


def check_bot_argv(bot: str, command: Sequence[str] = CARGO_EVAL) -> list[str]:
    """``eval check-bot --json -- BOT``, ``eval`` run as ``command``."""
    return [*command, "check-bot", "--json", "--", bot]


def check_bot(
    bot: str, repo: Path, *, command: Sequence[str] = CARGO_EVAL, run: Runner | None = None
) -> BotCheck:
    """What ``bot`` is, from ``eval check-bot`` run in ``repo``."""
    try:
        done = (run or RUN)(check_bot_argv(bot, command), repo)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise BotCheckError(f"eval check-bot could not run: {e}") from e
    lines = done.stdout.strip().splitlines()
    try:
        parsed: object = json.loads(lines[-1]) if lines else None
    except json.JSONDecodeError:
        parsed = None
    if not isinstance(parsed, dict):
        tail = (done.stderr or done.stdout).strip().splitlines()[-3:]
        raise BotCheckError(f"eval check-bot exited {done.returncode}: {' / '.join(tail)}")
    out = cast(dict[str, object], parsed)
    if "error" in out:
        raise BotCheckError(str(out["error"]))
    try:
        checked = schema.read(BotCheck, out, "eval check-bot", unknown="ignore")
    except SchemaError as e:
        raise BotCheckError(f"eval check-bot said {out} (exit {done.returncode}): {e}") from e
    if done.returncode != 0:
        raise BotCheckError(f"eval check-bot said {out} (exit {done.returncode})")
    return checked
