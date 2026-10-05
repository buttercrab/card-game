"""The Rust environment through its Python bindings (``cardgame_env``)."""

import hashlib
import json
from pathlib import Path
from typing import cast

import numpy as np
import pytest
from cardgame_env import Env, Step
from numpy.typing import NDArray

from cardgame_ml.data.spec import EncodingSpec

ALL_SEATS = list(range(8))
OBSERVATION = ("global", "cards", "events", "event_cards", "legal")


def choose(step: Step, number: int) -> NDArray[np.int64]:
    """The choice ``crates/env/tests/common`` makes: of each hand's legal
    indices, ascending, the one at ``(7 * number + slot) mod count``."""
    actions: list[int] = []
    for slot, mask in enumerate(step["legal"]):
        legal = np.flatnonzero(mask)
        actions.append(int(legal[(7 * number + slot) % len(legal)]))
    return np.array(actions, dtype=np.int64)


def random_actions(step: Step, rng: np.random.Generator) -> NDArray[np.int64]:
    """A uniformly random legal action per hand."""
    scores = rng.random(step["legal"].shape)
    scores[~step["legal"]] = -1.0
    return scores.argmax(axis=1).astype(np.int64)


def field(step: Step, name: str) -> NDArray[np.generic]:
    """A field by a name only known at run time."""
    return cast(dict[str, NDArray[np.generic]], step)[name]


def same(a: Step, b: Step) -> bool:
    return all(np.array_equal(field(a, k), field(b, k)) for k in a)


def test_spec_is_the_pinned_one(repo: Path) -> None:
    env = Env(num_envs=1, seed=0)
    pinned = EncodingSpec.load(repo / "crates/mighty/tests/encoding.json")
    assert EncodingSpec.from_json(env.spec()) == pinned


def test_shapes_follow_the_spec() -> None:
    env = Env(num_envs=5, seed=1)
    spec = EncodingSpec.from_json(env.spec())
    step = env.reset()
    for name, shape in spec.shapes.items():
        assert field(step, name).shape == (5, *shape), name
    assert step["global"].dtype == np.float32
    assert step["event_cards"].dtype == np.int32
    assert step["legal"].dtype == np.bool_
    assert step["reward"].shape == (5, env.max_seats)
    for name in ("events_len", "seat", "done"):
        assert step[name].shape == (5,)
    assert env.belief_targets().shape == (5, len(spec.cards))
    for name in OBSERVATION:
        assert step[name].flags.c_contiguous


def test_same_seed_same_trajectory() -> None:
    def run(threads: int) -> list[Step]:
        env = Env(num_envs=4, seed=3, controlled=ALL_SEATS, threads=threads)
        steps = [env.reset()]
        for number in range(80):
            steps.append(env.step(choose(steps[-1], number)))
        return steps

    one, many = run(1), run(3)
    assert all(same(a, b) for a, b in zip(one, many, strict=True))
    other = Env(num_envs=4, seed=4).reset()
    assert not same(other, one[0])


def test_legal_masks_and_illegal_actions() -> None:
    env = Env(num_envs=3, seed=5)
    twin = Env(num_envs=3, seed=5)
    step = env.reset()
    twin.reset()
    assert step["legal"].any(axis=1).all(), "every hand has a legal action"
    illegal = choose(step, 0)
    illegal[1] = int(np.flatnonzero(~step["legal"][1])[0])
    with pytest.raises(ValueError, match="not legal"):
        env.step(illegal)
    with pytest.raises(ValueError, match="negative"):
        env.step(np.array([-1, 0, 0]))
    with pytest.raises(ValueError, match="2 actions for 3"):
        env.step(choose(step, 0)[:2])
    assert same(env.step(choose(step, 0)), twin.step(choose(step, 0))), "nothing changed"


def test_random_rollout() -> None:
    """Random play over varied rules: rewards only when hands end, every
    payoff zero-sum, the seat to act always at the table."""
    env = Env(num_envs=16, seed=6)
    rng = np.random.default_rng(0)
    step = env.reset()
    hands = 0
    for _ in range(600):
        players = np.array([r["players"] for r in env.rules()])
        assert (step["seat"] < players).all()
        assert (step["events_len"] <= step["events"].shape[1]).all()
        step = env.step(random_actions(step, rng))
        done = step["done"]
        hands += int(done.sum())
        assert not step["reward"][~done].any()
        assert np.allclose(step["reward"][done].sum(axis=1), 0.0)
    assert hands > 50


