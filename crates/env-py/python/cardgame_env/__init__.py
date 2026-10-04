"""The card-game RL environment and self-play generator, from Rust (``crates/env``).

``Env`` steps many hands of a game at once. The caller plays the
``controlled`` seats (all of them for self-play); bots from ``bots`` play
the rest. Each step takes one action per hand, as an index into the
spec's actions, and returns the next decision of a controlled seat as one
array per field (``Step``), with the shapes ``EncodingSpec.shapes`` gives
plus the batch dimension first.

A hand that ends starts the next at once. The step that ends it has
``done`` set and every seat's payoff in ``reward`` (the game's points
times ``reward_scale``, indexed by absolute seat; zero on every other
step), and its observation is already from the next hand.

Every hand is reproducible from its seed and the caller's actions, and
hand ``k`` of slot ``i`` depends only on ``seed`` and ``i``, not on the
batch size or thread count.

Rules (``rules``): a preset id (``"gshs"``), at another table size
(``"gshs/4"``), ``"pool:default,gshs"``, ``"varied"`` (fresh draws of the
optional rules around every preset, 3 to 7 players) or ``"varied:gshs"``,
or rule sets as JSON. Rule sets in ``exclude`` (a JSON array, such as the
evals' held-out list) are never played.

Bots: ``"초보"``/``"easy"``, ``"보통"``/``"normal"``, ``"고수"``/``"hard"``
(``"hard:50"`` with 50 samples), or any ``sim`` spec (``"random"``,
``"simple"``, ``"search:50:1:0"``).
"""

import json
from collections.abc import Mapping, Sequence
from os import PathLike
from typing import TypedDict, cast

import numpy as np
from numpy.typing import ArrayLike, NDArray

from cardgame_env import _core

__all__ = ["Env", "Step", "selfplay"]

Step = TypedDict(
    "Step",
    {
        # [n, global], [n, cards, card_features], [n, max_events, event_features]
        "global": NDArray[np.float32],
        "cards": NDArray[np.float32],
        "events": NDArray[np.float32],
        # [n, max_events]: the card slot of each event, or -1.
        "event_cards": NDArray[np.int32],
        # [n]: how many event rows are real.
        "events_len": NDArray[np.int32],
        # [n, actions]
        "legal": NDArray[np.bool_],
        # [n]: the absolute seat to act.
        "seat": NDArray[np.int32],
        # [n, max_seats]
        "reward": NDArray[np.float32],
        # [n]
        "done": NDArray[np.bool_],
    },
)
"""One step for every hand. Arrays are fresh each step; keeping them is safe."""


class Env:
    """A batch of hands; see the module documentation."""

    # Every setting is a keyword with a default, as gym-style envs take them.
    def __init__(  # noqa: PLR0913
        self,
        game: str = "mighty",
        *,
        num_envs: int,
        seed: int,
        rules: str = "varied",
        exclude: str | PathLike[str] | None = None,
        controlled: Sequence[int] | None = None,
        bots: Sequence[str] | Mapping[str, float] = (),
        reward_scale: float = 1.0,
        threads: int = 0,
    ) -> None:
        """``controlled=None`` plays every seat; ``bots`` maps specs to
        weights, or lists them equally likely; ``threads=0`` uses every core.
        """
        weighted = (
            list(bots.items()) if isinstance(bots, Mapping) else [(spec, 1.0) for spec in bots]
        )
        self._env = _core.Env(
            game,
            num_envs,
            seed,
            rules,
            None if exclude is None else str(exclude),
            None if controlled is None else list(controlled),
            weighted,
            reward_scale,
            threads,
        )

    @property
    def num_envs(self) -> int:
        return self._env.num_envs

    @property
    def max_seats(self) -> int:
        """The width of ``reward``."""
        return self._env.max_seats

    def spec(self) -> dict[str, object]:
        """The encoding spec as JSON; ``EncodingSpec.from_json`` reads it."""
        return cast(dict[str, object], json.loads(self._env.spec()))

    def reset(self, seed: int | None = None) -> Step:
        """Starts every hand afresh: from ``seed`` when given, else each
        slot's next hand (its first, before any step)."""
        return cast(Step, self._env.reset(seed))

    def step(self, actions: ArrayLike) -> Step:
        """Plays one action index per hand. Raises ``ValueError``, changing
        nothing, if any is not legal."""
        return cast(Step, self._env.step(np.ascontiguousarray(actions, dtype=np.int64)))

    def belief_targets(self) -> NDArray[np.int32]:
        """``[n, cards]``: where each card the seat to act cannot see
        really is (an index into the spec's belief classes), -1 where it
        knows. Training labels only, never an input."""
        return self._env.belief_targets()

    def rules(self) -> list[dict[str, object]]:
        """Each hand's rule set."""
        return [cast(dict[str, object], json.loads(r)) for r in self._env.rules()]

    def hand_seeds(self) -> list[int]:
        """Each hand's seed."""
        return self._env.hand_seeds()


def selfplay(
    config: str,
    out: str | PathLike[str],
    *,
    root: str | PathLike[str] = ".",
    threads: int = 0,
) -> dict[str, object]:
    """Writes a self-play dataset into ``out`` (which must not exist) from
    a TOML config, the same as the ``selfplay`` binary but without the
    manifest; ``root`` is where the config's ``exclude`` path is read
    from. Returns the run's statistics."""
    stats = _core.selfplay(config, str(root), str(out), threads)
    return cast(dict[str, object], json.loads(stats))
