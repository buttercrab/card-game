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
from typing import cast

from cardgame_ml._json import (
    JsonError,
    as_object,
    get,
    get_int,
    get_list,
    get_str,
)

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
        obj = as_object(value, "session")
        commit = get(obj, "commit")
        if commit is not None and not isinstance(commit, str):
            raise JsonError("session commit: expected a string or null")
        dirty = get(obj, "dirty")
        if not isinstance(dirty, bool):
            raise JsonError("session dirty: expected a boolean")
        changed = obj.get("config_changed", [])
        if not isinstance(changed, list) or not all(
            isinstance(c, str) for c in cast(list[object], changed)
        ):
            raise JsonError("session config_changed: expected a list of strings")
        return cls(
            session=get_int(obj, "session"),
            commit=commit,
            dirty=dirty,
            config_sha256=get_str(obj, "config_sha256"),
            seed=get_int(obj, "seed"),
            started=get_str(obj, "started"),
            config_changed=tuple(cast(list[str], changed)),
        )

    def to_json(self) -> dict[str, object]:
        out: dict[str, object] = {
            "session": self.session,
            "commit": self.commit,
            "dirty": self.dirty,
            "config_sha256": self.config_sha256,
            "seed": self.seed,
            "started": self.started,
        }
        if self.config_changed:
            out["config_changed"] = list(self.config_changed)
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
            obj = as_object(value, "manifest")
            encoding = get(obj, "encoding")
            if encoding is not None and not isinstance(encoding, str):
                raise JsonError("encoding: expected a string or null")
            seeds = get_list(obj, "seeds")
            if not all(isinstance(s, int) and not isinstance(s, bool) for s in seeds):
                raise JsonError("seeds: expected a list of integers")
            sessions = obj.get("sessions", [])
            if not isinstance(sessions, list):
                raise JsonError("sessions: expected a list")
            exported_at = obj.get("exported_at")
            if exported_at is not None and not isinstance(exported_at, str):
                raise JsonError("exported_at: expected a string or null")
            return cls(
                name=get_str(obj, "name"),
                kind=get_str(obj, "kind"),
                created=date.fromisoformat(get_str(obj, "created")),
                commit=get_str(obj, "commit"),
                config=get_str(obj, "config"),
                seeds=tuple(cast(list[int], seeds)),
                encoding=encoding,
                artifacts=tuple(
                    _artifact(as_object(a, "artifact")) for a in get_list(obj, "artifacts")
                ),
                sessions=tuple(Session.from_json(s) for s in cast(list[object], sessions)),
                exported_at=exported_at,
            )
        except ManifestError:
            raise
        except ValueError as e:  # a JsonError, or a date that is not ISO
            raise ManifestError(str(e)) from e

    @classmethod
    def load(cls, path: Path) -> "Manifest":
        return cls.from_json(json.loads(path.read_text(encoding="utf-8")))

    def to_json(self) -> dict[str, object]:
        return {
            "name": self.name,
            "kind": self.kind,
            "created": self.created.isoformat(),
            "commit": self.commit,
            "config": self.config,
            "seeds": list(self.seeds),
            "encoding": self.encoding,
            "artifacts": [
                {"path": a.path, "bytes": a.bytes, "sha256": a.sha256} for a in self.artifacts
            ],
            "sessions": [s.to_json() for s in self.sessions],
            "exported_at": self.exported_at,
        }

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


def _artifact(obj: dict[str, object]) -> Artifact:
    return Artifact(
        path=get_str(obj, "path"), bytes=get_int(obj, "bytes"), sha256=get_str(obj, "sha256")
    )


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
