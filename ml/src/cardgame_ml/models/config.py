"""Model sizes, kept apart from the networks so configs read without PyTorch."""

from dataclasses import dataclass


@dataclass(frozen=True)
class TrunkConfig:
    """The token trunk's size (``models.trunk``). Input and output sizes
    come from the spec."""

    width: int = 128
    heads: int = 4
    layers: int = 4
    feedforward: int = 256
    dropout: float = 0.0

    def __post_init__(self) -> None:
        if self.width % self.heads:
            raise ValueError(f"width {self.width} is not a multiple of heads {self.heads}")


BeliefConfig = TrunkConfig
"""The belief model is the trunk plus a head per card: its size is the trunk's."""


@dataclass(frozen=True)
class QConfig:
    """The Q network's size: the trunk, then an MLP of ``head_layers``
    hidden layers of width ``head_width`` over the state and each action."""

    trunk: TrunkConfig
    head_width: int = 256
    head_layers: int = 2

    def __post_init__(self) -> None:
        if self.head_layers < 1:
            raise ValueError("the head needs at least one hidden layer")
