"""Actors: processes that play self-play hands with a CPU copy of the
network and send every finished decision to the learner, labelled with
the Monte Carlo return (the acting seat's payoff for the hand, scaled).

Every seat of every hand is the current network, exploring: a draw
by the softmax of its values at a small temperature, and with a small
probability a uniformly random legal action. An actor
reloads the weights whenever the learner has published newer ones, and
each draws its hands from its own seed, so actors never play the same
hands.
"""

# PyTorch leaves a few parameters unannotated (load_state_dict's, for
# one), which strict mode reports.
# pyright: reportUnknownMemberType=false

import queue
import time
from dataclasses import dataclass, field
from multiprocessing.synchronize import Event, Lock
from typing import Any

import numpy as np
import torch
from cardgame_env import Env, Step
from numpy.typing import NDArray

from cardgame_ml.data.spec import EncodingSpec
from cardgame_ml.models.q import QModel
from cardgame_ml.train.dmc.buffer import Decisions
from cardgame_ml.train.dmc.config import DmcConfig
from cardgame_ml.train.dmc.policy import choose, legal_values


@dataclass
class _Slot:
    """One environment slot's decisions in the hand under way."""

    seats: list[int] = field(default_factory=list[int])
    global_: list[NDArray[np.float32]] = field(default_factory=list[NDArray[np.float32]])
    cards: list[NDArray[np.float16]] = field(default_factory=list[NDArray[np.float16]])
    events: list[NDArray[np.float16]] = field(default_factory=list[NDArray[np.float16]])
    event_cards: list[NDArray[np.int16]] = field(default_factory=list[NDArray[np.int16]])
    actions: list[int] = field(default_factory=list[int])


class Hands:
    """Keeps each slot's decisions until its hand ends, then labels every
    one with the payoff of the seat that took it."""

    def __init__(self, num_envs: int) -> None:
        self.slots = [_Slot() for _ in range(num_envs)]

    def record(self, step: Step, actions: NDArray[np.int64]) -> None:
        """The decisions of ``step``, taking ``actions``."""
        cards = step["cards"].astype(np.float16)
        for i, slot in enumerate(self.slots):
            length = int(step["events_len"][i])
            slot.seats.append(int(step["seat"][i]))
            slot.global_.append(step["global"][i].copy())
            slot.cards.append(cards[i])
            slot.events.append(step["events"][i, :length].astype(np.float16))
            slot.event_cards.append(step["event_cards"][i, :length].astype(np.int16))
            slot.actions.append(int(actions[i]))

    def finish(self, step: Step) -> tuple[Decisions | None, int]:
        """After a step: the decisions of every hand it ended, with their
        targets (``step``'s rewards), and how many hands that was."""
        done = np.flatnonzero(step["done"])
        parts: list[Decisions] = []
        for i in done.tolist():
            slot = self.slots[i]
            rewards = step["reward"][i]
            parts.append(
                Decisions(
                    global_=np.stack(slot.global_),
                    cards=np.stack(slot.cards),
                    events=np.concatenate(slot.events),
                    event_cards=np.concatenate(slot.event_cards),
                    events_len=np.array([len(e) for e in slot.events], np.int32),
                    action=np.array(slot.actions, np.int64),
                    target=rewards[np.array(slot.seats, np.int64)].astype(np.float32),
                )
            )
            self.slots[i] = _Slot()
        return (Decisions.concat(parts) if parts else None), len(parts)


@dataclass(frozen=True)
class Report:
    """What an actor sends: finished decisions and how it spent its time
    since its last report."""

    actor: int
    decisions: Decisions
    hands: int
    steps: int
    model_seconds: float
    env_seconds: float
    cpu_seconds: float
    wall_seconds: float
    version: int
    """The weights it played with last."""


# A process entry point: everything it needs, passed once at spawn.
def run(  # noqa: PLR0913, PLR0917
    index: int,
    config: DmcConfig,
    spec_json: dict[str, object],
    exclude: str,
    shared: dict[str, torch.Tensor],
    version: Any,  # a multiprocessing Value("q")
    lock: Lock,
    out: "queue.Queue[Report]",
    stop: Event,
    seed: int,
) -> None:
    """An actor's life: play and report until ``stop`` is set. The
    entry point of an actor process."""
    a = config.actors
    torch.set_num_threads(a.threads)
    spec = EncodingSpec.from_json(spec_json)
    model = QModel(spec, config.model).eval()
    seen = -1
    env = Env(
        num_envs=a.envs,
        seed=seed,
        rules=config.rules,
        exclude=exclude,
        reward_scale=config.reward_scale,
        threads=a.env_threads,
    )
    rng = np.random.default_rng(seed)
    hands = Hands(a.envs)
    device = torch.device("cpu")
    step = env.reset()
    pending: list[Decisions] = []
    count = finished = steps = 0
    model_s = env_s = 0.0
    wall, cpu = time.monotonic(), time.process_time()
    while not stop.is_set():
        if version.value != seen:
            with lock:
                model.load_state_dict(shared)
                seen = version.value
        started = time.monotonic()
        actions, values = legal_values(model, step, device, a.groups)
        chosen = choose(actions, values, a.epsilon, rng, a.temperature)
        hands.record(step, chosen)
        stepped = time.monotonic()
        step = env.step(chosen)
        model_s += stepped - started
        env_s += time.monotonic() - stepped
        steps += 1
        decisions, ended = hands.finish(step)
        finished += ended
        if decisions is not None:
            pending.append(decisions)
            count += len(decisions)
        if count < a.chunk:
            continue
        now, now_cpu = time.monotonic(), time.process_time()
        report = Report(
            actor=index,
            decisions=Decisions.concat(pending),
            hands=finished,
            steps=steps,
            model_seconds=model_s,
            env_seconds=env_s,
            cpu_seconds=now_cpu - cpu,
            wall_seconds=now - wall,
            version=seen,
        )
        while not stop.is_set():
            try:
                out.put(report, timeout=1.0)
                break
            except queue.Full:
                continue
        pending, count, finished, steps = [], 0, 0, 0
        model_s = env_s = 0.0
        wall, cpu = now, now_cpu
