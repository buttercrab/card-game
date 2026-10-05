"""Typed training configs, read from TOML files committed with an
experiment (``research/experiments/<folder>/config.toml``).

Every field is spelled out in the file: reading (``schema.read``, with
defaults off) fails on a missing or unknown key and on a value of the
wrong type, so a config never leans on a default that could change under
it.
"""

import dataclasses
import tomllib
from collections.abc import Mapping
from pathlib import Path

from cardgame_ml import schema
from cardgame_ml.models.config import BeliefConfig
from cardgame_ml.schema import SchemaError

ConfigError = SchemaError
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


def from_mapping[T](cls: type[T], data: Mapping[str, object], where: str) -> T:
    """Builds the training config ``cls`` from ``data``: every field present
    (no defaults) and of its declared type (``schema.read``)."""
    return schema.read(cls, data, where, defaults=False)
