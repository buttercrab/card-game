"""What a network reads: one observation's arrays, and the tensors made
from them.

An ``Env`` step, a batch cut from a self-play shard and a batch from the
DMC replay buffer all hold the same observation arrays under the same
names (``data.spec`` gives their shapes); they differ in what else they
carry (labels, targets) and in the compact types some are stored in.
``observation`` picks the observation out of any of them, and
``to_tensors`` turns it into the trunk's inputs, in its order and types,
events cut to the longest sequence present: the one place the learner,
the policy, the belief batches and the export make them.
"""

from collections.abc import Mapping
from typing import Any, NotRequired, TypedDict, cast

import numpy as np
import torch
from numpy.typing import NDArray
from torch import Tensor

from cardgame_ml.data.shards import Batch
from cardgame_ml.models.trunk import INPUTS

__all__ = ["Batch", "Observation", "observation", "to_tensors"]

Observation = TypedDict(
    "Observation",
    {
        "global": NDArray[Any],
        "cards": NDArray[Any],
        "events": NDArray[Any],
        "event_cards": NDArray[Any],
        "events_len": NDArray[Any],
        "legal": NotRequired[NDArray[Any]],
    },
)
"""A batch of observations: ``global`` ``[B, G]``, ``cards`` ``[B, S,
F]``, ``events`` ``[B, E, H]`` and ``event_cards`` ``[B, E]`` (``E`` up
to the spec's ``max_events``; rows past ``events_len`` are ignored),
``events_len`` ``[B]``, and ``legal`` ``[B, A]`` where actions are
chosen."""


def observation(arrays: Mapping[str, object]) -> Observation:
    """The observation in ``arrays`` (a step, or a batch with more keys)."""
    missing = [k for k in INPUTS if k not in arrays]
    if missing:
        raise KeyError(f"not an observation: no {', '.join(missing)}")
    picked = {k: np.asarray(arrays[k]) for k in (*INPUTS, "legal") if k in arrays}
    return cast(Observation, picked)


def to_tensors(obs: Observation, device: torch.device) -> tuple[Tensor, ...]:
    """The trunk's inputs (``models.trunk.INPUTS``) on ``device``: float32
    features, int64 indices and lengths, events cut to the longest
    sequence in the batch. Types are widened on the device (half the
    bytes to move for float16 buffers)."""
    events_len = np.asarray(obs["events_len"])
    longest = max(int(events_len.max()), 1) if len(events_len) else 1

    def tensor(array: NDArray[Any]) -> Tensor:
        return torch.as_tensor(np.ascontiguousarray(array), device=device)

    return (
        tensor(obs["global"]).float(),
        tensor(obs["cards"]).float(),
        tensor(obs["events"][:, :longest]).float(),
        tensor(obs["event_cards"][:, :longest]).long(),
        tensor(events_len).long(),
    )
