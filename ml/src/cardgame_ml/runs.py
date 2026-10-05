"""Model runs in the artifact store: ``models/<name>/``, and the manifest
that records them in ``research/manifests/<name>.json``.

Training writes a run's weights and logs there; exporting adds the ONNX
model and its parity check. Each step rewrites the manifest over every
file the run keeps, so the manifest always matches the directory.
"""

import json
from datetime import UTC, datetime
from pathlib import Path

from cardgame_ml.manifest import Manifest, artifacts
from cardgame_ml.provenance import Checkout
from cardgame_ml.store import artifact_store

TRANSIENT = frozenset({"checkpoint.pt", "checkpoint.tmp"})
"""Files a run writes but does not keep: resuming state, not results."""


def run_dir(name: str) -> Path:
    return artifact_store() / "models" / name


def record(
    run: Path, checkout: Checkout, config: str, seeds: tuple[int, ...], encoding: str
) -> Path:
    """Writes the manifest of run directory ``run`` (inside the store) and
    returns its path. ``config`` is the producing config, relative to the
    repository."""
    store = artifact_store()
    paths = sorted(
        p.relative_to(store).as_posix()
        for p in run.rglob("*")
        if p.is_file() and p.name not in TRANSIENT
    )
    manifest = Manifest(
        name=run.name,
        kind="weights",
        created=datetime.now(UTC).date(),
        commit=checkout.commit,
        config=config,
        seeds=seeds,
        encoding=encoding,
        artifacts=artifacts(store, paths),
    )
    path = manifest_path(checkout, run.name)
    text = json.dumps(manifest.to_json(), indent=2, sort_keys=True, ensure_ascii=False)
    path.write_text(text + "\n", encoding="utf-8")
    return path


def rerecord(run: Path, checkout: Checkout) -> Path:
    """Rewrites the manifest of ``run`` after files were added to it, with
    the config, seeds and encoding training recorded."""
    old = Manifest.load(manifest_path(checkout, run.name))
    return record(run, checkout, old.config, old.seeds, old.encoding or "")


def manifest_path(checkout: Checkout, name: str) -> Path:
    return checkout.root / "research" / "manifests" / f"{name}.json"
