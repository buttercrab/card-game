from pathlib import Path
from typing import Any

import pytest
from cardgame_env import selfplay
from loopkit import fake_check_bot

from cardgame_ml.data.shards import Dataset
from cardgame_ml.loop import botcheck

TINY = """
name = "tiny"
game = "mighty"
seed = 3
games = 24
rules = "varied"
shard_decisions = 400

[[bots]]
spec = "random"
weight = 1.0

[[bots]]
spec = "simple"
weight = 1.0

[[bots]]
spec = "초보"
weight = 1.0
"""


@pytest.fixture(autouse=True)
def stub_check_bot(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every test asks ``eval check-bot`` through ``loopkit``'s stub; one
    runs the real binary, passing its own runner."""
    monkeypatch.setattr(botcheck, "RUN", fake_check_bot)


@pytest.fixture
def repo() -> Path:
    """The repository root: ml/ sits directly under it."""
    return Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def dataset(tmp_path_factory: pytest.TempPathFactory) -> Dataset:
    """A tiny self-play dataset: 24 games over varied rules, a few shards."""
    out = tmp_path_factory.mktemp("selfplay") / "tiny"
    stats = selfplay(TINY, out, threads=2)
    dataset = Dataset.open(out)
    assert stats["decisions"] == dataset.decisions
    return dataset


@pytest.fixture
def train_config() -> dict[str, Any]:
    """A belief training config as its TOML file reads, for the tiny dataset."""
    data: dict[str, Any] = {
        "name": "tiny-belief",
        "dataset": "selfplay/tiny",
        "seed": 1,
        "eval_every": 5,
        "device": "cpu",
        "split": {"val_fraction": 0.25, "seed": 2},
        "model": {"width": 16, "heads": 2, "layers": 1, "feedforward": 32, "dropout": 0.0},
        "optim": {
            "batch_size": 32,
            "epochs": 3,
            "lr": 1e-2,
            "weight_decay": 0.0,
            "warmup_steps": 2,
            "min_lr_ratio": 0.1,
            "grad_clip": 1,
        },
    }
    return data
