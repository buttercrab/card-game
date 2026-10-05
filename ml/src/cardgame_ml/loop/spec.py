"""An experiment spec: one TOML file in ``research/loop/queue/``.

A spec says what is tried and why (``hypothesis``), how (``method``, a
runner in ``methods``, with its ``[config]`` and ``[options]``),
what it may spend (``[budget]``, ``[resources]``), how it is scored
(``[evals]``, within the policy's protocol) and what it is compared with
(``parent``). ``research/loop/README.md`` has a full example.

``parse_spec`` checks the shape (every key known and of its type);
``validate.check`` checks it against the policy and its method.
"""

import dataclasses
import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

from cardgame_ml.loop.fields import FieldError, Table

ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$")
TAGS = frozenset(
    {
        "baseline",
        "method",
        "hybrid",
        "ablation",
        "hparam",
        "scaling",
        "search",
        "eval",
        "confirmation",
        "replicate",
    }
)
PARTS = ("ladder", "presets", "heldout", "matches", "cost", "puzzles")
PARENT_BOT = "bot:"
"""``parent = "bot:<spec>"`` compares with a bot by name, not a loop run."""


class SpecError(FieldError):
    """A spec is malformed or not allowed."""


@dataclass(frozen=True)
class Budget:
    wall_hours: float
    """The whole run, evals included: past it the runner stops the run."""
    train_hours: float
    """Training kinds: the training's own stop (0 for eval-only kinds)."""
    hands: int
    """Training kinds: self-play hands at most (0 for eval-only kinds)."""
    gpu: bool


@dataclass(frozen=True)
class Resources:
    host: str
    """Where the main step runs (training: ``mac``)."""
    threads: int
    """Threads the main step holds."""
    eval_host: str
    eval_threads: int


@dataclass(frozen=True)
class Evals:
    curve: bool
    """Training kinds: record the protocol's learning curve."""
    suite: str
    parts: tuple[str, ...]
    baselines: tuple[str, ...]
    """One suite run per baseline, deal by deal: a bot name, or
    ``parent`` for the parent's bot."""
    cost: bool
    """Also measure think time (the ``cost`` part) on the home server."""


@dataclass(frozen=True)
class ConfigSource:
    """A training config: a committed ``base`` file with ``set`` overrides
    (dotted keys, each already in the base), or an ``inline`` table."""

    base: str | None
    overrides: dict[str, object] = field(default_factory=dict[str, object])
    inline: dict[str, object] | None = None


@dataclass(frozen=True)
class Spec:
    id: str
    hypothesis: str
    method: str
    tags: tuple[str, ...]
    parent: str | None
    """A loop run's id, ``bot:<spec>``, or none."""
    priority: int
    """Higher runs first; ties by file name."""
    seeds: tuple[int, ...]
    """Training seeds; several make one run each (``<id>-s<seed>``)."""
    after: tuple[str, ...]
    """Loop runs that must have finished first."""
    requires: tuple[str, ...]
    """Paths in the artifact store that must exist first (a model a
    run outside the loop is still training, say)."""
    budget: Budget
    resources: Resources
    evals: Evals
    config: ConfigSource
    options: dict[str, object]
    """The ``[options]`` table: the method's own options."""
    confirms: str | None = None
    """Set by the runner on the confirmation of a candidate."""

    @property
    def seed(self) -> int:
        return self.seeds[0]

    def replicates(self) -> list["Spec"]:
        """One spec per seed."""
        if len(self.seeds) == 1:
            return [self]
        return [
            dataclasses.replace(self, id=f"{self.id}-s{seed}", seeds=(seed,)) for seed in self.seeds
        ]

    def parent_bot(self) -> str | None:
        if self.parent and self.parent.startswith(PARENT_BOT):
            return self.parent[len(PARENT_BOT) :]
        return None

    def parent_run(self) -> str | None:
        if self.parent and not self.parent.startswith(PARENT_BOT):
            return self.parent
        return None

    def gpu_hours(self) -> float:
        """The GPU time the spec may take: its training's budget."""
        return self.budget.train_hours if self.budget.gpu else 0.0

    def to_toml(self) -> dict[str, object]:
        """The spec as its file reads (``parse_spec`` gives it back)."""
        config: dict[str, object] = {}
        if self.config.base is not None:
            config["base"] = self.config.base
        if self.config.overrides:
            config["set"] = dict(self.config.overrides)
        if self.config.inline is not None:
            config["inline"] = dict(self.config.inline)
        data: dict[str, object] = {
            "id": self.id,
            "hypothesis": self.hypothesis,
            "method": self.method,
            "tags": list(self.tags),
            "priority": self.priority,
            "seeds": list(self.seeds),
            "after": list(self.after),
            "requires": list(self.requires),
        }
        if self.parent is not None:
            data["parent"] = self.parent
        if self.confirms is not None:
            data["confirms"] = self.confirms
        data |= {
            "budget": dataclasses.asdict(self.budget),
            "resources": dataclasses.asdict(self.resources),
            "evals": {
                "curve": self.evals.curve,
                "suite": self.evals.suite,
                "parts": list(self.evals.parts),
                "baselines": list(self.evals.baselines),
                "cost": self.evals.cost,
            },
            "config": config,
            "options": dict(self.options),
        }
        return data


