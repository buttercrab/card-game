"""Exports a trained model to ONNX, with its parity check:

    uv run python -m cardgame_ml.export --run belief-v1
    uv run python -m cardgame_ml.export --run dmc-v1
    uv run python -m cardgame_ml.export --run dmc-v1 \\
        --weights snapshots/hands-0001000000.pt --out <dir>

writes ``model.onnx`` and ``parity.json`` (positions and PyTorch's outputs
for them) into ``models/<run>/`` in the artifact store and rewrites the
run's manifest. What is exported follows the run's kind (its
``config.json``): a belief model is checked on validation positions of
its dataset, a Q network (a ``train.dmc`` run) on positions of random
play over varied rules. Either is refused when it reads another encoding
than this build's. ``--weights`` exports another weights file of a Q run
(a learning-curve snapshot) into ``--out`` instead, with the run's
``config.json``, leaving the run and its manifest alone. Then check the
Rust side agrees:

    cargo run --release -p infer -- check ~/card-game-artifacts/models/<run>
"""

import argparse
import shutil
import sys
from pathlib import Path

import numpy as np

from cardgame_ml import runs
from cardgame_ml.data.shards import Dataset
from cardgame_ml.export.fixture import positions
from cardgame_ml.export.onnx import write, write_q
from cardgame_ml.models.belief import BeliefModel
from cardgame_ml.models.io import EncodingMismatchError, load_model
from cardgame_ml.provenance import Checkout
from cardgame_ml.runs import Described, RunDir
from cardgame_ml.store import artifact_store
from cardgame_ml.train.batching import ARRAYS, Split
from cardgame_ml.train.config import BeliefTrainConfig, from_mapping

POSITIONS = 32
"""Positions in ``parity.json``."""

Q_POSITIONS_AT = (0, 4, 12, 30, 45, 60, 75, 90)
"""Steps of random play at which a Q network's positions are taken, four
hands at once: bidding to the last tricks."""


class ExportError(ValueError):
    """A run that cannot be exported as asked."""


def export_belief(model: BeliefModel, run: RunDir, described: Described) -> None:
    """Validation positions spread over the dataset's first shard."""
    config = from_mapping(BeliefTrainConfig, described.config, f"{run.config_json}: config")
    dataset = Dataset.open(artifact_store() / config.dataset)
    split = Split.draw(sum(s.games for s in dataset.shards), config.split)
    shard = dataset.load(0, [*ARRAYS, "legal"])
    rows = np.flatnonzero(split.val_rows(shard))
    picked = rows[np.linspace(0, len(rows) - 1, POSITIONS).astype(np.int64)]
    batch = shard.take(picked)
    write(model, batch, batch, run.path)


def export_run(run: RunDir, weights: Path | None = None, out: Path | None = None) -> Path:
    """Exports ``run`` by its kind into its own directory, or (a Q run's
    ``weights``, relative to the run) into ``out``; returns where
    ``model.onnx`` went."""
    if (weights is None) != (out is None):
        raise ExportError("--weights and --out go together")
    described = run.described()
    model = load_model(run, None if weights is None else run.path / weights)
    if isinstance(model, BeliefModel):
        if weights is not None:
            raise ExportError("--weights is for Q networks")
        export_belief(model, run, described)
        return run.path / "model.onnx"
    target = out or run.path
    if target != run.path:
        target.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(run.config_json, target / "config.json")
    assert described.reward_scale is not None, "a Q network's run records its reward scale"
    batch = positions(seed=1, num_envs=POSITIONS // len(Q_POSITIONS_AT), at=Q_POSITIONS_AT)
    write_q(model, batch, batch, described.reward_scale, target)
    return target / "model.onnx"


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m cardgame_ml.export", description=__doc__)
    parser.add_argument("--run", required=True, help="the run's name, as in its config")
    parser.add_argument("--weights", type=Path, help="a Q run's weights file, relative to the run")
    parser.add_argument("--out", type=Path, help="with --weights: where the model directory goes")
    parser.add_argument("--allow-dirty", action="store_true", help="run with uncommitted changes")
    args = parser.parse_args()

    checkout = Checkout.of(Path.cwd())
    checkout.require_clean(args.allow_dirty)
    run = RunDir.named(args.run)
    try:
        written = export_run(run, args.weights, args.out)
    except (ExportError, EncodingMismatchError) as e:
        parser.error(str(e))
    if args.weights is not None:
        print(f"exported {written}", file=sys.stderr)
        return
    manifest = runs.rerecord(run, checkout)
    print(f"exported {written}; manifest: {manifest}", file=sys.stderr)


if __name__ == "__main__":
    main()
