"""The runner: takes specs from the queue, starts their steps when hosts
have room, watches them, enforces budgets and records everything.

Rules, each tick (every 30 s):

1. **Watch** every active run's current step. A step that ended well
   moves the run on; one that failed fails the run; one that was lost
   (no process, no exit code: the machine restarted) starts again, up to
   ``limits.max_attempts`` (training resumes from its checkpoint). A run
   past its wall budget, or cancelled, is stopped: SIGTERM, then SIGKILL
   after the step's grace.
2. **Start** what fits, in order: the next steps of active runs, then
   new runs from the queue (priority, then file name) whose ``after``
   runs and parent finished well and whose ``requires`` exist.
   - **One GPU job at a time**, and none while a training process the
     loop did not start is running (an interactive run has the GPU).
   - **Threads**: a host's steps hold at most its ``threads``; a step
     bigger than that starts only on an idle host. A GPU step waiting
     for threads reserves its host: nothing new starts there before it.
   - **Remote hosts**: nothing starts while unreachable or above
     ``max_load`` (the live bot worker comes first).
3. **Record**: finished runs get ``run.json``, ``summary.md``, their
   comparison with the parent and, if they beat it, a confirmation in
   the queue; the leaderboard is rewritten; on the loop's branch, the
   records are committed (never pushed).

A researcher call is a critical section. While one is under way
(``Layout.researcher_call`` exists) the runner keeps watching and
finishing runs, but it takes nothing from the queue (no new runs, no
replicate splits), starts no step that needs a clean checkout (the
researcher's edits are uncommitted), and neither writes nor commits
anything under ``research/loop``: confirmations wait in
``Layout.held`` and the leaderboard waits, until the call has been
checked (``Researcher.settle``) and the next tick catches up.

Only one runner works at a time (``RunnerLock``). Steps run in their own
process groups and outlive the runner, which adopts them on restart.
"""

import fcntl
import os
import subprocess
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import TextIO

from cardgame_ml.loop import tomlw
from cardgame_ml.loop.executors import LOST, RUNNING, UNKNOWN, HostExecutor
from cardgame_ml.loop.gitops import RECORD_PATHS, Git, GitError
from cardgame_ml.loop.layout import Layout
from cardgame_ml.loop.methods import METHODS, Context
from cardgame_ml.loop.policy import Host, Policy
from cardgame_ml.loop.promotion import assess, confirmation, write_spec
from cardgame_ml.loop.queue import Queued, read_queue, reject, waiting_for
from cardgame_ml.loop.records import (
    Records,
    RunRecord,
    StepRecord,
    environment,
    now_utc,
    parse_stamp,
    stamp,
)
from cardgame_ml.loop.safety import UnsafePathError, inside, name
from cardgame_ml.loop.spec import Spec, load_spec
from cardgame_ml.loop.steps import Step
from cardgame_ml.loop.summary import write_summary
from cardgame_ml.loop.validate import Known, check

LOOP = "research/loop"
"""The researcher's and the queue's part of the records."""

TRAINING = "cardgame_ml.train"
"""Training processes (belief, DMC and their scoring) hold the GPU."""


@dataclass(frozen=True)
class Want:
    """A step that would start now: the next of an active run, or the
    first of a queued spec."""

    step: Step
    run: RunRecord | None = None
    queued: Queued | None = None
    folder: str = ""


@dataclass
class Usage:
    threads: dict[str, int] = field(default_factory=dict[str, int])
    gpu: bool = False

    @classmethod
    def of(cls, runs: list[RunRecord]) -> "Usage":
        usage = cls()
        for run in runs:
            for record in run.steps:
                if record.status == "running":
                    host = record.step.host
                    usage.threads[host] = usage.threads.get(host, 0) + record.step.threads
                    usage.gpu |= record.step.gpu
        return usage


def admit(
    wants: list[Want],
    usage: Usage,
    hosts: Mapping[str, Host],
    loads: Mapping[str, float | None],
    gpu_elsewhere: bool,
) -> list[Want]:
    """The wants that start now, in order (see the module's rules)."""
    admitted: list[Want] = []
    reserved: set[str] = set()
    for want in wants:
        step = want.step
        host = hosts.get(step.host)
        load = loads.get(step.host)
        if host is None or load is None or load > host.max_load or step.host in reserved:
            continue
        if step.gpu and (usage.gpu or gpu_elsewhere or not host.gpu):
            continue
        used = usage.threads.get(step.host, 0)
        if used and used + step.threads > host.threads:
            if step.gpu:
                reserved.add(step.host)
            continue
        admitted.append(want)
        usage.threads[step.host] = used + step.threads
        usage.gpu |= step.gpu
    return admitted


