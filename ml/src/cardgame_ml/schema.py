"""One typed reader for the package's files: TOML configs and specs, the
loop's policy and records, model directories' ``config.json`` and the
``eval`` tool's results.

A schema is a dataclass. ``read`` builds one from parsed TOML or JSON,
checking every value against its field's type and naming the path of the
first one that does not fit (``policy.toml: hosts: home: threads:
expected int, got str``). Fields are:

- ``str``, ``int``, ``float`` (an integer is fine; a boolean is never a
  number), ``bool`` and ``date`` (an ISO string);
- ``X | None`` (``null`` in JSON; TOML has none, so leave it out with a
  default of ``None``);
- ``Literal[...]`` and ``StrEnum`` subclasses, by value;
- nested dataclasses (tables), ``tuple[T, ...]`` and ``list[T]``
  (arrays), fixed ``tuple[A, B]`` and ``dict[str, T]`` (tables of
  values);
- ``object``: taken as it is (a table whose keys someone else checks).

A key missing from the data takes its field's default, when the field has
one and ``defaults`` is on (training configs turn it off: every field
spelled out, so a config never leans on a default that could change under
it). An unknown key is an error unless ``unknown="ignore"`` (results
written by another program, of which only some fields are read).

A field may have another name in the file (``named``), or be filled from
the key of the table that holds it (``TABLE_KEY``: a host's name, from
``[hosts.<name>]``). A field the dataclass derives (``init=False``) is
written by ``data`` for other readers and skipped when read back. A
dataclass's ``__post_init__`` may refuse values
with a ``ValueError``: it is reported with the path, like a wrong type.

``data`` is the inverse: a schema's value as the plain mapping it reads
from (tuples as lists, enums as their values, fields under their names in
the file).
"""

import dataclasses
import enum
import types
import typing
from collections.abc import Mapping
from datetime import date
from typing import Any, Literal, cast

type Unknown = Literal["reject", "ignore"]

_NAME = "schema.name"
_TABLE_KEY = "schema.table_key"


class SchemaError(ValueError):
    """Data does not match its schema."""


def named(name: str) -> Mapping[str, object]:
    """Field metadata: the field is called ``name`` in the file (``set``,
    say, which is no name for an attribute):
    ``field(metadata=named("set"))``."""
    return types.MappingProxyType({_NAME: name})


TABLE_KEY: Mapping[str, object] = types.MappingProxyType({_TABLE_KEY: True})
"""Field metadata: the field is filled from the key under which its table
sits in a ``dict[str, T]`` (and is not read from the table):
``field(default="", metadata=TABLE_KEY)``."""


@dataclasses.dataclass(frozen=True)
class _Options:
    defaults: bool
    unknown: Unknown


def read[T](
    cls: type[T],
    value: object,
    where: str,
    *,
    defaults: bool = True,
    unknown: Unknown = "reject",
) -> T:
    """The dataclass ``cls`` from ``value`` (a parsed table), or
    ``SchemaError`` naming ``where`` and the path to the problem."""
    return _dataclass(cls, value, where, _Options(defaults, unknown), None)


def data(value: object) -> object:
    """``value`` (a schema, or anything inside one) as plain data."""
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        out: dict[str, object] = {}
        for f in dataclasses.fields(value):
            if f.metadata.get(_TABLE_KEY):
                continue
            out[f.metadata.get(_NAME, f.name)] = data(getattr(value, f.name))
        return out
    if isinstance(value, enum.Enum):
        return cast(object, value.value)
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Mapping):
        return {str(k): data(v) for k, v in cast(Mapping[object, object], value).items()}
    if isinstance(value, list | tuple):
        return [data(v) for v in cast(list[object], value)]
    return value


def table(value: object) -> dict[str, object]:
    """A schema's value as a table (``data`` of a dataclass)."""
    out = data(value)
    if not isinstance(out, dict):
        raise TypeError(f"{type(value).__name__} is not a schema")
    return cast(dict[str, object], out)


