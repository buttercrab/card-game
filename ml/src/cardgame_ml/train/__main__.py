"""Trains a belief model from a committed config:

    uv run python -m cardgame_ml.train --config research/experiments/<folder>/config.toml

The run goes to ``models/<name>/`` in the artifact store (resuming from
its last epoch if it was interrupted), its manifest to
``research/manifests/<name>.json``. Run it from a clean checkout: the
manifest names the commit. A resume with another config than the run's
is refused; ``--allow-config-change`` accepts it (the run's sessions
record the change).
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from cardgame_ml import runs
from cardgame_ml.data.shards import Dataset
from cardgame_ml.provenance import Checkout
from cardgame_ml.store import artifact_store
from cardgame_ml.train.belief import train
from cardgame_ml.train.config import BeliefTrainConfig
from cardgame_ml.train.sessions import ConfigChangedError


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m cardgame_ml.train", description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--allow-dirty", action="store_true", help="run with uncommitted changes")
    parser.add_argument(
        "--allow-config-change",
        action="store_true",
        help="resume although the config changed (recorded in the run)",
    )
    args = parser.parse_args()

    checkout = Checkout.of(Path.cwd())
    checkout.require_clean(args.allow_dirty)
    config = BeliefTrainConfig.load(args.config)
    dataset = Dataset.open(artifact_store() / config.dataset)
    out = runs.run_dir(config.name)
    print(f"training {config.name} into {out}", file=sys.stderr)
    out.mkdir(parents=True, exist_ok=True)
    with (out / "log.jsonl").open("a", encoding="utf-8") as log_file:

        def log(entry: dict[str, Any]) -> None:
            line = json.dumps(entry, ensure_ascii=False)
            log_file.write(line + "\n")
            log_file.flush()
            print(line, file=sys.stderr)

        try:
            train(
                config,
                dataset,
                out,
                log,
                commit=checkout.commit,
                dirty=checkout.dirty,
                allow_config_change=args.allow_config_change,
            )
        except ConfigChangedError as e:
            raise SystemExit(str(e)) from None
    manifest = runs.record(
        out,
        checkout,
        checkout.relative(args.config),
        (config.seed, config.split.seed),
        dataset.encoding,
    )
    print(f"manifest: {manifest}", file=sys.stderr)


if __name__ == "__main__":
    main()
