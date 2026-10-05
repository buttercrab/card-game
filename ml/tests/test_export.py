"""Export parity: PyTorch gives the logits the Rust runtime is checked
against (``crates/infer/tests/parity.rs``), on the shared fixture."""

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

torch = pytest.importorskip("torch")
onnx = pytest.importorskip("onnx")

from cardgame_ml.data.shards import Batch  # noqa: E402
from cardgame_ml.export.onnx import export, export_q, observations  # noqa: E402
from cardgame_ml.models.belief import INPUTS  # noqa: E402
from cardgame_ml.models.q import INPUTS as Q_INPUTS  # noqa: E402
from cardgame_ml.train.batching import to_inputs  # noqa: E402
from cardgame_ml.train.belief import load  # noqa: E402
from cardgame_ml.train.dmc.learner import load as load_q  # noqa: E402


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
    model = load(fixture)
    parity = json.loads((fixture / "parity.json").read_text(encoding="utf-8"))
    batch = as_batch(parity["observations"], model.spec.max_events)
    with torch.no_grad():
        logits = model(*to_inputs(batch, torch.device("cpu")))
    recorded = torch.tensor(parity["logits"]).reshape(logits.shape)
    assert (logits - recorded).abs().max() <= parity["tolerance"]
    # The JSON layout round-trips.
    assert observations(batch) == parity["observations"]


def test_exports_with_dynamic_batch_and_events(fixture: Path, tmp_path: Path) -> None:
    model = load(fixture)
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
    model = load_q(fixture)
    parity = json.loads((fixture / "parity.json").read_text(encoding="utf-8"))
    batch = as_batch(parity["observations"], model.spec.max_events)
    path = tmp_path / "model.onnx"
    export_q(model, batch, path)
    graph = onnx.load(str(path)).graph
    assert [i.name for i in graph.input] == list(Q_INPUTS)
    actions = graph.input[Q_INPUTS.index("actions")].type.tensor_type.shape.dim
    assert actions[0].dim_param
    assert actions[1].dim_param, "any number of actions"
