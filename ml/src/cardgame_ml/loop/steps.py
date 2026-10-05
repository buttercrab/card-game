"""A step: one command of a run (train, export, an eval), with what it
holds while it runs. A method turns a spec into steps; the scheduler
starts each when its host has room.

Every step has a ``role``, which is what the runner and the reports go
by: the suite run against a baseline is the ``eval`` step with that
``baseline``, whatever its name (names only have to be unique and safe as
folder names).

Commands name places by placeholder, so the same step runs here or on
the home server: ``{python}`` (the loop's interpreter), ``{repo}``,
``{run}`` (the run's folder), ``{out}`` (the step's output folder,
``{run}/results/<step>``), ``{artifacts}`` (the artifact store),
``{eval}`` (the release ``eval`` binary), ``{commit}`` (the run's
commit) and ``{machine}`` (a label for the record).
"""

import re
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from cardgame_ml.loop.safety import name as safe_name

PLACEHOLDERS = ("python", "repo", "run", "out", "artifacts", "eval", "commit", "machine")
_ARTIFACT = re.compile(r"\{artifacts\}/([A-Za-z0-9_./-]+)")


class Role(StrEnum):
    """What a step is for."""

    BUILD = "build"
    """Builds ``eval`` where the next steps run it."""
    TRAIN = "train"
    CURVE = "curve"
    """Writes the learning curve (``train.dmc.report.CurveReport``)."""
    SCORE = "score"
    """Scores a belief model against the counts."""
    EXPORT = "export"
    EVAL = "eval"
    """A suite run against ``Step.baseline``."""
    COST = "cost"
    """Think time, on the policy's ``cost_host``."""
    OTHER = "other"


PARENT = "parent"
"""The baseline that stands for the parent's bot."""


@dataclass(frozen=True)
class Step:
    name: str
    """Unique in its run; names its log and its output folder."""
    argv: tuple[str, ...]
    host: str
    threads: int
    gpu: bool = False
    cwd: str = "repo"
    """``repo`` or ``ml`` (the Python project)."""
    grace_seconds: float = 60.0
    """Between SIGTERM and SIGKILL when stopped (training checkpoints)."""
    clean: bool = False
    """Refuses uncommitted changes (it writes a manifest naming the
    commit): the runner commits its records first."""
    role: Role = Role.OTHER
    baseline: str | None = None
    """``eval`` steps: the baseline as the spec names it (a bot, or
    ``parent`` for the parent's)."""

    def __post_init__(self) -> None:
        safe_name(self.name, "step")
        if self.cwd not in ("repo", "ml"):
            raise ValueError(f"step {self.name}: cwd {self.cwd!r} is repo or ml")
        if (self.role == Role.EVAL) != (self.baseline is not None):
            raise ValueError(f"step {self.name}: eval steps, and only they, have a baseline")

    def expand(self, places: Mapping[str, str]) -> list[str]:
        return [expand(arg, places) for arg in self.argv]

    def uploads(self) -> list[str]:
        """Paths in the artifact store the command reads (models a bot
        plays by): a remote host needs a copy first."""
        found: list[str] = []
        for arg in self.argv:
            for match in _ARTIFACT.finditer(arg):
                path = match.group(1).rstrip("/")
                if path not in found:
                    found.append(path)
        return found


def expand(text: str, places: Mapping[str, str]) -> str:
    for name in PLACEHOLDERS:
        if name in places:
            text = text.replace("{" + name + "}", places[name])
    return text
