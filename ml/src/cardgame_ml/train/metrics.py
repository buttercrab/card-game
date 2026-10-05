"""Belief metrics: log-loss and accuracy per hidden card, against the
baseline that knows only how many hidden cards each class holds, overall
and by phase of the hand.

Phases are read from the global vector by feature name: the bidding
(``phase=bidding``, and ``phase=misdeal_round`` in ``mighty-1`` and
``mighty-2``, which ``mighty-3`` dropped), the exchange, and the play,
split at half the hand by ``trick`` (the share of tricks done). An
encoding without them reports the overall numbers only.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

from cardgame_ml.data.spec import EncodingSpec

PHASES = ("bidding", "exchange", "early tricks", "late tricks")
"""Phase labels, by the index :func:`phases` gives (-1: none of these)."""

LATE = 0.5
"""The share of tricks done from which the play counts as late."""


def phases(spec: EncodingSpec, global_: NDArray[np.float32]) -> NDArray[np.int64]:
    """The phase of each decision ``[B]``, an index into :data:`PHASES`."""
    names = {name: i for i, name in enumerate(spec.global_features)}
    out = np.full(len(global_), -1, np.int64)
    wanted = ("phase=bidding", "phase=exchange", "phase=play", "trick")
    if not all(name in names for name in wanted):
        return out

    def column(name: str) -> NDArray[np.float32]:
        return global_[:, names[name]]

    bidding = column("phase=bidding") > 0
    if "phase=misdeal_round" in names:
        bidding |= column("phase=misdeal_round") > 0
    out[bidding] = 0
    out[column("phase=exchange") > 0] = 1
    playing = column("phase=play") > 0
    late = column("trick") >= LATE
    out[playing & ~late] = 2
    out[playing & late] = 3
    return out


@dataclass
class Tally:
    """Sums over hidden cards, so batches add up."""

    cards: int = 0
    loss: float = 0.0
    correct: int = 0

    def add(self, losses: NDArray[np.float64], correct: NDArray[np.bool_]) -> None:
        self.cards += len(losses)
        self.loss += float(losses.sum())
        self.correct += int(correct.sum())

    def to_json(self) -> dict[str, float | int]:
        return {
            "cards": self.cards,
            "log_loss": self.loss / self.cards if self.cards else float("nan"),
            "accuracy": self.correct / self.cards if self.cards else float("nan"),
        }


@dataclass
class Report:
    """A model's and the baseline's tallies, overall and by phase."""

    model: dict[str, Tally] = field(default_factory=dict[str, Tally])
    baseline: dict[str, Tally] = field(default_factory=dict[str, Tally])

    def add(
        self,
        phase: NDArray[np.int64],
        owner: NDArray[np.int64],
        model: tuple[NDArray[np.float64], NDArray[np.bool_]],
        baseline: tuple[NDArray[np.float64], NDArray[np.bool_]],
    ) -> None:
        """One batch: per hidden card, the decision it belongs to
        (``owner``, an index into ``phase``) and each predictor's
        negative log-likelihood and whether it was right."""
        card_phase = phase[owner]
        groups: Iterable[tuple[str, NDArray[np.bool_]]] = [
            ("all", np.ones(len(owner), np.bool_)),
            *((name, card_phase == i) for i, name in enumerate(PHASES)),
        ]
        for name, rows in groups:
            if not rows.any():
                continue
            for tallies, (losses, correct) in ((self.model, model), (self.baseline, baseline)):
                tallies.setdefault(name, Tally()).add(losses[rows], correct[rows])

    def to_json(self) -> dict[str, dict[str, Mapping[str, float | int]]]:
        """By group (``all``, then each phase present): the model's and the
        baseline's numbers, and the model's gain in nats per card."""
        out: dict[str, dict[str, Mapping[str, float | int]]] = {}
        for name in ("all", *PHASES):
            if name not in self.model:
                continue
            model, baseline = self.model[name].to_json(), self.baseline[name].to_json()
            out[name] = {
                "model": model,
                "baseline": baseline,
                "gain": {"nats": baseline["log_loss"] - model["log_loss"]},
            }
        return out
