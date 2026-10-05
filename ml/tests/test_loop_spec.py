"""Experiment specs: their shape, the policy's checks, the methods' plans
and the committed policy, base configs, fresh-deal suite and queue."""

import json
import tomllib
from pathlib import Path
from typing import Any

import pytest
from loopkit import DMC, EVAL, REPO, make_layout, spec, write

from cardgame_ml.loop import tomlw
from cardgame_ml.loop.configs import get_path
from cardgame_ml.loop.evals import FRESH_SEED_STRIDE, fresh_suite
from cardgame_ml.loop.layout import Layout
from cardgame_ml.loop.methods import METHODS, Context
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.queue import read_queue
from cardgame_ml.loop.spec import SpecError, parse_spec
from cardgame_ml.loop.validate import Known, check, check_file

NOBODY = Known(runs=(), queued=())


@pytest.fixture
def layout(tmp_path: Path) -> Layout:
    return make_layout(tmp_path)


@pytest.fixture
def policy(layout: Layout) -> Policy:
    return Policy.load(layout.policy)


def problems(data: dict[str, Any], policy: Policy, layout: Layout, **kw: Any) -> list[str]:
    return check(
        parse_spec(data, "test"),
        policy,
        layout.repo,
        kw.get("known", NOBODY),
        researcher=kw.get("researcher", False),
    )


def test_toml_writer_round_trips() -> None:
    data: dict[str, Any] = {
        "a": 1,
        "b": 2.5,
        "c": 'x "y" 한글',
        "d": [1, 2],
        "e": True,
        "t": {"k.dotted": 1, "nested": {"z": []}},
        "arr": [{"n": 1}, {"n": 2}],
    }
    assert tomllib.loads(tomlw.dumps(data)) == data


def test_a_spec_parses_and_writes_back() -> None:
    parsed = parse_spec(spec(DMC, seeds=[1, 2]), "test")
    assert parsed.method == "dmc"
    assert parsed.config.overrides == {"optim.lr": 0.0001}
    assert parse_spec(tomllib.loads(tomlw.dumps(parsed.to_toml())), "again") == parsed
    replicates = parsed.replicates()
    assert [r.id for r in replicates] == ["dmc-test-s1", "dmc-test-s2"]
    assert [r.seeds for r in replicates] == [(1,), (2,)]
    assert parsed.gpu_hours() == 5.0


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"extra": 1}, "unknown extra"),
        ({"id": "Bad_Id"}, "lowercase"),
        ({"hypothesis": "short"}, "hypothesis"),
        ({"tags": ["shiny"]}, "tags"),
        ({"seeds": []}, "seeds"),
        ({"budget": {"train_hours": 10.0}}, "train_hours must leave time"),
        ({"evals": {"parts": ["ladder", "cost"]}}, "cost = true"),
        ({"evals": {"parts": ["ladders"]}}, "unknown parts"),
        ({"parent": "Not An Id"}, "parent"),
        ({"budget": {"gpu": "yes"}}, "true or false"),
        ({"config": {"set": {"optim.lr": 0.1}}}, "set overrides a base"),
    ],
)
def test_malformed_specs_are_refused(changes: dict[str, Any], message: str) -> None:
    data = spec(DMC, **changes)
    if "config" in changes:
        data["config"] = changes["config"]
    with pytest.raises(SpecError, match=message):
        parse_spec(data, "test")


def test_a_good_spec_passes(policy: Policy, layout: Layout) -> None:
    assert problems(DMC, policy, layout) == []
    assert problems(EVAL, policy, layout, researcher=True) == []


