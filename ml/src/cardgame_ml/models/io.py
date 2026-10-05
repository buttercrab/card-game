"""Loading a trained network from its run directory (``runs.RunDir``), by
the kind its ``config.json`` records.

Every kind is checked against the encoding this build's environment
writes before its weights are read: a network that reads another
encoding would not fit, or would silently mean something else
(``EncodingMismatchError``).
"""

from pathlib import Path

import torch
from cardgame_env import Env

from cardgame_ml import schema
from cardgame_ml.data.spec import EncodingSpec
from cardgame_ml.models.belief import BeliefModel
from cardgame_ml.models.config import BeliefConfig, QConfig
from cardgame_ml.models.q import QModel
from cardgame_ml.runs import Described, ModelKind, RunDir

type Model = BeliefModel | QModel


class EncodingMismatchError(ValueError):
    """A run or model reads another encoding than this build's."""


class WrongKindError(ValueError):
    """A run is not of the kind asked for."""


def current_spec() -> EncodingSpec:
    """The encoding this build's environment writes."""
    return EncodingSpec.from_json(Env(num_envs=1, seed=0, threads=1).spec())


def check_encoding(where: Path, described: Described, ours: EncodingSpec) -> None:
    """Refuses a run or model directory whose network reads another
    encoding than ``ours``."""
    theirs = described.encoding_spec
    if theirs != ours:
        raise EncodingMismatchError(
            f"{where}: the network reads {theirs.version}, not {ours.version}"
        )


def load_model(
    run: RunDir, weights: Path | None = None, device: torch.device | None = None
) -> Model:
    """The network of ``run`` (``model.pt``, or another weights file of it,
    a snapshot), in eval mode on ``device`` (the CPU by default)."""
    described = run.described()
    check_encoding(run.path, described, current_spec())
    spec = described.encoding_spec
    where = f"{run.config_json}: config.model"
    model: Model
    match described.kind:
        case ModelKind.BELIEF:
            sizes = schema.read(BeliefConfig, described.model_config(), where, defaults=False)
            model = BeliefModel(spec, sizes)
        case ModelKind.DMC:
            q_sizes = schema.read(QConfig, described.model_config(), where, defaults=False)
            model = QModel(spec, q_sizes)
    device = device or torch.device("cpu")
    state = torch.load(weights or run.model, map_location=device, weights_only=True)
    model.load_state_dict(state)
    return model.to(device).eval()


def load_belief(run: RunDir, device: torch.device | None = None) -> BeliefModel:
    model = load_model(run, device=device)
    if not isinstance(model, BeliefModel):
        raise WrongKindError(f"{run.path}: not a belief model")
    return model


def load_q(run: RunDir, weights: Path | None = None, device: torch.device | None = None) -> QModel:
    model = load_model(run, weights, device)
    if not isinstance(model, QModel):
        raise WrongKindError(f"{run.path}: not a Q network")
    return model
