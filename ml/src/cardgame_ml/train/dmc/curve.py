"""The learning curve's measurement: the network, greedy, in seat 0
against a table of one built-in bot, on the same deals every time.

``deals`` hands are played at once, one per environment slot, on the
slots' first hands from a fixed seed, so every checkpoint meets exactly
the same cards, first bidders and bots' choices up to its own: two
points of the curve differ only by the network. The number is points
per seat-hand with a 95% interval, like suite v1's ladder (whose deals
and seat rotation it does not reproduce: a quick, fixed probe, not the
scoreboard).
"""

import math
from dataclasses import dataclass

import numpy as np
import torch
from cardgame_env import Env

from cardgame_ml.models.q import QModel
from cardgame_ml.train.dmc.policy import GREEDY, choose, legal_values


@dataclass(frozen=True)
class Score:
    """Points per seat-hand: mean, 95% half-width, deals."""

    mean: float
    ci95: float
    n: int

    def to_json(self) -> dict[str, float | int]:
        return {"mean": self.mean, "ci95": self.ci95, "n": self.n}


def play(  # noqa: PLR0913
    model: QModel,
    device: torch.device,
    *,
    rules: str,
    opponent: str,
    deals: int,
    seed: int,
    threads: int = 0,
) -> Score:
    """The network in seat 0 against ``opponent`` in every other seat."""
    env = Env(
        num_envs=deals, seed=seed, rules=rules, controlled=[0], bots=[opponent], threads=threads
    )
    payoff = np.zeros(deals, np.float64)
    finished = np.zeros(deals, np.bool_)
    step = env.reset()
    rng = np.random.default_rng(0)
    model.eval()
    while not finished.all():
        actions, values = legal_values(model, step, device, groups=8)
        step = env.step(choose(actions, values, GREEDY, rng))
        ended = step["done"] & ~finished
        payoff[ended] = step["reward"][ended, 0]
        finished |= step["done"]
    se = payoff.std(ddof=1) / math.sqrt(deals) if deals > 1 else math.inf
    return Score(float(payoff.mean()), 1.96 * float(se), deals)
