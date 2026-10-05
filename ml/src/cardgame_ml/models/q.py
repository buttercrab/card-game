"""The Q network: how many points each action is worth to the seat taking
it, ``Q(observation, action)``, for Deep Monte Carlo (``train.dmc``).

The observation goes through the token trunk (``models.trunk``) once; the
global token after the last layer is the state. Each action to score is
an embedding of its index, plus the embedding of its template and its
number (``models.actions``: what it does, read from the spec's names),
plus the trunk's token of the card it names, if any: so "play ♠A" sees
everything the trunk worked out about ♠A in this position (whether it is
playable, would win the trick, is the mighty...). Then the action looks
over every card token (attention, the action as the query): "bid ♦14"
names no card, but can learn to weigh the diamonds in hand. An MLP over
the state and the action gives the value.

Only the actions asked for are scored, ``[batch, k]`` indices at a time:
the legal ones when playing, the one taken when training, so the trunk
runs once per observation whatever ``k`` is. Nothing here knows a game's
rules: action features come from the spec's names, everything else from
the observation.
"""

import math

import torch
from torch import Tensor, nn

from cardgame_ml.data.spec import EncodingSpec
from cardgame_ml.models.actions import ActionFeatures
from cardgame_ml.models.config import QConfig
from cardgame_ml.models.trunk import INPUTS as TRUNK_INPUTS
from cardgame_ml.models.trunk import TokenTrunk, init_weights

INPUTS = (*TRUNK_INPUTS, "actions")
"""What the Q network reads, in ``forward``'s order: the trunk's inputs
and ``actions`` ``[batch, k]``, the action indices to score."""

__all__ = ["INPUTS", "QConfig", "QModel"]


class QModel(TokenTrunk):
    """Observation and action indices in, ``[batch, k]`` values out."""

    action_card: Tensor
    action_template: Tensor
    action_number: Tensor

    def __init__(self, spec: EncodingSpec, config: QConfig) -> None:
        super().__init__(spec, config.trunk)
        self.config = config
        width = config.trunk.width
        features = ActionFeatures.from_spec(spec)
        # Derived from the spec, so not part of the weights.
        self.register_buffer("action_card", torch.as_tensor(features.card), persistent=False)
        self.register_buffer(
            "action_template", torch.as_tensor(features.template), persistent=False
        )
        self.register_buffer(
            "action_number", torch.as_tensor(features.number).unsqueeze(-1), persistent=False
        )
        templates = len(features.templates)
        self.action_id = nn.Embedding(len(spec.actions), width)
        self.template = nn.Embedding(templates, width)
        # Per template, the direction its number moves the action along.
        self.number = nn.Embedding(templates, width)
        self.named_card = nn.Linear(width, width)
        self.heads = config.trunk.heads
        self.look_query = nn.Linear(width, width)
        self.look_keys = nn.Linear(width, 2 * width)
        self.look_out = nn.Linear(width, width)
        layers: list[nn.Module] = [nn.Linear(2 * width, config.head_width), nn.GELU()]
        for _ in range(config.head_layers - 1):
            layers += [nn.Linear(config.head_width, config.head_width), nn.GELU()]
        layers.append(nn.Linear(config.head_width, 1))
        self.head = nn.Sequential(*layers)
        self.apply(init_weights)

    # The inputs are positional: ONNX export names them in this order.
    def forward(  # noqa: PLR0913, PLR0917
        self,
        global_: Tensor,
        cards: Tensor,
        events: Tensor,
        event_cards: Tensor,
        events_len: Tensor,
        actions: Tensor,
    ) -> Tensor:
        """The trunk's inputs (``TokenTrunk.tokens``) and ``actions`` ``[B,
        K]``, valid action indices (pad with any legal one and ignore its
        value). Returns ``[B, K]`` values, in the units of the targets
        trained on."""
        x = self.tokens(global_, cards, events, event_cards, events_len)
        state, card_tokens = x[:, 0], x[:, 1 : 1 + self.slots]
        actions = actions.long()
        k = actions.shape[1]
        slot = self.action_card[actions]
        named = card_tokens.gather(
            1, slot.clamp(min=0).unsqueeze(-1).expand(-1, -1, card_tokens.shape[-1])
        )
        named = self.named_card(named) * (slot >= 0).unsqueeze(-1).to(named.dtype)
        template = self.action_template[actions]
        action = (
            self.action_id(actions)
            + self.template(template)
            + self.number(template) * self.action_number[actions]
            + named
        )
        action = action + self.look_out(self._look(action, card_tokens))
        both = torch.cat((state.unsqueeze(1).expand(-1, k, -1), action), dim=-1)
        return self.head(both).squeeze(-1)

    def _look(self, action: Tensor, card_tokens: Tensor) -> Tensor:
        """Multi-head attention of each action ``[B, K, W]`` over the card
        tokens ``[B, S, W]``: ``[B, K, W]``. Written out in plain operators,
        as the trunk's, for export."""
        batch, k, width = action.shape
        slots, per = card_tokens.shape[1], width // self.heads
        q = self.look_query(action).reshape(batch, k, self.heads, per).transpose(1, 2)
        keys, values = (
            self.look_keys(card_tokens)
            .reshape(batch, slots, 2, self.heads, per)
            .permute(2, 0, 3, 1, 4)
            .unbind(0)
        )
        scores = (q @ keys.transpose(-1, -2)) * (1 / math.sqrt(per))
        return (scores.softmax(-1) @ values).transpose(1, 2).reshape(batch, k, width)