@pytest.mark.parametrize(
    ("changes", "message"),
    [
        ({"budget": {"wall_hours": 99.0}}, "over the policy"),
        ({"resources": {"threads": 40}}, "which has 14"),
        ({"resources": {"eval_host": "cloud"}}, "not in the policy"),
        ({"resources": {"host": "home", "threads": 4}}, "gpu, but home"),
        ({"method": "alphazero"}, "unknown 'alphazero'"),
        (
            {"config": {"base": "research/loop/configs/dmc-v1.toml", "set": {"optim.lrr": 0.1}}},
            "not in the base",
        ),
        (
            {"config": {"base": "research/loop/configs/dmc-v1.toml", "set": {"exclude": "x.json"}}},
            "set by the loop",
        ),
        (
            {"config": {"base": "research/loop/configs/dmc-v1.toml", "set": {"curve.deals": 10}}},
            "set by the loop",
        ),
        (
            {"config": {"base": "research/loop/configs/dmc-v1.toml", "set": {"optim.lr": "fast"}}},
            "is float in the base",
        ),
        (
            {
                "config": {
                    "base": "research/loop/configs/dmc-v1.toml",
                    "set": {"rules": "file:research/evals/v1/heldout-rules.json"},
                }
            },
            "names the evals",
        ),
        ({"config": {"base": "research/evals/v1/suite.json"}}, "names the evals"),
        ({"evals": {"curve": False}}, "learning curve"),
        ({"evals": {"parts": ["ladder"]}}, "play heldout, presets too"),
        ({"evals": {"baselines": ["normal"]}}, "measured against hard"),
        ({"evals": {"suite": "v1-fresh-1"}}, "scored on v1"),
        ({"evals": {"baselines": ["hard", "parent"]}}, "no parent"),
        ({"parent": "nobody-ran-this"}, "no run or queued spec"),
        ({"after": ["nor-this"]}, "no run or queued spec"),
        ({"requires": ["../outside"]}, "inside the artifact store"),
    ],
)
def test_specs_against_the_policy(
    policy: Policy, layout: Layout, changes: dict[str, Any], message: str
) -> None:
    data = spec(DMC, **changes)
    if "config" in changes:
        data["config"] = changes["config"]
    found = problems(data, policy, layout)
    assert any(message in p for p in found), found


def test_researcher_limits(policy: Policy, layout: Layout) -> None:
    confirming = spec(DMC, confirms="other", tags=["hparam", "confirmation"])
    assert any(
        "queued by the runner" in p for p in problems(confirming, policy, layout, researcher=True)
    )
    taken = Known(runs={"dmc-test"}, queued=())
    assert any("taken" in p for p in problems(DMC, policy, layout, known=taken))


def test_eval_only_checks(policy: Policy, layout: Layout) -> None:
    clocked = spec(EVAL, options={"bot": "search:200:1:150"})
    assert any("on a clock" in p for p in problems(clocked, policy, layout))
    not_search = spec(EVAL, options={"bot": "normal"})
    assert any("must be a search" in p for p in problems(not_search, policy, layout))
    gpu = spec(EVAL, budget={"gpu": True}, resources={"host": "mac", "threads": 4})
    assert any("train nothing" in p for p in problems(gpu, policy, layout))


def test_dmc_plan(policy: Policy, layout: Layout) -> None:
    parsed = parse_spec(DMC, "test")
    plan = METHODS["dmc"].plan(Context(parsed, policy, layout.repo, "2026-10-06-dmc-test", None))
    assert [s.name for s in plan.steps] == ["train", "curve", "export", "eval-hard"]
    train = plan.steps[0]
    assert train.gpu
    assert train.resumable
    assert train.clean
    assert train.host == "mac"
    assert plan.steps[-1].host == "home"
    assert plan.bot == "dmc:{artifacts}/models/2026-10-06-dmc-test"
    config = plan.config
    assert config is not None
    # The spec's override, then what the loop decides.
    assert get_path(config, "optim.lr") == 0.0001
    assert config["name"] == "2026-10-06-dmc-test"
    assert config["seed"] == 7
    assert get_path(config, "budget.hours") == 5.0
    assert get_path(config, "budget.hands") == 1000000
    assert config["curve"] == policy.protocol.curve.to_table()
    assert config["exclude"] == policy.exclude


