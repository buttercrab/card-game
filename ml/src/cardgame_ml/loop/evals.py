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
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from cardgame_ml._json import as_object

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

    def to_json(self) -> dict[str, float | int]:
        return {"mean": self.mean, "ci95": self.ci95, "n": self.n}

    @classmethod
    def from_json(cls, value: object) -> "Estimate | None":
        if value is None:
            return None
        obj = as_object(value, "estimate")
        return cls(
            float(cast(float, obj["mean"])),
            float(cast(float, obj["ci95"])),
            int(cast(int, obj["n"])),
        )

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

    bot: Estimate | None
    baseline: Estimate | None
    diff: Estimate | None

    @classmethod
    def from_json(cls, value: object) -> "Summary | None":
        if value is None:
            return None
        obj = as_object(value, "summary")
        return cls(
            Estimate.from_json(obj.get("bot")),
            Estimate.from_json(obj.get("baseline")),
            Estimate.from_json(obj.get("diff")),
        )


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
        obj = as_object(data, where)
        if obj.get("schema") != SCHEMA:
            raise ValueError(f"{where}: not {SCHEMA}")
        suite = as_object(obj["suite"], "suite")
        run = as_object(obj["run"], "run")

        def part(name: str, key: str) -> Summary | None:
            value = obj.get(name)
            return None if value is None else Summary.from_json(as_object(value, name)[key])

        median = p99 = None
        if obj.get("cost") is not None:
            think = as_object(as_object(obj["cost"], "cost")["bot"], "cost.bot")
            median = float(cast(float, think["median_ms"]))
            p99 = float(cast(float, think["p99_ms"]))
        puzzles = None
        if obj.get("puzzles") is not None:
            p = as_object(obj["puzzles"], "puzzles")
            puzzles = (int(cast(int, p["passed"])), int(cast(int, p["scored"])))
        baseline = obj.get("baseline")
        return cls(
            suite=str(suite["name"]),
            quick=bool(suite["quick"]),
            bot=str(obj["bot"]),
            baseline=None if baseline is None else str(baseline),
            ladder=part("ladder", "rating"),
            presets=part("presets", "average"),
            heldout=part("heldout", "average"),
            think_median_ms=median,
            think_p99_ms=p99,
            puzzles=puzzles,
            wall_seconds=float(cast(float, run["wall_seconds"])),
            threads=int(cast(int, run["threads"])),
            matches=_pooled(obj.get("matches")),
        )


def _pooled(value: object) -> Summary | None:
    """Tables pooled by deals: the mean of every deal, and the interval of
    independent tables combined (``sqrt(sum (ci_i n_i)^2) / sum n_i``)."""
    if not isinstance(value, list) or not value:
        return None
    tables = [as_object(t, "match") for t in cast(list[object], value)]

    def pool(key: str) -> Estimate | None:
        found = [Estimate.from_json(t.get(key)) for t in tables]
        estimates = [e for e in found if e is not None]
        if len(estimates) != len(tables):
            return None
        n = sum(e.n for e in estimates)
        mean = sum(e.mean * e.n for e in estimates) / n
        ci = math.sqrt(sum((e.ci95 * e.n) ** 2 for e in estimates)) / n
        return Estimate(mean, ci, n)

    return Summary(pool("bot"), pool("baseline"), pool("diff"))


@dataclass(frozen=True)
class Comparison:
    """A run against its parent on the primary metric."""

    metric: str
    diff: Estimate
    paired: bool
    """Measured deal by deal (the parent's bot as the suite's baseline),
    rather than as the difference of two separate measurements."""

    @property
    def beats(self) -> bool:
        """Better beyond the 95% interval."""
        return self.diff.low > 0

    @property
    def loses(self) -> bool:
        return self.diff.high < 0

    def to_json(self) -> dict[str, object]:
        return {
            "metric": self.metric,
            "diff": self.diff.to_json(),
            "paired": self.paired,
            "beats": self.beats,
        }


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
    return Comparison(metric, mine.bot.minus(theirs.bot), paired=False)


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


def fresh_suite(source: dict[str, object], name: str, k: int, source_dir: str) -> dict[str, object]:
    """Suite ``source`` (a parsed ``suite.json``) on fresh deals: every
    table's seed moved by ``k`` strides, files named relative to the new
    suite's folder (``source_dir``: the source's folder from there), only
    the parts whose deals move."""
    if k < 1:
        raise ValueError("a fresh-deal suite moves the seeds: k >= 1")
    shift = k * FRESH_SEED_STRIDE
    out: dict[str, object] = {
        "suite": name,
        "game": source["game"],
        "about": (
            f"Suite {source['suite']} on fresh deals (seeds + {shift}), for confirming a win; "
            "generated by the experiment loop. Not a scoreboard."
        ),
    }
    for part in FRESH_PARTS:
        value = source.get(part)
        if value is None:
            continue
        table = dict(as_object(value, part))
        table["seed"] = int(cast(int, table["seed"])) + shift
        if "file" in table:
            table["file"] = f"{source_dir}/{table['file']}"
        out[part] = table
    return out
