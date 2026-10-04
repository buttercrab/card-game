"""Batches for training and evaluation: a split of a dataset by game,
rows grouped by sequence length, tensors made ahead on a thread."""

import queue
import threading
from collections.abc import Callable, Iterator
from dataclasses import dataclass

import numpy as np
import torch
from numpy.typing import NDArray
from torch import Tensor

from cardgame_ml.data.shards import Batch, Dataset, Shard
from cardgame_ml.models.belief import INPUTS
from cardgame_ml.train.config import SplitConfig

ARRAYS = (*INPUTS, "belief", "game")
"""What a belief model trains on: its inputs, the targets, and the game
(for the split)."""

WINDOW = 64
"""Batches cut from one window of rows sorted by length (:func:`batches`)."""

type Rows = Callable[[Shard], NDArray[np.bool_]]
"""Which rows of a shard to use."""


@dataclass(frozen=True)
class Split:
    """Validation games, as a mask over game ids: no game is on both sides."""

    val: NDArray[np.bool_]

    @classmethod
    def draw(cls, games: int, config: SplitConfig) -> "Split":
        rng = np.random.default_rng(config.seed)
        return cls(rng.random(games) < config.val_fraction)

    def train_rows(self, shard: Shard) -> NDArray[np.bool_]:
        return ~self.val_rows(shard)

    def val_rows(self, shard: Shard) -> NDArray[np.bool_]:
        return self.val[shard.arrays["game"].astype(np.int64)]


def every_row(shard: Shard) -> NDArray[np.bool_]:
    return np.ones(len(shard), np.bool_)


def batches(dataset: Dataset, rows: Rows, batch_size: int, seed: int | None) -> Iterator[Batch]:
    """Every row ``rows`` picks, ``batch_size`` at a time, each batch
    holding sequences of about one length: padding costs as much as
    events.

    With a ``seed``, for training: shards and rows in a random order, rows
    sorted by event count within windows of :data:`WINDOW` batches, the
    batches of a window in random order, and each shard's last part batch
    dropped. Without, for evaluation: shard by shard, each shard's rows
    sorted by event count, every row kept."""
    rng = np.random.default_rng(seed)
    order = range(len(dataset.shards)) if seed is None else rng.permutation(len(dataset.shards))
    for i in order:
        shard = dataset.load(int(i), ARRAYS)
        picked = np.flatnonzero(rows(shard))
        lengths = shard.arrays["events_len"]
        if seed is None:
            picked = picked[np.argsort(lengths[picked], kind="stable")]
            for start in range(0, len(picked), batch_size):
                yield shard.take(picked[start : start + batch_size].astype(np.int64))
            continue
        picked = rng.permutation(picked)
        for start in range(0, len(picked), WINDOW * batch_size):
            window = picked[start : start + WINDOW * batch_size]
            window = window[np.argsort(lengths[window], kind="stable")]
            cuts: list[NDArray[np.int64]] = [
                window[j : j + batch_size].astype(np.int64)
                for j in range(0, len(window), batch_size)
            ]
            for k in rng.permutation(len(cuts)):
                cut = cuts[int(k)]
                if len(cut) == batch_size:
                    yield shard.take(cut)


def steps_per_epoch(dataset: Dataset, rows: Rows, batch_size: int) -> int:
    """How many batches :func:`batches` makes with a seed."""
    return sum(
        int(rows(dataset.load(i, ["game"])).sum()) // batch_size for i in range(len(dataset.shards))
    )


def to_inputs(batch: Batch, device: torch.device) -> tuple[Tensor, ...]:
    """A belief model's inputs from a batch, in ``INPUTS`` order, events
    cut to the longest sequence in it."""
    longest = max(int(batch["events_len"].max()), 1)
    arrays = {
        "global": batch["global"],
        "cards": batch["cards"],
        "events": batch["events"][:, :longest],
        "event_cards": batch["event_cards"][:, :longest].astype(np.int64),
        "events_len": batch["events_len"].astype(np.int64),
    }
    return tuple(torch.as_tensor(arrays[k], device=device) for k in INPUTS)


@dataclass(frozen=True)
class _End:
    failure: BaseException | None


def prefetch[T](items: Iterator[T], depth: int = 4) -> Iterator[T]:
    """``items``, made ahead on a thread: the next batches are cut while
    the accelerator works on this one."""
    ready: queue.Queue[T | _End] = queue.Queue(depth)

    def fill() -> None:
        try:
            for item in items:
                ready.put(item)
        except BaseException as e:  # handed over to the consumer
            ready.put(_End(e))
        else:
            ready.put(_End(None))

    threading.Thread(target=fill, daemon=True).start()
    while not isinstance(item := ready.get(), _End):
        yield item
    if item.failure is not None:
        raise item.failure
