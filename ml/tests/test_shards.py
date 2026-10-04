"""Self-play datasets: generated small here, read back in batches."""

import numpy as np
import pytest
from cardgame_env import Env, selfplay

from cardgame_ml.data.shards import ARRAYS, Batch, Dataset

CONFIG = """
name = "tiny"
game = "mighty"
seed = 3
games = 24
rules = "varied"
shard_decisions = 400

[[bots]]
spec = "random"
weight = 1.0

[[bots]]
spec = "simple"
weight = 1.0

[[bots]]
spec = "초보"
weight = 1.0
"""


@pytest.fixture(scope="module")
def dataset(tmp_path_factory: pytest.TempPathFactory) -> Dataset:
    out = tmp_path_factory.mktemp("selfplay") / "tiny"
    stats = selfplay(CONFIG, out, threads=2)
    dataset = Dataset.open(out)
    assert stats["decisions"] == dataset.decisions
    return dataset


def concat(batches: list[Batch]) -> Batch:
    return {k: np.concatenate([b[k] for b in batches]) for k in batches[0]}


def test_reads_the_metadata(dataset: Dataset) -> None:
    assert dataset.name == "tiny"
    assert dataset.encoding == dataset.spec.version == "mighty-1"
    assert dataset.bots == ("random", "simple", "초보")
    assert len(dataset.shards) >= 2
    assert sum(s.games for s in dataset.shards) == 24
    rules = dataset.rules()
    assert all(len(rule_id) == 64 for rule_id in rules)
    assert all("players" in r for r in rules.values())


def test_batches_cover_every_decision_once(dataset: Dataset) -> None:
    batches = list(dataset.batches(64, seed=0))
    assert all(len(b["action"]) <= 64 for b in batches)
    every = concat(batches)
    keys = sorted(zip(every["game"].tolist(), every["decision"].tolist(), strict=True))
    assert len(keys) == dataset.decisions == len(set(keys))
    again = concat(list(dataset.batches(64, seed=0)))
    assert all(np.array_equal(every[k], again[k]) for k in every), "seeded"
    in_order = concat(list(dataset.batches(1000, seed=0, shuffle=False)))
    assert (np.diff(in_order["game"]) >= 0).all()
    dropped = list(dataset.batches(64, seed=0, drop_last=True))
    assert all(len(b["action"]) == 64 for b in dropped)


def test_decisions_fit_the_spec(dataset: Dataset) -> None:
    spec = dataset.spec
    batch = next(dataset.batches(256, seed=1))
    n = len(batch["action"])
    for name, shape in spec.shapes.items():
        assert batch[name].shape == (n, *shape), name
    assert batch["legal"][np.arange(n), batch["action"]].all(), "the action taken was legal"
    assert batch["belief"].shape == (n, len(spec.cards))
    assert batch["belief"].min() >= -1
    assert batch["belief"].max() < len(spec.belief_classes)
    assert (batch["style"] < len(dataset.bots)).all()
    # Padding past each decision's events is empty.
    past = np.arange(spec.max_events)[None, :] >= batch["events_len"][:, None]
    assert (batch["event_cards"][past] == -1).all()
    assert not batch["events"][past].any()


def test_payoffs_are_per_game_and_seat(dataset: Dataset) -> None:
    every = concat(list(dataset.batches(1000, seed=0, shuffle=False)))
    for game in np.unique(every["game"]):
        rows = every["game"] == game
        for seat in np.unique(every["seat"][rows]):
            assert len(np.unique(every["payoff"][rows & (every["seat"] == seat)])) == 1
        assert len(np.unique(every["seed"][rows])) == 1


def test_loads_some_arrays(dataset: Dataset) -> None:
    shard = dataset.load(0, ["action", "events"])
    assert set(shard.arrays) == {"action", "events", "events_len"}
    batch = shard.take(np.arange(3))
    assert set(batch) == {"action", "events", "events_len"}
    with pytest.raises(ValueError, match="no such arrays"):
        dataset.load(0, ["nonsense"])
    assert set(dataset.load(0).arrays) == set(ARRAYS)


def test_a_game_replays_in_the_environment(dataset: Dataset) -> None:
    """Game 0 of a dataset is the first hand of slot 0 of an environment
    with the same seed and rules: replaying its actions there gives back
    its observations, bit for bit."""
    every = concat(list(dataset.batches(1000, seed=0, shuffle=False)))
    first = np.flatnonzero(every["game"] == 0)
    env = Env(num_envs=1, seed=3, rules="varied")
    step = env.reset()
    for row in first:
        for name in ("global", "cards", "events", "event_cards", "legal"):
            assert np.array_equal(step[name][0], every[name][row]), name
        assert step["seat"][0] == every["seat"][row]
        assert np.array_equal(env.belief_targets()[0], every["belief"][row])
        step = env.step(every["action"][[row]])
    assert step["done"][0]
    seat = int(every["seat"][first[0]])
    assert step["reward"][0, seat] == every["payoff"][first[0]]