def _dataclass[T](cls: type[T], value: object, where: str, options: _Options, key: str | None) -> T:
    if not isinstance(value, Mapping):
        raise SchemaError(f"{where}: expected a table, got {_kind(value)}")
    given = cast(Mapping[str, object], value)
    hints = typing.get_type_hints(cls)
    every = dataclasses.fields(cast(Any, cls))
    fields = [f for f in every if f.init]
    names = {f.metadata.get(_NAME, f.name): f for f in fields if not f.metadata.get(_TABLE_KEY)}
    derived = {f.name for f in every if not f.init}
    missing = [
        name
        for name, f in names.items()
        if name not in given and not (options.defaults and _has_default(f))
    ]
    known = names.keys() | derived
    unknown = [k for k in given if k not in known] if options.unknown == "reject" else []
    if missing or unknown:
        problems = [f"missing {', '.join(missing)}"] if missing else []
        problems += [f"unknown {', '.join(unknown)}"] if unknown else []
        raise SchemaError(f"{where}: {'; '.join(problems)}")
    values: dict[str, object] = {}
    for f in fields:
        if f.metadata.get(_TABLE_KEY):
            values[f.name] = key or ""
            continue
        name = f.metadata.get(_NAME, f.name)
        if name in given:
            values[f.name] = _value(hints[f.name], given[name], f"{where}: {name}", options)
    try:
        return cls(**values)
    except SchemaError:
        raise
    except (ValueError, TypeError) as e:
        raise SchemaError(f"{where}: {e}") from e


def _has_default(f: dataclasses.Field[object]) -> bool:
    return f.default is not dataclasses.MISSING or f.default_factory is not dataclasses.MISSING


def _value(  # noqa: PLR0911, PLR0912
    kind: object, value: object, at: str, options: _Options, key: str | None = None
) -> object:
    """``value`` as ``kind``; ``key``: the key it sits under in a table of
    values (for a dataclass's ``TABLE_KEY`` field)."""
    origin, args = typing.get_origin(kind), typing.get_args(kind)
    if kind is object or kind is Any:
        return value
    if isinstance(kind, type) and dataclasses.is_dataclass(kind):
        return _dataclass(kind, value, at, options, key)
    if origin is typing.Union or isinstance(kind, types.UnionType):
        return _union(args, value, at, options)
    if origin is Literal:
        if value not in args:
            raise SchemaError(f"{at}: expected one of {', '.join(map(repr, args))}, got {value!r}")
        return value
    if isinstance(kind, type) and issubclass(kind, enum.Enum):
        allowed = [m.value for m in kind]
        if value not in allowed:
            raise SchemaError(
                f"{at}: expected one of {', '.join(map(str, allowed))}, got {value!r}"
            )
        return kind(value)
    if origin in (tuple, list):
        if not isinstance(value, list | tuple):
            raise SchemaError(f"{at}: expected an array, got {_kind(value)}")
        items = cast(list[object], value)
        if origin is list:
            return [_value(args[0], item, f"{at}[{i}]", options) for i, item in enumerate(items)]
        if len(args) == 2 and args[1] is Ellipsis:  # noqa: PLR2004
            return tuple(
                _value(args[0], item, f"{at}[{i}]", options) for i, item in enumerate(items)
            )
        if len(items) != len(args):
            raise SchemaError(f"{at}: expected {len(args)} items, got {len(items)}")
        return tuple(
            _value(a, item, f"{at}[{i}]", options)
            for i, (a, item) in enumerate(zip(args, items, strict=True))
        )
    if origin is dict:
        if not isinstance(value, Mapping):
            raise SchemaError(f"{at}: expected a table, got {_kind(value)}")
        entries = cast(Mapping[object, object], value)
        out: dict[str, object] = {}
        for k, item in entries.items():
            if not isinstance(k, str):
                raise SchemaError(f"{at}: keys are strings")
            out[k] = _value(args[1], item, f"{at}.{k}", options, key=k)
        return out
    return _scalar(cast(object, kind), value, at)


def _union(args: tuple[object, ...], value: object, at: str, options: _Options) -> object:
    if value is None:
        if type(None) in args:
            return None
        raise SchemaError(f"{at}: expected a value, got null")
    arms = [a for a in args if a is not type(None)]
    if len(arms) == 1:
        return _value(arms[0], value, at, options)
    errors: list[str] = []
    for arm in arms:
        try:
            return _value(arm, value, at, options)
        except SchemaError as e:
            errors.append(str(e))
    raise SchemaError(errors[0])


def _scalar(kind: object, value: object, at: str) -> object:
    if not isinstance(kind, type):
        raise SchemaError(f"{at}: the schema's type {kind!r} is not supported")
    if kind is date:
        if not isinstance(value, str):
            raise SchemaError(f"{at}: expected an ISO date, got {_kind(value)}")
        try:
            return date.fromisoformat(value)
        except ValueError as e:
            raise SchemaError(f"{at}: {e}") from e
    # Integers are fine where a float is wanted; booleans are never numbers.
    if kind is float and isinstance(value, int) and not isinstance(value, bool):
        return float(value)
    if kind is not bool and isinstance(value, bool):
        raise SchemaError(f"{at}: expected {kind.__name__}, got a boolean")
    if isinstance(value, kind):
        return value
    raise SchemaError(f"{at}: expected {kind.__name__}, got {_kind(value)}")


def _kind(value: object) -> str:
    return "null" if value is None else type(value).__name__
