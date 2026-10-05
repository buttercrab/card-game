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
from dataclasses import dataclass
from pathlib import Path

from cardgame_ml._json import JsonError, as_object, get_int, get_str, get_str_tuple


@dataclass(frozen=True)
class EncodingSpec:
    version: str
    global_features: tuple[str, ...]
    cards: tuple[str, ...]
    card_features: tuple[str, ...]
    max_events: int
    event_features: tuple[str, ...]
    actions: tuple[str, ...]
    belief_classes: tuple[str, ...]

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
        obj = as_object(value, "spec")
        spec = cls(
            version=get_str(obj, "version"),
            global_features=get_str_tuple(obj, "global"),
            cards=get_str_tuple(obj, "cards"),
            card_features=get_str_tuple(obj, "card_features"),
            max_events=get_int(obj, "max_events"),
            event_features=get_str_tuple(obj, "event_features"),
            actions=get_str_tuple(obj, "actions"),
            belief_classes=get_str_tuple(obj, "belief_classes"),
        )
        if spec.max_events < 0:
            raise JsonError("max_events: must not be negative")
        return spec

    def to_json(self) -> dict[str, object]:
        """The JSON form Rust's ``engine::Spec`` reads."""
        return {
            "version": self.version,
            "global": list(self.global_features),
            "cards": list(self.cards),
            "card_features": list(self.card_features),
            "max_events": self.max_events,
            "event_features": list(self.event_features),
            "actions": list(self.actions),
            "belief_classes": list(self.belief_classes),
        }

    @classmethod
    def load(cls, path: Path) -> "EncodingSpec":
        return cls.from_json(json.loads(path.read_text(encoding="utf-8")))
