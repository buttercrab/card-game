"""Replays dmc-v2's actor loop (training exploration, exploring starts) with
the final weights, single process, and measures the bidding data the
learner saw: bidding decisions per hand, the share in deals later thrown in,
and the fit of Q(chosen) on each part. Writes per-decision rows to JSONL."""

import json
import sys
from pathlib import Path

import numpy as np
import torch
from cardgame_env import Env

from cardgame_ml.data.spec import EncodingSpec
from cardgame_ml.train.dmc import learner
from cardgame_ml.train.dmc.policy import (
    Exploration,
    ExploringStarts,
    bid_mask,
    choose,
    legal_values,
)
from cardgame_ml.train.metrics import phases

HANDS = int(sys.argv[1]) if len(sys.argv) > 1 else 600
OUT = Path(sys.argv[2])
run = Path.home() / "card-game-artifacts/models/dmc-v2"
weights = Path.home() / "card-game-artifacts/assess-2026-10-06/dmc-v2-final-weights.pt"
torch.set_num_threads(3)
model = learner.load(run, weights)
spec: EncodingSpec = model.spec
names = {n: i for i, n in enumerate(spec.global_features)}
cfg = json.loads((run / "config.json").read_text())["config"]
a = cfg["actors"]
env = Env(
    num_envs=64,
    seed=777,
    rules="gshs/5",
    exclude=str(Path.cwd().parent / cfg["exclude"]),
    reward_scale=cfg["reward_scale"],
    threads=1,
)
rng = np.random.default_rng(5)
exploration = Exploration(a["epsilon"], a["temperature"], a["runner_up"])
bids = bid_mask(spec.actions)
starts = ExploringStarts(64, bids, a["declare"], a["declare_temperature"])
step = env.reset()
slots: list[list[dict]] = [[] for _ in range(64)]
finished = 0
out = OUT.open("w")
while finished < HANDS:
    actions, values = legal_values(model, step, torch.device("cpu"), 4)
    chosen = choose(actions, values, exploration, rng)
    before = chosen.copy()
    starts.apply(step, actions, values, chosen, rng)
    ph = phases(spec, np.asarray(step["global"], np.float32))
    for i in range(64):
        k = int(np.flatnonzero(actions[i] == chosen[i])[0])
        greedy = int(actions[i, int(values[i].argmax())])
        slots[i].append(
            {
                "seat": int(step["seat"][i]),
                "phase": int(ph[i]),
                "action": spec.actions[int(chosen[i])],
                "q": float(values[i, k]) / 0.025,
                "qmax": float(values[i].max()) / 0.025,
                "forced": bool(before[i] != chosen[i]),
                "explored": bool(chosen[i] != greedy),
                "events": int(step["events_len"][i]),
                "redeals": float(step["global"][i, names["redeals"]]),
            }
        )
    step = env.step(chosen)
    starts.finish(step["done"])
    for i in np.flatnonzero(step["done"]).tolist():
        rewards = step["reward"][i] / 0.025
        rows = slots[i]
        # Deal number: a bidding decision whose event count drops below the
        # last one's starts a new deal.
        deal, last_events = 0, -1
        for r in rows:
            if r["phase"] == 0 and r["events"] < last_events:
                deal += 1
            last_events = r["events"] if r["phase"] == 0 else 10**6
            r["deal"] = deal
        for r in rows:
            r["thrown_in"] = r["deal"] < deal
            r["payoff"] = float(rewards[r["seat"]])
            r["hand"] = finished
            out.write(json.dumps(r) + "\n")
        slots[i] = []
        finished += 1
print("hands", finished)
