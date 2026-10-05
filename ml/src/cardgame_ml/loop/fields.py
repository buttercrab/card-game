"""Typed reading of parsed TOML tables, with errors that name the file and
the key. Unlike ``train.config.from_mapping`` (every field required, as
training configs are), loop files may leave a few keys to stated
defaults, so the reader is explicit per key."""

from collections.abc import Mapping
from typing import cast


class FieldError(ValueError):
    """A loop file does not match its schema."""


class Table:
    """One TOML table being read: ask for each key, then ``done()``
    rejects any key nobody asked for (a typo is an error, not ignored)."""

    def __init__(self, data: Mapping[str, object], where: str) -> None:
        self.data, self.where = data, where
        self._seen: set[str] = set()

    def _get(self, key: str, default: object = ...) -> object:
        self._seen.add(key)
        if key in self.data:
            return self.data[key]
        if default is ...:
            raise FieldError(f"{self.where}: missing {key}")
        return default

    def _fail(self, key: str, expected: str, value: object) -> FieldError:
        return FieldError(f"{self.where}: {key}: expected {expected}, got {type(value).__name__}")

    def text(self, key: str, default: str | None = None) -> str:
        value = self._get(key, ... if default is None else default)
        if not isinstance(value, str):
            raise self._fail(key, "a string", value)
        return value

    def opt_text(self, key: str) -> str | None:
        value = self._get(key, None)
        if value is None:
            return None
        if not isinstance(value, str):
            raise self._fail(key, "a string", value)
        return value

    def integer(self, key: str, default: int | None = None) -> int:
        value = self._get(key, ... if default is None else default)
        if not isinstance(value, int) or isinstance(value, bool):
            raise self._fail(key, "an integer", value)
        return value

    def number(self, key: str, default: float | None = None) -> float:
        value = self._get(key, ... if default is None else default)
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise self._fail(key, "a number", value)
        return float(value)

    def flag(self, key: str, default: bool | None = None) -> bool:
        value = self._get(key, ... if default is None else default)
        if not isinstance(value, bool):
            raise self._fail(key, "true or false", value)
        return value

    def texts(self, key: str, default: tuple[str, ...] | None = None) -> tuple[str, ...]:
        value = self._get(key, ... if default is None else list(default))
        if not isinstance(value, list):
            raise self._fail(key, "a list of strings", value)
        items = cast(list[object], value)
        if not all(isinstance(v, str) for v in items):
            raise FieldError(f"{self.where}: {key}: expected a list of strings")
        return tuple(cast(list[str], items))

    def integers(self, key: str) -> tuple[int, ...]:
        value = self._get(key)
        if not isinstance(value, list):
            raise self._fail(key, "a list of integers", value)
        items = cast(list[object], value)
        if not all(isinstance(v, int) and not isinstance(v, bool) for v in items):
            raise FieldError(f"{self.where}: {key}: expected a list of integers")
        return tuple(cast(list[int], items))

    def table(self, key: str, required: bool = True) -> "Table":
        value = self._get(key, ... if required else {})
        if not isinstance(value, Mapping):
            raise self._fail(key, "a table", value)
        return Table(cast(Mapping[str, object], value), f"{self.where}: {key}")

    def raw_table(self, key: str) -> dict[str, object]:
        """A table taken whole, its keys checked by whoever uses it."""
        value = self._get(key, {})
        if not isinstance(value, Mapping):
            raise self._fail(key, "a table", value)
        return dict(cast(Mapping[str, object], value))

    def tables(self, key: str) -> list["Table"]:
        value = self._get(key, [])
        if not isinstance(value, list):
            raise self._fail(key, "an array of tables", value)
        items = cast(list[object], value)
        out: list[Table] = []
        for i, item in enumerate(items):
            if not isinstance(item, Mapping):
                raise FieldError(f"{self.where}: {key}[{i}]: expected a table")
            out.append(Table(cast(Mapping[str, object], item), f"{self.where}: {key}[{i}]"))
        return out

    def done(self) -> None:
        unknown = sorted(set(self.data) - self._seen)
        if unknown:
            raise FieldError(f"{self.where}: unknown {', '.join(unknown)}")
