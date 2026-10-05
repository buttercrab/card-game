"""The token trunk every network here shares: a small transformer over one
observation, generic over the encoding spec.

An observation becomes tokens: one for the global vector, one per card
slot (its row of features plus a learned identity), one per event (its
features, the identity of the card it is about, and its place in the
sequence). Padding events are hidden from attention. The trunk returns
every token after the last layer; a network on top reads the ones it
needs (the belief model a head per card, the Q network the global token
and the cards its actions name).

The inputs are an ``Env`` step's arrays, so a batch from ``data.shards``
or a live step feeds it directly once moved to tensors, and the graph
exports to plain ONNX operators for ``crates/infer``.
"""

import math

import torch
from torch import Tensor, nn
from torch.nn import functional

from cardgame_ml.data.spec import EncodingSpec
from cardgame_ml.models.config import TrunkConfig

INPUTS = ("global", "cards", "events", "event_cards", "events_len")
"""What the trunk reads from a batch, in ``forward``'s order."""


class Block(nn.Module):
    """A pre-norm transformer layer: self-attention, then a feed-forward."""

    def __init__(self, config: TrunkConfig) -> None:
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
        self.fused = True
        """PyTorch's fused attention kernel; :func:`unfused` turns it off for export."""

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
        if self.fused:
            attended = functional.scaled_dot_product_attention(q, k, v, attn_mask=bias)
        else:
            # Written out: it exports to plain ONNX operators that every
            # runtime has. The same numbers, more slowly.
            attended = (q @ k.transpose(-1, -2) * self.scale + bias).softmax(-1) @ v
        attended = attended.transpose(1, 2).reshape(batch, tokens, width)
        x = x + self.drop(self.out(attended))
        return x + self.drop(self.ff(self.norm2(x)))


class TokenTrunk(nn.Module):
    """Observation in, one vector per token out: ``[batch, 1 + cards +
    events, width]``, the global token first, then the card slots in the
    spec's order, then the events. Networks extend it with their heads."""

    def __init__(self, spec: EncodingSpec, config: TrunkConfig) -> None:
        super().__init__()
        self.spec = spec
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

    def tokens(
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
        Returns the normalised tokens ``[B, 1 + S + E, width]``."""
        batch, length = events.shape[0], events.shape[1]
        slots = torch.arange(self.slots, device=cards.device)
        order = torch.arange(length, device=events.device)
        # Events about no card (-1) take the last identity.
        about = torch.where(event_cards < 0, self.slots, event_cards).long()
        x = torch.cat(
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
        for block in self.blocks:
            x = block(x, bias[:, None, None, :])
        return self.norm(x)

    def parameter_count(self) -> int:
        return sum(p.numel() for p in self.parameters())


def init_weights(module: nn.Module) -> None:
    """Small normal weights and zero biases, for ``Module.apply``."""
    if isinstance(module, nn.Linear):
        nn.init.normal_(module.weight, std=0.02)
        nn.init.zeros_(module.bias)
    elif isinstance(module, nn.Embedding):
        nn.init.normal_(module.weight, std=0.02)


def unfused(model: nn.Module) -> nn.Module:
    """``model`` with every attention written out in plain operators, as
    ONNX export needs; returns it."""
    for module in model.modules():
        if isinstance(module, Block):
            module.fused = False
    return model
