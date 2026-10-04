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

The model's inputs are an ``Env`` step's arrays, so a batch from
``data.shards`` feeds it directly once moved to tensors, and the same
graph exports to ONNX for ``crates/infer``.
"""

import math

import torch
from torch import Tensor, nn
from torch.nn import functional

from cardgame_ml.data.spec import EncodingSpec
from cardgame_ml.models.config import BeliefConfig

INPUTS = ("global", "cards", "events", "event_cards", "events_len")
"""What the model reads from a batch, in ``forward``'s order."""

__all__ = ["INPUTS", "BeliefConfig", "BeliefModel"]


class Block(nn.Module):
    """A pre-norm transformer layer: self-attention, then a feed-forward."""

    def __init__(self, config: BeliefConfig) -> None:
        super().__init__()
        self.heads = config.heads
        self.scale = 1 / math.sqrt(config.width // config.heads)
        self.norm1 = nn.LayerNorm(config.width)
        self.qkv = nn.Linear(config.width, 3 * config.width)
        self.out = nn.Linear(config.width, config.width)
        self.norm2 = nn.LayerNorm(config.width)
        self.ff = nn.Sequential(
            nn.Linear(config.width, config.feedforward),
            nn.GELU(),
            nn.Linear(config.feedforward, config.width),
        )
        self.drop = nn.Dropout(config.dropout)

    def forward(self, x: Tensor, bias: Tensor) -> Tensor:
        """``x`` is ``[batch, tokens, width]``; ``bias`` is ``[batch, 1, 1,
        tokens]``, added to the attention scores (``-inf`` hides a token)."""
        batch, tokens, width = x.shape
        q, k, v = (
            self.qkv(self.norm1(x))
            .reshape(batch, tokens, 3, self.heads, width // self.heads)
            .permute(2, 0, 3, 1, 4)
            .unbind(0)
        )
        # Written out rather than scaled_dot_product_attention: it exports
        # to plain ONNX operators that every runtime has.
        scores = q @ k.transpose(-1, -2) * self.scale + bias
        attended = (scores.softmax(-1) @ v).transpose(1, 2).reshape(batch, tokens, width)
        x = x + self.drop(self.out(attended))
        return x + self.drop(self.ff(self.norm2(x)))


class BeliefModel(nn.Module):
    """Observation in, ``[batch, cards, classes]`` logits out."""

    def __init__(self, spec: EncodingSpec, config: BeliefConfig) -> None:
        super().__init__()
        self.spec = spec
        self.config = config
        width = config.width
        slots = len(spec.cards)
        self.slots = slots
        self.global_in = nn.Linear(len(spec.global_features), width)
        self.card_in = nn.Linear(len(spec.card_features), width)
        self.event_in = nn.Linear(len(spec.event_features), width)
        # One identity per card slot, shared by its row and the events about
        # it; the last stands for "no card".
        self.identity = nn.Embedding(slots + 1, width)
        self.position = nn.Embedding(max(spec.max_events, 1), width)
        # Which kind of token: global, card, event.
        self.kind = nn.Parameter(torch.zeros(3, width))
        self.blocks = nn.ModuleList(Block(config) for _ in range(config.layers))
        self.norm = nn.LayerNorm(width)
        self.head = nn.Linear(width, len(spec.belief_classes))
        self.apply(_init)
        # Start at the count baseline: all logits zero.
        nn.init.zeros_(self.head.weight)

    def forward(
        self,
        global_: Tensor,
        cards: Tensor,
        events: Tensor,
        event_cards: Tensor,
        events_len: Tensor,
    ) -> Tensor:
        """``global_`` ``[B, G]``, ``cards`` ``[B, S, F]``, ``events`` ``[B,
        E, H]`` and ``event_cards`` ``[B, E]`` for any ``E`` up to the
        spec's ``max_events`` (rows past ``events_len`` are ignored, so a
        batch may be cut to its longest sequence), ``events_len`` ``[B]``.
        Returns logits ``[B, S, classes]``."""
        batch, length = events.shape[0], events.shape[1]
        slots = torch.arange(self.slots, device=cards.device)
        order = torch.arange(length, device=events.device)
        # Events about no card (-1) take the last identity.
        about = torch.where(event_cards < 0, self.slots, event_cards).long()
        tokens = torch.cat(
            (
                (self.global_in(global_) + self.kind[0]).unsqueeze(1),
                self.card_in(cards) + self.identity(slots) + self.kind[1],
                self.event_in(events) + self.identity(about) + self.position(order) + self.kind[2],
            ),
            dim=1,
        )
        # Padding events are hidden from every token. Global and cards are
        # always there, so no row of scores is all -inf.
        padding = order.unsqueeze(0) >= events_len.unsqueeze(1)
        fixed = torch.zeros(batch, 1 + self.slots, dtype=torch.bool, device=events.device)
        hidden = torch.cat((fixed, padding), dim=1)
        bias = torch.zeros(hidden.shape, device=events.device).masked_fill(hidden, -math.inf)
        x = tokens
        for block in self.blocks:
            x = block(x, bias[:, None, None, :])
        return self.head(self.norm(x[:, 1 : 1 + self.slots]))

    def parameter_count(self) -> int:
        return sum(p.numel() for p in self.parameters())


def _init(module: nn.Module) -> None:
    if isinstance(module, nn.Linear):
        nn.init.normal_(module.weight, std=0.02)
        nn.init.zeros_(module.bias)
    elif isinstance(module, nn.Embedding):
        nn.init.normal_(module.weight, std=0.02)


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
