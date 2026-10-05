"""The registry of method runners: a spec's ``method`` names one.

Adding a method is a class with ``name``, ``trains``, ``check`` and
``plan`` (``base.Method``) registered here, plus its tests; the
researcher cannot add one (it files a request in
``research/loop/requests.md``), and the policy lists which methods it
may queue.
"""

from cardgame_ml.loop.methods.base import Context, Method, Plan, eval_steps
from cardgame_ml.loop.methods.belief import Belief
from cardgame_ml.loop.methods.dmc import Dmc
from cardgame_ml.loop.methods.evalonly import EvalOnly, SearchTuning

METHODS: dict[str, Method] = {m.name: m for m in (Dmc(), Belief(), EvalOnly(), SearchTuning())}

__all__ = ["METHODS", "Context", "Method", "Plan", "eval_steps"]
