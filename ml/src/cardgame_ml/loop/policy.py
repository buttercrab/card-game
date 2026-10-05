"""The loop's fixed rules, ``research/loop/policy.toml``: the machines and
their caps, what the researcher may queue, and the protocol every run is
scored by. People change it by commit; the researcher may read it but
never change it (the runner reverts its edits and stops calling it)."""

import tomllib
from dataclasses import dataclass
from pathlib import Path

from cardgame_ml.loop.fields import FieldError, Table

SCHEMA = "loop-policy/1"


@dataclass(frozen=True)
class Host:
    """A machine the runner starts steps on."""

    name: str
    threads: int
    """Threads the loop's steps may hold at once (a step bigger than this
    starts only when the host is otherwise idle)."""
    cores: int
    """The most threads one step may hold (it then has the host's loop
    share to itself): a search that thinks on every core, as at the
    table."""
    gpu: bool
    nice: int
    ssh: str | None
    """The ``ssh`` destination; ``None`` for this machine."""
    root: str
    """Scratch folder for the loop's code and outputs, relative to the
    home directory (remote hosts only)."""
    max_load: float
    """No new step starts while the one-minute load average is above this
    (remote hosts: the live bot worker comes first)."""


@dataclass(frozen=True)
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


@dataclass(frozen=True)
class ResearcherPolicy:
    claude: str
    model: str
    min_interval_hours: float
    max_calls_per_day: int
    low_water: int
    """Called when fewer runnable specs than this wait in the queue."""
    timeout_minutes: float
    max_budget_usd: float
    """Passed to ``claude --max-budget-usd``; 0 leaves it out."""


@dataclass(frozen=True)
class Curve:
    """The learning curve every RL run measures: a training config's
    ``[curve]`` table is replaced by this, so curves compare."""

    every_hands: int
    deals: int
    rules: str
    opponents: tuple[str, ...]
    seed: int
    threads: int

    def to_table(self) -> dict[str, object]:
        return {
            "every_hands": self.every_hands,
            "deals": self.deals,
            "rules": self.rules,
            "opponents": list(self.opponents),
            "seed": self.seed,
            "threads": self.threads,
        }


@dataclass(frozen=True)
class Protocol:
    """How every run is scored."""

    curve: Curve
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
    suites: tuple[str, ...]
    """Other suites a spec may play: the loop's own, in
    ``research/loop/suites`` (head-to-heads on a few rule sets, say).
    They are not the scoreboard: a win on one is not confirmed by the
    runner, and the leaderboard's suite columns stay empty for them."""


@dataclass(frozen=True)
class Reference:
    """A fixed row of the leaderboard: a bot measured outside the loop."""

    name: str
    bot: str
    results: str


@dataclass(frozen=True)
class Policy:
    loop_branch: str
    """The runner commits its records only on this branch."""
    exclude: str
    """The held-out rule sets training must exclude; configs may name it,
    never change it."""
    report_hour: int
    """Local hour after which yesterday's daily report is written."""
    hosts: dict[str, Host]
    limits: Limits
    researcher: ResearcherPolicy
    protocol: Protocol
    references: tuple[Reference, ...]

    def host(self, name: str) -> Host:
        try:
            return self.hosts[name]
        except KeyError:
            raise FieldError(f"no host {name!r} in the policy") from None

    @classmethod
    def load(cls, path: Path) -> "Policy":
        with path.open("rb") as f:
            return parse_policy(tomllib.load(f), str(path))


def parse_policy(data: dict[str, object], where: str) -> Policy:
    t = Table(data, where)
    if t.text("schema") != SCHEMA:
        raise FieldError(f"{where}: schema is not {SCHEMA}")
    hosts: dict[str, Host] = {}
    hosts_table = t.table("hosts")
    for name in list(hosts_table.data):
        h = hosts_table.table(name)
        hosts[name] = Host(
            name=name,
            threads=h.integer("threads"),
            cores=h.integer("cores"),
            gpu=h.flag("gpu"),
            nice=h.integer("nice"),
            ssh=h.opt_text("ssh"),
            root=h.text("root", ""),
            max_load=h.number("max_load", 1e9),
        )
        h.done()
    hosts_table.done()
    if "mac" not in hosts:
        raise FieldError(f"{where}: hosts: the Mac (mac) is required")
    lim = t.table("limits")
    limits = Limits(
        methods=lim.texts("methods"),
        max_wall_hours=lim.number("max_wall_hours"),
        max_gpu_hours_queued=lim.number("max_gpu_hours_queued"),
        max_specs_per_call=lim.integer("max_specs_per_call"),
        max_attempts=lim.integer("max_attempts"),
    )
    lim.done()
    r = t.table("researcher")
    researcher = ResearcherPolicy(
        claude=r.text("claude"),
        model=r.text("model"),
        min_interval_hours=r.number("min_interval_hours"),
        max_calls_per_day=r.integer("max_calls_per_day"),
        low_water=r.integer("low_water"),
        timeout_minutes=r.number("timeout_minutes"),
        max_budget_usd=r.number("max_budget_usd"),
    )
    r.done()
    p = t.table("protocol")
    c = p.table("curve")
    curve = Curve(
        every_hands=c.integer("every_hands"),
        deals=c.integer("deals"),
        rules=c.text("rules"),
        opponents=c.texts("opponents"),
        seed=c.integer("seed"),
        threads=c.integer("threads"),
    )
    c.done()
    protocol = Protocol(
        curve=curve,
        suite=p.text("suite"),
        parts=p.texts("parts"),
        required_parts=p.texts("required_parts"),
        baseline=p.text("baseline"),
        primary=p.text("primary"),
        confirm_suite=p.text("confirm_suite"),
        confirm_seed_shift=p.integer("confirm_seed_shift"),
        suites=p.texts("suites", ()),
    )
    p.done()
    if not set(protocol.required_parts) <= set(protocol.parts):
        raise FieldError(f"{where}: protocol: required_parts must be among parts")
    reference_tables = t.tables("references")
    references = tuple(
        Reference(name=x.text("name"), bot=x.text("bot"), results=x.text("results"))
        for x in reference_tables
    )
    for x in reference_tables:
        x.done()
    policy = Policy(
        loop_branch=t.text("loop_branch"),
        exclude=t.text("exclude"),
        report_hour=t.integer("report_hour"),
        hosts=hosts,
        limits=limits,
        researcher=researcher,
        protocol=protocol,
        references=references,
    )
    t.done()
    return policy
