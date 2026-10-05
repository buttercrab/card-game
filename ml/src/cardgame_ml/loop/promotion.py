"""Deciding a run: how it compares with its parent, and the confirmation
a win needs before it counts.

A run that beats its parent beyond the 95% interval on the protocol's
primary metric is a *candidate*: the runner queues its confirmation, the
same spec on a new training seed, played deal by deal against the
parent's bot on a fresh-deal suite (``protocol.confirm_suite``). The
candidate is *confirmed* when that run beats the parent too; only then
does the leaderboard call it a win. Only the primary metric decides: a
run that did not measure it is not compared at all.
"""

import dataclasses
from collections.abc import Mapping
from pathlib import Path

from cardgame_ml.loop import tomlw
from cardgame_ml.loop.evals import FRESH_PARTS, Comparison, EvalResult, compare
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.records import RunRecord
from cardgame_ml.loop.spec import Spec
from cardgame_ml.loop.steps import PARENT, Role

CONFIRM_PRIORITY = 1000
"""Added to a candidate's priority: confirmations go first."""


def eval_results(folder: Path) -> dict[str, EvalResult]:
    """Each eval step's results, by step name."""
    out: dict[str, EvalResult] = {}
    for path in sorted(folder.glob("results/*/results.json")):
        try:
            out[path.parent.name] = EvalResult.load(path)
        except ValueError:
            continue
    return out


def result_of(record: RunRecord, folder: Path, baseline: str) -> EvalResult | None:
    """The run's suite results against ``baseline`` (as its spec names
    it: a bot, or ``parent``), found by the step's role."""
    step = record.eval_step(baseline)
    return None if step is None else eval_results(folder).get(step.step.name)


def cost_of(record: RunRecord, folder: Path) -> EvalResult | None:
    """The run's think-time results, if it measured them."""
    step = record.role(Role.COST)
    return None if step is None else eval_results(folder).get(step.step.name)


def assess(
    record: RunRecord,
    folder: Path,
    policy: Policy,
    runs: Mapping[str, RunRecord],
    experiments: Path,
) -> Comparison | None:
    """The run against its parent on the protocol's primary metric, if
    both were measured on it."""
    baseline = policy.protocol.baseline
    own = result_of(record, folder, baseline)
    against_parent = result_of(record, folder, PARENT)
    parents = None
    parent = runs.get(record.parent) if record.parent else None
    if parent is not None:
        parents = result_of(parent, experiments / parent.folder, baseline)
    return compare(policy.protocol.primary, against_parent, own, parents)


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
            spec.evals,
            suite=protocol.confirm_suite,
            parts=parts,
            baselines=(PARENT,),
            cost=False,
        ),
        confirms=spec.id,
    )


def write_spec(spec: Spec, queue: Path) -> Path:
    queue.mkdir(parents=True, exist_ok=True)
    path = queue / f"{spec.id}.toml"
    path.write_text(tomlw.dumps(spec.to_toml()), encoding="utf-8")
    return path
