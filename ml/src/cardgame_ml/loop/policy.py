"""The loop's fixed rules, ``research/loop/policy.toml``: the machines and
their caps, what the researcher may queue, and the protocol every run is
scored by. People change it by commit; the researcher may read it but
never change it (the runner reverts its edits and stops calling it)."""

import tomllib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from cardgame_ml import schema
from cardgame_ml.loop.safety import relative, ssh_destination
from cardgame_ml.schema import TABLE_KEY, SchemaError
from cardgame_ml.train.dmc.config import CurveConfig

SCHEMA = "loop-policy/1"


@dataclass(frozen=True, kw_only=True)
class Host:
    """A machine the runner starts steps on."""

    name: str = field(default="", metadata=TABLE_KEY)
    """Its key under ``[hosts]``."""
    threads: int
    """Threads the loop's steps may hold at once (a step bigger than this
    starts only when the host is otherwise idle)."""
    cores: int
    """The most threads one step may hold (it then has the host's loop
    share to itself): a search that thinks on every core, as at the
    table."""
    gpu: bool
    nice: int
    ssh: str | None = None
    """The ``ssh`` destination; ``None`` for this machine."""
    root: str = ""
    """Scratch folder for the loop's code and outputs, relative to the
    home directory (remote hosts only)."""
    max_load: float = 1e9
    """No new step starts while the one-minute load average is above this
    (remote hosts: the live bot worker comes first)."""

    def __post_init__(self) -> None:
        if self.ssh is not None:
            ssh_destination(self.ssh)
            relative(self.root, f"hosts.{self.name}.root")

    @property
    def local(self) -> bool:
        return self.ssh is None


@dataclass(frozen=True, kw_only=True)
class Limits:
    methods: tuple[str, ...]
    """Methods the researcher may queue (the agenda's runnable ones)."""
    max_wall_hours: float
    """Per spec."""
    max_gpu_hours_queued: float
    """GPU hours (by budget) the queue may hold after a researcher call."""
    max_specs_per_call: int
    max_attempts: int
    """Times a step is started before its run is given up (restarts)."""


@dataclass(frozen=True, kw_only=True)
class ResearcherPolicy:
    claude: str
    model: str
    min_interval_hours: float
    max_calls_per_day: int
    low_water: int
    """Called when fewer runnable specs than this wait in the queue."""
    timeout_minutes: float
    max_budget_usd: float
    """One call's cap, passed to ``claude --max-budget-usd`` (above 0)."""
    max_usd_per_day: float
    """What the calls of the last 24 hours may cost in all (by ``claude``'s
    own ``total_cost_usd``; a call that reported none counts as
    ``max_budget_usd``). A call starts only if it fits whole."""

    def __post_init__(self) -> None:
        if not 0 < self.max_budget_usd <= self.max_usd_per_day:
            raise ValueError("0 < max_budget_usd <= max_usd_per_day")
        if not self.timeout_minutes > 0:
            raise ValueError("timeout_minutes above 0")


@dataclass(frozen=True, kw_only=True)
class Protocol:
    """How every run is scored."""

    curve: CurveConfig
    """The learning curve every RL run measures: a training config's
    ``[curve]`` table is replaced by this, so curves compare."""
    suite: str
    parts: tuple[str, ...]
    """Parts a spec may ask for."""
    required_parts: tuple[str, ...]
    """Parts every policy run plays (screening may not skip them)."""
    baseline: str
    """The bot every run is also measured against, deal by deal."""
    primary: str
    """The metric a win is decided on (``ladder``: the rating)."""
    confirm_suite: str
    """The fresh-deal suite confirmations play (generated beside
    ``research/loop``, never in ``research/evals``)."""
    confirm_seed_shift: int
    """Added to a candidate's training seed for its confirmation."""
    suites: tuple[str, ...] = ()
    """Other suites a spec may play: the loop's own, in
    ``research/loop/suites`` (head-to-heads on a few rule sets, say).
    They are not the scoreboard: a win on one is not confirmed by the
    runner, and the leaderboard's suite columns stay empty for them."""

    def __post_init__(self) -> None:
        if not set(self.required_parts) <= set(self.parts):
            raise ValueError("required_parts must be among parts")


@dataclass(frozen=True, kw_only=True)
class Reference:
    """A fixed row of the leaderboard: a bot measured outside the loop."""

    name: str
    bot: str
    results: str


@dataclass(frozen=True, kw_only=True)
class Policy:
    schema: Literal["loop-policy/1"]
    loop_branch: str
    """The runner commits its records only on this branch."""
    exclude: str
    """The held-out rule sets training must exclude; configs may name it,
    never change it."""
    report_hour: int
    """Local hour after which yesterday's daily report is written."""
    train_host: str
    """Where training (and anything else on the GPU) runs: this machine,
    with a GPU. ``eval`` is built here before steps run here."""
    cost_host: str
    """Where think time is measured (the machine bots serve from)."""
    hosts: dict[str, Host]
    limits: Limits
    researcher: ResearcherPolicy
    protocol: Protocol
    references: tuple[Reference, ...] = ()

    def __post_init__(self) -> None:
        for role, host in (("train_host", self.train_host), ("cost_host", self.cost_host)):
            if host not in self.hosts:
                raise ValueError(f"{role}: no host {host!r} in hosts")
        train = self.hosts[self.train_host]
        if not train.local or not train.gpu:
            raise ValueError(f"train_host: {train.name} must be this machine, with a GPU")

    def host(self, name: str) -> Host:
        try:
            return self.hosts[name]
        except KeyError:
            raise SchemaError(f"no host {name!r} in the policy") from None

    @classmethod
    def load(cls, path: Path) -> "Policy":
        with path.open("rb") as f:
            return parse_policy(tomllib.load(f), str(path))


def parse_policy(data: dict[str, object], where: str) -> Policy:
    return schema.read(Policy, data, where)
