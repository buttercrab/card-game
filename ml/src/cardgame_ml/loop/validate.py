"""Whether a spec may run: its shape (``spec``), the policy (hosts,
budgets, the protocol, what the researcher may queue), the evals kept
out of reach, and its method's own checks.

Every spec is checked when it enters the queue (the researcher's
included, file by file) and again when it starts.
"""

from collections.abc import Collection
from dataclasses import dataclass
from pathlib import Path

from cardgame_ml.loop.configs import base_config, strings
from cardgame_ml.loop.methods import METHODS
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.spec import Spec, SpecError, load_spec

FORBIDDEN = ("research/evals", "heldout-rules", "evals/v1")
"""No spec names the suites or held-out sets: the loop scores through the
``eval`` tool and training excludes held-out sets by the policy's path."""


@dataclass(frozen=True)
class Known:
    """Runs the spec may refer to (as parent or in ``after``)."""

    runs: Collection[str]
    """Loop runs recorded."""
    queued: Collection[str]
    """Specs in the queue besides this one."""


def check(spec: Spec, policy: Policy, repo: Path, known: Known, *, researcher: bool) -> list[str]:
    """Every problem with ``spec`` (none: it may run). ``researcher``
    applies the limits on what the research agent may queue."""
    problems: list[str] = []
    method = METHODS.get(spec.method)
    if method is None:
        problems.append(f"method: unknown {spec.method!r} (known: {', '.join(sorted(METHODS))})")
    elif researcher and spec.method not in policy.limits.methods:
        problems.append(f"method: {spec.method} is not one the policy lets the researcher queue")
    if spec.id in known.runs or spec.id in known.queued:
        problems.append(f"id: {spec.id} is taken by a run or another queued spec")
    problems += _resources(spec, policy)
    problems += _evals(spec, policy, method.trains if method else False)
    problems += _references(spec, known, researcher)
    for path, text in strings(spec.to_toml()):
        if any(word in text for word in FORBIDDEN):
            problems.append(f"{path}: names the evals or held-out sets ({text!r})")
    if method is not None and not problems:
        problems += method.check(spec, policy, repo)
    if not problems:
        problems += _base_config(spec, repo)
    return [f"{spec.id}: {p}" for p in problems]


def check_file(
    path: Path, policy: Policy, repo: Path, known: Known, *, researcher: bool
) -> tuple[Spec | None, list[str]]:
    try:
        spec = load_spec(path)
    except SpecError as e:
        return None, [str(e)]
    return spec, check(spec, policy, repo, known, researcher=researcher)


def _base_config(spec: Spec, repo: Path) -> list[str]:
    """The base config names no evals either, but for the held-out list
    it excludes (``exclude``, which the methods pin to the policy's)."""
    try:
        config = base_config(spec, repo)
    except SpecError as e:
        return [str(e)]
    return [
        f"config: {path} names the evals or held-out sets"
        for path, text in strings(config)
        if path != "exclude" and any(word in text for word in FORBIDDEN)
    ]


def _resources(spec: Spec, policy: Policy) -> list[str]:
    problems: list[str] = []
    r, b = spec.resources, spec.budget
    for role, name, threads in (
        ("host", r.host, r.threads),
        ("eval_host", r.eval_host, r.eval_threads),
    ):
        host = policy.hosts.get(name)
        if host is None:
            problems.append(f"resources: {role} {name!r} is not in the policy")
        elif threads > host.cores:
            problems.append(f"resources: {threads} threads on {name}, which has {host.cores}")
    host = policy.hosts.get(r.host)
    if b.gpu and host is not None and not host.gpu:
        problems.append(f"budget: gpu, but {r.host} has none for the loop")
    if b.wall_hours > policy.limits.max_wall_hours:
        problems.append(
            f"budget: {b.wall_hours} wall hours, over the policy's {policy.limits.max_wall_hours}"
        )
    return problems


def _evals(spec: Spec, policy: Policy, trains: bool) -> list[str]:
    problems: list[str] = []
    e, protocol = spec.evals, policy.protocol
    fresh = spec.confirms is not None and e.suite == protocol.confirm_suite
    if e.suite != protocol.suite and e.suite not in protocol.suites and not fresh:
        problems.append(f"evals: suite {e.suite!r}; runs are scored on {protocol.suite}")
    outside = sorted(set(e.parts) - set(protocol.parts))
    if outside:
        problems.append(f"evals: parts {', '.join(outside)} are not in the protocol")
    if not e.baselines:
        problems.append("evals: at least one baseline")
    if "parent" in e.baselines and spec.parent is None:
        problems.append("evals: baseline parent, but no parent")
    if trains:
        if not e.curve:
            problems.append("evals: training runs record the learning curve (curve = true)")
        missing = sorted(set(protocol.required_parts) - set(e.parts))
        if missing:
            problems.append(f"evals: training runs play {', '.join(missing)} too")
        if protocol.baseline not in e.baselines and not fresh:
            problems.append(f"evals: training runs are measured against {protocol.baseline}")
    return problems


def _references(spec: Spec, known: Known, researcher: bool) -> list[str]:
    problems: list[str] = []
    everything = set(known.runs) | set(known.queued)
    parent = spec.parent_run()
    if parent is not None and parent not in everything:
        problems.append(f"parent: no run or queued spec {parent!r}")
    problems += [f"after: no run or queued spec {a!r}" for a in spec.after if a not in everything]
    if researcher and (spec.confirms is not None or "confirmation" in spec.tags):
        problems.append("confirmations are queued by the runner, not by hand")
    for path in spec.requires:
        if path.startswith("/") or ".." in Path(path).parts:
            problems.append(f"requires: {path!r} must be a path inside the artifact store")
    return problems
