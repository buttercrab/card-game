"""What a method runner is, and the scoring steps every method shares.

A method turns a validated spec into a ``Plan``: the effective training
config (if it trains), the steps in order (each with its ``Role``), and
the bot the run is scored as. Scoring is not the method's to choose:
every run ends with the same suite steps (``eval_steps``), one per
baseline, plus think time on the policy's ``cost_host`` when asked.
"""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from cardgame_ml.loop.evals import eval_argv, suite_argument
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.spec import Spec
from cardgame_ml.loop.steps import PARENT, Role, Step

CURVE_STEP = "curve"
"""The step that writes a training run's learning curve, and so its
output folder (``results/curve``)."""


def build_step(host: str) -> Step:
    """Builds ``eval`` on ``host`` (quick when it is up to date); remote
    hosts build their own copy when the code arrives."""
    return Step(
        name="build",
        argv=("cargo", "build", "--release", "--locked", "-p", "eval"),
        host=host,
        threads=4,
        role=Role.BUILD,
    )


@dataclass(frozen=True)
class Context:
    """A spec about to run."""

    spec: Spec
    policy: Policy
    repo: Path
    name: str
    """The run's name: its folder in ``research/experiments`` and, for
    training kinds, its model's folder under ``models/``."""
    parent_bot: str | None
    """The parent's bot, resolved (a loop run's own bot, or ``bot:``)."""


@dataclass(frozen=True)
class Plan:
    steps: list[Step]
    bot: str
    """The bot the run is scored as, ``{artifacts}`` for the store."""
    model: str | None
    """The model trained, relative to the artifact store."""
    config: dict[str, object] | None
    """The effective training config, written as the run's
    ``config.toml``."""

    def eval_step(self, baseline: str) -> Step | None:
        """The suite run against ``baseline`` (as the spec names it)."""
        return next((s for s in self.steps if s.role == Role.EVAL and s.baseline == baseline), None)


class Method(Protocol):
    name: str
    trains: bool
    """Trains a policy: the learning curve and the protocol's parts are
    required, and the config is the spec's."""

    def check(self, spec: Spec, policy: Policy, repo: Path) -> list[str]:
        """What is wrong with ``spec`` for this method (nothing: [])."""
        ...

    def plan(self, ctx: Context) -> Plan: ...


def eval_steps(ctx: Context, bot: str, deal_threads: int | None = None) -> list[Step]:
    """The suite runs that score ``bot``: one per baseline, then think
    time on the cost host if the spec asks. ``deal_threads``: deals
    played at once (``eval --threads``), when not one per thread held (a
    bot that thinks on several threads itself)."""
    spec, policy = ctx.spec, ctx.policy
    protocol = policy.protocol
    suite = suite_argument(spec.evals.suite, protocol.suite)
    parts = tuple(p for p in spec.evals.parts if p != "cost")
    steps: list[Step] = []
    for k, baseline in enumerate(spec.evals.baselines):
        resolved = ctx.parent_bot if baseline == PARENT else baseline
        if resolved is None:
            raise ValueError(f"{spec.id}: baseline parent, but no parent bot")
        steps.append(
            Step(
                name=f"eval-{_slug(baseline, k)}",
                argv=eval_argv(
                    suite=suite,
                    bot=bot,
                    baseline=resolved,
                    parts=parts,
                    threads=deal_threads or spec.resources.eval_threads,
                ),
                host=spec.resources.eval_host,
                threads=spec.resources.eval_threads,
                role=Role.EVAL,
                baseline=baseline,
            )
        )
    if spec.evals.cost:
        steps.append(
            Step(
                name="cost",
                argv=eval_argv(
                    suite=protocol.suite, bot=bot, baseline=None, parts=("cost",), threads=1
                ),
                host=policy.cost_host,
                threads=1,
                role=Role.COST,
            )
        )
    local = next((s.host for s in steps if policy.host(s.host).local), None)
    if local is not None:
        steps.insert(0, build_step(local))
    return steps


def _slug(baseline: str, k: int) -> str:
    """A step name for the baseline: itself when it is a safe short name,
    else its place (the step's ``baseline`` says which it is)."""
    if re.fullmatch(r"[a-z0-9-]{1,24}", baseline):
        return baseline
    return f"baseline{k + 1}"


def check_options(spec: Spec, allowed: dict[str, type]) -> list[str]:
    """The spec's ``[options]`` against the method's own, by type."""
    problems = [f"options: unknown {key}" for key in spec.options if key not in allowed]
    for key, kind in allowed.items():
        value = spec.options.get(key)
        wrong = not isinstance(value, kind) or (kind is not bool and isinstance(value, bool))
        if value is not None and wrong:
            problems.append(f"options: {key} should be {kind.__name__}")
    return problems


def check_trains_here(spec: Spec, policy: Policy, what: str) -> list[str]:
    """A training spec runs on the train host's GPU."""
    if not spec.budget.gpu or spec.resources.host != policy.train_host:
        return [f"budget: {what} trains on the GPU (gpu = true, host = {policy.train_host})"]
    return []