def test_eval_plan_uses_the_parent(policy: Policy, layout: Layout) -> None:
    parsed = parse_spec(spec(EVAL, evals={"cost": True}), "test")
    plan = METHODS["search-tuning"].plan(Context(parsed, policy, layout.repo, "x", "hard"))
    names = [s.name for s in plan.steps]
    assert names == ["eval-parent", "cost"]
    argv = plan.steps[0].argv
    assert argv[argv.index("--baseline") + 1] == "hard"
    assert argv[argv.index("--bot") + 1] == "search:400:1:0"
    assert "cost" in plan.steps[1].argv


def test_uploads_are_the_models_a_step_reads(policy: Policy, layout: Layout) -> None:
    parsed = parse_spec(
        spec(
            EVAL, method="eval-only", tags=["eval"], options={"bot": "dmc:{artifacts}/models/m:2"}
        ),
        "test",
    )
    plan = METHODS["eval-only"].plan(Context(parsed, policy, layout.repo, "x", "hard"))
    assert plan.steps[0].uploads() == ["models/m"]


def test_the_committed_policy_and_queue() -> None:
    layout = Layout(REPO, REPO / "nowhere")
    policy = Policy.load(layout.policy)
    assert set(policy.limits.methods) <= set(METHODS)
    assert policy.protocol.baseline in ("hard",)
    queue = read_queue(layout.queue)
    assert queue, "the queue is seeded"
    ids = [q.spec.id for q in queue if q.spec is not None]
    for item in queue:
        spec_, found = check_file(
            item.path,
            policy,
            REPO,
            Known((), [i for i in ids if item.spec is None or i != item.spec.id]),
            researcher=True,
        )
        assert spec_ is not None, item.error
        assert found == [], found


def test_the_committed_fresh_suite_is_v1_on_new_deals() -> None:
    policy = Policy.load(REPO / "research/loop/policy.toml")
    source = json.loads((REPO / "research/evals/v1/suite.json").read_text(encoding="utf-8"))
    path = REPO / "research/loop/suites" / policy.protocol.confirm_suite / "suite.json"
    committed = json.loads(path.read_text(encoding="utf-8"))
    assert committed == fresh_suite(source, policy.protocol.confirm_suite, 1, "../../../evals/v1")
    assert committed["ladder"]["seed"] == source["ladder"]["seed"] + FRESH_SEED_STRIDE
    assert "puzzles" not in committed
    assert "cost" not in committed


def test_queue_order_and_unreadable_files(layout: Layout) -> None:
    write(layout, spec(DMC, id="low", priority=1))
    write(layout, spec(DMC, id="high", priority=9))
    (layout.queue / "broken.toml").write_text("id = ", encoding="utf-8")
    queue = read_queue(layout.queue)
    assert [q.spec.id if q.spec else None for q in queue] == ["high", "low", None]
    assert queue[2].error is not None


def test_clock_bound_head_to_heads(policy: Policy, layout: Layout) -> None:
    data = spec(
        EVAL,
        parent="bot:search:60000:1:1300@threads=12",
        resources={"threads": 12, "eval_threads": 12},
        evals={"suite": "think-gshs", "parts": ["matches"]},
        options={"bot": "search:60000:1:2400@threads=12", "clock": True, "deal_threads": 1},
    )
    assert problems(data, policy, layout, researcher=True) == []
    unclocked = spec(data)
    unclocked["options"] = {"bot": "search:60000:1:2400@threads=12"}
    assert any("on a clock" in p for p in problems(unclocked, policy, layout))
    ctx = Context(parse_spec(data, "t"), policy, layout.repo, "x", "search:1:1:1")
    step = METHODS["search-tuning"].plan(ctx).steps[0]
    assert step.argv[step.argv.index("--threads") + 1] == "1"
    assert step.argv[step.argv.index("--suite") + 1] == "research/loop/suites/think-gshs"
    assert step.threads == 12
    too_many = spec(data, resources={"threads": 13, "eval_threads": 13})
    assert any("which has 12" in p for p in problems(too_many, policy, layout))
    unknown_suite = spec(data, evals={"suite": "my-suite"})
    assert any("scored on v1" in p for p in problems(unknown_suite, policy, layout))
