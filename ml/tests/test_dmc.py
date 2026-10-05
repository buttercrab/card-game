"""Deep Monte Carlo without PyTorch: action features from a spec, the
committed configs, choosing among legal actions, and the replay buffer."""

import itertools
from pathlib import Path

import numpy as np
import pytest

from cardgame_ml.data.spec import EncodingSpec
from cardgame_ml.models.actions import ActionFeatures
from cardgame_ml.models.config import QConfig, TrunkConfig
from cardgame_ml.train.config import ConfigError
from cardgame_ml.train.dmc.buffer import Decisions, ReplayBuffer
from cardgame_ml.train.dmc.config import DmcConfig


@pytest.fixture
def spec(repo: Path) -> EncodingSpec:
    return EncodingSpec.load(repo / "crates" / "mighty" / "tests" / "encoding.json")


def test_actions_name_their_cards_templates_and_numbers(spec: EncodingSpec) -> None:
    features = ActionFeatures.from_spec(spec)
    index = {name: i for i, name in enumerate(spec.actions)}
    slot = {name: i for i, name in enumerate(spec.cards)}

    def of(name: str) -> tuple[int, str, float]:
        i = index[name]
        return (
            int(features.card[i]),
            features.templates[int(features.template[i])],
            float(features.number[i]),
        )

    assert of("play ♠A") == (slot["♠A"], "play <card>", 0.0)
    assert of("discard ♠A")[0] == of("play ♠A")[0]
    assert of("play ♠2 calling the joker") == (slot["♠2"], "play <card> calling the joker", 0.0)
    assert of("lead RJ as black") == (slot["RJ"], "lead <card> as black", 0.0)
    # "♠2" names a card in "play ♠2", but a number in "bid ♠2": its
    # template also holds "bid ♠1", which is no card.
    card, template, two = of("bid ♠2")
    assert (card, template) == (-1, "bid ♠#")
    assert of("bid ♠4")[2] == pytest.approx(2 * two)
    assert of("bid nt30")[2] == 1.0
    assert of("call seat+3")[:2] == (-1, "call seat+#")
    assert of("pass") == (-1, "pass", 0.0)
    # Every card action of a kind shares one template.
    plays = [i for i, name in enumerate(spec.actions) if name.startswith("play ")]
    assert {int(features.card[i]) for i in plays} == set(range(len(spec.cards)))
    assert len(features.templates) < 40


def test_action_features_are_generic() -> None:
    """Nothing of Mighty's: a made-up game's names read the same way."""
    toy = EncodingSpec(
        version="toy-1",
        global_features=("g",),
        cards=("A", "K", "Q"),
        card_features=("f",),
        max_events=1,
        event_features=("e",),
        actions=("fold", "raise 1", "raise 2", "raise 10", "show A", "show K", "show Q"),
        belief_classes=("x",),
    )
    features = ActionFeatures.from_spec(toy)
    assert features.card.tolist() == [-1, -1, -1, -1, 0, 1, 2]
    assert features.templates == ("fold", "raise #", "show <card>")
    assert features.number.tolist() == pytest.approx([0, 0.1, 0.2, 1, 0, 0, 0])


def test_the_committed_configs_read(repo: Path) -> None:
    folder = repo / "research" / "experiments" / "2026-10-05-dmc-v1"
    main = DmcConfig.load(folder / "config.toml")
    smoke = DmcConfig.load(folder / "smoke.toml")
    for config in (main, smoke):
        assert config.exclude == "research/evals/v1/heldout-rules.json"
        assert (repo / config.exclude).is_file()
        assert isinstance(config.model, QConfig)
        assert isinstance(config.model.trunk, TrunkConfig)
        assert isinstance(config.curve.opponents, tuple)
    assert main.name == "dmc-v1"
    assert main.curve.opponents == ("easy", "normal")


def test_configs_must_exclude_the_held_out_rules(repo: Path, tmp_path: Path) -> None:
    text = (repo / "research" / "experiments" / "2026-10-05-dmc-v1" / "smoke.toml").read_text(
        encoding="utf-8"
    )
    bad = tmp_path / "bad.toml"
    bad.write_text(text.replace('exclude = "research', 'exclude = "" # "'), encoding="utf-8")
    with pytest.raises(ConfigError, match="held-out"):
        DmcConfig.load(bad)
    bad.write_text(text.replace('opponents = ["easy"', "opponents = [1"), encoding="utf-8")
    with pytest.raises(ConfigError, match=r"opponents\[0\]: expected str"):
        DmcConfig.load(bad)


def decisions(spec: EncodingSpec, lengths: list[int], first: int = 0) -> Decisions:
    """Decisions whose every number is its index (from ``first``)."""
    n = len(lengths)
    ids = np.arange(first, first + n)
    shapes = spec.shapes
    return Decisions(
        global_=np.repeat(ids[:, None], shapes["global"][0], 1).astype(np.float32),
        cards=np.broadcast_to(ids[:, None, None], (n, *shapes["cards"])).astype(np.float16),
        events=np.repeat(np.repeat(ids, lengths)[:, None], shapes["events"][1], 1).astype(
            np.float16
        ),
        event_cards=np.repeat(ids, lengths).astype(np.int16),
        events_len=np.array(lengths, np.int32),
        action=ids.astype(np.int64),
        target=ids.astype(np.float32),
    )


def test_the_buffer_keeps_the_latest_and_restores_events(spec: EncodingSpec) -> None:
    buffer = ReplayBuffer(spec, capacity=5)
    buffer.add(decisions(spec, [2, 0, 3]))
    buffer.add(decisions(spec, [1, 4, 2], first=3))
    assert (buffer.size, buffer.added) == (5, 6)
    # The oldest (decision 0) was overwritten by the newest (5).
    assert sorted(buffer.action.tolist()) == [1, 2, 3, 4, 5]
    rng = np.random.default_rng(0)
    batches = buffer.sample(4, rng, batches=3)
    assert len(batches) == 3
    lengths = [np.asarray(b["events_len"], np.int64) for b in batches]
    for batch, longest in zip(batches, lengths, strict=True):
        assert len(batch["target"]) == 4
        assert batch["events"].shape[1] == max(int(longest.max()), 1)
        for i, d in enumerate(batch["action"].tolist()):
            length = int(batch["events_len"][i])
            assert batch["target"][i] == d
            assert (batch["events"][i, :length] == d).all()
            assert (batch["events"][i, length:] == 0).all()
            assert (batch["event_cards"][i, :length] == d).all()
            assert (batch["event_cards"][i, length:] == -1).all()
    # Sorted by length before cutting: batches barely overlap in length.
    spans = sorted((int(length.min()), int(length.max())) for length in lengths)
    assert all(a[1] <= b[0] for a, b in itertools.pairwise(spans))
