"""Manifests: how large artifacts outside git are named and checked from inside it.

Self-play shards and model weights are too large for the repository, so
they live elsewhere and a manifest under ``research/manifests/`` records
each file's path, size and SHA-256, with the commit, config and seeds that
produced it. Anyone with the files can verify them against the manifest;
anyone without them can reproduce them from the commit.

The JSON form, one manifest per file::

    {
      "name": "selfplay-gshs-2026-10",
      "kind": "self-play",
      "created": "2026-10-05",
      "commit": "<40 hex digits>",
      "config": "research/experiments/<folder>/config.toml",
      "seeds": [0, 1, 2],
      "encoding": "mighty-1",
      "artifacts": [{"path": "shards/part-0000.bin", "bytes": 1048576,
                     "sha256": "<64 hex digits>"}],
      "sessions": [{"session": 1, "commit": "<40 hex digits>", "dirty": false,
                    "config_sha256": "<64 hex digits>", "seed": 0,
                    "started": "2026-10-05T01:00:00Z"}],
      "exported_at": "<40 hex digits>"
    }

``encoding`` is the encoding spec version the data or model uses, or null.
Artifact paths are relative to wherever the artifact store is mounted.

``commit`` is the commit that produced the artifacts (for a model: the
one its training finished on). A model trained over several sessions
lists each in ``sessions`` (its commit, config hash and seed;
``train.sessions``), and ``exported_at`` is the commit that exported it
to ONNX (``null`` before that). Both are optional: older manifests have
neither.
"""

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path, PurePosixPath

from cardgame_ml import schema
from cardgame_ml.schema import SchemaError

KINDS = ("self-play", "weights", "eval", "other")
"""What a manifest may describe."""

_COMMIT = re.compile(r"[0-9a-f]{40}")
_SHA256 = re.compile(r"[0-9a-f]{64}")


class ManifestError(ValueError):
    """A manifest is malformed, or files do not match it."""


@dataclass(frozen=True)
class Artifact:
    path: str
    bytes: int
    sha256: str


@dataclass(frozen=True)
class Session:
    """One training session of a model (see ``train.sessions``)."""

    session: int
    commit: str | None
    dirty: bool
    config_sha256: str
    seed: int
    started: str
    config_changed: tuple[str, ...] = ()

    @classmethod
    def from_json(cls, value: object) -> "Session":
        return schema.read(cls, value, "session")

    def to_json(self) -> dict[str, object]:
        out = schema.table(self)
        if not self.config_changed:
            del out["config_changed"]
        return out


@dataclass(frozen=True)
class Manifest:
    name: str
    kind: str
    created: date
    commit: str
    config: str
    seeds: tuple[int, ...]
    encoding: str | None
    artifacts: tuple[Artifact, ...]
    sessions: tuple[Session, ...] = ()
    exported_at: str | None = None

    def __post_init__(self) -> None:
        problems = list(_problems(self))
        if problems:
            raise ManifestError(f"manifest {self.name!r}: " + "; ".join(problems))

    @classmethod
    def from_json(cls, value: object) -> "Manifest":
        try:
            return schema.read(cls, value, "manifest")
        except SchemaError as e:
            raise ManifestError(str(e)) from e

    @classmethod
    def load(cls, path: Path) -> "Manifest":
        return cls.from_json(json.loads(path.read_text(encoding="utf-8")))

    def to_json(self) -> dict[str, object]:
        return schema.table(self) | {"sessions": [s.to_json() for s in self.sessions]}

    def verify(self, root: Path) -> None:
        """Checks every artifact under ``root`` has the recorded size and hash."""
        for artifact in self.artifacts:
            path = root / artifact.path
            if not path.is_file():
                raise ManifestError(f"{artifact.path}: missing under {root}")
            size = path.stat().st_size
            if size != artifact.bytes:
                raise ManifestError(f"{artifact.path}: {size} bytes, expected {artifact.bytes}")
            if sha256_file(path) != artifact.sha256:
                raise ManifestError(f"{artifact.path}: SHA-256 does not match")


def _provenance_problems(m: Manifest) -> list[str]:
    problems: list[str] = []
    if m.exported_at is not None and not _COMMIT.fullmatch(m.exported_at):
        problems.append("exported_at must be a full 40-digit lowercase hash")
    for s in m.sessions:
        if s.commit is not None and not _COMMIT.fullmatch(s.commit):
            problems.append(f"session {s.session}: commit must be a full 40-digit lowercase hash")
        if not _SHA256.fullmatch(s.config_sha256):
            problems.append(f"session {s.session}: config_sha256 must be 64 lowercase hex digits")
    return problems


def _problems(m: Manifest) -> list[str]:
    problems: list[str] = []
    if not m.name:
        problems.append("name is empty")
    if m.kind not in KINDS:
        problems.append(f"kind {m.kind!r} is not one of {', '.join(KINDS)}")
    if not _COMMIT.fullmatch(m.commit):
        problems.append("commit must be a full 40-digit lowercase hash")
    if not m.config:
        problems.append("config is empty")
    problems += _provenance_problems(m)
    if not m.seeds:
        problems.append("no seeds: every run names its seeds")
    if not m.artifacts:
        problems.append("no artifacts")
    paths = [a.path for a in m.artifacts]
    if len(set(paths)) != len(paths):
        problems.append("an artifact is listed twice")
    for a in m.artifacts:
        pure = PurePosixPath(a.path)
        if not a.path or pure.is_absolute() or ".." in pure.parts:
            problems.append(f"{a.path!r}: paths are relative and stay inside the store")
        if a.bytes < 0:
            problems.append(f"{a.path}: negative size")
        if not _SHA256.fullmatch(a.sha256):
            problems.append(f"{a.path}: sha256 must be 64 lowercase hex digits")
    return problems


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifacts(store: Path, paths: list[str]) -> tuple[Artifact, ...]:
    """Records the files at ``paths`` (relative to ``store``) as they are now."""
    return tuple(
        Artifact(path, (store / path).stat().st_size, sha256_file(store / path)) for path in paths
    )


def load_all(directory: Path) -> list[Manifest]:
    """Every manifest under ``directory``, sorted by path."""
    return [Manifest.load(p) for p in sorted(directory.rglob("*.json"))]
