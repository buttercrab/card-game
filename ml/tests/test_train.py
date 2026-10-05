"""Training configs, the split and batching, and a tiny run on CPU."""

import dataclasses
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from cardgame_ml.data.shards import Dataset
from cardgame_ml.models.config import BeliefConfig
from cardgame_ml.train.config import (
    BeliefTrainConfig,
    ConfigError,
    OptimConfig,
    SplitConfig,
    from_mapping,
)
from cardgame_ml.train.metrics import PHASES, PhaseFeaturesError, Report, phases


def test_reads_a_config(train_config: dict[str, Any]) -> None:
    config = from_mapping(BeliefTrainConfig, train_config, "test")
    assert config.split == SplitConfig(0.25, 2)
    assert config.model == BeliefConfig(16, 2, 1, 32, 0.0)
    assert config.optim.grad_clip == 1.0
    assert isinstance(config.optim, OptimConfig)


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"seed": "1"}, "seed: expected int"),
        ({"seed": True}, "boolean"),
        ({"extra": 1}, "unknown extra"),
        ({"split": {"val_fraction": 0.1}}, "missing seed"),
        ({"model": 3}, "expected a table"),
        (
            {"model": {"width": 15, "heads": 2, "layers": 1, "feedforward": 8, "dropout": 0.0}},
            "multiple of heads",
        ),
    ],
)
def test_rejects_bad_configs(
    train_config: dict[str, Any], changes: dict[str, object], message: str
) -> None:
    with pytest.raises(ConfigError, match=message):
        from_mapping(BeliefTrainConfig, {**train_config, **changes}, "test")


def test_committed_configs_load(repo: Path) -> None:
    configs = list((repo / "research" / "experiments").glob("*belief*/config.toml"))
    for path in configs:
        BeliefTrainConfig.load(path)


def test_phases_follow_the_hand(dataset: Dataset) -> None:
    shard = dataset.load(0, ["global", "game", "decision"])
    labels = phases(dataset.spec, shard.arrays["global"].astype(np.float32))
    assert set(labels.tolist()) <= set(range(len(PHASES)))
    games = shard.arrays["game"]
    first = games == games[0]
    # A hand goes bidding, (exchange), play: phases never go back.
    assert (np.diff(labels[first]) >= 0).all()


def test_phases_need_the_games_phase_features(dataset: Dataset) -> None:
    """Another game's encoding is refused with what is missing, rather
    than reporting every decision in no phase."""
    other = dataclasses.replace(dataset.spec, version="other-1", global_features=("pot", "trick"))
    with pytest.raises(PhaseFeaturesError, match=r"other-1 has no phase=bidding, phase=exchange"):
        phases(other, np.zeros((2, 2), np.float32))


def test_reports_add_up_by_phase() -> None:
    report = Report()
    owner = np.array([0, 0, 1])
    losses = np.array([1.0, 2.0, 3.0])
    right = np.array([True, False, True])
    report.add(np.array([0, 3]), owner, (losses, right), (losses + 1, right))
    out = report.to_json()
    assert out["all"]["model"]["cards"] == 3
    assert out["all"]["model"]["log_loss"] == pytest.approx(2.0)
    assert out["bidding"]["model"]["accuracy"] == pytest.approx(0.5)
    assert out["late tricks"]["gain"]["nats"] == pytest.approx(1.0)
    assert "exchange" not in out
