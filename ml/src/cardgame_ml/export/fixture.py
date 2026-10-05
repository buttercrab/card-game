"""The parity fixtures both test suites share: a tiny, untrained belief
model and Q network as model directories, in ``crates/infer/tests/tiny``
and ``tiny-q``:

    uv run python -m cardgame_ml.export.fixture

Rust's tests run ``model.onnx`` on ``parity.json``'s observations; the
Python tests run ``model.pt``. Both must give the outputs recorded there,
so PyTorch and the Rust runtime agree with each other through it. Rewrite
it when the model's architecture or the encoding changes
(``scripts/regenerate-fixtures.sh`` rewrites every fixture). The positions
come from rule sets frozen in ``crates/env/tests/parity-rules.json``, so a
change to the presets leaves the fixture as it is.
"""

# PyTorch leaves some of manual_seed's parameters unannotated, which strict
# mode reports.
# pyright: reportUnknownMemberType=false

import argparse
import dataclasses
import json
from pathlib import Path

import numpy as np
import torch
from cardgame_env import Env

from cardgame_ml.data.shards import Batch
from cardgame_ml.data.spec import EncodingSpec
from cardgame_ml.export.onnx import write, write_q
from cardgame_ml.models.belief import BeliefModel
from cardgame_ml.models.config import BeliefConfig, QConfig, TrunkConfig
from cardgame_ml.models.q import QModel

CONFIG = BeliefConfig(width=16, heads=2, layers=2, feedforward=32, dropout=0.0)
Q_CONFIG = QConfig(TrunkConfig(width=16, heads=2, layers=2, feedforward=32), 32, 2)
Q_REWARD_SCALE = 0.025
SEED = 7

ROOT = Path(__file__).resolve().parents[4]
FIXTURE = ROOT / "crates" / "infer" / "tests" / "tiny"
"""Where the belief fixture lives in the repository."""
Q_FIXTURE = ROOT / "crates" / "infer" / "tests" / "tiny-q"
"""Where the Q network's lives."""
HELD_OUT = ROOT / "research" / "evals" / "v1" / "heldout-rules.json"
RULES = ROOT / "crates" / "env" / "tests" / "parity-rules.json"
"""The frozen pool of rule sets the positions are played under."""


def positions(seed: int = SEED, num_envs: int = 2, at: tuple[int, ...] = (0, 15, 45)) -> Batch:
    """Positions from random play over the frozen rule sets (never a
    held-out one), the steps ``at`` of ``num_envs`` hands at once: by
    default six, from before anyone acts (no events) to deep in the play."""
    rules = RULES.read_text(encoding="utf-8")
    env = Env(num_envs=num_envs, seed=seed, rules=rules, exclude=HELD_OUT, threads=1)
    rng = np.random.default_rng(seed)
    step = env.reset()
    taken: list[Batch] = []
    for number in range(max(at) + 1):
        if number in at:
            taken.append({k: np.asarray(v) for k, v in step.items()})
        scores = rng.random(step["legal"].shape)
        scores[~step["legal"]] = -1
        step = env.step(scores.argmax(axis=1))
    return {k: np.concatenate([t[k] for t in taken]) for k in taken[0]}


def belief_fixture(out: Path, batch: Batch, spec: EncodingSpec) -> None:
    torch.manual_seed(SEED)
    model = BeliefModel(spec, CONFIG)
    # A fresh head is all zeros; parity wants logits that differ.
    torch.nn.init.normal_(model.head.weight, std=0.5)
    model.eval()
    torch.save(model.state_dict(), out / "model.pt")
    described = {
        "config": {"model": CONFIG.__dict__},
        "encoding": spec.version,
        "spec": spec.to_json(),
        "parameters": model.parameter_count(),
    }
    (out / "config.json").write_text(json.dumps(described, indent=2) + "\n", encoding="utf-8")
    write(model, batch, batch, out)


def q_fixture(out: Path, batch: Batch, spec: EncodingSpec) -> None:
    torch.manual_seed(SEED)
    model = QModel(spec, Q_CONFIG)
    # Fresh output weights are tiny; parity wants values that differ.
    for layer in model.head:
        if isinstance(layer, torch.nn.Linear):
            torch.nn.init.normal_(layer.weight, std=0.3)
    model.eval()
    torch.save(model.state_dict(), out / "model.pt")
    described = {
        "config": {"model": dataclasses.asdict(Q_CONFIG)},
        "encoding": spec.version,
        "spec": spec.to_json(),
        "parameters": model.parameter_count(),
        "reward_scale": Q_REWARD_SCALE,
    }
    (out / "config.json").write_text(json.dumps(described, indent=2) + "\n", encoding="utf-8")
    write_q(model, batch, batch, Q_REWARD_SCALE, out)


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m cardgame_ml.export.fixture")
    parser.add_argument("--out", type=Path, default=FIXTURE)
    parser.add_argument("--q-out", type=Path, default=Q_FIXTURE)
    args = parser.parse_args()
    batch = positions()
    spec = EncodingSpec.from_json(Env(num_envs=1, seed=0).spec())
    for out, write_fixture in ((args.out, belief_fixture), (args.q_out, q_fixture)):
        out.mkdir(parents=True, exist_ok=True)
        write_fixture(out, batch, spec)


if __name__ == "__main__":
    main()
