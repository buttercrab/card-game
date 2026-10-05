"""Trains a Q network by Deep Monte Carlo from a committed config:

    uv run python -m cardgame_ml.train.dmc --config research/experiments/<folder>/config.toml

The run goes to ``models/<name>/`` in the artifact store (resuming from
its checkpoint if it was stopped), its manifest to
``research/manifests/<name>.json``. Run it from a clean checkout: the
manifest names the commit. Stop it with Ctrl-C (or SIGTERM): it
checkpoints on the way out.
"""

import argparse
import json
import signal
import sys
from pathlib import Path
from typing import Any

from cardgame_ml import runs
from cardgame_ml.provenance import Checkout
from cardgame_ml.train.dmc.config import DmcConfig
from cardgame_ml.train.dmc.learner import train


def _terminate(_signum: int, _frame: object) -> None:
    raise KeyboardInterrupt


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m cardgame_ml.train.dmc", description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--allow-dirty", action="store_true", help="run with uncommitted changes")
    args = parser.parse_args()

    checkout = Checkout.of(Path.cwd())
    checkout.require_clean(args.allow_dirty)
    config = DmcConfig.load(args.config)
    exclude = checkout.root / config.exclude
    if not exclude.is_file():
        raise SystemExit(f"exclude: {exclude} does not exist")
    out = runs.run_dir(config.name)
    out.mkdir(parents=True, exist_ok=True)
    print(f"training {config.name} into {out}", file=sys.stderr)
    signal.signal(signal.SIGTERM, _terminate)
    with (out / "log.jsonl").open("a", encoding="utf-8") as log_file:

        def log(entry: dict[str, Any]) -> None:
            line = json.dumps(entry, ensure_ascii=False)
            log_file.write(line + "\n")
            log_file.flush()
            print(line, file=sys.stderr)

        try:
            progress = train(config, out, exclude, log)
        except KeyboardInterrupt:
            print("stopped; resume with the same command", file=sys.stderr)
            return
    print(f"done: {progress.hands} hands, {progress.step} steps", file=sys.stderr)
    manifest = runs.record(
        out,
        checkout,
        checkout.relative(args.config),
        (config.seed, config.curve.seed),
        json.loads((out / "config.json").read_text(encoding="utf-8"))["encoding"],
    )
    print(f"manifest: {manifest}", file=sys.stderr)


if __name__ == "__main__":
    main()
