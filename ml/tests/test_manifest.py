"""Artifact manifests: the schema, verification, and the committed ones."""

import hashlib
from datetime import date
from pathlib import Path

import pytest

from cardgame_ml.manifest import Artifact, Manifest, ManifestError, load_all


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
        ({"seeds": [True]}, "integers"),
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
