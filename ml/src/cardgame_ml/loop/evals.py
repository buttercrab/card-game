"""Scoring through the ``eval`` tool, never around it: the command that
plays a suite, what its ``results.json`` (schema ``eval-results/1``) says,
how a run compares with its parent, and the fresh-deal suites that
confirmations play.

The loop never reads a suite's held-out rule sets: a fresh-deal suite
names the same file by a relative path and the same SHA-256, and only
``eval`` opens it.
"""

import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, cast

from cardgame_ml import schema

SCHEMA = "eval-results/1"
FRESH_SEED_STRIDE = 10_000_000
"""A fresh-deal suite ``k`` plays every table from its seed plus ``k``
times this: far past any deals of the suite it comes from."""
FRESH_PARTS = ("ladder", "presets", "heldout")
"""Parts whose deals change with the seed (puzzles and think time do
not decide wins)."""


@dataclass(frozen=True)
class Estimate:
    mean: float
    ci95: float
    n: int

    @property
    def low(self) -> float:
        return self.mean - self.ci95

    @property
    def high(self) -> float:
        return self.mean + self.ci95

    def minus(self, other: "Estimate") -> "Estimate":
        """The difference of two independent estimates."""
        return Estimate(
            self.mean - other.mean, math.hypot(self.ci95, other.ci95), min(self.n, other.n)
        )

    def __str__(self) -> str:
        return f"{self.mean:+.2f} ± {self.ci95:.2f}"


@dataclass(frozen=True)
class Summary:
    """A summary of a part: the bot, the baseline, their difference."""

    bot: Estimate | None = None
    baseline: Estimate | None = None
    diff: Estimate | None = None


# What the loop reads of ``eval-results/1`` (``eval`` writes more: the
# machine, each rung and table, the command line), read with unknown keys
# ignored.


@dataclass(frozen=True)
class _Suite:
    name: str
    quick: bool


@dataclass(frozen=True)
class _Run:
    wall_seconds: float
    threads: int


@dataclass(frozen=True)
class _Ladder:
    rating: Summary | None = None


@dataclass(frozen=True)
class _Average:
    average: Summary | None = None


@dataclass(frozen=True)
class _Think:
    median_ms: float
    p99_ms: float


@dataclass(frozen=True)
class _Cost:
    bot: _Think


@dataclass(frozen=True)
class _Puzzles:
    passed: int
    scored: int


@dataclass(frozen=True, kw_only=True)
class _Results:
    schema: Literal["eval-results/1"]
    suite: _Suite
    bot: str
    baseline: str | None = None
    run: _Run
    ladder: _Ladder | None = None
    presets: _Average | None = None
    heldout: _Average | None = None
    matches: tuple[Summary, ...] | None = None
    cost: _Cost | None = None
    puzzles: _Puzzles | None = None
    fingerprints: dict[str, str] = field(default_factory=dict[str, str])


@dataclass(frozen=True)
class EvalResult:
    """What one suite run measured, as the leaderboard needs it."""

    suite: str
    quick: bool
    bot: str
    baseline: str | None
    ladder: Summary | None
    presets: Summary | None
    heldout: Summary | None
    think_median_ms: float | None
    think_p99_ms: float | None
    puzzles: tuple[int, int] | None
    """Passed of scored."""
    wall_seconds: float
    threads: int

    matches: Summary | None = None
    """The ``matches`` part's tables pooled, each deal counting once."""
    fingerprints: dict[str, str] = field(default_factory=dict[str, str])
    """Every field bot the run met, by name: its choices on fixed probe
    positions, hashed (empty for results written before them)."""

    def differing_fields(self, other: "EvalResult") -> tuple[str, ...]:
        """Field bots both runs name but that are not the same bot."""
        return tuple(
            name
            for name, mine in sorted(self.fingerprints.items())
            if name in other.fingerprints and other.fingerprints[name] != mine
        )

    def metric(self, name: str) -> Summary | None:
        parts = {
            "ladder": self.ladder,
            "presets": self.presets,
            "heldout": self.heldout,
            "matches": self.matches,
        }
        return parts.get(name)

    @classmethod
    def load(cls, path: Path) -> "EvalResult":
        return cls.from_json(json.loads(path.read_text(encoding="utf-8")), str(path))

    @classmethod
    def from_json(cls, data: object, where: str = "results") -> "EvalResult":
        r = schema.read(_Results, data, where, unknown="ignore")
        return cls(
            suite=r.suite.name,
            quick=r.suite.quick,
            bot=r.bot,
            baseline=r.baseline,
            ladder=r.ladder.rating if r.ladder else None,
            presets=r.presets.average if r.presets else None,
            heldout=r.heldout.average if r.heldout else None,
            think_median_ms=r.cost.bot.median_ms if r.cost else None,
            think_p99_ms=r.cost.bot.p99_ms if r.cost else None,
            puzzles=(r.puzzles.passed, r.puzzles.scored) if r.puzzles else None,
            wall_seconds=r.run.wall_seconds,
            threads=r.run.threads,
            matches=_pooled(r.matches or ()),
            fingerprints=dict(r.fingerprints),
        )


