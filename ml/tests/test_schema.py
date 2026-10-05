"""The typed schema reader every file of the package goes through."""

from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum
from typing import Literal

import pytest

from cardgame_ml import schema
from cardgame_ml.runs import Described, ModelKind
from cardgame_ml.schema import TABLE_KEY, SchemaError, named


class Colour(StrEnum):
    RED = "red"
    BLUE = "blue"


@dataclass(frozen=True)
class Leaf:
    size: int
    weight: float = 1.0

    def __post_init__(self) -> None:
        if self.size < 0:
            raise ValueError("size: not negative")


@dataclass(frozen=True)
class Named:
    name: str = field(default="", metadata=TABLE_KEY)
    port: int = 22


@dataclass(frozen=True, kw_only=True)
class Root:
    kind: Literal["root/1"]
    colour: Colour
    leaf: Leaf
    when: date | None = None
    note: str | None = None
    tags: tuple[str, ...] = ()
    pair: tuple[int, str] = (0, "")
    hosts: dict[str, Named] = field(default_factory=dict[str, Named])
    raw: dict[str, object] = field(default_factory=dict[str, object], metadata=named("set"))
    total: int = field(init=False, default=0)

    def __post_init__(self) -> None:
        object.__setattr__(self, "total", self.leaf.size + len(self.tags))


GOOD: dict[str, object] = {
    "kind": "root/1",
    "colour": "blue",
    "leaf": {"size": 3, "weight": 2},
    "when": "2026-10-06",
    "tags": ["a", "b"],
    "pair": [1, "x"],
    "hosts": {"home": {"port": 2222}},
    "set": {"optim.lr": 0.1, "any": [1, {"thing": True}]},
}


def test_reads_every_kind_of_field() -> None:
    root = schema.read(Root, GOOD, "t")
    assert root.colour is Colour.BLUE
    assert root.leaf == Leaf(3, 2.0)
    assert isinstance(root.leaf.weight, float)
    assert root.when == date(2026, 10, 6)
    assert root.note is None
    assert root.tags == ("a", "b")
    assert root.pair == (1, "x")
    assert root.hosts == {"home": Named("home", 2222)}
    assert root.raw == {"optim.lr": 0.1, "any": [1, {"thing": True}]}
    assert root.total == 5
    # Written back as read: named keys, enums by value, tuples as lists; the
    # table key is not written and the derived field is.
    out = schema.table(root)
    assert out["set"] == GOOD["set"]
    assert out["colour"] == "blue"
    assert out["hosts"] == {"home": {"port": 2222}}
    assert out["total"] == 5
    assert schema.read(Root, out, "again") == root


def test_defaults_fill_missing_keys_unless_turned_off() -> None:
    minimal = {"kind": "root/1", "colour": "red", "leaf": {"size": 1}}
    root = schema.read(Root, minimal, "t")
    assert (root.leaf.weight, root.tags, root.hosts) == (1.0, (), {})
    with pytest.raises(SchemaError, match=r"^t: missing weight$"):
        schema.read(Leaf, {"size": 1}, "t", defaults=False)


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"extra": 1}, r"^t: unknown extra$"),
        ({"kind": "root/2"}, r"t: kind: expected one of 'root/1', got 'root/2'"),
        ({"colour": "green"}, r"t: colour: expected one of red, blue, got 'green'"),
        ({"leaf": {"size": "3"}}, r"t: leaf: size: expected int, got str"),
        ({"leaf": {"size": True}}, r"t: leaf: size: expected int, got a boolean"),
        ({"leaf": {"size": -1}}, r"t: leaf: size: not negative"),
        ({"leaf": {"size": 1, "colour": "red"}}, r"t: leaf: unknown colour"),
        ({"leaf": 3}, r"t: leaf: expected a table, got int"),
        ({"tags": ["a", 2]}, r"t: tags\[1\]: expected str, got int"),
        ({"pair": [1]}, r"t: pair: expected 2 items, got 1"),
        ({"hosts": {"home": {"port": "x"}}}, r"t: hosts.home: port: expected int"),
        ({"when": "soon"}, r"t: when: Invalid isoformat"),
        ({"note": 3}, r"t: note: expected str, got int"),
        ({"colour": None}, r"t: colour: expected one of"),
    ],
)
def test_errors_name_the_path(changes: dict[str, object], message: str) -> None:
    with pytest.raises(SchemaError, match=message):
        schema.read(Root, {**GOOD, **changes}, "t")


def test_unknown_keys_may_be_ignored_for_files_others_write() -> None:
    data = {**GOOD, "machine": {"cpus": 8}, "leaf": {"size": 1, "extra": 2}}
    assert schema.read(Root, data, "t", unknown="ignore").leaf == Leaf(1)


def test_a_model_directorys_kind_is_inferred_for_old_ones() -> None:
    old: dict[str, object] = {"config": {}, "encoding": "mighty-1", "spec": {}, "parameters": 1}
    assert Described.read(old, "t").kind == ModelKind.BELIEF
    q = Described.read({**old, "reward_scale": 0.025}, "t")
    assert (q.kind, q.reward_scale) == (ModelKind.DMC, 0.025)
    assert Described.read({**old, "kind": "belief"}, "t").kind == ModelKind.BELIEF
    with pytest.raises(SchemaError, match="reward_scale"):
        Described.read({**old, "kind": "dmc"}, "t")
    with pytest.raises(SchemaError, match="kind: expected one of belief, dmc"):
        Described.read({**old, "kind": "policy"}, "t")
    written = q.to_json()
    assert written["kind"] == "dmc"
    assert "dataset" not in written
    assert Described.read(written, "again") == q
