"""The encoding spec the Rust side pins, read from Python."""

from pathlib import Path

import pytest

from cardgame_ml._json import JsonError
from cardgame_ml.data.spec import EncodingSpec


def mighty_spec(repo: Path) -> EncodingSpec:
    return EncodingSpec.load(repo / "crates/mighty/tests/encoding.json")


def test_reads_mightys_pinned_spec(repo: Path) -> None:
    spec = mighty_spec(repo)
    assert spec.version.startswith("mighty-")
    # Four suits of 2 to A, then two jokers.
    assert len(spec.cards) == 54
    assert spec.cards[0] == "♠2"
    assert spec.cards[-2:] == ("BJ", "RJ")
    assert spec.belief_classes[-1] == "buried"
    assert spec.actions[:2] == ("pass", "misdeal")


def test_shapes_follow_the_names(repo: Path) -> None:
    spec = mighty_spec(repo)
    shapes = spec.shapes
    assert shapes["cards"] == (54, len(spec.card_features))
    assert shapes["events"] == (spec.max_events, len(spec.event_features))
    assert shapes["legal"] == (len(spec.actions),)
    for names in (spec.global_features, spec.card_features, spec.event_features, spec.actions):
        assert len(set(names)) == len(names), "names are unique"


def test_rejects_malformed_specs() -> None:
    with pytest.raises(JsonError, match="missing field 'version'"):
        EncodingSpec.from_json({})
    with pytest.raises(JsonError, match="expected an object"):
        EncodingSpec.from_json([])
