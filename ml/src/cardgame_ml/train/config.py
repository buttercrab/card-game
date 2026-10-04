"""Typed training configs, read from TOML files committed with an
experiment (``research/experiments/<folder>/config.toml``).

Every field is spelled out in the file: reading fails on a missing or
unknown key and on a value of the wrong type, so a config never leans on
a default that could change under it.
"""

import dataclasses
import tomllib
import types
import typing
from pathlib import Path
from typing import Any, cast

from cardgame_ml.models.config import BeliefConfig


class ConfigError(ValueError):
    """A config file does not match its schema."""


@dataclasses.dataclass(frozen=True)
class SplitConfig:
    """Which games are held back for validation: each game independently,
    with probability ``val_fraction``, drawn from ``seed``."""

    val_fraction: float
    seed: int


@dataclasses.dataclass(frozen=True)
class OptimConfig:
    """AdamW with a linear warm-up, then cosine decay to ``min_lr_ratio``
    of the peak over the whole run."""

    batch_size: int
    epochs: int
    lr: float
    weight_decay: float
    warmup_steps: int
    min_lr_ratio: float
    grad_clip: float


@dataclasses.dataclass(frozen=True)
class BeliefTrainConfig:
    """One training run of a belief model."""

    name: str
    """The run's name: its directory under ``models/`` in the artifact
    store, and its manifest's name."""
    dataset: str
    """The dataset's directory, relative to the artifact store."""
    seed: int
    """Seeds the weights' initialisation and the order of batches."""
    eval_every: int
    """Steps between evaluations on the validation games (and at the end
    of every epoch)."""
    device: str
    """``auto`` (MPS when there is one, else CPU), ``mps``, ``cpu`` or
    ``cuda``."""
    split: SplitConfig
    model: BeliefConfig
    optim: OptimConfig

    @classmethod
    def load(cls, path: Path) -> "BeliefTrainConfig":
        with path.open("rb") as f:
            return from_mapping(cls, tomllib.load(f), str(path))


def from_mapping[T](cls: type[T], data: dict[str, Any], where: str) -> T:
    """Builds the dataclass ``cls`` from ``data``, every field present and
    of its declared type; nested dataclasses come from tables."""
    hints = typing.get_type_hints(cls)
    fields = [f.name for f in dataclasses.fields(cast(Any, cls))]
    missing = [name for name in fields if name not in data]
    unknown = [key for key in data if key not in fields]
    if missing or unknown:
        problems = [f"missing {', '.join(missing)}"] if missing else []
        problems += [f"unknown {', '.join(unknown)}"] if unknown else []
        raise ConfigError(f"{where}: {'; '.join(problems)}")
    values: dict[str, object] = {}
    for name in fields:
        kind, value, at = hints[name], data[name], f"{where}: {name}"
        if dataclasses.is_dataclass(kind):
            if not isinstance(value, dict):
                raise ConfigError(f"{at}: expected a table")
            values[name] = from_mapping(cast(type, kind), cast(dict[str, Any], value), at)
        else:
            values[name] = _scalar(kind, value, at)
    try:
        return cls(**values)
    except ValueError as e:
        raise ConfigError(f"{where}: {e}") from e


def _scalar(kind: object, value: object, at: str) -> object:
    # TOML integers are fine where a float is wanted; booleans are never numbers.
    if kind is float and isinstance(value, int) and not isinstance(value, bool):
        return float(value)
    if isinstance(kind, type) and kind is not bool and isinstance(value, bool):
        raise ConfigError(f"{at}: expected {kind.__name__}, got a boolean")
    if isinstance(kind, type) and isinstance(value, kind):
        return value
    if isinstance(kind, types.UnionType):
        raise ConfigError(f"{at}: union types are not supported in configs")
    name = getattr(kind, "__name__", str(kind))
    raise ConfigError(f"{at}: expected {name}, got {type(value).__name__}")
