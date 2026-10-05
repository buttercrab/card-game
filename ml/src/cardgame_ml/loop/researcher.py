"""The researcher: Claude Code, headless, called when the queue runs low,
to propose the next experiments within the agenda.

It gets ``research/loop/researcher.md`` as its instructions plus a short
briefing (the date, the queue, recent results, the limits), and may only
read the repository (never ``research/evals``), write in
``research/loop/`` (specs into the queue, the agenda, requests, configs)
and ``research/experiments/*/notes.md``, and run the loop's ``validate``
command. It never writes code: a method that needs code becomes a
request in ``research/loop/requests.md`` for a person.

The runner checks every call afterwards, whatever the tool rules said:

- a change outside those places is put back (tracked files) and the
  researcher is switched off (``<store>/loop/researcher-off`` says why)
  until a person removes the file;
- every new or changed spec is validated with the researcher's limits
  (methods the policy allows, budgets, the protocol, no evals) and the
  ones that fail go to ``research/loop/rejected/`` with the reasons;
- at most ``max_specs_per_call`` new specs and ``max_gpu_hours_queued``
  GPU hours in the queue: the rest are rejected;
- confirmations the runner queued are put back if touched.

Calls are rate-limited (``min_interval_hours``, ``max_calls_per_day``)
and each is logged in ``research/loop/researcher-log.jsonl``, its
transcript kept in ``<store>/loop/researcher/``.
"""

import contextlib
import json
import os
import signal
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Protocol, cast

from cardgame_ml.loop.layout import Layout
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.queue import blocked, read_queue, reject, waiting_for
from cardgame_ml.loop.records import Records, parse_stamp, stamp
from cardgame_ml.loop.validate import Known, check_file

WRITABLE = (
    "research/loop/queue/",
    "research/loop/configs/",
    "research/loop/agenda.md",
    "research/loop/requests.md",
)
"""What the researcher may change (and ``research/experiments/*/notes.md``)."""

VALIDATE = "uv run --project ml python -m cardgame_ml.loop validate"


def allowed_path(path: str) -> bool:
    if any(path == w or (w.endswith("/") and path.startswith(w)) for w in WRITABLE):
        return True
    parts = path.split("/")
    return len(parts) == 4 and parts[:2] == ["research", "experiments"] and parts[3] == "notes.md"  # noqa: PLR2004


def command(policy: Policy, prompt: str) -> list[str]:
    """The ``claude`` command line: its tools restricted to reading,
    writing the loop's files and validating specs."""
    r = policy.researcher
    argv = [
        os.path.expanduser(r.claude),
        "-p",
        prompt,
        "--model",
        r.model,
        "--output-format",
        "json",
        "--no-session-persistence",
        "--permission-mode",
        "dontAsk",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers": {}}',
        "--tools",
        "Read,Glob,Grep,Write,Edit,Bash",
        "--allowedTools",
        "Read",
        "Glob",
        "Grep",
        "Write(research/loop/**)",
        "Edit(research/loop/**)",
        "Write(research/experiments/*/notes.md)",
        "Edit(research/experiments/*/notes.md)",
        f"Bash({VALIDATE}:*)",
        "--disallowedTools",
        "Read(research/evals/**)",
        "Edit(research/evals/**)",
        "Write(research/evals/**)",
    ]
    if r.max_budget_usd > 0:
        argv += ["--max-budget-usd", str(r.max_budget_usd)]
    return argv


@dataclass(frozen=True)
class Briefing:
    """What the researcher is told besides its instructions."""

    now: datetime
    runnable: int
    queued: list[str]
    recent: list[str]
    gpu_hours_queued: float

    def text(self, policy: Policy) -> str:
        lim = policy.limits
        lines = [
            f"Now: {self.now.astimezone().strftime('%Y-%m-%d %H:%M %Z')}.",
            f"Runnable specs in the queue: {self.runnable}; queued: "
            + (", ".join(self.queued) or "none")
            + ".",
            f"Limits: methods {', '.join(lim.methods)}; at most {lim.max_wall_hours} wall hours "
            f"a spec; at most {lim.max_specs_per_call} new specs this call; at most "
            f"{lim.max_gpu_hours_queued} GPU hours queued in all "
            f"({self.gpu_hours_queued:.1f} now).",
            "Recent runs (newest first):",
            *(f"- {line}" for line in self.recent),
        ]
        return "\n".join(lines)