def _pooled(tables: tuple[Summary, ...]) -> Summary | None:
    """Tables pooled by deals: the mean of every deal, and the interval of
    independent tables combined (``sqrt(sum (ci_i n_i)^2) / sum n_i``)."""
    if not tables:
        return None

    def pool(found: list[Estimate | None]) -> Estimate | None:
        estimates = [e for e in found if e is not None]
        if len(estimates) != len(tables):
            return None
        n = sum(e.n for e in estimates)
        mean = sum(e.mean * e.n for e in estimates) / n
        ci = math.sqrt(sum((e.ci95 * e.n) ** 2 for e in estimates)) / n
        return Estimate(mean, ci, n)

    return Summary(
        pool([t.bot for t in tables]),
        pool([t.baseline for t in tables]),
        pool([t.diff for t in tables]),
    )


@dataclass(frozen=True)
class Comparison:
    """A run against its parent on the primary metric."""

    metric: str
    diff: Estimate
    paired: bool
    """Measured deal by deal (the parent's bot as the suite's baseline),
    rather than as the difference of two separate measurements."""
    fields_differ: tuple[str, ...] = ()
    """Field bots the two measurements name alike but that are not the
    same bot (their fingerprints differ): an unpaired difference against
    them does not compare."""
    beats: bool = field(init=False)
    """Better beyond the 95% interval (written for readers of the record,
    derived when read back)."""

    def __post_init__(self) -> None:
        object.__setattr__(self, "beats", self.diff.low > 0)

    @property
    def loses(self) -> bool:
        return self.diff.high < 0


def compare(
    metric: str,
    against_parent: EvalResult | None,
    own: EvalResult | None,
    parents: EvalResult | None,
) -> Comparison | None:
    """The run against its parent: deal by deal when the run was measured
    with the parent's bot as baseline (``against_parent``), else its own
    measurement minus the parent's (both against the same field)."""
    if against_parent is not None:
        summary = against_parent.metric(metric)
        if summary is not None and summary.diff is not None:
            return Comparison(metric, summary.diff, paired=True)
    if own is None or parents is None:
        return None
    mine, theirs = own.metric(metric), parents.metric(metric)
    if mine is None or theirs is None or mine.bot is None or theirs.bot is None:
        return None
    return Comparison(
        metric,
        mine.bot.minus(theirs.bot),
        paired=False,
        fields_differ=parents.differing_fields(own),
    )


def eval_argv(
    *,
    suite: str,
    bot: str,
    baseline: str | None,
    parts: tuple[str, ...],
    threads: int,
) -> tuple[str, ...]:
    """The ``eval run`` command, with placeholders for the host's paths."""
    argv = ["{eval}", "run", "--suite", suite, "--bot", bot]
    if baseline is not None:
        argv += ["--baseline", baseline]
    argv += ["--parts", ",".join(parts), "--threads", str(threads)]
    argv += ["--machine", "{machine}", "--commit", "{commit}", "--out", "{out}"]
    return tuple(argv)


def suite_argument(suite: str, scoreboard: str) -> str:
    """How ``eval`` is told the suite: the scoreboard by name (it is found
    in ``research/evals``), a fresh-deal suite by its folder."""
    return suite if suite == scoreboard else f"research/loop/suites/{suite}"


@dataclass(frozen=True)
class _SuiteFile:
    suite: str
    game: str


@dataclass(frozen=True)
class _SuitePart:
    seed: int
    file: str | None = None


def fresh_suite(source: dict[str, object], name: str, k: int, source_dir: str) -> dict[str, object]:
    """Suite ``source`` (a parsed ``suite.json``) on fresh deals: every
    table's seed moved by ``k`` strides, files named relative to the new
    suite's folder (``source_dir``: the source's folder from there), only
    the parts whose deals move."""
    if k < 1:
        raise ValueError("a fresh-deal suite moves the seeds: k >= 1")
    shift = k * FRESH_SEED_STRIDE
    head = schema.read(_SuiteFile, source, "suite.json", unknown="ignore")
    out: dict[str, object] = {
        "suite": name,
        "game": head.game,
        "about": (
            f"Suite {head.suite} on fresh deals (seeds + {shift}), for confirming a win; "
            "generated by the experiment loop. Not a scoreboard."
        ),
    }
    for part in FRESH_PARTS:
        value = source.get(part)
        if value is None:
            continue
        typed = schema.read(_SuitePart, value, f"suite.json: {part}", unknown="ignore")
        table = dict(cast(dict[str, object], value))
        table["seed"] = typed.seed + shift
        if typed.file is not None:
            table["file"] = f"{source_dir}/{typed.file}"
        out[part] = table
    return out
