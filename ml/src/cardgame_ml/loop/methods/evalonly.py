"""Runs that train nothing: a bot by name, scored by the suite.

- ``eval-only``: any bot (``options.bot``), such as a model trained
  outside the loop (``dmc:{artifacts}/models/dmc-v1``) or a table level.
- ``search-tuning``: the search with other settings
  (``search:SAMPLES:CONFIDENCE:0@endgame=…,read.…``, ``hard@…``,
  ``belief:…`` or ``hybrid:…``), CPU only, usually on the home server.

Options: ``bot``; ``clock = true`` to allow a bot that thinks on a clock
(a budget in milliseconds: measures the real machine, but a rerun does
not give the same numbers, and ``eval`` records the run as not
reproducible); ``deal_threads``, deals played at once when the bot
searches on several threads itself (``@threads=``), so the threads the
spec holds are its search's.

What a bot is, and whether it thinks on a clock, is ``eval``'s to say
(``botcheck``), never a pattern over its name.
"""

from pathlib import Path

from cardgame_ml.loop.botcheck import BotCheck, BotCheckError, check_bot
from cardgame_ml.loop.methods.base import Context, Plan, check_options, eval_steps
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.spec import Spec

SEARCHES = ("search", "belief", "hybrid")
"""The kinds of bot (``eval check-bot``) a search-tuning run scores."""


class EvalOnly:
    name = "eval-only"
    trains = False

    def check(self, spec: Spec, policy: Policy, repo: Path) -> list[str]:
        problems = check_options(spec, {"bot": str, "clock": bool, "deal_threads": int})
        bot = spec.options.get("bot")
        if not isinstance(bot, str) or not bot:
            problems.append("options: bot (the bot to score) is required")
        else:
            problems += self._bot(spec, bot, repo)
        deal_threads = spec.options.get("deal_threads")
        if isinstance(deal_threads, int) and not 1 <= deal_threads <= spec.resources.eval_threads:
            problems.append("options: deal_threads between 1 and the eval threads held")
        if spec.budget.gpu or spec.budget.train_hours or spec.budget.hands:
            problems.append("budget: eval-only runs train nothing (no gpu, train_hours, hands)")
        if spec.config.base is not None or spec.config.inline is not None:
            problems.append("config: eval-only runs have no training config")
        return problems

    def _bot(self, spec: Spec, bot: str, repo: Path) -> list[str]:
        try:
            checked = check_bot(bot, repo)
        except BotCheckError as e:
            return [f"options: bot {bot!r}: {e}"]
        problems = self._kind(checked)
        if not checked.reproducible and spec.options.get("clock") is not True:
            problems.append(
                f"options: bot thinks on a clock ({checked.reason}); give a budget of 0 "
                "(fixed samples), or clock = true to measure the machine (not reproducible)"
            )
        return problems

    def _kind(self, checked: BotCheck) -> list[str]:
        """What is wrong with this kind of bot for the method."""
        return []

    def plan(self, ctx: Context) -> Plan:
        bot = str(ctx.spec.options["bot"])
        deal_threads = ctx.spec.options.get("deal_threads")
        steps = eval_steps(ctx, bot, deal_threads if isinstance(deal_threads, int) else None)
        return Plan(steps, bot, None, None)


class SearchTuning(EvalOnly):
    name = "search-tuning"

    def check(self, spec: Spec, policy: Policy, repo: Path) -> list[str]:
        problems = super().check(spec, policy, repo)
        if "search" not in spec.tags:
            problems.append("tags: a search-tuning run is tagged search")
        return problems

    def _kind(self, checked: BotCheck) -> list[str]:
        if checked.kind not in SEARCHES:
            return [
                f"options: bot must be a search (search:…, hard@…, belief:…, hybrid:…), "
                f"not {checked.kind}"
            ]
        return []