def other_training(own_groups: set[int]) -> list[str]:
    """Training processes this runner did not start (by process group)."""
    done = subprocess.run(
        ["ps", "-axo", "pid=,pgid=,command="], capture_output=True, text=True, check=False
    )
    found: list[str] = []
    for line in done.stdout.splitlines():
        parts = line.split(None, 2)
        if len(parts) < 3 or TRAINING not in parts[2] or "python" not in parts[2]:  # noqa: PLR2004
            continue
        if int(parts[1]) not in own_groups:
            found.append(f"{parts[0]} {parts[2][:120]}")
    return found


class RunnerLock:
    """An exclusive lock on ``runner.lock``: a second runner refuses to
    start rather than fight the first."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._file: TextIO | None = None

    def __enter__(self) -> "RunnerLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        f = self.path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            f.seek(0)
            holder = f.read().strip()
            f.close()
            raise SystemExit(f"another runner holds {self.path} ({holder or 'unknown'})") from None
        f.seek(0)
        f.truncate()
        f.write(f"pid {os.getpid()} since {stamp(now_utc())}\n")
        f.flush()
        self._file = f
        return self

    def __exit__(self, *_: object) -> None:
        if self._file is not None:
            fcntl.flock(self._file, fcntl.LOCK_UN)
            self._file.close()
            self._file = None


def holder(path: Path) -> str | None:
    """Who holds the runner's lock, if anyone."""
    if not path.exists():
        return None
    with path.open("a+", encoding="utf-8") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            f.seek(0)
            return f.read().strip() or "a runner"
        fcntl.flock(f, fcntl.LOCK_UN)
    return None


type Hook = Callable[["Runner", datetime], bool]
"""Called at the end of a tick (daily report, researcher); True when it
wrote something to commit."""


