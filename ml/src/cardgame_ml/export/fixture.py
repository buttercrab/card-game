"""The parity fixture both test suites share: a tiny, untrained belief
model as a model directory, in ``crates/infer/tests/tiny``:

    uv run python -m cardgame_ml.export.fixture

Rust's test runs ``model.onnx`` on ``parity.json``'s observations; the
Python test runs ``model.pt``. Both must give the logits recorded there,
so PyTorch and the Rust runtime agree with each other through it. Rewrite
it when the model's architecture changes.
"""

# PyTorch leaves some of manual_seed's parameters unannotated, which strict
# mode reports.
# pyright: reportUnknownMemberType=false

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from cardgame_env import Env

from cardgame_ml.data.shards import Batch
from cardgame_ml.data.spec import EncodingSpec
from cardgame_ml.export.onnx import write
from cardgame_ml.models.belief import BeliefModel
from cardgame_ml.models.config import BeliefConfig

CONFIG = BeliefConfig(width=16, heads=2, layers=2, feedforward=32, dropout=0.0)
SEED = 7

FIXTURE = Path(__file__).resolve().parents[4] / "crates" / "infer" / "tests" / "tiny"
"""Where the fixture lives in the repository."""


def positions() -> Batch:
    """Six positions from random play over varied rules, at several
    points of the hand: from before anyone acts (no events) to deep in
    the play."""
    env = Env(num_envs=2, seed=SEED, rules="varied", threads=1)
    rng = np.random.default_rng(SEED)
    step = env.reset()
    taken: list[Batch] = []
    for number in range(60):
        if number in (0, 15, 45):
            taken.append({k: np.asarray(v) for k, v in step.items()})
        scores = rng.random(step["legal"].shape)
        scores[~step["legal"]] = -1
        step = env.step(scores.argmax(axis=1))
    return {k: np.concatenate([t[k] for t in taken]) for k in taken[0]}


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m cardgame_ml.export.fixture")
    parser.add_argument("--out", type=Path, default=FIXTURE)
    args = parser.parse_args()
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    batch = positions()
    spec = EncodingSpec.from_json(Env(num_envs=1, seed=0).spec())
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


if __name__ == "__main__":
    main()
