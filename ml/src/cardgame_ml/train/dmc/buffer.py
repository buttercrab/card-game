"""Decisions on their way from the actors to the learner.

Actors send :class:`Decisions`: finished hands' decisions, each with the
action taken and its target (the acting seat's payoff for the hand),
events stored ragged. The learner keeps the latest in a
:class:`ReplayBuffer` of fixed capacity and samples batches uniformly.

Card rows and events are kept as float16: they are flags and small
fractions, and half the memory doubles the decisions the buffer holds.
"""

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from cardgame_ml.data.spec import EncodingSpec

type Batch = dict[str, NDArray[np.generic]]
"""Arrays by name, batch first."""


@dataclass(frozen=True)
class Decisions:
    """Finished decisions, ``n`` of them: what one message carries."""

    global_: NDArray[np.float32]
    """``[n, global]``"""
    cards: NDArray[np.float16]
    """``[n, cards, card_features]``"""
    events: NDArray[np.float16]
    """``[sum(events_len), event_features]``: each decision's real rows, in order."""
    event_cards: NDArray[np.int16]
    """``[sum(events_len)]``"""
    events_len: NDArray[np.int32]
    action: NDArray[np.int64]
    target: NDArray[np.float32]

    def __len__(self) -> int:
        return len(self.action)

    @classmethod
    def concat(cls, parts: list["Decisions"]) -> "Decisions":
        return cls(
            global_=np.concatenate([p.global_ for p in parts]),
            cards=np.concatenate([p.cards for p in parts]),
            events=np.concatenate([p.events for p in parts]),
            event_cards=np.concatenate([p.event_cards for p in parts]),
            events_len=np.concatenate([p.events_len for p in parts]),
            action=np.concatenate([p.action for p in parts]),
            target=np.concatenate([p.target for p in parts]),
        )


class ReplayBuffer:
    """The latest ``capacity`` decisions, oldest overwritten first."""

    def __init__(self, spec: EncodingSpec, capacity: int) -> None:
        shapes = spec.shapes
        self.capacity = capacity
        self.size = 0
        self.added = 0
        self.global_ = np.zeros((capacity, *shapes["global"]), np.float32)
        self.cards = np.zeros((capacity, *shapes["cards"]), np.float16)
        self.events = np.zeros((capacity, *shapes["events"]), np.float16)
        self.event_cards = np.full((capacity, *shapes["event_cards"]), -1, np.int16)
        self.events_len = np.zeros(capacity, np.int32)
        self.action = np.zeros(capacity, np.int64)
        self.target = np.zeros(capacity, np.float32)

    def add(self, decisions: Decisions) -> None:
        starts = np.concatenate(([0], np.cumsum(decisions.events_len)))
        rows = (np.arange(len(decisions)) + self.added) % self.capacity
        for i, row in enumerate(rows.tolist()):
            length = int(decisions.events_len[i])
            span = slice(int(starts[i]), int(starts[i]) + length)
            self.events[row, :length] = decisions.events[span]
            self.events[row, length:] = 0
            self.event_cards[row, :length] = decisions.event_cards[span]
            self.event_cards[row, length:] = -1
        self.global_[rows] = decisions.global_
        self.cards[rows] = decisions.cards
        self.events_len[rows] = decisions.events_len
        self.action[rows] = decisions.action
        self.target[rows] = decisions.target
        self.added += len(decisions)
        self.size = min(self.size + len(decisions), self.capacity)

    def sample(self, count: int, rng: np.random.Generator, batches: int = 1) -> list[Batch]:
        """``batches`` batches of ``count`` decisions drawn uniformly (with
        replacement), events cut to the longest in each. The draws are
        sorted by sequence length before they are cut into batches, so a
        batch pads little; the batches come back in random order."""
        rows = rng.integers(0, self.size, count * batches)
        rows = rows[np.argsort(self.events_len[rows], kind="stable")]
        cuts = [rows[i * count : (i + 1) * count] for i in range(batches)]
        return [self._take(cuts[int(i)]) for i in rng.permutation(batches)]

    def _take(self, rows: NDArray[np.int64]) -> Batch:
        longest = max(int(self.events_len[rows].max()), 1)
        return {
            "global": self.global_[rows],
            "cards": self.cards[rows],
            "events": self.events[rows, :longest],
            "event_cards": self.event_cards[rows, :longest],
            "events_len": self.events_len[rows],
            "action": self.action[rows],
            "target": self.target[rows],
        }
