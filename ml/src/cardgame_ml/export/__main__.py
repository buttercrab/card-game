"""Exports a trained model to ONNX, with its parity check:

    uv run python -m cardgame_ml.export --run belief-v1
    uv run python -m cardgame_ml.export --run dmc-v1
    uv run python -m cardgame_ml.export --run dmc-v1 \\
        --weights snapshots/hands-0001000000.pt --out <dir>

writes ``model.onnx`` and ``parity.json`` (positions and PyTorch's outputs
for them) into ``models/<run>/`` in the artifact store and rewrites the
run's manifest. A belief model is checked on validation positions of its
dataset, a Q network (a ``train.dmc`` run) on positions of random play
over varied rules. ``--weights`` exports another weights file of the run
(a learning-curve snapshot) into ``--out`` instead, with the run's
``config.json``, leaving the run and its manifest alone. Then check the
Rust side agrees:

    cargo run --release -p infer -- check ~/card-game-artifacts/models/<run>
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

import numpy as np

from cardgame_ml import runs
from cardgame_ml.data.shards import Dataset
from cardgame_ml.export.fixture import positions
from cardgame_ml.export.onnx import write, write_q
from cardgame_ml.provenance import Checkout
from cardgame_ml.store import artifact_store
from cardgame_ml.train import belief
from cardgame_ml.train.batching import ARRAYS, Split
from cardgame_ml.train.config import SplitConfig
from cardgame_ml.train.dmc import learner

POSITIONS = 32
"""Positions in ``parity.json``."""

Q_POSITIONS_AT = (0, 4, 12, 30, 45, 60, 75, 90)
"""Steps of random play at which a Q network's positions are taken, four
hands at once: bidding to the last tricks."""


def export_belief(run: Path) -> None:
    """Validation positions spread over the dataset's first shard."""
    config = json.loads((run / "config.json").read_text(encoding="utf-8"))["config"]
    dataset = Dataset.open(artifact_store() / config["dataset"])
    split = Split.draw(sum(s.games for s in dataset.shards), SplitConfig(**config["split"]))
    shard = dataset.load(0, [*ARRAYS, "legal"])
    rows = np.flatnonzero(split.val_rows(shard))
    picked = rows[np.linspace(0, len(rows) - 1, POSITIONS).astype(np.int64)]
    batch = shard.take(picked)
    write(belief.load(run), batch, batch, run)


def export_q(run: Path, weights: Path | None, out: Path) -> None:
    described = json.loads((run / "config.json").read_text(encoding="utf-8"))
    batch = positions(seed=1, num_envs=POSITIONS // len(Q_POSITIONS_AT), at=Q_POSITIONS_AT)
    if out != run:
        out.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(run / "config.json", out / "config.json")
    model = learner.load(run, weights)
    write_q(model, batch, batch, float(described["reward_scale"]), out)


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m cardgame_ml.export", description=__doc__)
    parser.add_argument("--run", required=True, help="the run's name, as in its config")
    parser.add_argument("--weights", type=Path, help="a Q run's weights file, relative to the run")
    parser.add_argument("--out", type=Path, help="with --weights: where the model directory goes")
    parser.add_argument("--allow-dirty", action="store_true", help="run with uncommitted changes")
    args = parser.parse_args()
    if (args.weights is None) != (args.out is None):
        parser.error("--weights and --out go together")

    checkout = Checkout.of(Path.cwd())
    checkout.require_clean(args.allow_dirty)
    run = runs.run_dir(args.run)
    described = json.loads((run / "config.json").read_text(encoding="utf-8"))
    if "reward_scale" in described:
        try:
            learner.check_encoding(run, described, learner.current_spec())
        except learner.EncodingMismatchError as e:
            parser.error(str(e))
    if "reward_scale" not in described:
        if args.weights is not None:
            parser.error("--weights is for Q networks")
        export_belief(run)
    elif args.weights is not None:
        export_q(run, run / args.weights, args.out)
        print(f"exported {args.out / 'model.onnx'}", file=sys.stderr)
        return
    else:
        export_q(run, None, run)
    manifest = runs.rerecord(run, checkout)
    print(f"exported {run / 'model.onnx'}; manifest: {manifest}", file=sys.stderr)


if __name__ == "__main__":
    main()
