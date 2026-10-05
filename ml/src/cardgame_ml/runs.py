"""Model runs in the artifact store: ``models/<name>/`` (a ``RunDir``),
and the manifest that records them in ``research/manifests/<name>.json``.

A run directory's ``config.json`` (``Described``) says what trained it:
its ``kind`` (a belief model or a DMC Q network), the trainer's config,
the encoding spec its network reads, its size and its training sessions.
Directories written before ``kind`` was recorded are read too: their
kind is inferred in one place, ``Described.read``.

Training writes a run's weights and logs there; exporting adds the ONNX
model and its parity check. Each step rewrites the manifest over every
file the run keeps, so the manifest always matches the directory. The
provenance stays training's: the manifest's ``commit`` is the commit
training finished on and ``sessions`` every training session (from the
run's ``config.json``); an export only adds ``exported_at``.
"""

import dataclasses
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import cast

from cardgame_ml import schema
from cardgame_ml.data.spec import EncodingSpec
from cardgame_ml.manifest import Artifact, Manifest, Session, artifacts
from cardgame_ml.provenance import Checkout
from cardgame_ml.runtime import write_json
from cardgame_ml.store import artifact_store

TRANSIENT = frozenset({"checkpoint.pt", "checkpoint.tmp"})
"""Files a run writes but does not keep: resuming state, not results
(and any ``*.tmp``, a write under way)."""


class ModelKind(StrEnum):
    BELIEF = "belief"
    """``train.belief``: where each hidden card is."""
    DMC = "dmc"
    """``train.dmc``: a Q network learnt by Deep Monte Carlo."""


@dataclass(frozen=True, kw_only=True)
class Described:
    """A run directory's ``config.json``."""

    kind: ModelKind
    config: dict[str, object]
    """The trainer's config as the run started it (``asdict`` of a
    ``BeliefTrainConfig`` or ``DmcConfig``)."""
    encoding: str
    spec: dict[str, object]
    """The encoding spec the network reads (``EncodingSpec.to_json``)."""
    parameters: int
    dataset: str | None = None
    """Belief models: the dataset's name."""
    reward_scale: float | None = None
    """Q networks: how many of the network's units a point is."""
    sessions: tuple[Session, ...] = ()
    """Every training session (``train.sessions``); none for runs from
    before they were recorded."""

    def __post_init__(self) -> None:
        if (self.kind == ModelKind.DMC) != (self.reward_scale is not None):
            raise ValueError("a Q network, and only it, has a reward_scale")

    @property
    def encoding_spec(self) -> EncodingSpec:
        return EncodingSpec.from_json(self.spec)

    def model_config(self) -> dict[str, object]:
        """The ``model`` table of the trainer's config."""
        model = self.config.get("model")
        if not isinstance(model, dict):
            raise schema.SchemaError(f"{self.kind} run: config.model is not a table")
        return cast(dict[str, object], model)

    def to_json(self) -> dict[str, object]:
        out = schema.table(self) | {"sessions": [s.to_json() for s in self.sessions]}
        return {k: v for k, v in out.items() if v is not None}

    @classmethod
    def read(cls, data: object, where: str) -> "Described":
        """``config.json``'s contents; a directory from before ``kind``
        was written is a Q network if it has a ``reward_scale``, else a
        belief model (the only two kinds then)."""
        if not isinstance(data, dict):
            return schema.read(cls, data, where)  # refused: not a table
        fields = cast(dict[str, object], data)
        if "kind" not in fields:
            kind = ModelKind.DMC if "reward_scale" in fields else ModelKind.BELIEF
            fields = {**fields, "kind": kind.value}
        return schema.read(cls, fields, where)


@dataclass(frozen=True)
class RunDir:
    """A model run's directory (or a model directory exported from one:
    ``config.json`` and the weights)."""

    path: Path

    @classmethod
    def named(cls, name: str) -> "RunDir":
        """The run ``name`` in the artifact store."""
        return cls(artifact_store() / "models" / name)

    @property
    def name(self) -> str:
        return self.path.name

    @property
    def config_json(self) -> Path:
        return self.path / "config.json"

    @property
    def log(self) -> Path:
        return self.path / "log.jsonl"

    @property
    def model(self) -> Path:
        """The trained weights."""
        return self.path / "model.pt"

    @property
    def checkpoint(self) -> Path:
        return self.path / "checkpoint.pt"

    def described(self) -> Described:
        text = self.config_json.read_text(encoding="utf-8")
        return Described.read(json.loads(text), str(self.config_json))

    def describe(self, described: Described) -> None:
        """Writes ``config.json``, whole."""
        self.path.mkdir(parents=True, exist_ok=True)
        write_json(self.config_json, described.to_json())


def record(
    run: RunDir, checkout: Checkout, config: str, seeds: tuple[int, ...], encoding: str
) -> Path:
    """Writes the manifest of run directory ``run`` (inside the store) at
    the end of training and returns its path. ``config`` is the producing
    config, relative to the repository."""
    manifest = Manifest(
        name=run.name,
        kind="weights",
        created=datetime.now(UTC).date(),
        commit=checkout.commit,
        config=config,
        seeds=seeds,
        encoding=encoding,
        artifacts=_artifacts(run.path),
        sessions=_sessions(run),
    )
    return _write(checkout, manifest)


def rerecord(run: RunDir, checkout: Checkout) -> Path:
    """Rewrites the manifest of ``run`` after files were added to it (an
    export by ``checkout``): the files are recorded anew, the provenance
    training recorded is kept and ``exported_at`` names this commit."""
    old = Manifest.load(manifest_path(checkout, run.name))
    manifest = dataclasses.replace(
        old,
        artifacts=_artifacts(run.path),
        sessions=old.sessions or _sessions(run),
        exported_at=checkout.commit,
    )
    return _write(checkout, manifest)


def _artifacts(run: Path) -> tuple[Artifact, ...]:
    store = artifact_store()
    paths = sorted(
        p.relative_to(store).as_posix()
        for p in run.rglob("*")
        if p.is_file() and p.name not in TRANSIENT and p.suffix != ".tmp"
    )
    return artifacts(store, paths)


def _sessions(run: RunDir) -> tuple[Session, ...]:
    """The training sessions the run's ``config.json`` lists."""
    if not run.config_json.is_file():
        return ()
    return run.described().sessions


def _write(checkout: Checkout, manifest: Manifest) -> Path:
    path = manifest_path(checkout, manifest.name)
    write_json(path, manifest.to_json(), sort_keys=True)
    return path


def manifest_path(checkout: Checkout, name: str) -> Path:
    return checkout.root / "research" / "manifests" / f"{name}.json"
