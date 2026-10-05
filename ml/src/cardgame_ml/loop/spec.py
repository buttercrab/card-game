"""An experiment spec: one TOML file in ``research/loop/queue/``.

A spec says what is tried and why (``hypothesis``), how (``method``, a
runner in ``methods``, with its ``[config]`` and ``[options]``),
what it may spend (``[budget]``, ``[resources]``), how it is scored
(``[evals]``, within the policy's protocol) and what it is compared with
(``parent``). ``research/loop/README.md`` has a full example.

``parse_spec`` checks the shape (every key known and of its type,
``schema.read``) and what a spec says on its own (ids, seeds, budgets);
``validate.check`` checks it against the policy and its method.
"""

import dataclasses
import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

from cardgame_ml import schema
from cardgame_ml.schema import SchemaError, named

ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$")
RUN_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,62}[a-z0-9](-s-?\d{1,18})?$")
"""A run's id: a spec's, or a replicate's (``<id>-s<seed>``)."""
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


class SpecError(SchemaError):
    """A spec is malformed or not allowed."""


@dataclass(frozen=True, kw_only=True)
class Budget:
    wall_hours: float
    """The whole run, evals included: past it the runner stops the run."""
    train_hours: float = 0.0
    """Training kinds: the training's own stop (0 for eval-only kinds)."""
    hands: int = 0
    """Training kinds: self-play hands at most (0 for eval-only kinds)."""
    gpu: bool

    def __post_init__(self) -> None:
        if not self.wall_hours > 0 or self.train_hours < 0 or self.hands < 0:
            raise ValueError("wall_hours above 0, the others not negative")
        if self.train_hours >= self.wall_hours:
            raise ValueError("train_hours must leave time for evals in wall_hours")


@dataclass(frozen=True, kw_only=True)
class Resources:
    host: str
    """Where the main step runs (training: ``mac``)."""
    threads: int
    """Threads the main step holds."""
    eval_host: str
    eval_threads: int

    def __post_init__(self) -> None:
        if self.threads < 1 or self.eval_threads < 1:
            raise ValueError("at least one thread")


@dataclass(frozen=True, kw_only=True)
class Evals:
    curve: bool
    """Training kinds: record the protocol's learning curve."""
    suite: str
    parts: tuple[str, ...]
    baselines: tuple[str, ...]
    """One suite run per baseline, deal by deal: a bot name, or
    ``parent`` for the parent's bot."""
    cost: bool
    """Also measure think time (the ``cost`` part) on the policy's
    ``cost_host``."""

    def __post_init__(self) -> None:
        bad_parts = sorted(set(self.parts) - set(PARTS))
        if bad_parts:
            raise ValueError(f"unknown parts {', '.join(bad_parts)}")
        if "cost" in self.parts:
            raise ValueError("think time is `cost = true` (the cost host), not a part")


@dataclass(frozen=True)
class ConfigSource:
    """A training config: a committed ``base`` file with ``set`` overrides
    (dotted keys, each already in the base), or an ``inline`` table."""

    base: str | None = None
    overrides: dict[str, object] = field(default_factory=dict[str, object], metadata=named("set"))
    inline: dict[str, object] | None = None

    def __post_init__(self) -> None:
        if self.base is not None and self.inline is not None:
            raise ValueError("a base file or an inline table, not both")
        if self.overrides and self.base is None:
            raise ValueError("set overrides a base file")


@dataclass(frozen=True, kw_only=True)
class Spec:
    id: str
    hypothesis: str
    method: str
    tags: tuple[str, ...]
    parent: str | None = None
    """A loop run's id, ``bot:<spec>``, or none."""
    priority: int = 0
    """Higher runs first; ties by file name."""
    seeds: tuple[int, ...]
    """Training seeds; several make one run each (``<id>-s<seed>``)."""
    after: tuple[str, ...] = ()
    """Loop runs that must have finished first."""
    requires: tuple[str, ...] = ()
    """Paths in the artifact store that must exist first (a model a
    run outside the loop is still training, say)."""
    budget: Budget
    resources: Resources
    evals: Evals
    config: ConfigSource = field(default_factory=ConfigSource)
    options: dict[str, object] = field(default_factory=dict[str, object])
    """The ``[options]`` table: the method's own options."""
    confirms: str | None = None
    """Set by the runner on the confirmation of a candidate."""

    def __post_init__(self) -> None:
        if not ID.match(self.id):
            raise ValueError(f"id {self.id!r}: lowercase letters, digits and dashes, 3-64")
        object.__setattr__(self, "hypothesis", self.hypothesis.strip())
        if len(self.hypothesis) < 20:  # noqa: PLR2004
            raise ValueError("hypothesis: say what is expected and why (a sentence)")
        if set(self.tags) - TAGS or not self.tags:
            raise ValueError(f"tags: at least one of {', '.join(sorted(TAGS))}")
        if not self.seeds or len(set(self.seeds)) != len(self.seeds):
            raise ValueError("seeds: one or more distinct integers")
        parent = self.parent
        if parent is not None and not parent.startswith(PARENT_BOT) and not ID.match(parent):
            raise ValueError("parent: a loop run's id or bot:<spec>")
        for ref in (*self.after, *([self.confirms] if self.confirms is not None else [])):
            if not RUN_ID.match(ref):
                raise ValueError(f"after/confirms: {ref!r} is not a loop run's id")

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
        data = schema.table(self)
        config = schema.table(self.config)
        data["config"] = {k: v for k, v in config.items() if v is not None and v != {}}
        return {k: v for k, v in data.items() if v is not None}


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
        return schema.read(Spec, data, where)
    except SchemaError as e:
        raise SpecError(str(e)) from e
