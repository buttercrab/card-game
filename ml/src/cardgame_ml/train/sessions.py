"""Training sessions: what each start or resume of a run was.

A run's ``config.json`` keeps ``sessions``, one entry per session: its
number, the commit it ran (and whether the checkout was dirty), the
SHA-256 of its config, its seed and when it started. The manifest copies
them, so a run trained over several sessions names every commit that
trained it, and the ``start`` line of the log carries the same.

A session resumes only with the config the run was started with,
``budget`` aside (a run may be given more hands or hours): anything else
is refused (``ConfigChangedError``) unless the caller says to accept it,
and then the session records which keys changed. Keys the record does
not have (a field this build added, whose default keeps the old
behaviour) do not count as changes.
"""

import hashlib
import json
from collections.abc import Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast


class ConfigChangedError(ValueError):
    """A run is resumed with another config than it was started with."""


def config_sha256(config: Mapping[str, Any]) -> str:
    """The SHA-256 of a config, as canonical JSON."""
    text = json.dumps(config, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _flatten(value: Mapping[str, Any], prefix: str = "") -> dict[str, Any]:
    flat: dict[str, Any] = {}
    for key, item in value.items():
        path = f"{prefix}{key}"
        if isinstance(item, Mapping):
            flat |= _flatten(cast(Mapping[str, Any], item), f"{path}.")
        else:
            flat[path] = item
    return flat


def differences(
    recorded: Mapping[str, Any], current: Mapping[str, Any], ignore: tuple[str, ...] = ()
) -> list[str]:
    """The keys (dotted) whose values differ between the config a run
    recorded and ``current``, outside the ``ignore`` tables; a key only
    ``current`` has is not a difference."""
    old, new = _flatten(recorded), _flatten(json.loads(json.dumps(current)))

    def kept(key: str) -> bool:
        return not any(key == t or key.startswith(f"{t}.") for t in ignore)

    changed: list[str] = []
    for key in sorted(old):
        if not kept(key):
            continue
        if key not in new:
            changed.append(f"{key} ({old[key]!r} → absent)")
        elif new[key] != old[key]:
            changed.append(f"{key} ({old[key]!r} → {new[key]!r})")
    return changed


def check_resume(
    where: Path,
    recorded: Mapping[str, Any],
    current: Mapping[str, Any],
    *,
    ignore: tuple[str, ...] = (),
    allow_change: bool = False,
) -> list[str]:
    """Refuses to resume the run in ``where`` with a changed config
    (unless ``allow_change``); returns the changes."""
    changed = differences(recorded, current, ignore)
    if changed and not allow_change:
        outside = f" outside {', '.join(ignore)}" if ignore else ""
        raise ConfigChangedError(
            f"{where}: the config differs from the one the run was started with{outside}: "
            + "; ".join(changed)
            + ". Start a new run under another name, or resume with --allow-config-change "
            "to accept the change (it is recorded in the run's sessions)."
        )
    return changed


def session(  # noqa: PLR0913, PLR0917
    number: int,
    commit: str | None,
    dirty: bool,
    config: Mapping[str, Any],
    seed: int,
    changed: list[str] | None = None,
) -> dict[str, Any]:
    """One entry of ``sessions``."""
    entry: dict[str, Any] = {
        "session": number,
        "commit": commit,
        "dirty": dirty,
        "config_sha256": config_sha256(json.loads(json.dumps(config))),
        "seed": seed,
        "started": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    if changed:
        entry["config_changed"] = changed
    return entry


def recorded_sessions(described: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The sessions a run's ``config.json`` lists (none for runs from
    before they were recorded)."""
    value = described.get("sessions")
    if not isinstance(value, list):
        return []
    return [cast(dict[str, Any], s) for s in cast(list[object], value) if isinstance(s, dict)]


def write_json(path: Path, value: object) -> None:
    """Writes ``value`` to ``path`` atomically: a crash leaves the old file."""
    tmp = path.with_name(f"{path.name}.tmp")
    tmp.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)
