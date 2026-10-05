"""Deep Monte Carlo on CPU: the Q network, playing with it, labelling
hands, the Q export's parity fixture, and a tiny run end to end."""

import json
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from cardgame_env import Env  # noqa: E402

from cardgame_ml.data.spec import EncodingSpec  # noqa: E402
from cardgame_ml.export.onnx import observations  # noqa: E402
from cardgame_ml.models.config import QConfig, TrunkConfig  # noqa: E402
from cardgame_ml.models.q import QModel  # noqa: E402
from cardgame_ml.train.config import from_mapping  # noqa: E402
from cardgame_ml.train.dmc.actor import Hands  # noqa: E402
from cardgame_ml.train.dmc.config import DmcConfig  # noqa: E402
from cardgame_ml.train.dmc.learner import load, train  # noqa: E402
from cardgame_ml.train.dmc.policy import (  # noqa: E402
    choose,
    legal_actions,
    legal_values,
    observation_tensors,
)

TINY = QConfig(TrunkConfig(width=16, heads=2, layers=1, feedforward=32), 32, 1)
CPU = torch.device("cpu")


@pytest.fixture(scope="module")
def env() -> Env:
    return Env(num_envs=16, seed=5, rules="varied", threads=1)


@pytest.fixture(scope="module")
def spec(env: Env) -> EncodingSpec:
    return EncodingSpec.from_json(env.spec())


def steps(env: Env, count: int, seed: int = 0) -> list[dict[str, Any]]:
    """``count`` steps of random play, each step's arrays kept."""
    rng = np.random.default_rng(seed)
    step = env.reset(seed)
    kept: list[dict[str, Any]] = []
    for _ in range(count):
        kept.append(dict(step))
        scores = rng.random(step["legal"].shape)
        scores[~step["legal"]] = -1
        step = env.step(scores.argmax(axis=1))
    return kept


def model(spec: EncodingSpec, seed: int = 0) -> QModel:
    torch.manual_seed(seed)
    return QModel(spec, TINY).eval()


def test_legal_actions_come_first_in_order() -> None:
    legal = np.array([[False, True, False, True], [True, False, False, False]])
    actions, valid = legal_actions(legal)
    assert actions.tolist() == [[1, 3], [0, 0]]
    assert valid.tolist() == [[True, True], [True, False]]


def test_a_value_depends_only_on_its_action(env: Env, spec: EncodingSpec) -> None:
    """Scored alone, with others, padded or grouped by length: the same."""
    step = steps(env, 30)[25]
    m = model(spec)
    actions, values = legal_values(m, step, CPU)
    _, grouped = legal_values(m, step, CPU, groups=5)
    assert np.allclose(values, grouped, atol=1e-5)
    counts = np.asarray(step["legal"], np.bool_).sum(axis=1, dtype=np.int64)
    expected = np.arange(values.shape[1], dtype=np.int64)[None, :] < counts[:, None]
    assert np.array_equal(np.isfinite(values), expected)
    with torch.no_grad():
        first = m(*observation_tensors(step, CPU), torch.as_tensor(actions[:, :1]))
    assert np.allclose(first.numpy()[:, 0], values[:, 0], atol=1e-5)


def test_choosing_is_greedy_or_uniform_among_the_legal() -> None:
    actions = np.array([[4, 9, 2], [7, 7, 7]])
    values = np.array([[0.1, 0.5, -1.0], [3.0, -np.inf, -np.inf]], np.float32)
    rng = np.random.default_rng(0)
    assert choose(actions, values, 0.0, rng).tolist() == [9, 7]
    picks = np.stack([choose(actions, values, 1.0, rng) for _ in range(300)])
    assert set(picks[:, 0].tolist()) == {4, 9, 2}
    assert set(picks[:, 1].tolist()) == {7}
    # A softmax at a temperature: mostly the best, sometimes the next.
    warm = np.stack([choose(actions, values, 0.0, rng, 0.3) for _ in range(400)])
    share = Counter(int(x) for x in warm[:, 0])
    assert share[9] > share[4] > share[2]
    assert set(warm[:, 1].tolist()) == {7}
    assert (choose(actions, values, 0.0, rng, 1e-6) == [9, 7]).all()


