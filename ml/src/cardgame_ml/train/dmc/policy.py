"""Playing with a Q network: score the legal actions of a batch of
decisions, pick the best (or, with probability ε, a random legal one)."""

from collections.abc import Mapping
from typing import Any

import numpy as np
import torch
from numpy.typing import NDArray

from cardgame_ml.models.q import QModel


def legal_actions(legal: NDArray[np.bool_]) -> tuple[NDArray[np.int64], NDArray[np.bool_]]:
    """``[B, K]`` legal action indices in ascending order (``K`` the most
    any decision has), rows padded with their first legal action, and
    ``[B, K]`` which entries are real."""
    counts = legal.sum(axis=1)
    k = max(int(counts.max()), 1) if len(counts) else 1
    # A stable sort of "not legal" puts each row's legal indices first, in order.
    order = np.argsort(~legal, axis=1, kind="stable")[:, :k].astype(np.int64)
    valid = np.arange(k)[None, :] < counts[:, None]
    return np.where(valid, order, order[:, :1]), valid


type Observations = Mapping[str, Any]
"""A step's arrays (``cardgame_env.Step``) or a batch with the same keys."""

OBSERVATION_KEYS = ("global", "cards", "events", "event_cards", "events_len", "legal")
"""What a network reads of a step to play."""


def observation_tensors(step: Observations, device: torch.device) -> tuple[torch.Tensor, ...]:
    """The trunk's inputs from a step's arrays, events cut to the longest
    sequence in it."""
    events_len = np.asarray(step["events_len"], np.int64)
    longest = max(int(events_len.max()), 1)
    return (
        torch.as_tensor(np.asarray(step["global"], np.float32), device=device),
        torch.as_tensor(np.asarray(step["cards"], np.float32), device=device),
        torch.as_tensor(np.asarray(step["events"], np.float32)[:, :longest], device=device),
        torch.as_tensor(np.asarray(step["event_cards"], np.int64)[:, :longest], device=device),
        torch.as_tensor(events_len, device=device),
    )


def legal_values(
    model: QModel, step: Observations, device: torch.device, groups: int = 1
) -> tuple[NDArray[np.int64], NDArray[np.float32]]:
    """For each decision of a step: its legal actions ``[B, K]`` (as
    :func:`legal_actions`) and their values ``[B, K]``, ``-inf`` at
    padding. With ``groups`` > 1 the decisions run in that many batches
    of about one sequence length each (fewer padding events to attend
    over; the values are the same)."""
    actions, valid = legal_actions(np.asarray(step["legal"], np.bool_))
    values = np.full(actions.shape, -np.inf, np.float32)
    order = np.argsort(np.asarray(step["events_len"]), kind="stable")
    for rows in np.array_split(order, min(groups, len(order))):
        if not len(rows):
            continue
        part = {key: np.asarray(step[key])[rows] for key in OBSERVATION_KEYS}
        k = max(int(valid[rows].sum(axis=1).max()), 1)
        with torch.inference_mode():
            q = model(
                *observation_tensors(part, device),
                torch.as_tensor(actions[rows, :k], device=device),
            )
        values[rows, :k] = q.float().cpu().numpy()
    return actions, np.where(valid, values, -np.inf).astype(np.float32)


def choose(
    actions: NDArray[np.int64],
    values: NDArray[np.float32],
    epsilon: float,
    rng: np.random.Generator,
    temperature: float = 0.0,
) -> NDArray[np.int64]:
    """One action index per decision: the best by ``values`` or, with a
    ``temperature``, one drawn with probability proportional to
    ``exp(value / temperature)``; and with probability ``epsilon``
    instead one of the legal actions uniformly."""
    rows = np.arange(len(actions))
    if temperature > 0:
        # Gumbel-max: the argmax of values / T plus Gumbel noise is a
        # softmax draw.
        noise = rng.gumbel(size=values.shape).astype(np.float32)
        best = actions[rows, (values / np.float32(temperature) + noise).argmax(axis=1)]
    else:
        best = actions[rows, values.argmax(axis=1)]
    if epsilon <= 0:
        return best
    legal = np.isfinite(values)
    # A uniform legal pick: the legal entry with the largest random key.
    keys = np.where(legal, rng.random(values.shape), -1.0)
    random = actions[rows, keys.argmax(axis=1)]
    return np.where(rng.random(len(actions)) < epsilon, random, best)
