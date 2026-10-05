"""What each action of a spec is about, read from the action names alone.

A Q network scores actions, and an action's index says little by itself:
"play ♠A" and "discard ♠A" are about the same card, "bid ♠13" and
"bid ♠14" differ by one. The spec names every action (``EncodingSpec.
actions``) and every card slot (``EncodingSpec.cards``), so this reads,
for any game's spec, without knowing its rules:

- the **card** an action names: a word of its name that is a card slot's
  name ("play ♠A" names ♠A), so a network can look at that card's token;
- its **template**: the name with the card replaced by ``<card>`` and a
  number by ``#`` ("play <card>", "bid ♠#"), shared by the actions that do
  the same thing to different cards or numbers;
- its **number**, scaled to ``[0, 1]`` by the largest in the spec.

A word ending in digits, such as ``♠2``, could be either a card or a
number. It is a number when another action of the same template has a
word there that is not a card (``bid ♠1``, ``call seat+0``): so "bid ♠2"
is a bid of two, while "play ♠2" plays the two of spades.
"""

import re
from collections import defaultdict
from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from cardgame_ml.data.spec import EncodingSpec

CARD = "<card>"
NUMBER = "#"
_NUMBERED = re.compile(r"^(.*?)(\d+)$")


@dataclass(frozen=True)
class ActionFeatures:
    """Per action index of a spec: ``card`` (a card slot, or -1),
    ``template`` (an index into ``templates``) and ``number`` (0 where
    there is none)."""

    card: NDArray[np.int64]
    template: NDArray[np.int64]
    number: NDArray[np.float32]
    templates: tuple[str, ...]

    @classmethod
    def from_spec(cls, spec: EncodingSpec) -> "ActionFeatures":
        words = [name.split(" ") for name in spec.actions]
        cards = {name: slot for slot, name in enumerate(spec.cards)}
        numeric = _numeric_families(words, set(cards))
        card = np.full(len(words), -1, np.int64)
        number = np.zeros(len(words), np.float32)
        names: list[str] = []
        for i, name in enumerate(words):
            out = list(name)
            for j, word in enumerate(name):
                found = _NUMBERED.match(word)
                if found and _family(name, j, found.group(1)) in numeric:
                    out[j] = found.group(1) + NUMBER
                    number[i] = float(found.group(2))
                elif word in cards and card[i] < 0:
                    out[j] = CARD
                    card[i] = cards[word]
            names.append(" ".join(out))
        templates = tuple(dict.fromkeys(names))
        index = {t: k for k, t in enumerate(templates)}
        top = float(number.max()) if len(number) else 0.0
        return cls(
            card=card,
            template=np.array([index[t] for t in names], np.int64),
            number=number / top if top > 0 else number,
            templates=templates,
        )


def _family(words: list[str], at: int, prefix: str) -> str:
    """The template an action would have with word ``at`` read as a number."""
    return " ".join([*words[:at], prefix + NUMBER, *words[at + 1 :]])


def _numeric_families(names: list[list[str]], cards: set[str]) -> set[str]:
    """Templates whose numbered word is, for at least one action, no card:
    there the word is a number, for every action of the template."""
    members: defaultdict[str, list[str]] = defaultdict(list)
    for words in names:
        for j, word in enumerate(words):
            if found := _NUMBERED.match(word):
                members[_family(words, j, found.group(1))].append(word)
    return {family for family, seen in members.items() if any(w not in cards for w in seen)}