class Checkout(Protocol):
    """What the researcher's checks need of git (``gitops.Git``)."""

    def changed(self) -> list[str]: ...

    def restore(self, paths: list[str]) -> None: ...

    def tracked(self, path: str) -> bool: ...


type Spawn = Callable[[list[str], Path, Path], int]
"""Starts the researcher (argv, working directory, transcript file) and
returns its process id."""


def spawn(argv: list[str], cwd: Path, transcript: Path) -> int:
    transcript.parent.mkdir(parents=True, exist_ok=True)
    with transcript.open("wb") as sink:
        child = subprocess.Popen(
            argv,
            cwd=cwd,
            stdin=subprocess.DEVNULL,
            stdout=sink,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    return child.pid


def _alive(pid: int) -> bool:
    try:
        waited, _ = os.waitpid(pid, os.WNOHANG)
        if waited:
            return False
    except ChildProcessError:
        pass
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class Researcher:
    """The runner's hook that calls the researcher and checks its work.
    A call runs in the background; the hook looks at it every tick."""

    def __init__(
        self,
        layout: Layout,
        policy: Policy,
        git: Checkout,
        *,
        spawn: Spawn = spawn,
        alive: Callable[[int], bool] = _alive,
    ) -> None:
        self.layout, self.policy, self.git = layout, policy, git
        self.spawn, self.alive = spawn, alive
        self.state_file = layout.state / "researcher-call.json"

    # -- when ----------------------------------------------------------

    def calls(self) -> list[dict[str, Any]]:
        if not self.layout.researcher_log.is_file():
            return []
        text = self.layout.researcher_log.read_text(encoding="utf-8")
        return [json.loads(line) for line in text.splitlines() if line.strip()]

    def not_due(self, now: datetime) -> str | None:
        """Why the researcher is not called now (``None``: it is due)."""
        r = self.policy.researcher
        if self.layout.researcher_off.exists():
            return "switched off (researcher-off)"
        if self.state_file.exists():
            return "a call is under way"
        runnable = self.briefing(now).runnable
        if runnable >= r.low_water:
            return f"{runnable} runnable specs queued"
        starts = [parse_stamp(c["started"]) for c in self.calls()]
        if starts and now - max(starts) < timedelta(hours=r.min_interval_hours):
            return f"last call at {stamp(max(starts))}"
        if sum(now - s < timedelta(days=1) for s in starts) >= r.max_calls_per_day:
            return f"{r.max_calls_per_day} calls in the last day"
        return None

    def briefing(self, now: datetime) -> Briefing:
        runs = Records(self.layout.experiments, self.layout.live).by_id()
        queue = [q for q in read_queue(self.layout.queue) if q.spec is not None]
        runnable = sum(
            not blocked(waiting_for(q.spec, runs, self.layout.artifacts))
            for q in queue
            if q.spec is not None
        )
        recent: list[str] = []
        for record in sorted(runs.values(), key=lambda r: r.created, reverse=True)[:12]:
            c = record.comparison or {}
            diff = c.get("diff")
            versus = (
                f", vs parent {diff['mean']:+.2f} ± {diff['ci95']:.2f}"
                if isinstance(diff, dict)
                else ""
            )
            recent.append(
                f"{record.id} ({record.method}, {record.status}{versus}): "
                f"research/experiments/{record.folder}/summary.md"
            )
        gpu = sum(q.spec.gpu_hours() for q in queue if q.spec is not None)
        return Briefing(now, runnable, [q.path.name for q in queue], recent, gpu)

    # -- the hook --------------------------------------------------------

    def __call__(self, _runner: object, now: datetime) -> bool:
        if self.state_file.exists():
            return self._watch(now)
        if self.not_due(now) is None:
            self.start(now)
        return False

    def start(self, now: datetime) -> None:
        instructions = (self.layout.loop / "researcher.md").read_text(encoding="utf-8")
        prompt = f"{instructions}\n\n## Briefing\n\n{self.briefing(now).text(self.policy)}\n"
        transcript = self.layout.state / "researcher" / f"{stamp(now).replace(':', '')}.json"
        before = {
            "changed": self.git.changed(),
            "queue": {
                p.name: p.read_text(encoding="utf-8") for p in self.layout.queue.glob("*.toml")
            },
        }
        pid = self.spawn(command(self.policy, prompt), self.layout.repo, transcript)
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        self.state_file.write_text(
            json.dumps(
                {"pid": pid, "started": stamp(now), "transcript": str(transcript), "before": before}
            ),
            encoding="utf-8",
        )

    def _watch(self, now: datetime) -> bool:
        call = json.loads(self.state_file.read_text(encoding="utf-8"))
        started = parse_stamp(call["started"])
        timeout = timedelta(minutes=self.policy.researcher.timeout_minutes)
        outcome = "ok"
        if self.alive(call["pid"]):
            if now - started < timeout:
                return False
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(call["pid"], signal.SIGKILL)
            outcome = "timeout"
        entry = self.settle(call, now, outcome)
        with self.layout.researcher_log.open("a", encoding="utf-8") as log:
            log.write(json.dumps(entry, ensure_ascii=False) + "\n")
        self.state_file.unlink()
        return True

    # -- checking its work -----------------------------------------------

    def settle(self, call: dict[str, Any], now: datetime, outcome: str) -> dict[str, Any]:
        before: dict[str, Any] = call["before"]
        old_queue: dict[str, str] = before["queue"]
        changed = sorted(set(self.git.changed()) - set(before["changed"]))
        violations = [p for p in changed if not allowed_path(p)]
        if violations:
            outcome = "violation"
            self.git.restore([p for p in violations if self.git.tracked(p)])
            self.layout.researcher_off.parent.mkdir(parents=True, exist_ok=True)
            self.layout.researcher_off.write_text(
                f"{stamp(now)}: the researcher changed {', '.join(violations)}\n",
                encoding="utf-8",
            )
        # Confirmations are the runner's: put back any the researcher touched.
        for name, text in old_queue.items():
            path = self.layout.queue / name
            if "\nconfirms = " in text and (
                not path.exists() or path.read_text(encoding="utf-8") != text
            ):
                path.write_text(text, encoding="utf-8")
        accepted, rejected = self._validate(old_queue)
        entry: dict[str, Any] = {
            "started": call["started"],
            "ended": stamp(now),
            "outcome": outcome,
            "accepted": accepted,
            "rejected": rejected,
            "changed": changed,
            "transcript": call["transcript"],
        }
        entry |= _usage(Path(call["transcript"]))
        return entry

    def _validate(self, old_queue: dict[str, str]) -> tuple[list[str], list[dict[str, Any]]]:
        """Checks every spec the call added or changed, in file order."""
        layout, policy = self.layout, self.policy
        runs = Records(layout.experiments, layout.live).by_id()
        queue = read_queue(layout.queue)
        fresh = sorted(
            q.path
            for q in queue
            if old_queue.get(q.path.name) != q.path.read_text(encoding="utf-8")
        )
        gpu = sum(q.spec.gpu_hours() for q in queue if q.spec is not None and q.path not in fresh)
        accepted: list[str] = []
        rejected: list[dict[str, Any]] = []
        for k, path in enumerate(fresh):
            others = [q.spec.id for q in queue if q.spec is not None and q.path != path]
            spec, problems = check_file(
                path, policy, layout.repo, Known(runs, others), researcher=True
            )
            if not problems and k >= policy.limits.max_specs_per_call:
                problems = [f"over the {policy.limits.max_specs_per_call} specs a call may queue"]
            if not problems and spec is not None:
                if gpu + spec.gpu_hours() > policy.limits.max_gpu_hours_queued:
                    limit = policy.limits.max_gpu_hours_queued
                    problems = [f"the queue would hold over {limit} GPU hours"]
                else:
                    gpu += spec.gpu_hours()
            if problems:
                reject(path, layout.rejected, problems)
                rejected.append({"file": path.name, "reasons": problems})
            elif spec is not None:
                accepted.append(spec.id)
        return accepted, rejected


def _usage(transcript: Path) -> dict[str, Any]:
    """Cost and turns from ``claude``'s JSON output, when it wrote one."""
    try:
        data = json.loads(transcript.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    fields = cast(dict[str, Any], data)
    keys = ("total_cost_usd", "num_turns", "duration_ms", "is_error")
    out: dict[str, Any] = {k: fields[k] for k in keys if k in fields}
    result = fields.get("result")
    if isinstance(result, str):
        out["note"] = result[:300]
    return out
