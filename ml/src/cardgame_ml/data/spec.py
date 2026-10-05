"""The layout of a game's observations, as its Rust ``engine::Encode`` reports it.

A spec names every number a model sees. Observations are flat arrays; the
spec gives their shapes:

- ``global``: ``[len(global_features)]``, the rules and public state.
- ``cards``: ``[len(cards), len(card_features)]``, one row per card slot.
- ``events``: ``[max_events, len(event_features)]``, oldest first, zero-padded.
- ``event_cards``: ``[max_events]``, the card slot of each event or -1.
- ``legal``: ``[len(actions)]``, the legal-action mask.

Belief targets are ``[len(cards)]`` indices into ``belief_classes``, -1 where
the viewer already knows.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path

from cardgame_ml import schema
from cardgame_ml.schema import named


@dataclass(frozen=True)
class EncodingSpec:
    version: str
    global_features: tuple[str, ...] = field(metadata=named("global"))
    cards: tuple[str, ...]
    card_features: tuple[str, ...]
    max_events: int
    event_features: tuple[str, ...]
    actions: tuple[str, ...]
    belief_classes: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.max_events < 0:
            raise ValueError("max_events: must not be negative")

    @property
    def shapes(self) -> dict[str, tuple[int, ...]]:
        """The shape of each array of one observation, by name."""
        return {
            "global": (len(self.global_features),),
            "cards": (len(self.cards), len(self.card_features)),
            "events": (self.max_events, len(self.event_features)),
            "event_cards": (self.max_events,),
            "legal": (len(self.actions),),
        }

    @classmethod
    def from_json(cls, value: object) -> "EncodingSpec":
        """Reads the JSON form of Rust's ``engine::Spec``."""
        return schema.read(cls, value, "spec", defaults=False)

    def to_json(self) -> dict[str, object]:
        """The JSON form Rust's ``engine::Spec`` reads."""
        return schema.table(self)

    @classmethod
    def load(cls, path: Path) -> "EncodingSpec":
        return cls.from_json(json.loads(path.read_text(encoding="utf-8")))
