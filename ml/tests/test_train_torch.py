"""A tiny training run on CPU, and the batches it reads."""

import dataclasses
import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

pytest.importorskip("torch")

from cardgame_ml.data.shards import Dataset
from cardgame_ml.train.batching import Split, batches, every_row, steps_per_epoch
from cardgame_ml.train.belief import evaluate, load, train
from cardgame_ml.train.config import BeliefTrainConfig, SplitConfig, from_mapping


def test_the_split_is_by_game_and_batches_cover_it(dataset: Dataset) -> None:
    split = Split.draw(24, SplitConfig(0.25, 2))
    val = np.concatenate([b["game"] for b in batches(dataset, split.val_rows, 50, None)])
    train_games = np.concatenate([b["game"] for b in batches(dataset, split.train_rows, 50, 1)])
    assert not set(val.tolist()) & set(train_games.tolist())
    shards = range(len(dataset.shards))
    assert len(val) == sum(int(split.val_rows(dataset.load(i)).sum()) for i in shards)
    every = list(batches(dataset, every_row, 50, None))
    assert sum(len(b["game"]) for b in every) == dataset.decisions
    # Seeded: full batches only, as many as promised.
    seeded = list(batches(dataset, every_row, 50, seed=4))
    assert all(len(b["game"]) == 50 for b in seeded)
    assert len(seeded) == steps_per_epoch(dataset, every_row, 50)
    # Within a batch, sequences are of about one length.
    spread = [int(np.ptp(b["events_len"])) for b in seeded]
    assert np.median(spread) < np.ptp(np.concatenate([b["events_len"] for b in seeded]))


def test_eval_only_data_is_never_trained_on(
    dataset: Dataset, train_config: dict[str, Any], tmp_path: Path
) -> None:
    config = from_mapping(BeliefTrainConfig, train_config, "test")
    held_out = dataclasses.replace(dataset, eval_only=True)
    with pytest.raises(ValueError, match="evaluation only"):
        train(config, held_out, tmp_path, lambda _: None)


def test_a_tiny_run_learns_and_writes_its_files(
    dataset: Dataset, train_config: dict[str, Any], tmp_path: Path
) -> None:
    config = from_mapping(BeliefTrainConfig, train_config, "test")
    lines: list[dict[str, Any]] = []
    report = train(config, dataset, tmp_path, lines.append)
    assert {p.name for p in tmp_path.iterdir()} >= {
        "config.json",
        "checkpoint.pt",
        "model.pt",
        "metrics.json",
    }
    val = [line for line in lines if line["event"] == "val"]
    assert len(val) >= config.optim.epochs
    assert report.to_json()["all"]["model"]["cards"] > 0
    described = json.loads((tmp_path / "config.json").read_text(encoding="utf-8"))
    assert described["encoding"] == "mighty-2"
    trained = load(tmp_path)
    assert trained.parameter_count() == described["parameters"]
    # Better than the count baseline on the games it saw, at least.
    fitted = evaluate(trained, dataset, every_row).to_json()["all"]
    assert fitted["model"]["log_loss"] < fitted["baseline"]["log_loss"]
