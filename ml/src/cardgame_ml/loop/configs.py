"""A run's effective training config: the spec's base file (or inline
table), its ``set`` overrides, then what the loop decides itself (the
run's name, its seed, the protocol's learning curve, the budget).

Overrides only change keys the base already has, to a value of the same
type: a misspelt key is an error, never a new setting nobody reads.
"""

import copy
import tomllib
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import cast

from cardgame_ml.loop.spec import Spec, SpecError


def base_config(spec: Spec, repo: Path) -> dict[str, object]:
    """The config the spec starts from, unchanged."""
    source = spec.config
    if source.inline is not None:
        return copy.deepcopy(source.inline)
    if source.base is None:
        return {}
    path = (repo / source.base).resolve()
    research = (repo / "research").resolve()
    if not path.is_relative_to(research) or path.is_relative_to(research / "evals"):
        raise SpecError(f"{spec.id}: config.base must be a file in research/ (not research/evals)")
    if not path.is_file():
        raise SpecError(f"{spec.id}: config.base {source.base} does not exist")
    with path.open("rb") as f:
        return tomllib.load(f)


def effective_config(
    spec: Spec, repo: Path, decided: Mapping[str, object], protected: frozenset[str]
) -> dict[str, object]:
    """The base with the spec's overrides, then ``decided`` (dotted keys
    the loop sets). Overrides may not touch ``decided`` or ``protected``
    keys (nor tables under them)."""
    config = base_config(spec, repo)
    for key, value in spec.config.overrides.items():
        closed = [k for k in (*decided, *protected) if key == k or key.startswith(k + ".")]
        if closed:
            raise SpecError(f"{spec.id}: config.set: {key} is set by the loop, not the spec")
        current = get_path(config, key)
        if current is None:
            raise SpecError(f"{spec.id}: config.set: {key} is not in the base config")
        if not _same_kind(current, value):
            raise SpecError(
                f"{spec.id}: config.set: {key} is {type(current).__name__} in the base, "
                f"got {type(value).__name__}"
            )
        set_path(config, key, value)
    for key, value in decided.items():
        set_path(config, key, value)
    return config


def get_path(data: Mapping[str, object], dotted: str) -> object | None:
    table: Mapping[str, object] = data
    parts = dotted.split(".")
    for part in parts[:-1]:
        child = table.get(part)
        if not isinstance(child, dict):
            return None
        table = cast(dict[str, object], child)
    return table.get(parts[-1])


def set_path(data: dict[str, object], dotted: str, value: object) -> None:
    parts = dotted.split(".")
    node = data
    for part in parts[:-1]:
        child = node.setdefault(part, {})
        if not isinstance(child, dict):
            raise SpecError(f"{dotted}: {part} is not a table")
        node = cast(dict[str, object], child)
    node[parts[-1]] = value


def strings(data: object, path: str = "") -> Iterator[tuple[str, str]]:
    """Every string in a parsed document, with its dotted path."""
    if isinstance(data, str):
        yield path, data
    elif isinstance(data, Mapping):
        for key, value in cast(Mapping[str, object], data).items():
            yield from strings(value, f"{path}.{key}" if path else key)
    elif isinstance(data, list):
        for i, value in enumerate(cast(list[object], data)):
            yield from strings(value, f"{path}[{i}]")


def _same_kind(current: object, value: object) -> bool:
    if isinstance(current, bool) or isinstance(value, bool):
        return isinstance(current, bool) and isinstance(value, bool)
    if isinstance(current, int | float) and isinstance(value, int | float):
        return not (isinstance(current, int) and isinstance(value, float))
    if isinstance(current, Mapping):
        return False
    return type(current) is type(value)
