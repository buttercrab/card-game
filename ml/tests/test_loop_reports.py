"""Scoring and reporting: eval results, comparisons, the leaderboard and
its plots, the daily report and status, from fake finished runs."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from loopkit import (
    EVAL,
    Clock,
    FakeHost,
    estimate,
    make_layout,
    results,
    spec,
    write,
    write_results,
)

from cardgame_ml.loop.daily import compute_on, day_span, due, write_daily
from cardgame_ml.loop.evals import Estimate, EvalResult, compare
from cardgame_ml.loop.executors import HostExecutor
from cardgame_ml.loop.layout import Layout
from cardgame_ml.loop.leaderboard import rows, write_leaderboard
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.records import Records, RunRecord, StepRecord, stamp
from cardgame_ml.loop.scheduler import Runner
from cardgame_ml.loop.status import status
from cardgame_ml.loop.steps import Step
from cardgame_ml.loop.svg import Series, chart


@pytest.fixture
def layout(tmp_path: Path) -> Layout:
    return make_layout(tmp_path)


@pytest.fixture
def policy(layout: Layout) -> Policy:
    return Policy.load(layout.policy)


def test_eval_results_read_the_schema() -> None:
    r = EvalResult.from_json(results("dmc:x", "hard", 5.0, diff=-1.8))
    assert r.ladder is not None
    assert r.ladder.bot == Estimate(5.0, 0.3, 1000)
    assert r.presets is not None
    assert r.presets.diff == Estimate(-1.8, 0.3, 1000)
    assert r.heldout is None
    assert r.puzzles == (6, 6)
    with pytest.raises(ValueError, match="eval-results/1"):
        EvalResult.from_json({**results("a", None, 1.0), "schema": "eval-results/2"})


def test_comparisons() -> None:
    paired = EvalResult.from_json(results("child", "parent", 7.0, diff=0.5, ci95=0.2))
    c = compare("ladder", paired, None, None)
    assert c is not None
    assert c.paired
    assert c.beats
    child = EvalResult.from_json(results("child", "hard", 7.0, ci95=0.3))
    parent = EvalResult.from_json(results("parent", "hard", 6.8, ci95=0.3))
    c = compare("ladder", None, child, parent)
    assert c is not None
    assert not c.paired
    assert not c.beats
    assert not c.loses
    assert c.diff.ci95 == pytest.approx(0.3 * 2**0.5)
    assert compare("ladder", None, child, None) is None


def finished(layout: Layout, run_id: str, rating: float, *, hands: int | None = None) -> None:
    """A finished loop run with eval results (and a learning curve)."""
    records = Records(layout.experiments, layout.live)
    start = datetime(2026, 10, 6, 1, tzinfo=UTC)
    steps = [
        StepRecord(
            Step("train", (), "mac", 12, gpu=True),
            "done",
            1,
            stamp(start),
            stamp(start + timedelta(hours=5)),
        ),
        StepRecord(
            Step("eval-hard", (), "home", 6),
            "done",
            1,
            stamp(start + timedelta(hours=5)),
            stamp(start + timedelta(hours=8)),
        ),
    ]
    run = RunRecord(
        id=run_id,
        folder=f"2026-10-06-{run_id}",
        method="dmc",
        tags=["hparam"],
        parent=None,
        confirms=None,
        priority=0,
        commit="c",
        dirty=False,
        created=stamp(start),
        deadline=stamp(start + timedelta(hours=20)),
        wall_hours=20.0,
        gpu=True,
        steps=steps,
        status="succeeded",
        ended=stamp(start + timedelta(hours=8)),
        params={"optim.lr": 0.001},
        comparison={
            "metric": "ladder",
            "diff": {"mean": 0.5, "ci95": 0.2, "n": 1},
            "paired": True,
            "beats": True,
        },
        candidate=True,
    )
    records.save(run)
    write_results(layout, run, "eval-hard", results("dmc:x", "hard", rating, diff=rating - 6.8))
    if hands:
        curve = {
            "run": run_id,
            "sessions": [{"event": "start", "parameters": 600000}],
            "curve": [
                {
                    "hands": h,
                    "decisions": 0,
                    "step": 0,
                    "seconds": h / 1000,
                    "scores": {
                        "easy": {"mean": h / 1e6, "ci95": 1.0, "n": 2000},
                        "normal": {"mean": h / 2e6, "ci95": 1.0, "n": 2000},
                    },
                }
                for h in (hands // 2, hands)
            ],
        }
        out = layout.experiments / run.folder / "results" / "curve"
        out.mkdir(parents=True)
        (out / "curve.json").write_text(json.dumps(curve), encoding="utf-8")


def test_leaderboard_ranks_runs_and_writes_plots(layout: Layout, policy: Policy) -> None:
    finished(layout, "weaker", 3.0, hands=1_000_000)
    finished(layout, "stronger", 5.5, hands=2_000_000)
    table = rows(layout, policy)
    assert [r.id for r in table] == ["stronger", "weaker"]
    top = table[0]
    assert top.hands == 2_000_000
    assert top.parameters == 600000
    assert top.gpu_hours == 5.0
    assert top.thread_hours == {"mac": 60.0, "home": 18.0}
    assert top.vs_hard is not None
    assert top.vs_hard.mean == pytest.approx(-1.3)
    written = write_leaderboard(layout, policy)
    names = {p.name for p in written}
    assert {
        "leaderboard.md",
        "leaderboard.json",
        "scaling.csv",
        "curves.csv",
        "curve-easy.svg",
        "curve-normal.svg",
        "scaling-hands.svg",
        "scaling-gpu.svg",
    } <= names
    board = (layout.loop / "leaderboard.md").read_text(encoding="utf-8")
    assert board.index("[stronger]") < board.index("[weaker]")
    assert "optim.lr=0.001" in board
    data = json.loads((layout.loop / "leaderboard.json").read_text(encoding="utf-8"))
    assert data["schema"] == "loop-leaderboard/1"
    curves = (layout.plots / "curves.csv").read_text(encoding="utf-8").splitlines()
    assert curves[0] == "run,hands,hours,opponent,mean,ci95"
    assert len(curves) == 1 + 2 * 2 * 2
    assert "<polyline" in (layout.plots / "curve-normal.svg").read_text(encoding="utf-8")


def test_references_join_the_leaderboard(layout: Layout, policy: Policy) -> None:
    ref = policy.references[0]
    path = layout.repo / ref.results
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(results("hard", None, 6.81)), encoding="utf-8")
    finished(layout, "run", 2.0)
    table = rows(layout, policy)
    assert table[0].reference
    assert table[0].id == ref.name


def test_charts_without_data() -> None:
    assert "no data yet" in chart([], title="t", x_label="x", y_label="y")
    svg = chart(
        [Series("a", [(1.0, 2.0), (10.0, -1.0)])], title="t", x_label="x", y_label="y", log_x=True
    )
    assert svg.startswith("<svg")
    assert "<circle" in svg


def test_the_daily_report(layout: Layout, policy: Policy) -> None:
    finished(layout, "done-today", 4.0)
    calls = layout.researcher_log
    calls.parent.mkdir(parents=True, exist_ok=True)
    calls.write_text(
        json.dumps(
            {"started": "2026-10-06T03:00:00Z", "outcome": "ok", "accepted": ["a"], "rejected": []}
        )
        + "\n",
        encoding="utf-8",
    )
    write(layout, spec(EVAL, id="next-up"))
    day = datetime(2026, 10, 6, 1, tzinfo=UTC).astimezone().date()
    text = write_daily(layout, policy, day).read_text(encoding="utf-8")
    for heading in (
        "## Results",
        "## Best so far",
        "## Notable",
        "## Failures",
        "## Researcher",
        "## Running and next",
    ):
        assert heading in text
    assert "done-today" in text
    assert "beat its parent" in text
    assert "queued: next-up" in text


def test_compute_counts_only_the_day(layout: Layout) -> None:
    finished(layout, "r", 1.0)
    run = Records(layout.experiments, layout.live).all()[0]
    start = datetime(2026, 10, 6, 1, tzinfo=UTC)
    span = (start + timedelta(hours=4), start + timedelta(hours=6))
    used = compute_on([run], span)
    assert used["gpu"] == pytest.approx(1.0)
    assert used["mac"] == pytest.approx(12.0)
    assert used["home"] == pytest.approx(6.0)
    assert day_span(start.astimezone().date())[1] - day_span(start.astimezone().date())[
        0
    ] == timedelta(days=1)


def test_reports_are_due_after_the_hour(layout: Layout, policy: Policy) -> None:
    local = datetime(2026, 10, 7, policy.report_hour + 1).astimezone()
    assert due(layout, policy, local) == local.date() - timedelta(days=1)
    early = datetime(2026, 10, 7, policy.report_hour - 1).astimezone()
    assert due(layout, policy, early) is None
    layout.reports.mkdir(parents=True)
    (layout.reports / f"{local.date() - timedelta(days=1)}.md").write_text("", encoding="utf-8")
    assert due(layout, policy, local) is None


def test_status_names_what_runs(layout: Layout, policy: Policy) -> None:
    clock = Clock()
    hosts: dict[str, HostExecutor] = {n: FakeHost(h) for n, h in policy.hosts.items()}
    runner = Runner(
        layout, policy, hosts, git=None, clock=clock, gpu_elsewhere=lambda _: [], say=lambda _: None
    )
    write(layout, spec(EVAL, id="busy"))
    write(layout, spec(EVAL, id="later", parent="busy"))
    runner.tick()
    text = status(
        layout,
        policy,
        clock(),
        loads={"mac": 1.0, "home": None},
        other_training=["42 python -m cardgame_ml.train.dmc"],
    )
    assert "busy: eval-parent on home (running, attempt 1)" in text
    assert "later [search-tuning" in text
    assert "waiting for busy to finish" in text
    assert "home: 4/6 threads in loop steps; unreachable" in text
    assert "not ours, holding it: 42" in text
    assert "researcher: never called" in text


def test_matches_pool_by_deals() -> None:
    data = results("a", "b", 1.0)
    data["matches"] = [
        {
            "bot": estimate(1.0, 0.4, 100),
            "baseline": estimate(0.0, 0.4, 100),
            "diff": estimate(1.0, 0.4, 100),
        },
        {
            "bot": estimate(4.0, 0.2, 300),
            "baseline": estimate(3.0, 0.2, 300),
            "diff": estimate(-1.0, 0.2, 300),
        },
    ]
    pooled = EvalResult.from_json(data).metric("matches")
    assert pooled is not None
    assert pooled.diff is not None
    assert pooled.diff.mean == pytest.approx(-0.5)
    assert pooled.diff.n == 400
    assert pooled.diff.ci95 == pytest.approx((40**2 + 60**2) ** 0.5 / 400)
