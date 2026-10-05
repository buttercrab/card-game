"""Model runs in the artifact store: ``models/<name>/``, and the manifest
that records them in ``research/manifests/<name>.json``.

Training writes a run's weights and logs there; exporting adds the ONNX
model and its parity check. Each step rewrites the manifest over every
file the run keeps, so the manifest always matches the directory. The
provenance stays training's: the manifest's ``commit`` is the commit
training finished on and ``sessions`` every training session (from the
run's ``config.json``); an export only adds ``exported_at``.
"""

import dataclasses
import json
from datetime import UTC, datetime
from pathlib import Path

from cardgame_ml.manifest import Artifact, Manifest, Session, artifacts
from cardgame_ml.provenance import Checkout
from cardgame_ml.store import artifact_store
from cardgame_ml.train.sessions import recorded_sessions

TRANSIENT = frozenset({"checkpoint.pt", "checkpoint.tmp"})
"""Files a run writes but does not keep: resuming state, not results
(and any ``*.tmp``, a write under way)."""


def run_dir(name: str) -> Path:
    return artifact_store() / "models" / name


def record(
    run: Path, checkout: Checkout, config: str, seeds: tuple[int, ...], encoding: str
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
        artifacts=_artifacts(run),
        sessions=_sessions(run),
    )
    return _write(checkout, manifest)


def rerecord(run: Path, checkout: Checkout) -> Path:
    """Rewrites the manifest of ``run`` after files were added to it (an
    export by ``checkout``): the files are recorded anew, the provenance
    training recorded is kept and ``exported_at`` names this commit."""
    old = Manifest.load(manifest_path(checkout, run.name))
    manifest = dataclasses.replace(
        old,
        artifacts=_artifacts(run),
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


def _sessions(run: Path) -> tuple[Session, ...]:
    """The training sessions the run's ``config.json`` lists."""
    try:
        described = json.loads((run / "config.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        return ()
    return tuple(Session.from_json(s) for s in recorded_sessions(described))


def _write(checkout: Checkout, manifest: Manifest) -> Path:
    path = manifest_path(checkout, manifest.name)
    text = json.dumps(manifest.to_json(), indent=2, sort_keys=True, ensure_ascii=False)
    tmp = path.with_name(f"{path.name}.tmp")
    tmp.write_text(text + "\n", encoding="utf-8")
    tmp.replace(path)
    return path


def manifest_path(checkout: Checkout, name: str) -> Path:
    return checkout.root / "research" / "manifests" / f"{name}.json"
