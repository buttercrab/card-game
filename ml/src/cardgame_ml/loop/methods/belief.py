"""A belief model (P3): ``python -m cardgame_ml.train`` on a self-play
dataset, scored for log-loss against the counts (gate A), exported, and
played as ``belief:<model>:<samples>``: 고수 dealing its sampled worlds by
the model. Options: ``samples`` (the search's deals, 200 by default).
"""

from pathlib import Path

from cardgame_ml.loop.configs import effective_config
from cardgame_ml.loop.methods.base import Context, Plan, check_options, eval_steps
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.spec import Spec, SpecError
from cardgame_ml.loop.steps import Step

SAMPLES = 200


class Belief:
    name = "belief"
    trains = False
    """Not a policy: no learning curve, and the search it helps is scored."""

    def check(self, spec: Spec, policy: Policy, repo: Path) -> list[str]:
        problems = check_options(spec, {"samples": int})
        if not spec.budget.gpu or spec.resources.host != "mac":
            problems.append("budget: belief training runs on the Mac's GPU")
        if spec.budget.train_hours <= 0:
            problems.append("budget: train_hours is required for training")
        try:
            config = self._config(spec, repo, "check")
        except SpecError as e:
            return [*problems, str(e)]
        try:
            from cardgame_ml.train.config import BeliefTrainConfig, from_mapping  # noqa: PLC0415

            from_mapping(BeliefTrainConfig, config, "effective config")
        except ValueError as e:
            problems.append(f"config: {e}")
        return problems

    def plan(self, ctx: Context) -> Plan:
        config = self._config(ctx.spec, ctx.repo, ctx.name)
        model = f"models/{ctx.name}"
        samples = ctx.spec.options.get("samples", SAMPLES)
        bot = f"belief:{{artifacts}}/{model}:{samples}"
        steps = [
            Step(
                name="train",
                argv=("{python}", "-m", "cardgame_ml.train", "--config", "{run}/config.toml"),
                threads=ctx.spec.resources.threads,
                gpu=True,
                resumable=True,
                clean=True,
                host="mac",
                cwd="ml",
            ),
            Step(
                name="score",
                argv=(
                    "{python}",
                    "-m",
                    "cardgame_ml.train.score",
                    "--run",
                    ctx.name,
                    "--dataset",
                    str(config["dataset"]),
                    "--out",
                    "{out}/gate-a.json",
                ),
                threads=2,
                gpu=True,
                host="mac",
                cwd="ml",
            ),
            Step(
                name="export",
                argv=("{python}", "-m", "cardgame_ml.export", "--run", ctx.name),
                threads=2,
                clean=True,
                host="mac",
                cwd="ml",
            ),
        ]
        return Plan([*steps, *eval_steps(ctx, bot)], bot, model, config)

    def _config(self, spec: Spec, repo: Path, name: str) -> dict[str, object]:
        if spec.config.base is None and spec.config.inline is None:
            raise SpecError("config: a base belief config is required")
        return effective_config(spec, repo, {"name": name, "seed": spec.seed}, frozenset())