def load_spec(path: Path) -> Spec:
    try:
        with path.open("rb") as f:
            data = tomllib.load(f)
    except tomllib.TOMLDecodeError as e:
        raise SpecError(f"{path}: not TOML: {e}") from e
    return parse_spec(data, path.name)


def parse_spec(data: dict[str, object], where: str) -> Spec:
    """The spec in ``data`` (a parsed file), its shape checked."""
    try:
        return _parse(data, where)
    except SpecError:
        raise
    except FieldError as e:
        raise SpecError(str(e)) from e


def _parse(data: dict[str, object], where: str) -> Spec:
    t = Table(data, where)
    spec_id = t.text("id")
    if not ID.match(spec_id):
        raise SpecError(f"{where}: id {spec_id!r}: lowercase letters, digits and dashes, 3-64")
    hypothesis = t.text("hypothesis").strip()
    if len(hypothesis) < 20:  # noqa: PLR2004
        raise SpecError(f"{where}: hypothesis: say what is expected and why (a sentence)")
    tags = t.texts("tags")
    unknown = sorted(set(tags) - TAGS)
    if unknown or not tags:
        raise SpecError(f"{where}: tags: at least one of {', '.join(sorted(TAGS))}")
    seeds = t.integers("seeds")
    if not seeds or len(set(seeds)) != len(seeds):
        raise SpecError(f"{where}: seeds: one or more distinct integers")
    b = t.table("budget")
    budget = Budget(
        wall_hours=b.number("wall_hours"),
        train_hours=b.number("train_hours", 0.0),
        hands=b.integer("hands", 0),
        gpu=b.flag("gpu"),
    )
    b.done()
    if not budget.wall_hours > 0 or budget.train_hours < 0 or budget.hands < 0:
        raise SpecError(f"{where}: budget: wall_hours above 0, the others not negative")
    if budget.train_hours >= budget.wall_hours:
        raise SpecError(f"{where}: budget: train_hours must leave time for evals in wall_hours")
    r = t.table("resources")
    resources = Resources(
        host=r.text("host"),
        threads=r.integer("threads"),
        eval_host=r.text("eval_host"),
        eval_threads=r.integer("eval_threads"),
    )
    r.done()
    if resources.threads < 1 or resources.eval_threads < 1:
        raise SpecError(f"{where}: resources: at least one thread")
    e = t.table("evals")
    evals = Evals(
        curve=e.flag("curve"),
        suite=e.text("suite"),
        parts=e.texts("parts"),
        baselines=e.texts("baselines"),
        cost=e.flag("cost"),
    )
    e.done()
    bad_parts = sorted(set(evals.parts) - set(PARTS))
    if bad_parts:
        raise SpecError(f"{where}: evals: unknown parts {', '.join(bad_parts)}")
    if "cost" in evals.parts:
        raise SpecError(f"{where}: evals: think time is `cost = true` (home server), not a part")
    c = t.table("config", required=False)
    base = c.opt_text("base")
    overrides = c.raw_table("set")
    inline = c.raw_table("inline") if "inline" in c.data else None
    c.done()
    if base is not None and inline is not None:
        raise SpecError(f"{where}: config: a base file or an inline table, not both")
    if overrides and base is None:
        raise SpecError(f"{where}: config: set overrides a base file")
    parent = t.opt_text("parent")
    if parent is not None and not parent.startswith(PARENT_BOT) and not ID.match(parent):
        raise SpecError(f"{where}: parent: a loop run's id or bot:<spec>")
    spec = Spec(
        id=spec_id,
        hypothesis=hypothesis,
        method=t.text("method"),
        tags=tags,
        parent=parent,
        priority=t.integer("priority", 0),
        seeds=seeds,
        after=t.texts("after", ()),
        requires=t.texts("requires", ()),
        budget=budget,
        resources=resources,
        evals=evals,
        config=ConfigSource(base, overrides, inline),
        options=t.raw_table("options"),
        confirms=t.opt_text("confirms"),
    )
    t.done()
    return spec