class Runner:
    def __init__(  # noqa: PLR0913
        self,
        layout: Layout,
        policy: Policy,
        executors: Mapping[str, HostExecutor],
        *,
        git: Git | None,
        clock: Callable[[], datetime] = now_utc,
        gpu_elsewhere: Callable[[set[int]], list[str]] = other_training,
        hooks: tuple[Hook, ...] = (),
        say: Callable[[str], None] = print,
    ) -> None:
        self.layout, self.policy, self.executors = layout, policy, executors
        self.git, self.clock, self.gpu_elsewhere = git, clock, gpu_elsewhere
        self.hooks, self.say = hooks, say
        self.records = Records(layout.experiments, layout.live)
        self.finished: list[RunRecord] = []
        """Runs finished during the last tick."""
        self._board_stale = False
        """Runs finished during a researcher call: the leaderboard waits."""

    def calling(self) -> bool:
        """Whether a researcher call is under way (see the module's doc)."""
        return self.layout.researcher_call.exists()

    # -- one tick ------------------------------------------------------

    def tick(self) -> None:
        now = self.clock()
        self.finished = []
        calling = self.calling()
        released = [] if calling else self._release_held()
        for run in self.records.active():
            self._advance(run, now)
        self._board_stale |= bool(self.finished)
        if self._board_stale and not calling:
            from cardgame_ml.loop.leaderboard import write_leaderboard  # noqa: PLC0415

            write_leaderboard(self.layout, self.policy)
            self._board_stale = False
        if self.finished or released:
            done = [f"{r.id} finished" for r in self.finished] + [f"queued {f}" for f in released]
            self._commit(f"loop: {', '.join(done)}")
        if not self.layout.pause.exists():
            if not calling:
                self._split_replicates()
            started = self._start(now, intake=not calling)
            if started:
                self._commit(f"loop: started {', '.join(started)}")
        for hook in self.hooks:
            if hook(self, now):
                self._commit("loop: reports and research")

    def _commit(self, message: str) -> None:
        if self.git is None:
            return
        # During a researcher call its files are uncommitted on purpose: the
        # call's check diffs them against HEAD.
        paths = tuple(p for p in RECORD_PATHS if p != LOOP) if self.calling() else RECORD_PATHS
        try:
            self.git.commit(message, self.policy.loop_branch, paths)
        except GitError as e:
            self.say(f"not committed: {e}")

    def _release_held(self) -> list[str]:
        """Moves confirmations held during a researcher call to the queue."""
        if not self.layout.held.is_dir():
            return []
        released: list[str] = []
        for path in sorted(self.layout.held.glob("*.toml")):
            self.layout.queue.mkdir(parents=True, exist_ok=True)
            path.replace(self.layout.queue / path.name)
            released.append(path.name)
        return released

    # -- watching ------------------------------------------------------

    def _advance(self, run: RunRecord, now: datetime) -> None:  # noqa: PLR0912
        current = run.current()
        if current is None:
            self._finish(run, "succeeded", now)
            return
        cancel = (self.layout.cancel / run.id).exists()
        over = now >= parse_stamp(run.deadline)
        ending = "cancelled" if cancel else "timeout"
        if current.status == "pending":
            if cancel or over:
                self._finish(run, ending, now, f"{ending} before {current.step.name}")
            return
        executor = self.executors.get(current.step.host)
        if executor is None:
            self._finish(run, "failed", now, f"no executor for host {current.step.host}")
            return
        result = executor.poll(current)
        if result in (RUNNING, UNKNOWN):
            if cancel or over:
                self._stop(run, current, executor, now)
            return
        log = self._log(run, current)
        executor.collect(run, current, log)
        current.ended = stamp(now)
        if isinstance(result, int):
            current.exit_code = result
        if current.stopping is not None:
            current.status = "killed"
            self._finish(run, ending, now, f"{current.step.name} stopped: {ending}")
        elif result == 0:
            current.status = "done"
            if run.current() is None:
                self._finish(run, "succeeded", now)
            else:
                self.records.save(run)
        elif result == LOST:
            if current.attempts < self.policy.limits.max_attempts:
                self.say(f"{run.id}: {current.step.name} was lost; starting it again")
                current.status, current.pid, current.ended = "pending", None, None
                self.records.save(run)
            else:
                current.status = "failed"
                self._finish(
                    run, "interrupted", now, f"{current.step.name} lost {current.attempts} times"
                )
        else:
            current.status = "failed"
            self._finish(run, "failed", now, f"{current.step.name} exited {result}: {_tail(log)}")

    def _stop(
        self, run: RunRecord, record: StepRecord, executor: HostExecutor, now: datetime
    ) -> None:
        if record.stopping is None:
            self.say(f"{run.id}: stopping {record.step.name}")
            executor.stop(record, force=False)
            record.stopping = stamp(now)
            self.records.save(run)
        elif now - parse_stamp(record.stopping) > timedelta(seconds=record.step.grace_seconds):
            executor.stop(record, force=True)

    def _finish(
        self, run: RunRecord, status: str, now: datetime, failure: str | None = None
    ) -> None:
        run.status, run.ended, run.failure = status, stamp(now), failure
        for record in run.steps:
            if record.status == "running":
                record.status = "killed"
        folder = self.records.folder(run)
        spec = load_spec(folder / "spec.toml")
        runs = self.records.by_id()
        if status == "succeeded":
            comparison = assess(run, folder, self.policy, runs, self.layout.experiments)
            run.comparison = comparison.to_json() if comparison else None
            beats = comparison is not None and comparison.beats
            # Only the scoreboard has fresh-deal twins to confirm on.
            scoreboard = spec.evals.suite == self.policy.protocol.suite
            if run.confirms is None and beats and scoreboard:
                confirm = confirmation(spec, self.policy)
                write_spec(confirm, self.layout.held if self.calling() else self.layout.queue)
                run.candidate, run.confirmation = True, confirm.id
            original = runs.get(run.confirms) if run.confirms else None
            if original is not None:
                original.confirmed, original.confirmation = beats, run.id
                self.records.save(original)
                write_summary(
                    original,
                    load_spec(self.records.folder(original) / "spec.toml"),
                    self.records.folder(original),
                )
        self.records.save(run)
        write_summary(run, spec, folder)
        self.finished.append(run)
        self.say(f"{run.id}: {status}" + (f" ({failure})" if failure else ""))

    # -- starting ------------------------------------------------------

    def _split_replicates(self) -> None:
        """A queued spec with several seeds becomes one spec per seed."""
        for item in read_queue(self.layout.queue):
            if item.spec is not None and len(item.spec.seeds) > 1:
                for replicate in item.spec.replicates():
                    write_spec(replicate, self.layout.queue)
                item.path.unlink()

    def _start(self, now: datetime, intake: bool = True) -> list[str]:
        """Starts what fits. Without ``intake`` (a researcher call is under
        way) nothing comes from the queue and steps that need a clean
        checkout wait."""
        active = self.records.active()
        runs = self.records.by_id()
        wants = [
            Want(current.step, run=run)
            for run in active
            if (current := run.current()) is not None
            and current.status == "pending"
            and (intake or not current.step.clean)
        ]
        if intake:
            wants += self._new_wants(runs, now)
        if not wants:
            return []
        loads = {name: self._load(name) for name in {w.step.host for w in wants}}
        own = {
            r.pid
            for run in active
            for r in run.steps
            if r.status == "running" and r.pid is not None and r.step.host == "mac"
        }
        elsewhere = bool(self.gpu_elsewhere(own)) if any(w.step.gpu for w in wants) else False
        started: list[str] = []
        for want in admit(wants, Usage.of(active), self.policy.hosts, loads, elsewhere):
            run = want.run or self._open(want, now)
            if run is None:
                continue
            current = run.current()
            if current is not None and self._launch(run, current, now):
                started.append(f"{run.id}:{current.step.name}")
        return started

    def _load(self, host: str) -> float | None:
        executor = self.executors.get(host)
        return executor.load() if executor else None

    def _new_wants(self, runs: Mapping[str, RunRecord], now: datetime) -> list[Want]:
        queue = read_queue(self.layout.queue)
        ids = [q.spec.id for q in queue if q.spec]
        wants: list[Want] = []
        for item in queue:
            if item.spec is None:
                reject(item.path, self.layout.rejected, [item.error or "unreadable"])
                continue
            spec = item.spec
            if waiting_for(spec, runs, self.layout.artifacts) is not None:
                continue
            others = [i for i in ids if i != spec.id]
            problems = check(
                spec, self.policy, self.layout.repo, Known(runs, others), researcher=False
            )
            if problems:
                reject(item.path, self.layout.rejected, problems)
                self.say(f"rejected {item.path.name}: {problems[0]}")
                continue
            folder = self.records.new_folder(spec.id, now)
            plan = METHODS[spec.method].plan(self._context(spec, folder, runs))
            if plan.steps:
                wants.append(Want(plan.steps[0], queued=item, folder=folder))
        return wants

    def _context(self, spec: Spec, folder: str, runs: Mapping[str, RunRecord]) -> Context:
        parent_bot = spec.parent_bot()
        parent = spec.parent_run()
        if parent is not None and parent in runs:
            parent_bot = runs[parent].bot
        return Context(spec, self.policy, self.layout.repo, folder, parent_bot)

    def _open(self, want: Want, now: datetime) -> RunRecord | None:
        """A new run's folder and record, its spec taken off the queue."""
        assert want.queued is not None
        spec = want.queued.spec
        assert spec is not None
        plan = METHODS[spec.method].plan(self._context(spec, want.folder, self.records.by_id()))
        folder = inside(self.layout.experiments, name(want.folder, "run folder"))
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "spec.toml").write_text(tomlw.dumps(spec.to_toml()), encoding="utf-8")
        if plan.config is not None:
            header = f"# Effective config of loop run {spec.id}: written by the runner.\n\n"
            (folder / "config.toml").write_text(header + tomlw.dumps(plan.config), encoding="utf-8")
        commit = self.git.head() if self.git else "unknown"
        run = RunRecord(
            id=spec.id,
            folder=want.folder,
            method=spec.method,
            tags=list(spec.tags),
            parent=spec.parent,
            confirms=spec.confirms,
            priority=spec.priority,
            commit=commit,
            dirty=self.git.dirty() if self.git else False,
            created=stamp(now),
            deadline=stamp(now + timedelta(hours=spec.budget.wall_hours)),
            wall_hours=spec.budget.wall_hours,
            gpu=spec.budget.gpu,
            steps=[StepRecord(step) for step in plan.steps],
            bot=plan.bot,
            model=plan.model,
            params={**spec.config.overrides, **spec.options},
            environment=environment(),
        )
        want.queued.path.unlink()
        self.records.save(run)
        self.say(f"{spec.id}: started in {want.folder}")
        return run

    def _launch(self, run: RunRecord, record: StepRecord, now: datetime) -> bool:
        if record.step.clean:
            self._commit(f"loop: records before {run.id} {record.step.name}")
        executor = self.executors[record.step.host]
        record.attempts += 1
        record.started = record.started or stamp(now)
        record.stopping = record.exit_code = record.ended = None
        try:
            executor.start(run, record, self._log(run, record))
        except UnsafePathError as e:
            self.say(f"{run.id}: refused to start {record.step.name}: {e}")
            record.status = "failed"
            self._finish(run, "failed", now, f"{record.step.name}: {e}")
            return False
        except (ConnectionError, OSError, subprocess.SubprocessError) as e:
            self.say(f"{run.id}: could not start {record.step.name}: {e}")
            record.attempts -= 1
            if record.attempts == 0:
                record.started = None
            self.records.save(run)
            return False
        record.status = "running"
        self.records.save(run)
        return True

    def _log(self, run: RunRecord, record: StepRecord) -> Path:
        return self.layout.run_logs(run.folder) / f"{record.step.name}.log"

    # -- serving -------------------------------------------------------

    def serve(self, interval: float = 30.0, once: bool = False) -> None:
        with RunnerLock(self.layout.lock):
            self.say(f"runner up: {len(self.records.active())} active runs to watch")
            while True:
                try:
                    self.tick()
                except Exception as e:
                    # A bad tick (a disk hiccup, a malformed file) must not
                    # take the runner down; the next one tries again.
                    self.say(f"tick failed: {type(e).__name__}: {e}")
                if once:
                    return
                time.sleep(interval)


def _tail(log: Path, lines: int = 8) -> str:
    try:
        text = log.read_text(encoding="utf-8", errors="replace").splitlines()
    except FileNotFoundError:
        return "(no log)"
    return " / ".join(line.strip() for line in text[-lines:] if line.strip())[-600:]
