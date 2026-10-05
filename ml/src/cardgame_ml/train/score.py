"""Scores a trained belief model against the count baseline, by phase:

    uv run python -m cardgame_ml.train.score --run belief-v1 \\
        --dataset selfplay/selfplay-heldout-v1 --out <results.json>

On the dataset the run trained on, only its validation games count; on
any other (an eval-only one on held-out rules, say), every decision.
Writes JSON: the run, the dataset, which decisions, and per phase both
predictors' log-loss (nats per hidden card) and accuracy.
"""

import argparse
from pathlib import Path
from typing import Any

import torch

from cardgame_ml.data.shards import Dataset
from cardgame_ml.models.io import load_belief
from cardgame_ml.runs import RunDir
from cardgame_ml.runtime import device_for, write_json
from cardgame_ml.store import artifact_store
from cardgame_ml.train.batching import Split, every_row
from cardgame_ml.train.belief import evaluate
from cardgame_ml.train.config import BeliefTrainConfig, from_mapping


def score(run: RunDir, dataset: Dataset, dataset_path: str, device: torch.device) -> dict[str, Any]:
    """The run's model and the counts on ``dataset`` (``dataset_path``,
    relative to the artifact store, as the run's config names datasets)."""
    described = run.described()
    config = from_mapping(BeliefTrainConfig, described.config, f"{run.config_json}: config")
    model = load_belief(run, device)
    if dataset_path == config.dataset:
        games = sum(s.games for s in dataset.shards)
        rows, which = Split.draw(games, config.split).val_rows, "validation games"
    else:
        rows, which = every_row, "every decision"
    scores = evaluate(model, dataset, rows).to_json()
    decisions = sum(int(rows(dataset.load(i, ["game"])).sum()) for i in range(len(dataset.shards)))
    return {
        "run": run.name,
        "dataset": dataset.name,
        "eval_only": dataset.eval_only,
        "decisions": which,
        "count": decisions,
        "parameters": model.parameter_count(),
        "torch": torch.__version__,
        "scores": scores,
    }


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m cardgame_ml.train.score", description=__doc__)
    parser.add_argument("--run", required=True, help="the run's name")
    parser.add_argument("--dataset", required=True, help="relative to the artifact store")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--device", default="auto")
    args = parser.parse_args()

    dataset = Dataset.open(artifact_store() / args.dataset)
    result = score(RunDir.named(args.run), dataset, args.dataset, device_for(args.device))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    write_json(args.out, result)
    for name, group in result["scores"].items():
        m, b = group["model"], group["baseline"]
        print(
            f"{name:13s} {m['log_loss']:.4f} vs {b['log_loss']:.4f} nats "
            f"(gain {b['log_loss'] - m['log_loss']:.4f}), "
            f"accuracy {m['accuracy']:.3f} vs {b['accuracy']:.3f}, {m['cards']} cards"
        )


if __name__ == "__main__":
    main()
