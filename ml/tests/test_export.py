"""Export parity: PyTorch gives the logits the Rust runtime is checked
against (``crates/infer/tests/parity.rs``), on the shared fixture."""

import json
import shutil
from pathlib import Path
from typing import Any

import numpy as np
import pytest

torch = pytest.importorskip("torch")
onnx = pytest.importorskip("onnx")

from cardgame_ml.data.shards import Batch  # noqa: E402
from cardgame_ml.export.__main__ import POSITIONS, ExportError, export_run  # noqa: E402
from cardgame_ml.export.onnx import export, export_q, observations  # noqa: E402
from cardgame_ml.models.belief import INPUTS  # noqa: E402
from cardgame_ml.models.inputs import observation, to_tensors  # noqa: E402
from cardgame_ml.models.io import EncodingMismatchError, load_belief, load_q  # noqa: E402
from cardgame_ml.models.q import INPUTS as Q_INPUTS  # noqa: E402
from cardgame_ml.runs import RunDir  # noqa: E402


@pytest.fixture
def fixture(repo: Path) -> Path:
    return repo / "crates" / "infer" / "tests" / "tiny"


def as_batch(observations: list[dict[str, Any]], max_events: int) -> Batch:
    """Observations in Rust's JSON layout, as a batch."""

    def stack(key: str, dtype: type[np.generic]) -> np.ndarray[Any, Any]:
        return np.array([o[key] for o in observations], dtype=dtype)

    n = len(observations)
    return {
        "global": stack("global", np.float32),
        "cards": stack("cards", np.float32).reshape(n, 54, -1),
        "events": stack("events", np.float32).reshape(n, max_events, -1),
        "event_cards": stack("event_cards", np.int32),
        "events_len": stack("events_len", np.int32),
        "legal": stack("legal", np.bool_),
    }


def test_pytorch_gives_the_recorded_logits(fixture: Path) -> None:
    model = load_belief(RunDir(fixture))
    parity = json.loads((fixture / "parity.json").read_text(encoding="utf-8"))
    batch = as_batch(parity["observations"], model.spec.max_events)
    with torch.no_grad():
        logits = model(*to_tensors(observation(batch), torch.device("cpu")))
    recorded = torch.tensor(parity["logits"]).reshape(logits.shape)
    assert (logits - recorded).abs().max() <= parity["tolerance"]
    # The JSON layout round-trips.
    assert observations(batch) == parity["observations"]


def test_exports_with_dynamic_batch_and_events(fixture: Path, tmp_path: Path) -> None:
    model = load_belief(RunDir(fixture))
    parity = json.loads((fixture / "parity.json").read_text(encoding="utf-8"))
    batch = as_batch(parity["observations"], model.spec.max_events)
    path = tmp_path / "model.onnx"
    export(model, batch, path)
    graph = onnx.load(str(path)).graph
    onnx.checker.check_model(onnx.load(str(path)))
    assert [i.name for i in graph.input] == list(INPUTS)
    events = graph.input[INPUTS.index("events")].type.tensor_type.shape.dim
    assert events[0].dim_param
    assert events[1].dim_param, "any number of event rows"


def test_q_networks_export_with_dynamic_actions(repo: Path, tmp_path: Path) -> None:
    fixture = repo / "crates" / "infer" / "tests" / "tiny-q"
    model = load_q(RunDir(fixture))
    parity = json.loads((fixture / "parity.json").read_text(encoding="utf-8"))
    batch = as_batch(parity["observations"], model.spec.max_events)
    path = tmp_path / "model.onnx"
    export_q(model, batch, path)
    graph = onnx.load(str(path)).graph
    assert [i.name for i in graph.input] == list(Q_INPUTS)
    actions = graph.input[Q_INPUTS.index("actions")].type.tensor_type.shape.dim
    assert actions[0].dim_param
    assert actions[1].dim_param, "any number of actions"


def test_export_follows_the_runs_kind(repo: Path, tmp_path: Path) -> None:
    """A Q run (here the fixture, from before ``kind`` was recorded) exports
    as a Q network, a snapshot of it into another directory."""
    run = RunDir(tmp_path / "q")
    shutil.copytree(repo / "crates" / "infer" / "tests" / "tiny-q", run.path)
    (run.path / "model.onnx").unlink()
    (run.path / "parity.json").unlink()
    snapshot = export_run(run, Path("model.pt"), tmp_path / "snapshot")
    assert snapshot == tmp_path / "snapshot" / "model.onnx"
    assert (tmp_path / "snapshot" / "config.json").read_bytes() == run.config_json.read_bytes()
    assert not (run.path / "model.onnx").exists(), "a snapshot leaves the run alone"
    assert export_run(run) == run.path / "model.onnx"
    parity = json.loads((run.path / "parity.json").read_text(encoding="utf-8"))
    assert parity["reward_scale"] == run.described().reward_scale
    assert len(parity["observations"]) == POSITIONS
    with pytest.raises(ExportError, match="go together"):
        export_run(run, Path("model.pt"))


def test_every_kind_is_checked_against_the_encoding(fixture: Path, tmp_path: Path) -> None:
    run = RunDir(tmp_path / "old")
    shutil.copytree(fixture, run.path)
    described = json.loads(run.config_json.read_text(encoding="utf-8"))
    described["spec"]["version"] = "mighty-0"
    run.config_json.write_text(json.dumps(described), encoding="utf-8")
    with pytest.raises(EncodingMismatchError, match="mighty-0"):
        load_belief(run)
    with pytest.raises(EncodingMismatchError, match="mighty-0"):
        export_run(run)
