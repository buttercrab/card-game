"""The researcher: Claude Code, headless, called when the queue runs low,
to propose the next experiments within the agenda.

It gets ``research/loop/researcher.md`` as its instructions plus a short
briefing (the date, the queue, recent results, the last call's rejected
specs, the limits). Its sandbox (``command``):

- it starts in ``research/`` with ``docs/`` added, and its rules allow
  reading only those two (never ``research/evals``, and never anything
  that looks like a secret: ``~/.ssh``, ``.env`` files, ``site.env``…);
- it may write only its own files: specs in its inbox
  (``research/loop/inbox/``, never the queue itself), new base configs
  in ``research/loop/configs/``, ``agenda.md``, ``requests.md``,
  ``withdraw.txt`` (queued specs it wants dropped) and
  ``research/experiments/*/notes.md``;
- it has no shell, no web and no MCP servers: the runner validates its
  specs afterwards and the next briefing says what was refused. It never
  writes code: a method that needs code becomes a request in
  ``research/loop/requests.md`` for a person;
- its environment holds only home, path, locale and its own login (no
  bot or stats tokens), and only the project's settings are read (the
  user's own permission rules do not widen these);
- each call is capped (``max_budget_usd``) and killed past
  ``timeout_minutes``; the calls of the last 24 hours may cost
  ``max_usd_per_day`` in all, by ``claude``'s own reported cost.

A call is a critical section: while it is under way
(``<store>/loop/researcher-call.json`` exists) the runner takes nothing
from the queue, starts no step that needs a clean checkout, writes and
commits nothing under ``research/loop`` (its confirmations wait in
``<store>/loop/held/``), so everything the call wrote is still there,
uncommitted, when it is checked. The runner checks every call
afterwards, whatever the tool rules said:

- a change outside those places (or to an existing base config) is put
  back (tracked files) or moved out of the repository to
  ``<store>/loop/researcher/quarantine/`` (new files), and the researcher
  is switched off (``<store>/loop/researcher-off`` says why) until a
  person removes it. The queue is compared with its contents when the
  call started, so any change to it counts and is undone. Run folders,
  manifests and reports are not judged: runs and their steps write
  there while a call is under way, and the tool rules keep the
  researcher out of them (except ``notes.md``);
- every spec in the inbox is validated with the researcher's limits
  (methods the policy allows, budgets, the protocol, no evals, no
  ``confirms``, safe names and paths); the good ones move to the queue,
  the ones that fail go to ``research/loop/rejected/`` with the reasons;
- at most ``max_specs_per_call`` new specs and ``max_gpu_hours_queued``
  GPU hours in the queue: the rest are rejected.

Calls are rate-limited (``min_interval_hours``, ``max_calls_per_day``)
and each is logged in ``research/loop/researcher-log.jsonl`` (outcome,
cost, tokens), its transcript kept in ``<store>/loop/researcher/``.
"""

import contextlib
import json
import os
import shutil
import signal
import subprocess
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol, cast

from cardgame_ml.loop.layout import Layout
from cardgame_ml.loop.policy import Policy
from cardgame_ml.loop.queue import blocked, read_queue, reject, waiting_for
from cardgame_ml.loop.records import Records, parse_stamp, stamp
from cardgame_ml.loop.safety import UnsafePathError, inside, name, researcher_environment
from cardgame_ml.loop.validate import Known, check_file
from cardgame_ml.runtime import alive as process_alive

if TYPE_CHECKING:
    from cardgame_ml.loop.scheduler import Runner

WITHDRAW = "research/loop/withdraw.txt"
"""Queued spec files the researcher wants dropped, one per line (it has
no shell to delete them): the runner moves them to ``rejected/``."""

FILES = (
    "research/loop/agenda.md",
    "research/loop/requests.md",
    WITHDRAW,
)
FOLDERS = ("research/loop/inbox", "research/loop/configs")
"""``*.toml`` files directly in these (configs: new ones only)."""

