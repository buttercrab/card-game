"""A belief model as ONNX, with the observations that check it.

A model directory (``crates/infer`` reads it) holds ``config.json`` (with
the encoding spec), ``model.onnx`` and ``parity.json``: observations in
the layout of Rust's ``engine::Observation`` and the logits PyTorch gives
for them, which the Rust side must reproduce (``infer check``).

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
from torch.export import Dim

from cardgame_ml.data.shards import Batch
from cardgame_ml.models.belief import INPUTS, BeliefModel
from cardgame_ml.train.batching import to_inputs

OUTPUT = "logits"

TOLERANCE = 1e-4
"""How far Rust's logits may be from PyTorch's: float32 sums in another
order, nothing more."""


def export(model: BeliefModel, batch: Batch, path: Path) -> None:
    """Writes ``model`` to ``path`` as ONNX, traced on ``batch`` (at least
    two decisions with at least two events each, so no size is taken for
    a constant)."""
    model = model.cpu().eval()
    inputs = to_inputs(batch, torch.device("cpu"))
    count, events = Dim("batch", min=1), Dim("events", min=1, max=model.spec.max_events)
    shapes = (
        {0: count},
        {0: count},
        {0: count, 1: events},
        {0: count, 1: events},
        {0: count},
    )
    with warnings.catch_warnings():
        # It names each dynamic axis once and warns about every other use.
        warnings.filterwarnings("ignore", message=".*axis name")
        torch.onnx.export(
            model,
            inputs,
            str(path),
            input_names=list(INPUTS),
            output_names=[OUTPUT],
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
            row = model(*to_inputs(one, torch.device("cpu")))[0]
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
