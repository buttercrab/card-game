"""Deep Monte Carlo self-play (P3b): ``python -m cardgame_ml.train.dmc``.

The spec's config is a DMC config (a base such as
``research/loop/configs/dmc-v1.toml`` with ``set`` overrides); the loop
decides its name, seed, budget and learning curve (the protocol's), and
never lets a spec change the held-out list it excludes. Steps: train on
the GPU, write the curve from the log, export to ONNX, then the suite
as ``dmc:<model>``.
"""

import importlib
import tempfile
from pathlib import Path

from cardgame_ml.loop import tomlw
from cardgame_ml.loop.configs import effective_config
from cardgame_ml.loop.methods.base import Context, Plan, check_options, eval_steps
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.spec import Spec, SpecError
from cardgame_ml.loop.steps import Step

REQUIRED = ("name", "seed", "rules", "exclude", "budget", "model", "actors", "optim", "curve")
"""Tables and keys a DMC config has (checked when the trainer's own
schema cannot be imported)."""


class Dmc:
    name = "dmc"
    trains = True

    def check(self, spec: Spec, policy: Policy, repo: Path) -> list[str]:
        problems = check_options(spec, {"temperature": float})
        b = spec.budget
        if not b.gpu or spec.resources.host != "mac":
            problems.append("budget: DMC trains on the Mac's GPU (gpu = true, host = mac)")
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
        problems += _schema(config)
        return problems

    def plan(self, ctx: Context) -> Plan:
        config = self._config(ctx.spec, ctx.policy, ctx.repo, ctx.name)
        model = f"models/{ctx.name}"
        temperature = ctx.spec.options.get("temperature")
        bot = f"dmc:{{artifacts}}/{model}" + (f":{temperature}" if temperature else "")
        train = Step(
            name="train",
            argv=("{python}", "-m", "cardgame_ml.train.dmc", "--config", "{run}/config.toml"),
            host="mac",
            threads=ctx.spec.resources.threads,
            gpu=True,
            cwd="ml",
            resumable=True,
            grace_seconds=120.0,
            clean=True,
        )
        curve = Step(
            name="curve",
            argv=(
                "{python}",
                "-m",
                "cardgame_ml.train.dmc.report",
                "--run",
                ctx.name,
                "--out",
                "{out}/curve.json",
            ),
            host="mac",
            threads=1,
            cwd="ml",
        )
        export = Step(
            name="export",
            argv=("{python}", "-m", "cardgame_ml.export", "--run", ctx.name),
            host="mac",
            threads=2,
            cwd="ml",
            clean=True,
        )
        return Plan([train, curve, export, *eval_steps(ctx, bot)], bot, model, config)

    def _config(self, spec: Spec, policy: Policy, repo: Path, name: str) -> dict[str, object]:
        decided: dict[str, object] = {
            "name": name,
            "seed": spec.seed,
            "budget.hours": spec.budget.train_hours,
            "budget.hands": spec.budget.hands,
            "curve": policy.protocol.curve.to_table(),
        }
        return effective_config(spec, repo, decided, frozenset({"exclude"}))


def _schema(config: dict[str, object]) -> list[str]:
    """The trainer's own check of the config, when its code is here;
    otherwise that the tables it needs are present."""
    try:
        module = importlib.import_module("cardgame_ml.train.dmc.config")
    except ImportError:
        missing = [key for key in REQUIRED if key not in config]
        return [f"config: missing {', '.join(missing)}"] if missing else []
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "config.toml"
        path.write_text(tomlw.dumps(config), encoding="utf-8")
        try:
            module.DmcConfig.load(path)
        except ValueError as e:
            return [f"config: {e}".replace(str(path), "effective config")]
    return []