TOOLS = "Read,Glob,Grep,Write,Edit"
"""The only tools it has: no Bash, no web, no agents."""

DENIED_TOOLS = ("Bash", "WebFetch", "WebSearch", "Task", "Agent", "NotebookEdit")

SECRETS = (
    "~/.ssh/**",
    "~/.aws/**",
    "~/.config/**",
    "~/.gnupg/**",
    "~/.docker/**",
    "~/.kube/**",
    "~/.claude/**",
    "~/.claude.json",
    "~/.netrc",
    "~/Library/**",
    "//**/.env",
    "//**/.env.*",
    "//**/*.env",
    "//**/site.env",
    "//**/*.pem",
    "//**/*.key",
    "//**/.git/**",
)
"""Read denied wherever it is, as well as everything outside the two
folders it may read."""


def allowed_path(path: str) -> bool:
    """Whether the researcher may change ``path`` (relative to the repo)."""
    if path in FILES:
        return True
    parts = path.split("/")
    folder, file = "/".join(parts[:-1]), parts[-1]
    if folder in FOLDERS:
        return file.endswith(".toml") and _safe(file)
    return (
        len(parts) == 4  # noqa: PLR2004
        and parts[:2] == ["research", "experiments"]
        and _safe(parts[2])
        and parts[3] == "notes.md"
    )


def runner_path(path: str, folders: set[str]) -> bool:
    """Whether ``path`` is one the runner and its steps write while a call
    is under way: a run's folder (except ``notes.md``, the researcher's),
    a manifest or a report. These are not judged after a call."""
    top, _, rest = path.removeprefix("research/").partition("/")
    if not path.startswith("research/") or not rest or ".." in rest.split("/"):
        return False
    if top == "experiments":
        folder, _, inner = rest.partition("/")
        return folder in folders and bool(inner) and inner != "notes.md"
    return top in ("manifests", "reports")


def _safe(text: str) -> bool:
    try:
        name(text, "file")
    except UnsafePathError:
        return False
    return True


def rule(tool: str, path: Path, pattern: str = "") -> str:
    """A permission rule on an absolute path (``//`` in Claude Code's rules)."""
    return f"{tool}(/{path.as_posix()}{pattern})"


@dataclass(frozen=True)
class Sandbox:
    """Where the researcher starts, and what it may read and write."""

    cwd: Path
    add_dirs: tuple[Path, ...]
    allow: tuple[str, ...]
    deny: tuple[str, ...]

    @classmethod
    def of(cls, repo: Path) -> "Sandbox":
        repo = repo.resolve()
        research, docs = repo / "research", repo / "docs"
        loop = research / "loop"
        allow = [
            rule("Read", research, "/**"),
            rule("Read", docs, "/**"),
            *(rule(t, loop / "inbox", "/*.toml") for t in ("Write", "Edit")),
            rule("Write", loop / "configs", "/*.toml"),
            *(rule(t, repo / f) for f in FILES for t in ("Write", "Edit")),
            *(rule(t, research / "experiments", "/*/notes.md") for t in ("Write", "Edit")),
        ]
        deny = [
            *(rule(t, research / "evals", "/**") for t in ("Read", "Write", "Edit")),
            *(f"Read({p})" for p in SECRETS),
            *DENIED_TOOLS,
        ]
        return cls(research, (docs,), tuple(allow), tuple(deny))


def command(policy: Policy, prompt: str, repo: Path) -> list[str]:
    """The ``claude`` command line: its sandbox, its model, its cap."""
    r, box = policy.researcher, Sandbox.of(repo)
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
        "--setting-sources",
        "project",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers": {}}',
        "--disable-slash-commands",
        "--tools",
        TOOLS,
        "--max-budget-usd",
        f"{r.max_budget_usd:.2f}",
    ]
    for folder in box.add_dirs:
        argv += ["--add-dir", str(folder)]
    return [*argv, "--allowedTools", *box.allow, "--disallowedTools", *box.deny]