def test_hands_label_every_decision_with_its_seats_payoff(spec: EncodingSpec) -> None:
    env = Env(num_envs=4, seed=9, rules="varied", reward_scale=0.5, threads=1)
    hands = Hands(4)
    rng = np.random.default_rng(1)
    step = env.reset()
    taken = [0] * 4
    labelled = 0
    for _ in range(400):
        scores = rng.random(step["legal"].shape)
        scores[~step["legal"]] = -1
        actions = scores.argmax(axis=1)
        hands.record(step, actions)
        before = dict(step)
        step = env.step(actions)
        for i in range(4):
            taken[i] += 1
        decisions, ended = hands.finish(step)
        if decisions is None:
            assert ended == 0
            continue
        done = np.flatnonzero(step["done"])
        assert ended == len(done)
        assert len(decisions) == sum(taken[i] for i in done)
        # Targets are payoffs of seats at the table: zero-sum per hand.
        assert np.isclose(step["reward"][done].sum(), 0)
        assert set(np.unique(decisions.target)) <= set(np.unique(step["reward"][done]))
        assert decisions.events.shape[0] == decisions.events_len.sum()
        for i in done:
            taken[i] = 0
        labelled += len(decisions)
        del before
    assert labelled > 0


def test_pytorch_gives_the_q_fixtures_values(repo: Path) -> None:
    fixture = repo / "crates" / "infer" / "tests" / "tiny-q"
    m = load(fixture)
    parity = json.loads((fixture / "parity.json").read_text(encoding="utf-8"))
    rows = parity["observations"]
    n = len(rows)
    batch = {
        "global": np.array([o["global"] for o in rows], np.float32),
        "cards": np.array([o["cards"] for o in rows], np.float32).reshape(n, 54, -1),
        "events": np.array([o["events"] for o in rows], np.float32).reshape(
            n, m.spec.max_events, -1
        ),
        "event_cards": np.array([o["event_cards"] for o in rows], np.int32),
        "events_len": np.array([o["events_len"] for o in rows], np.int32),
        "legal": np.array([o["legal"] for o in rows], np.bool_),
    }
    _, values = legal_values(m, batch, CPU)
    for row, recorded in zip(values, parity["values"], strict=True):
        ours = row[np.isfinite(row)]
        assert np.abs(ours - np.array(recorded)).max() <= parity["tolerance"]
    assert observations(batch) == rows


def tiny_config(repo: Path) -> DmcConfig:
    """The smoke config, shrunk to seconds."""
    import tomllib  # noqa: PLC0415

    folder = repo / "research" / "experiments" / "2026-10-05-dmc-v1"
    data = tomllib.loads((folder / "smoke.toml").read_text(encoding="utf-8"))
    data.update(name="tiny-dmc", device="cpu", log_seconds=0.5, checkpoint_minutes=0.01)
    data["budget"] = {"hands": 64, "hours": 0.05}
    data["model"] = {
        "head_width": 16,
        "head_layers": 1,
        "trunk": {"width": 16, "heads": 2, "layers": 1, "feedforward": 32, "dropout": 0.0},
    }
    data["actors"].update(processes=1, envs=8, threads=1, chunk=64, refresh_every=2)
    data["buffer"].update(capacity=4000, min_fill=200, window=2)
    data["optim"].update(batch_size=32, warmup_steps=2)
    data["curve"].update(every_hands=64, deals=6, opponents=["normal"], threads=1)
    return from_mapping(DmcConfig, data, "tiny")


def test_a_tiny_run_plays_learns_and_resumes(repo: Path, tmp_path: Path) -> None:
    config = tiny_config(repo)
    lines: list[dict[str, Any]] = []
    exclude = repo / config.exclude
    progress = train(config, tmp_path, exclude, lines.append)
    assert progress.hands >= config.budget.hands
    assert progress.step > 0
    files = {p.name for p in tmp_path.iterdir()}
    assert {"config.json", "checkpoint.pt", "model.pt", "snapshots"} <= files
    curve = [line for line in lines if line["event"] == "curve"]
    assert curve[0]["hands"] == 0
    assert len(curve) >= 2
    assert set(curve[-1]["scores"]) == {"normal"}
    assert any(line["event"] == "train" and "throughput" in line for line in lines)
    described = json.loads((tmp_path / "config.json").read_text(encoding="utf-8"))
    assert described["reward_scale"] == config.reward_scale
    trained = load(tmp_path)
    assert trained.parameter_count() == described["parameters"]
    # Done: started again, it resumes, finds the budget spent and stops.
    again: list[dict[str, Any]] = []
    resumed = train(config, tmp_path, exclude, again.append)
    assert again[0]["event"] == "resume"
    assert resumed.sessions == 2
    assert resumed.hands == progress.hands
