"""Deciding a run: how it compares with its parent, and the confirmation
a win needs before it counts.

A run that beats its parent beyond the 95% interval on the protocol's
primary metric is a *candidate*: the runner queues its confirmation, the
same spec on a new training seed, played deal by deal against the
parent's bot on a fresh-deal suite (``protocol.confirm_suite``). The
candidate is *confirmed* when that run beats the parent too; only then
does the leaderboard call it a win.
"""

import dataclasses
from collections.abc import Mapping
from pathlib import Path

from cardgame_ml.loop import tomlw
from cardgame_ml.loop.evals import FRESH_PARTS, Comparison, EvalResult, compare
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.records import RunRecord
from cardgame_ml.loop.spec import Spec

CONFIRM_PRIORITY = 1000
"""Added to a candidate's priority: confirmations go first."""


def eval_results(folder: Path) -> dict[str, EvalResult]:
    """Each eval step's results, by step name."""
    out: dict[str, EvalResult] = {}
    for path in sorted(folder.glob("results/*/results.json")):
        try:
            out[path.parent.name] = EvalResult.load(path)
        except (ValueError, KeyError):
            continue
    return out


def assess(
    record: RunRecord,
    folder: Path,
    policy: Policy,
    runs: Mapping[str, RunRecord],
    experiments: Path,
) -> Comparison | None:
    """The run against its parent on the primary metric, if both were
    measured."""
    results = eval_results(folder)
    baseline_step = f"eval-{policy.protocol.baseline}"
    own = results.get(baseline_step)
    against_parent = results.get("eval-parent")
    parents = None
    parent = runs.get(record.parent) if record.parent else None
    if parent is not None:
        parents = eval_results(experiments / parent.folder).get(baseline_step)
    for metric in (policy.protocol.primary, "presets", "matches"):
        comparison = compare(metric, against_parent, own, parents)
        if comparison is not None:
            return comparison
    return None


def confirmation(spec: Spec, policy: Policy) -> Spec:
    """The spec that confirms candidate ``spec`` (which has a parent: a
    candidate beat one)."""
    protocol = policy.protocol
    parts = tuple(p for p in spec.evals.parts if p in FRESH_PARTS) or ("ladder",)
    return dataclasses.replace(
        spec,
        id=f"{spec.id[:56]}-confirm",
        hypothesis=f"Confirms {spec.id} on a new seed and fresh deals: {spec.hypothesis}",
        tags=tuple(dict.fromkeys((*spec.tags, "confirmation"))),
        priority=spec.priority + CONFIRM_PRIORITY,
        seeds=(spec.seed + protocol.confirm_seed_shift,),
        after=(),
        evals=dataclasses.replace(
            spec.evals, suite=protocol.confirm_suite, parts=parts, baselines=("parent",), cost=False
        ),
        confirms=spec.id,
    )


def write_spec(spec: Spec, queue: Path) -> Path:
    queue.mkdir(parents=True, exist_ok=True)
    path = queue / f"{spec.id}.toml"
    path.write_text(tomlw.dumps(spec.to_toml()), encoding="utf-8")
    return path
