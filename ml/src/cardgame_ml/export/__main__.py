"""Exports a trained belief model to ONNX, with its parity check:

    uv run python -m cardgame_ml.export --run belief-v1

writes ``model.onnx`` and ``parity.json`` (validation positions and
PyTorch's logits for them) into ``models/<run>/`` in the artifact store
and rewrites the run's manifest. Then check the Rust side agrees:

    cargo run --release -p infer -- check ~/card-game-artifacts/models/<run>
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

from cardgame_ml import runs
from cardgame_ml.data.shards import Dataset
from cardgame_ml.export.onnx import write
from cardgame_ml.provenance import Checkout
from cardgame_ml.store import artifact_store
from cardgame_ml.train.batching import ARRAYS, Split
from cardgame_ml.train.belief import load
from cardgame_ml.train.config import SplitConfig

POSITIONS = 32
"""Validation positions in ``parity.json``, spread over the first shard."""


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m cardgame_ml.export", description=__doc__)
    parser.add_argument("--run", required=True, help="the run's name, as in its config")
    parser.add_argument("--allow-dirty", action="store_true", help="run with uncommitted changes")
    args = parser.parse_args()

    checkout = Checkout.of(Path.cwd())
    checkout.require_clean(args.allow_dirty)
    run = runs.run_dir(args.run)
    described = json.loads((run / "config.json").read_text(encoding="utf-8"))
    config = described["config"]
    dataset = Dataset.open(artifact_store() / config["dataset"])
    split = Split.draw(sum(s.games for s in dataset.shards), SplitConfig(**config["split"]))
    shard = dataset.load(0, [*ARRAYS, "legal"])
    rows = np.flatnonzero(split.val_rows(shard))
    picked = rows[np.linspace(0, len(rows) - 1, POSITIONS).astype(np.int64)]
    batch = shard.take(picked)

    write(load(run), batch, batch, run)
    manifest = runs.rerecord(run, checkout)
    print(f"exported {run / 'model.onnx'}; manifest: {manifest}", file=sys.stderr)


if __name__ == "__main__":
    main()
