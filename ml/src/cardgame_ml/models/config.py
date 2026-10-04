"""Model sizes, kept apart from the networks so configs read without PyTorch."""

from dataclasses import dataclass


@dataclass(frozen=True)
class BeliefConfig:
    """The network's size. Input and output sizes come from the spec."""

    width: int = 128
    heads: int = 4
    layers: int = 4
    feedforward: int = 256
    dropout: float = 0.0

    def __post_init__(self) -> None:
        if self.width % self.heads:
            raise ValueError(f"width {self.width} is not a multiple of heads {self.heads}")