@dataclass(frozen=True)
class Briefing:
    """What the researcher is told besides its instructions."""

    now: datetime
    runnable: int
    queued: list[str]
    recent: list[str]
    gpu_hours_queued: float
    repo: Path = Path()
    refused: list[str] = field(default_factory=list[str])
    """The last call's rejected specs, with why."""

    def text(self, policy: Policy) -> str:
        lim = policy.limits
        lines = [
            f"Now: {self.now.astimezone().strftime('%Y-%m-%d %H:%M %Z')}.",
            f"The repository is {self.repo.resolve()}; you start in its research/ folder and "
            "may read only research/ and docs/. Paths below are from the repository root.",
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
        if self.refused:
            lines += ["Specs the runner refused after your last call:"]
            lines += [f"- {line}" for line in self.refused]
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
            env=researcher_environment(),
        )
    return child.pid


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
        alive: Callable[[int], bool] = process_alive,
    ) -> None:
        self.layout, self.policy, self.git = layout, policy, git
        self.spawn, self.alive = spawn, alive
        self.state_file = layout.researcher_call
        self.records = Records(layout.experiments, layout.live)
        """The runs, as the runner sees them when it calls (else read here)."""

    # -- when ----------------------------------------------------------

    def calls(self) -> list[dict[str, Any]]:
        if not self.layout.researcher_log.is_file():
            return []
        text = self.layout.researcher_log.read_text(encoding="utf-8")
        return [json.loads(line) for line in text.splitlines() if line.strip()]

    def spent(self, now: datetime) -> float:
        """What the calls of the last 24 hours cost, by ``claude``'s own
        report; a call that reported nothing counts as a whole call."""
        cap = self.policy.researcher.max_budget_usd
        total = 0.0
        for c in self.calls():
            if now - parse_stamp(c["started"]) >= timedelta(days=1):
                continue
            cost: object = c.get("total_cost_usd")
            if isinstance(cost, int | float) and not isinstance(cost, bool):
                total += max(float(cost), 0.0)
            else:
                total += cap
        return total

    def over_budget(self, now: datetime) -> str | None:
        """Why a call would break the day's spend cap (``None``: it fits)."""
        r = self.policy.researcher
        spent = self.spent(now)
        if spent + r.max_budget_usd > r.max_usd_per_day:
            return (
                f"${spent:.2f} spent in the last day; a call may take ${r.max_budget_usd:.2f} "
                f"and the day's cap is ${r.max_usd_per_day:.2f}"
            )
        return None

    def not_due(self, now: datetime) -> str | None:  # noqa: PLR0911
        """Why the researcher is not called now (``None``: it is due)."""
        r = self.policy.researcher
        if self.layout.researcher_off.exists():
            return "switched off (researcher-off)"
        if self.state_file.exists():
            return "a call is under way"
        over = self.over_budget(now)
        if over is not None:
            return over
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
        runs = self.records.by_id()
        queue = [q for q in read_queue(self.layout.queue) if q.spec is not None]
        runnable = sum(
            not blocked(waiting_for(q.spec, runs, self.layout.artifacts))
            for q in queue
            if q.spec is not None
        )
        recent: list[str] = []
        for record in sorted(runs.values(), key=lambda r: r.created, reverse=True)[:12]:
            c = record.comparison
            versus = f", vs parent {c.diff}" if c is not None else ""
            recent.append(
                f"{record.id} ({record.method}, {record.status}{versus}): "
                f"research/experiments/{record.folder}/summary.md"
            )
        gpu = sum(q.spec.gpu_hours() for q in queue if q.spec is not None)
        calls = self.calls()
        refused: list[str] = []
        for item in cast(list[object], calls[-1].get("rejected", []) if calls else []):
            if isinstance(item, dict):
                r = cast(dict[str, object], item)
                reasons = cast(list[object], r.get("reasons", []))
                refused.append(f"{r.get('file')}: {'; '.join(map(str, reasons))}"[:400])
        return Briefing(
            now, runnable, [q.path.name for q in queue], recent, gpu, self.layout.repo, refused
        )

    # -- the hook --------------------------------------------------------

    def __call__(self, runner: "Runner | None", now: datetime) -> bool:
        if runner is not None:
            self.records = runner.records  # this tick's, read once
        else:
            self.records.refresh()
        if self.state_file.exists():
            return self._watch(now)
        if self.not_due(now) is None:
            self.start(now)
        return False

    def start(self, now: datetime) -> None:
        over = self.over_budget(now)
        if over is not None:
            raise RuntimeError(f"not calling the researcher: {over}")
        instructions = (self.layout.loop / "researcher.md").read_text(encoding="utf-8")
        prompt = f"{instructions}\n\n## Briefing\n\n{self.briefing(now).text(self.policy)}\n"
        transcript = self.layout.state / "researcher" / f"{stamp(now).replace(':', '')}.json"
        queue = self.layout.queue
        before = {
            "changed": self.git.changed(),
            "queue": {
                p.name: p.read_text(encoding="utf-8", errors="replace")
                for p in (sorted(queue.iterdir()) if queue.is_dir() else [])
                if p.is_file() and not p.is_symlink()
            },
        }
        self.layout.inbox.mkdir(parents=True, exist_ok=True)
        box = Sandbox.of(self.layout.repo)
        pid = self.spawn(command(self.policy, prompt, self.layout.repo), box.cwd, transcript)
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
        changed = sorted(set(self.git.changed()) - set(before["changed"]))
        folders = {r.folder for r in self.records.all()}
        violations = [
            p
            for p in changed
            if not runner_path(p, folders)
            and (
                not allowed_path(p)
                # Base configs: new files only; the existing ones runs were built on stay.
                or (p.startswith("research/loop/configs/") and self.git.tracked(p))
            )
        ]
        tracked = [p for p in violations if self.git.tracked(p)]
        self.git.restore(tracked)
        self._quarantine([p for p in violations if p not in tracked], now)
        # The queue is the runner's: whatever git says, it goes back to what
        # it held when the call started.
        queue = self.layout.queue.relative_to(self.layout.repo).as_posix()
        violations += [f"{queue}/{file}" for file in self._restore_queue(before["queue"], now)]
        violations = sorted(set(violations))
        if violations:
            outcome = "violation"
            self.layout.researcher_off.parent.mkdir(parents=True, exist_ok=True)
            self.layout.researcher_off.write_text(
                f"{stamp(now)}: the researcher changed {', '.join(violations)}\n",
                encoding="utf-8",
            )
        withdrawn = self._withdraw()
        accepted, rejected = self._validate()
        # The inbox ends empty: what is left is not a spec file.
        if self.layout.inbox.is_dir():
            left = [p.relative_to(self.layout.repo).as_posix() for p in self.layout.inbox.iterdir()]
            self._quarantine(left, now)
        entry: dict[str, Any] = {
            "started": call["started"],
            "ended": stamp(now),
            "outcome": outcome,
            "accepted": accepted,
            "rejected": rejected,
            "withdrawn": withdrawn,
            "changed": changed,
            "transcript": call["transcript"],
        }
        entry |= _usage(Path(call["transcript"]))
        return entry

    def _restore_queue(self, old: dict[str, str], now: datetime) -> list[str]:
        """Puts the queue back as it was when the call started (the runner
        does not touch it during a call); returns the files that differed."""
        queue = self.layout.queue
        differ: set[str] = set()
        present = sorted(queue.iterdir()) if queue.is_dir() else []
        for path in present:
            if path.name not in old or path.is_symlink() or not path.is_file():
                differ.add(path.name)
                self._quarantine([path.relative_to(self.layout.repo).as_posix()], now)
        for file, text in old.items():
            path = queue / file
            if not path.is_file() or path.read_text(encoding="utf-8", errors="replace") != text:
                differ.add(file)
                queue.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
        return sorted(differ)

    def _quarantine(self, paths: list[str], now: datetime) -> None:
        """Moves what the researcher had no right to write out of the
        repository (kept for a person to look at, never run or committed)."""
        root = self.layout.state / "researcher" / "quarantine" / stamp(now).replace(":", "")
        for rel in paths:
            source = self.layout.repo / rel
            if not (source.exists() or source.is_symlink()):
                continue
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(source, target)

    def _withdraw(self) -> list[str]:
        """Moves the queued specs ``withdraw.txt`` names to ``rejected/``
        (never a confirmation, never a name that is not a plain spec file)."""
        listing = self.layout.repo / WITHDRAW
        if not listing.is_file():
            return []
        done: list[str] = []
        for line in listing.read_text(encoding="utf-8").splitlines():
            file = line.strip()
            if not file or file.startswith("#"):
                continue
            try:
                path = inside(self.layout.queue, name(file, "withdrawn spec"))
            except UnsafePathError:
                continue
            if not file.endswith(".toml") or not path.is_file() or path.is_symlink():
                continue
            if "\nconfirms = " in path.read_text(encoding="utf-8"):
                continue
            reject(path, self.layout.rejected, ["withdrawn by the researcher"])
            done.append(file)
        listing.unlink()
        return done

    def _validate(self) -> tuple[list[str], list[dict[str, Any]]]:
        """Checks every spec in the inbox, in file order: the good ones move
        to the queue, the others to ``rejected/``. The inbox ends empty."""
        layout, policy = self.layout, self.policy
        runs = self.records.by_id()
        queue = read_queue(layout.queue)
        fresh = sorted(layout.inbox.glob("*.toml")) if layout.inbox.is_dir() else []
        inbox = read_queue(layout.inbox)
        gpu = sum(q.spec.gpu_hours() for q in queue if q.spec is not None)
        accepted: list[str] = []
        rejected: list[dict[str, Any]] = []
        for k, path in enumerate(fresh):
            others = [q.spec.id for q in [*queue, *inbox] if q.spec is not None and q.path != path]
            spec, problems = check_file(
                path, policy, layout.repo, Known(runs, others), researcher=True
            )
            if not _safe(path.name) or path.is_symlink():
                problems = [*problems, f"{path.name}: not a plain spec file with a safe name"]
            if not problems and (layout.queue / path.name).exists():
                problems = [f"{path.name}: a queued spec has this file name"]
            if not problems and k >= policy.limits.max_specs_per_call:
                problems = [f"over the {policy.limits.max_specs_per_call} specs a call may queue"]
            if not problems and spec is not None:
                if gpu + spec.gpu_hours() > policy.limits.max_gpu_hours_queued:
                    limit = policy.limits.max_gpu_hours_queued
                    problems = [f"the queue would hold over {limit} GPU hours"]
                else:
                    gpu += spec.gpu_hours()
            if problems or spec is None:
                reject(path, layout.rejected, problems or ["unreadable"])
                rejected.append({"file": path.name, "reasons": problems or ["unreadable"]})
            else:
                layout.queue.mkdir(parents=True, exist_ok=True)
                path.replace(layout.queue / path.name)
                accepted.append(spec.id)
        return accepted, rejected


def _usage(transcript: Path) -> dict[str, Any]:
    """Cost, tokens and turns from ``claude``'s JSON output, when it wrote one."""
    try:
        data = json.loads(transcript.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    fields = cast(dict[str, Any], data)
    keys = ("total_cost_usd", "num_turns", "duration_ms", "is_error")
    out: dict[str, Any] = {k: fields[k] for k in keys if k in fields}
    usage = fields.get("usage")
    if isinstance(usage, dict):
        tokens = {
            k: v
            for k, v in cast(dict[str, Any], usage).items()
            if k.endswith("_tokens") and isinstance(v, int)
        }
        if tokens:
            out["tokens"] = tokens
    result = fields.get("result")
    if isinstance(result, str):
        out["note"] = result[:300]
    return out
