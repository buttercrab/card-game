"""Writes TOML: the effective configs and generated specs the loop keeps.

Enough of TOML for configs: strings, integers, floats, booleans, arrays
of those, tables and arrays of tables; a ``None`` leaves its key out.
``tomllib`` reads it back to the same mapping (tested).
"""

import json
import math
import re
from collections.abc import Mapping, Sequence
from typing import cast

_BARE = re.compile(r"^[A-Za-z0-9_-]+$")


class TomlError(ValueError):
    """A value TOML cannot hold."""


def dumps(data: Mapping[str, object]) -> str:
    lines: list[str] = []
    _table(data, (), lines)
    return "\n".join(lines).strip() + "\n"


def _table(data: Mapping[str, object], path: tuple[str, ...], lines: list[str]) -> None:
    tables: list[tuple[str, Mapping[str, object]]] = []
    arrays: list[tuple[str, list[Mapping[str, object]]]] = []
    for key, value in data.items():
        if value is None:
            continue  # TOML has no null: a key left out
        if isinstance(value, Mapping):
            tables.append((key, cast(Mapping[str, object], value)))
        elif _is_table_array(value):
            arrays.append((key, cast(list[Mapping[str, object]], value)))
        else:
            lines.append(f"{_key(key)} = {_value(value, (*path, key))}")
    for key, table in tables:
        lines.append("")
        lines.append(f"[{_dotted((*path, key))}]")
        _table(table, (*path, key), lines)
    for key, items in arrays:
        for item in items:
            lines.append("")
            lines.append(f"[[{_dotted((*path, key))}]]")
            _table(item, (*path, key), lines)


def _is_table_array(value: object) -> bool:
    if not isinstance(value, list) or not value:
        return False
    items = cast(list[object], value)
    return all(isinstance(v, Mapping) for v in items)


def _key(key: str) -> str:
    return key if _BARE.match(key) else json.dumps(key, ensure_ascii=False)


def _dotted(path: tuple[str, ...]) -> str:
    return ".".join(_key(k) for k in path)


def _value(value: object, path: tuple[str, ...]) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            raise TomlError(f"{_dotted(path)}: {value} has no TOML form here")
        return repr(value)
    if isinstance(value, str):
        # JSON's string escapes are TOML's basic-string escapes.
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, Sequence):
        items = cast(Sequence[object], value)
        return "[" + ", ".join(_value(v, path) for v in items) + "]"
    raise TomlError(f"{_dotted(path)}: cannot write {type(value).__name__}")
