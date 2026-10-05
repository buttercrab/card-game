"""The belief model: where each card the viewer cannot see is.

A small transformer over one observation, generic over the encoding spec:
one token for the global vector, one per card slot (its row of features
plus a learned identity), one per event (its features, the identity of the
card it is about, and its place in the sequence). Every card token ends in
logits over the spec's belief classes.

The logits are relative to what the counts alone say. How many hidden
cards each class holds (each seat's hand size, the cards face down) is
known to every player, and with nothing else known a hidden card is in
a class with probability proportional to its count. The model predicts
how far to move from that: a card is in class ``k`` with probability
proportional to ``count[k] * exp(logit[k])``. So a model that says nothing
(all logits zero) is exactly the count baseline, classes that hold no
hidden card get nothing whatever the logits, and the counts, being
public, leak nothing about where any card is. Training reads them off the
targets (:func:`class_counts`); the search's dealer knows them from the
view, and deals each card to a place with room in proportion to ``room *
exp(logit)``, which is its old uniform deal when the logits are zero.

The trunk (``models.trunk``) is shared with the Q network; its inputs
are an ``Env`` step's arrays, and the graph exports to ONNX for
``crates/infer``.
"""

import torch
from torch import Tensor
from torch.nn import functional

from cardgame_ml.data.spec import EncodingSpec
from cardgame_ml.models.config import BeliefConfig
from cardgame_ml.models.trunk import INPUTS, TokenTrunk, init_weights

__all__ = ["INPUTS", "BeliefConfig", "BeliefModel"]


class BeliefModel(TokenTrunk):
    """Observation in, ``[batch, cards, classes]`` logits out: the token
    trunk (``models.trunk``) with a head on every card token."""

    def __init__(self, spec: EncodingSpec, config: BeliefConfig) -> None:
        super().__init__(spec, config)
        self.config = config
        self.head = torch.nn.Linear(config.width, len(spec.belief_classes))
        self.apply(init_weights)
        # Start at the count baseline: all logits zero.
        torch.nn.init.zeros_(self.head.weight)

    def forward(
        self,
        global_: Tensor,
        cards: Tensor,
        events: Tensor,
        event_cards: Tensor,
        events_len: Tensor,
    ) -> Tensor:
        """The trunk's inputs (``TokenTrunk.tokens``); returns logits ``[B,
        S, classes]``."""
        x = self.tokens(global_, cards, events, event_cards, events_len)
        return self.head(x[:, 1 : 1 + self.slots])


def class_counts(targets: Tensor, classes: int) -> Tensor:
    """``[B, classes]``: how many hidden cards each class holds, from the
    targets ``[B, S]`` (-1 where nothing is hidden). Public information,
    see the module docs."""
    hidden = targets >= 0
    onehot = functional.one_hot(targets.clamp(min=0), classes) * hidden.unsqueeze(-1)
    return onehot.sum(1)


def log_probs(logits: Tensor, counts: Tensor) -> Tensor:
    """Log-probabilities ``[B, S, C]`` of where each card is: in proportion
    to ``counts * exp(logits)``, so ``-inf`` for classes holding no hidden
    card. A position with no hidden card at all gets the logits' own
    softmax instead, so no row is all ``-inf`` (whose gradient is NaN)."""
    counts = counts.float()
    prior = torch.where(counts.sum(-1, keepdim=True) > 0, counts.log(), 0.0)
    return (logits + prior.unsqueeze(1)).log_softmax(-1)


def uniform_log_probs(counts: Tensor, slots: int) -> Tensor:
    """The count baseline: every hidden card in a class with probability
    proportional to how many hidden cards the class holds. ``[B, S, C]``."""
    zeros = torch.zeros(counts.shape[0], slots, counts.shape[1], device=counts.device)
    return log_probs(zeros, counts)


def card_losses(log_p: Tensor, targets: Tensor) -> tuple[Tensor, Tensor]:
    """Per hidden card: the negative log-likelihood of its true class and
    whether the most likely class is it. Both ``[N]`` over the cards with
    ``targets >= 0``, flattened."""
    hidden = targets >= 0
    picked = log_p.gather(-1, targets.clamp(min=0).unsqueeze(-1)).squeeze(-1)
    correct = log_p.argmax(-1) == targets
    return -picked[hidden], correct[hidden]
