"""Where the loop keeps things.

In the repository (committed): ``research/loop/`` (policy, agenda, queue,
rejected specs, leaderboard, plots, requests), each run's folder in
``research/experiments/`` and the daily reports in ``research/reports/``.
Outside it, under ``<artifact store>/loop/``: the runner's lock, active
runs' records, step logs and the researcher's transcripts.
"""

from dataclasses import dataclass
from pathlib import Path

from cardgame_ml.loop.safety import inside, name
from cardgame_ml.store import artifact_store


@dataclass(frozen=True)
class Layout:
    repo: Path
    state: Path
    """``<artifact store>/loop``."""

    @classmethod
    def default(cls, repo: Path) -> "Layout":
        return cls(repo, artifact_store() / "loop")

    @property
    def artifacts(self) -> Path:
        return self.state.parent

    @property
    def loop(self) -> Path:
        return self.repo / "research" / "loop"

    @property
    def policy(self) -> Path:
        return self.loop / "policy.toml"

    @property
    def queue(self) -> Path:
        return self.loop / "queue"

    @property
    def rejected(self) -> Path:
        return self.loop / "rejected"

    @property
    def suites(self) -> Path:
        return self.loop / "suites"

    @property
    def plots(self) -> Path:
        return self.loop / "plots"

    @property
    def experiments(self) -> Path:
        return self.repo / "research" / "experiments"

    @property
    def reports(self) -> Path:
        return self.repo / "research" / "reports"

    @property
    def researcher_log(self) -> Path:
        return self.loop / "researcher-log.jsonl"

    @property
    def logs(self) -> Path:
        return self.state / "logs"

    @property
    def lock(self) -> Path:
        return self.state / "runner.lock"

    @property
    def pause(self) -> Path:
        """While this file exists no new step starts (running ones go on)."""
        return self.state / "pause"

    @property
    def researcher_off(self) -> Path:
        """While this file exists the researcher is not called; the runner
        writes it when a call broke the rules, with the reason."""
        return self.state / "researcher-off"

    @property
    def live(self) -> Path:
        """Active runs' records (finished ones move to their folders)."""
        return self.state / "runs"

    @property
    def cancel(self) -> Path:
        """``cancel/<run id>`` asks the runner to stop that run."""
        return self.state / "cancel"

    def run_logs(self, folder: str) -> Path:
        return inside(self.logs, name(folder, "run folder"))
