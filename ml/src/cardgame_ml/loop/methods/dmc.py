"""Deep Monte Carlo self-play (P3b): ``python -m cardgame_ml.train.dmc``.

The spec's config is a DMC config (a base such as
``research/loop/configs/dmc-v1.toml`` with ``set`` overrides); the loop
decides its name, seed, budget and learning curve (the protocol's), and
never lets a spec change the held-out list it excludes. Steps: train on
the GPU, write the curve from the log, export to ONNX, then the suite
as ``dmc:<model>``.
"""

from pathlib import Path

from cardgame_ml import schema
from cardgame_ml.loop.configs import effective_config
from cardgame_ml.loop.methods.base import (
    CURVE_STEP,
    Context,
    Plan,
    check_options,
    check_trains_here,
    eval_steps,
)
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.spec import Spec, SpecError
from cardgame_ml.loop.steps import Role, Step
from cardgame_ml.train.dmc.config import DmcConfig
from cardgame_ml.train.dmc.report import CURVE_FILE


class Dmc:
    name = "dmc"
    trains = True

    def check(self, spec: Spec, policy: Policy, repo: Path) -> list[str]:
        problems = check_options(spec, {"temperature": float})
        problems += check_trains_here(spec, policy, "DMC")
        b = spec.budget
        if b.train_hours <= 0 or b.hands <= 0:
            problems.append("budget: train_hours and hands are required for training")
        if spec.config.base is None and spec.config.inline is None:
            problems.append("config: a base DMC config is required")
            return problems
        try:
            config = self._config(spec, policy, repo, "check")
        except SpecError as e:
            return [*problems, str(e)]
        if config.get("exclude") != policy.exclude:
            problems.append(f"config: exclude must stay {policy.exclude}")
        try:
            schema.read(DmcConfig, config, "effective config", defaults=False)
        except ValueError as e:
            problems.append(f"config: {e}")
        return problems

    def plan(self, ctx: Context) -> Plan:
        config = self._config(ctx.spec, ctx.policy, ctx.repo, ctx.name)
        model = f"models/{ctx.name}"
        temperature = ctx.spec.options.get("temperature")
        bot = f"dmc:{{artifacts}}/{model}" + (f":{temperature}" if temperature else "")
        here = ctx.policy.train_host
        train = Step(
            name="train",
            argv=("{python}", "-m", "cardgame_ml.train.dmc", "--config", "{run}/config.toml"),
            host=here,
            threads=ctx.spec.resources.threads,
            gpu=True,
            cwd="ml",
            grace_seconds=120.0,
            clean=True,
            role=Role.TRAIN,
        )
        curve = Step(
            name=CURVE_STEP,
            argv=(
                "{python}",
                "-m",
                "cardgame_ml.train.dmc.report",
                "--run",
                ctx.name,
                "--out",
                f"{{out}}/{CURVE_FILE}",
            ),
            host=here,
            threads=1,
            cwd="ml",
            role=Role.CURVE,
        )
        export = Step(
            name="export",
            argv=("{python}", "-m", "cardgame_ml.export", "--run", ctx.name),
            host=here,
            threads=2,
            cwd="ml",
            clean=True,
            role=Role.EXPORT,
        )
        return Plan([train, curve, export, *eval_steps(ctx, bot)], bot, model, config)

    def _config(self, spec: Spec, policy: Policy, repo: Path, name: str) -> dict[str, object]:
        decided: dict[str, object] = {
            "name": name,
            "seed": spec.seed,
            "budget.hours": spec.budget.train_hours,
            "budget.hands": spec.budget.hands,
            "curve": schema.table(policy.protocol.curve),
        }
        return effective_config(spec, repo, decided, frozenset({"exclude"}))
