"""Artifact manifests: the schema, verification, the committed ones, and
how training and export record a model's."""

import hashlib
import json
from datetime import date
from pathlib import Path

import pytest

from cardgame_ml import runs
from cardgame_ml.manifest import Artifact, Manifest, ManifestError, load_all
from cardgame_ml.provenance import Checkout


def manifest_json(**changes: object) -> dict[str, object]:
    data: dict[str, object] = {
        "name": "selfplay-test",
        "kind": "self-play",
        "created": "2026-10-05",
        "commit": "0" * 40,
        "config": "research/experiments/example/config.toml",
        "seeds": [0, 1],
        "encoding": "mighty-1",
        "artifacts": [{"path": "shards/part-0000.bin", "bytes": 3, "sha256": "a" * 64}],
    }
    data.update(changes)
    return data


def test_round_trips_through_json() -> None:
    manifest = Manifest.from_json(manifest_json())
    assert manifest.created == date(2026, 10, 5)
    assert manifest.artifacts == (Artifact("shards/part-0000.bin", 3, "a" * 64),)
    assert Manifest.from_json(manifest.to_json()) == manifest


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"kind": "notes"}, "kind"),
        ({"commit": "abc123"}, "40-digit"),
        ({"seeds": []}, "seeds"),
        ({"seeds": [True]}, r"seeds\[0\]: expected int"),
        ({"artifacts": []}, "no artifacts"),
        ({"created": "yesterday"}, "isoformat"),
        ({"encoding": 1}, "encoding"),
        ({"artifacts": [{"path": "../x", "bytes": 1, "sha256": "a" * 64}]}, "inside the store"),
        ({"artifacts": [{"path": "x", "bytes": 1, "sha256": "A" * 64}]}, "lowercase hex"),
    ],
)
def test_rejects_bad_manifests(changes: dict[str, object], message: str) -> None:
    with pytest.raises(ManifestError, match=message):
        Manifest.from_json(manifest_json(**changes))


def test_verifies_files_against_the_record(tmp_path: Path) -> None:
    content = b"abc"
    (tmp_path / "shards").mkdir()
    (tmp_path / "shards/part-0000.bin").write_bytes(content)
    sha = hashlib.sha256(content).hexdigest()
    entry = {"path": "shards/part-0000.bin", "bytes": 3, "sha256": sha}
    Manifest.from_json(manifest_json(artifacts=[entry])).verify(tmp_path)

    wrong = Manifest.from_json(manifest_json())
    with pytest.raises(ManifestError, match="SHA-256"):
        wrong.verify(tmp_path)
    (tmp_path / "shards/part-0000.bin").write_bytes(b"abcd")
    with pytest.raises(ManifestError, match="4 bytes"):
        Manifest.from_json(manifest_json(artifacts=[entry])).verify(tmp_path)


def test_committed_manifests_are_valid(repo: Path) -> None:
    directory = repo / "research/manifests"
    assert directory.is_dir()
    names = [m.name for m in load_all(directory)]
    assert len(set(names)) == len(names), "manifest names are unique"


SESSION = {
    "session": 1,
    "commit": "a" * 40,
    "dirty": False,
    "config_sha256": "c" * 64,
    "seed": 7,
    "started": "2026-10-05T01:00:00Z",
}

DESCRIBED: dict[str, object] = {"config": {}, "encoding": "mighty-1", "spec": {}, "parameters": 1}
"""A run directory's ``config.json`` from before ``kind`` and ``sessions``
were recorded (a belief model's, by the absence of a reward scale)."""


def test_sessions_and_export_round_trip() -> None:
    manifest = Manifest.from_json(manifest_json(sessions=[SESSION], exported_at="e" * 40))
    assert manifest.sessions[0].commit == "a" * 40
    assert manifest.exported_at == "e" * 40
    assert Manifest.from_json(manifest.to_json()) == manifest
    # Older manifests have neither.
    old = Manifest.from_json(manifest_json())
    assert old.sessions == ()
    assert old.exported_at is None
    with pytest.raises(ManifestError, match="session 1: commit"):
        Manifest.from_json(manifest_json(sessions=[{**SESSION, "commit": "abc"}]))
    with pytest.raises(ManifestError, match="exported_at"):
        Manifest.from_json(manifest_json(exported_at="HEAD"))


def test_an_export_keeps_the_training_provenance(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store, repo = tmp_path / "store", tmp_path / "repo"
    monkeypatch.setenv("CARDGAME_ARTIFACTS", str(store))
    (repo / "research" / "manifests").mkdir(parents=True)
    run = runs.RunDir.named("m")
    folder = run.path
    folder.mkdir(parents=True)
    second = {**SESSION, "session": 2, "commit": "b" * 40}
    described = {**DESCRIBED, "sessions": [SESSION, second]}
    (folder / "config.json").write_text(json.dumps(described), encoding="utf-8")
    (folder / "model.pt").write_bytes(b"weights")
    (folder / "checkpoint.pt").write_bytes(b"resume state")
    (folder / "metrics.json.tmp").write_bytes(b"a write under way")

    trained = Checkout(repo, "b" * 40, dirty=False)
    path = runs.record(run, trained, "research/x/config.toml", (7, 1), "mighty-1")
    manifest = Manifest.load(path)
    assert manifest.commit == "b" * 40
    assert [s.commit for s in manifest.sessions] == ["a" * 40, "b" * 40]
    assert manifest.exported_at is None
    assert {a.path for a in manifest.artifacts} == {"models/m/config.json", "models/m/model.pt"}

    (folder / "model.onnx").write_bytes(b"onnx")
    exported = Checkout(repo, "f" * 40, dirty=False)
    again = Manifest.load(runs.rerecord(run, exported))
    assert again.commit == "b" * 40  # still the training commit
    assert again.sessions == manifest.sessions
    assert again.exported_at == "f" * 40
    assert (again.config, again.seeds, again.encoding, again.created) == (
        manifest.config,
        manifest.seeds,
        manifest.encoding,
        manifest.created,
    )
    assert "models/m/model.onnx" in {a.path for a in again.artifacts}


def test_an_old_manifest_is_rerecorded_without_losing_its_commit(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A manifest from before sessions were recorded (a run trained by an
    older build) keeps its training commit through an export."""
    store, repo = tmp_path / "store", tmp_path / "repo"
    monkeypatch.setenv("CARDGAME_ARTIFACTS", str(store))
    (repo / "research" / "manifests").mkdir(parents=True)
    run = runs.RunDir.named("old")
    folder = run.path
    folder.mkdir(parents=True)
    (folder / "config.json").write_text(json.dumps(DESCRIBED), encoding="utf-8")
    (folder / "model.pt").write_bytes(b"weights")
    old = manifest_json(name="old", kind="weights", commit="b" * 40)
    (repo / "research" / "manifests" / "old.json").write_text(json.dumps(old), encoding="utf-8")
    again = Manifest.load(runs.rerecord(run, Checkout(repo, "f" * 40, dirty=False)))
    assert (again.commit, again.exported_at, again.sessions) == ("b" * 40, "f" * 40, ())
