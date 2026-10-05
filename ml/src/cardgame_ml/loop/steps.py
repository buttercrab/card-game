"""A step: one command of a run (train, export, an eval), with what it
holds while it runs. A method turns a spec into steps; the scheduler
starts each when its host has room.

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

PLACEHOLDERS = ("python", "repo", "run", "out", "artifacts", "eval", "commit", "machine")
_ARTIFACT = re.compile(r"\{artifacts\}/([A-Za-z0-9_./-]+)")


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
    resumable: bool = False
    """Started again after an interruption, it carries on (training
    resumes from its checkpoint); otherwise it starts over."""
    grace_seconds: float = 60.0
    """Between SIGTERM and SIGKILL when stopped (training checkpoints)."""
    clean: bool = False
    """Refuses uncommitted changes (it writes a manifest naming the
    commit): the runner commits its records first."""

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