def test_bots_play_the_other_seats() -> None:
    env = Env(num_envs=4, seed=7, rules="gshs", controlled=[3], bots={"simple": 1, "초보": 2})
    rng = np.random.default_rng(1)
    step = env.reset()
    for _ in range(50):
        assert (step["seat"] == 3).all()
        step = env.step(random_actions(step, rng))


def test_belief_targets_mark_the_unseen_cards() -> None:
    env = Env(num_envs=8, seed=8)
    spec = EncodingSpec.from_json(env.spec())
    unseen = spec.card_features.index("unseen")
    rng = np.random.default_rng(2)
    step = env.reset()
    for _ in range(40):
        targets = env.belief_targets()
        hidden = step["cards"][:, :, unseen] == 1.0
        assert np.array_equal(targets >= 0, hidden)
        assert targets.max() < len(spec.belief_classes)
        step = env.step(random_actions(step, rng))


def test_excluded_rules_are_never_played(tmp_path: Path) -> None:
    seen = Env(num_envs=32, seed=9)
    held_out = seen.rules()[::2]
    path = tmp_path / "heldout.json"
    path.write_text(json.dumps(held_out), encoding="utf-8")
    env = Env(num_envs=32, seed=9, exclude=path)
    rng = np.random.default_rng(3)
    step = env.reset()
    for _ in range(100):
        assert not any(r in held_out for r in env.rules())
        step = env.step(random_actions(step, rng))
    gshs = Env(num_envs=1, seed=0, rules="gshs").rules()
    path.write_text(json.dumps(gshs), encoding="utf-8")
    with pytest.raises(ValueError, match="excluded"):
        Env(num_envs=1, seed=0, rules="pool:default,gshs", exclude=path)


def test_bad_arguments_are_refused() -> None:
    with pytest.raises(ValueError, match="unknown game"):
        Env("poker", num_envs=1, seed=0)
    with pytest.raises(ValueError, match="unknown preset"):
        Env(num_envs=1, seed=0, rules="nowhere")
    with pytest.raises(ValueError, match="needs a bot"):
        Env(num_envs=1, seed=0, controlled=[0])
    with pytest.raises(ValueError, match="unknown bot"):
        Env(num_envs=1, seed=0, controlled=[0], bots=["genius"])
    with pytest.raises(OSError, match="missing"):
        Env(num_envs=1, seed=0, exclude="missing.json")


def _hash(array: NDArray[np.generic], dtype: str) -> str:
    data = np.ascontiguousarray(array).astype(dtype, copy=False).tobytes()
    return hashlib.sha256(data).hexdigest()[:16]


def test_python_matches_rust_on_recorded_positions(repo: Path) -> None:
    """Replays the run ``crates/env/tests/parity.rs`` recorded: every
    field of every step, bit for bit."""
    fixture = cast(
        dict[str, object],
        json.loads((repo / "crates/env/tests/parity.json").read_text(encoding="utf-8")),
    )
    num_envs, seed = cast(int, fixture["num_envs"]), cast(int, fixture["seed"])
    # A pool of rule sets frozen in a file, by its path from the repository.
    rules = (repo / cast(str, fixture["rules"])).read_text(encoding="utf-8")
    env = Env(cast(str, fixture["game"]), num_envs=num_envs, seed=seed, rules=rules)
    assert env.spec()["version"] == fixture["encoding"]
    types = {
        "global": "<f4",
        "cards": "<f4",
        "events": "<f4",
        "event_cards": "<i4",
        "events_len": "<i4",
        "legal": "u1",
        "seat": "<i4",
        "reward": "<f4",
        "done": "u1",
    }
    steps = cast(list[dict[str, object]], fixture["steps"])
    step = env.reset()
    for number, recorded in enumerate(steps):
        if number > 0:
            actions = cast(list[int], recorded["actions"])
            assert choose(step, number - 1).tolist() == actions
            step = env.step(np.array(actions))
        hashes = cast(dict[str, str], recorded["hashes"])
        got = {name: _hash(field(step, name), dtype) for name, dtype in types.items()}
        got["belief"] = _hash(env.belief_targets(), "<i4")
        assert got == hashes, f"step {number}"
