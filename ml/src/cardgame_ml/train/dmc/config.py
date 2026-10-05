"""The typed config of a Deep Monte Carlo run, read from a TOML file
committed with its experiment (``train.config`` reads it: every field
spelled out, nothing left to a default)."""

import dataclasses
import tomllib
from pathlib import Path

from cardgame_ml.models.config import QConfig
from cardgame_ml.train.config import ConfigError, from_mapping


@dataclasses.dataclass(frozen=True)
class ActorConfig:
    """The processes that play. Each holds a CPU copy of the network, its
    own environments and its own seed stream. Every seat of every
    training hand is the current network: pure self-play, no built-in
    bot ever sits at a training table (they are for evaluation only)."""

    processes: int
    envs: int
    """Self-play hands at once per actor, every seat played by the network."""
    threads: int
    """PyTorch threads per actor."""
    env_threads: int
    """Rust threads per actor's environments."""
    groups: int
    """Each step's decisions go through the network in this many batches
    of about one sequence length (less padding)."""
    epsilon: float
    """Share of decisions taken uniformly among the legal actions."""
    temperature: float
    """The others are drawn with probability proportional to ``exp(Q /
    temperature)``, in the network's units (0: the best). Uniform
    exploration alone mostly tries absurd actions (a random bid is
    usually far too high), so the network learns that bidding loses and
    passes for ever; the softmax keeps trying the actions it values
    nearly as much as its best."""
    refresh_every: int
    """Learner steps between publishing weights to the actors."""
    chunk: int
    """Finished decisions per message to the learner."""


@dataclasses.dataclass(frozen=True)
class BufferConfig:
    """The learner's replay buffer: the latest decisions, sampled uniformly."""

    capacity: int
    min_fill: int
    """Decisions in the buffer before the first step."""
    window: int
    """Batches drawn at once and cut by sequence length (less padding)."""
    replay_ratio: float
    """At most this many decisions trained on (counted with repeats) per
    decision played: the learner waits for the actors beyond it."""


@dataclasses.dataclass(frozen=True)
class DmcOptimConfig:
    """AdamW at a constant rate after a linear warm-up."""

    batch_size: int
    lr: float
    weight_decay: float
    warmup_steps: int
    grad_clip: float


@dataclasses.dataclass(frozen=True)
class CurveConfig:
    """The learning curve: the network (greedy, in seat 0) against each
    opponent (four of it, or as many as the rules seat) on the same
    ``deals`` hands every time."""

    every_hands: int
    deals: int
    rules: str
    opponents: tuple[str, ...]
    seed: int
    threads: int
    """Rust threads for the opponents' play."""


@dataclasses.dataclass(frozen=True)
class BudgetConfig:
    """The run stops at whichever comes first (and resumes up to it)."""

    hands: int
    hours: float


@dataclasses.dataclass(frozen=True)
class DmcConfig:
    """One Deep Monte Carlo run."""

    name: str
    """The run's directory under ``models/`` and its manifest's name."""
    seed: int
    """Seeds the weights and each actor's environments and exploration."""
    device: str
    """The learner's: ``auto`` (MPS when there is one), ``mps``, ``cpu``, ``cuda``."""
    rules: str
    """Where training hands' rules come from, as ``cardgame_env.Env`` reads it."""
    exclude: str
    """Rule sets never played in training (the evals' held-out list), a
    path relative to the repository. Required."""
    reward_scale: float
    """Targets are a hand's payoff in points times this."""
    checkpoint_minutes: float
    log_seconds: float
    budget: BudgetConfig
    model: QConfig
    actors: ActorConfig
    buffer: BufferConfig
    optim: DmcOptimConfig
    curve: CurveConfig

    def __post_init__(self) -> None:
        if not self.exclude:
            raise ValueError("exclude: training must name the held-out rule sets it never plays")
        if self.actors.processes < 1 or self.actors.envs < 1:
            raise ValueError("actors: at least one process with one environment")
        if self.buffer.min_fill > self.buffer.capacity:
            raise ValueError("buffer: min_fill exceeds capacity")
        if not 0 <= self.actors.epsilon <= 1:
            raise ValueError("actors: epsilon is a probability")
        if self.actors.temperature < 0:
            raise ValueError("actors: the temperature is not negative")

    @classmethod
    def load(cls, path: Path) -> "DmcConfig":
        with path.open("rb") as f:
            data = tomllib.load(f)
        return from_mapping(cls, data, str(path))


__all__ = [
    "ActorConfig",
    "BudgetConfig",
    "BufferConfig",
    "ConfigError",
    "CurveConfig",
    "DmcConfig",
    "DmcOptimConfig",
]
