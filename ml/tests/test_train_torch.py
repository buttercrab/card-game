"""A tiny training run on CPU, and the batches it reads."""

import dataclasses
import json
import shutil
from pathlib import Path
from typing import Any

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from cardgame_ml.data.shards import Dataset  # noqa: E402
from cardgame_ml.export.__main__ import POSITIONS, ExportError, export_run  # noqa: E402
from cardgame_ml.models.io import WrongKindError, load_belief, load_q  # noqa: E402
from cardgame_ml.runs import RunDir  # noqa: E402
from cardgame_ml.train.batching import Split, batches, every_row, steps_per_epoch  # noqa: E402
from cardgame_ml.train.belief import evaluate, train  # noqa: E402
from cardgame_ml.train.config import BeliefTrainConfig, SplitConfig, from_mapping  # noqa: E402
from cardgame_ml.train.score import score  # noqa: E402
from cardgame_ml.train.sessions import ConfigChangedError  # noqa: E402


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
    assert described["encoding"] == "mighty-3"
    assert described["kind"] == "belief"
    trained = load_belief(RunDir(tmp_path))
    assert trained.parameter_count() == described["parameters"]
    # Better than the count baseline on the games it saw, at least.
    fitted = evaluate(trained, dataset, every_row).to_json()["all"]
    assert fitted["model"]["log_loss"] < fitted["baseline"]["log_loss"]


def test_a_resume_keeps_the_record_and_refuses_another_config(
    dataset: Dataset, train_config: dict[str, Any], tmp_path: Path
) -> None:
    config = from_mapping(BeliefTrainConfig, train_config, "test")
    train(config, dataset, tmp_path, lambda _: None, commit="a" * 40)
    assert not list(tmp_path.glob("*.tmp"))  # the checkpoint was written whole
    described = json.loads((tmp_path / "config.json").read_text(encoding="utf-8"))
    assert [s["commit"] for s in described["sessions"]] == ["a" * 40]
    # Another config: refused before config.json is touched.
    other = dataclasses.replace(config, optim=dataclasses.replace(config.optim, lr=0.5))
    with pytest.raises(ConfigChangedError, match=r"optim\.lr"):
        train(other, dataset, tmp_path, lambda _: None, commit="b" * 40)
    assert json.loads((tmp_path / "config.json").read_text(encoding="utf-8")) == described
    # The same config resumes (all epochs done: it only validates) as a new session.
    lines: list[dict[str, Any]] = []
    train(config, dataset, tmp_path, lines.append, commit="b" * 40)
    assert lines[0]["event"] == "resume"
    start = next(line for line in lines if line["event"] == "start")
    assert (start["session"], start["commit"], start["seed"]) == (2, "b" * 40, config.seed)
    described = json.loads((tmp_path / "config.json").read_text(encoding="utf-8"))
    assert [s["commit"] for s in described["sessions"]] == ["a" * 40, "b" * 40]


def test_a_belief_run_is_scored_and_exported_by_its_kind(
    dataset: Dataset,
    train_config: dict[str, Any],
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``train.score`` and ``export`` on a run in the artifact store, as
    the loop's steps run them."""
    pytest.importorskip("onnx")
    store = tmp_path / "store"
    monkeypatch.setenv("CARDGAME_ARTIFACTS", str(store))
    shutil.copytree(dataset.root, store / "selfplay" / "tiny")
    config = from_mapping(BeliefTrainConfig, train_config, "test")
    run = RunDir.named(config.name)
    train(config, dataset, run.path, lambda _: None)

    cpu = torch.device("cpu")
    own = score(run, dataset, "selfplay/tiny", cpu)
    assert own["decisions"] == "validation games"
    games = sum(s.games for s in dataset.shards)
    val = Split.draw(games, config.split).val_rows
    assert own["count"] == sum(int(val(dataset.load(i, ["game"])).sum()) for i in range(3))
    other = score(run, dataset, "selfplay/another", cpu)
    assert (other["decisions"], other["count"]) == ("every decision", dataset.decisions)
    assert own["scores"]["all"]["model"]["cards"] > 0

    assert export_run(run) == run.path / "model.onnx"
    parity = json.loads((run.path / "parity.json").read_text(encoding="utf-8"))
    assert len(parity["observations"]) == POSITIONS
    with pytest.raises(ExportError, match="Q networks"):
        export_run(run, Path("model.pt"), tmp_path / "out")
    with pytest.raises(WrongKindError):
        load_q(run)
