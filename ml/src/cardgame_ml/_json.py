"""Typed reading of parsed JSON, with errors that say which field is wrong."""

from typing import cast


class JsonError(ValueError):
    """A JSON document does not have the expected shape."""


def as_object(value: object, what: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise JsonError(f"{what}: expected an object")
    return cast(dict[str, object], value)


def get(obj: dict[str, object], key: str) -> object:
    if key not in obj:
        raise JsonError(f"missing field {key!r}")
    return obj[key]


def get_str(obj: dict[str, object], key: str) -> str:
    value = get(obj, key)
    if not isinstance(value, str):
        raise JsonError(f"{key}: expected a string")
    return value


def get_int(obj: dict[str, object], key: str) -> int:
    value = get(obj, key)
    # bool is an int in Python, never in these documents.
    if not isinstance(value, int) or isinstance(value, bool):
        raise JsonError(f"{key}: expected an integer")
    return value


def get_list(obj: dict[str, object], key: str) -> list[object]:
    value = get(obj, key)
    if not isinstance(value, list):
        raise JsonError(f"{key}: expected a list")
    return cast(list[object], value)


def get_str_tuple(obj: dict[str, object], key: str) -> tuple[str, ...]:
    items = get_list(obj, key)
    if not all(isinstance(item, str) for item in items):
        raise JsonError(f"{key}: expected a list of strings")
    return tuple(cast(list[str], items))
