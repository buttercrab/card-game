"""Models as ONNX, with the observations that check them: the belief
model, and the Q network (``export_q``, ``write_q``).

A model directory (``crates/infer`` reads it) holds ``config.json`` (with
the encoding spec), ``model.onnx`` and ``parity.json``: observations in
the layout of Rust's ``engine::Observation`` and the outputs PyTorch
gives for them (a belief model's logits, a Q network's values of the
legal actions), which the Rust side must reproduce (``infer check``).

The graph takes any batch size and any number of event rows up to the
spec's ``max_events``, so Rust feeds only the rows a position has.
"""

# PyTorch leaves some of torch.onnx.export's parameters unannotated,
# which strict mode reports.
# pyright: reportUnknownMemberType=false

import json
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import torch
from torch import nn
from torch.export import Dim

from cardgame_ml.data.shards import Batch
from cardgame_ml.models.belief import INPUTS, BeliefModel
from cardgame_ml.models.inputs import observation, to_tensors
from cardgame_ml.models.q import INPUTS as Q_INPUTS
from cardgame_ml.models.q import QModel
from cardgame_ml.models.trunk import unfused
from cardgame_ml.train.dmc.policy import legal_actions, legal_values

OUTPUT = "logits"
Q_OUTPUT = "values"

TOLERANCE = 1e-4
"""How far Rust's logits may be from PyTorch's: float32 sums in another
order, nothing more."""


def export(model: BeliefModel, batch: Batch, path: Path) -> None:
    """Writes ``model`` to ``path`` as ONNX, traced on ``batch`` (at least
    two decisions with at least two events each, so no size is taken for
    a constant)."""
    inputs = to_tensors(observation(batch), torch.device("cpu"))
    count, events = _dims(model.spec.max_events)
    shapes = ({0: count}, {0: count}, {0: count, 1: events}, {0: count, 1: events}, {0: count})
    _export(model, inputs, INPUTS, shapes, OUTPUT, path)


def export_q(model: QModel, batch: Batch, path: Path) -> None:
    """Writes the Q network ``model`` to ``path`` as ONNX, traced on
    ``batch`` (at least two decisions with at least two events and two
    legal actions each): inputs as the belief model's plus ``actions``
    ``[n, k]`` (int64), output ``values`` ``[n, k]``."""
    inputs = to_tensors(observation(batch), torch.device("cpu"))
    actions, _ = legal_actions(np.asarray(batch["legal"], np.bool_))
    count, events = _dims(model.spec.max_events)
    k = Dim("actions", min=1, max=len(model.spec.actions))
    shapes = (
        {0: count},
        {0: count},
        {0: count, 1: events},
        {0: count, 1: events},
        {0: count},
        {0: count, 1: k},
    )
    _export(model, (*inputs, torch.as_tensor(actions)), Q_INPUTS, shapes, Q_OUTPUT, path)


def _dims(max_events: int) -> tuple[Dim, Dim]:
    return Dim("batch", min=1), Dim("events", min=1, max=max_events)


def _export(  # noqa: PLR0913, PLR0917
    model: nn.Module,
    inputs: tuple[torch.Tensor, ...],
    names: tuple[str, ...],
    shapes: tuple[dict[int, Dim], ...],
    output: str,
    path: Path,
) -> None:
    model = unfused(model.cpu().eval())
    with warnings.catch_warnings():
        # It names each dynamic axis once and warns about every other use.
        warnings.filterwarnings("ignore", message=".*axis name")
        torch.onnx.export(
            model,
            inputs,
            str(path),
            input_names=list(names),
            output_names=[output],
            dynamic_shapes=shapes,
            external_data=False,
            dynamo=True,
            verbose=False,
        )


def observations(batch: Batch) -> list[dict[str, Any]]:
    """Each decision of ``batch`` as Rust's ``engine::Observation`` reads it
    from JSON: flat arrays, events padded to the spec's length."""
    out: list[dict[str, Any]] = []
    for i in range(len(batch["events_len"])):
        out.append(
            {
                "global": _numbers(batch["global"][i]),
                "cards": _numbers(batch["cards"][i]),
                "events": _numbers(batch["events"][i]),
                "event_cards": batch["event_cards"][i].astype(int).tolist(),
                "events_len": int(batch["events_len"][i]),
                "legal": batch["legal"][i].astype(bool).tolist(),
            }
        )
    return out


def parity(model: BeliefModel, batch: Batch) -> dict[str, Any]:
    """The observations of ``batch`` and ``model``'s logits for them, one
    decision at a time (so the logits do not depend on batching)."""
    model = model.cpu().eval()
    logits: list[list[float]] = []
    with torch.no_grad():
        for i in range(len(batch["events_len"])):
            one = {name: array[i : i + 1] for name, array in batch.items()}
            row = model(*to_tensors(observation(one), torch.device("cpu")))[0]
            logits.append([float(x) for x in row.flatten()])
    return {"tolerance": TOLERANCE, "observations": observations(batch), "logits": logits}


def write(model: BeliefModel, trace: Batch, check: Batch, out: Path) -> None:
    """Writes ``model.onnx`` (traced on ``trace``) and ``parity.json``
    (on ``check``) into ``out``."""
    export(model, trace, out / "model.onnx")
    text = json.dumps(parity(model, check), separators=(",", ":"))
    (out / "parity.json").write_text(text + "\n", encoding="utf-8")


def _numbers(array: np.ndarray[Any, Any]) -> list[float | int]:
    """Floats, written as integers where they are whole: observations are
    mostly zeros and ones, and JSON is text."""
    return [int(x) if x.is_integer() else x for x in array.astype(float).flatten().tolist()]


def q_parity(model: QModel, batch: Batch, reward_scale: float) -> dict[str, Any]:
    """The observations of ``batch`` and ``model``'s values of each one's
    legal actions (in index order), one decision at a time, in the
    network's units; ``reward_scale`` says how many of them a point is."""
    model = model.cpu().eval()
    values: list[list[float]] = []
    for i in range(len(batch["events_len"])):
        one = {name: array[i : i + 1] for name, array in batch.items()}
        _, row = legal_values(model, one, torch.device("cpu"))
        values.append([float(x) for x in row[0] if np.isfinite(x)])
    return {
        "tolerance": TOLERANCE,
        "reward_scale": reward_scale,
        "observations": observations(batch),
        "values": values,
    }


def write_q(model: QModel, trace: Batch, check: Batch, reward_scale: float, out: Path) -> None:
    """Writes ``model.onnx`` (traced on ``trace``) and ``parity.json`` (on
    ``check``) into ``out``."""
    export_q(model, trace, out / "model.onnx")
    text = json.dumps(q_parity(model, check, reward_scale), separators=(",", ":"))
    (out / "parity.json").write_text(text + "\n", encoding="utf-8")
