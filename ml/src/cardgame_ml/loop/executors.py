"""Starting, watching and stopping steps, here or on the home server.

Every step runs in its own process group (``setsid``), at low priority
(the host's ``nice``), through a small shell wrapper that writes the
command's exit code to a file when it ends. So a runner that restarts
finds its steps again: a live process group is adopted, an exit file
read, and a step with neither was lost (the machine restarted, or it was
killed) and is started again or given up.

The home server also runs the live bot worker, so the loop sends it only
CPU steps (``eval``, which needs nothing but cargo there), from a
``git archive`` of the run's exact commit unpacked under
``~/<root>/code/<commit>`` and built there, at ``nice`` 15 with capped
threads; nothing starts while its load is high, and the loop touches
nothing outside ``~/<root>`` (never Docker, systemd or the worker).
"""

import contextlib
import os
import shlex
import signal
import subprocess
import sys
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from cardgame_ml.loop.policy import Host
from cardgame_ml.loop.records import RunRecord, StepRecord

RUNNING = "running"
LOST = "lost"
UNKNOWN = "unknown"
"""The host could not be asked (unreachable): try again later."""

type Poll = int | str
"""An exit code, or ``RUNNING``, ``LOST`` or ``UNKNOWN``."""

_WRAPPER = '"$@"; code=$?; echo $code > "$0.tmp" && mv "$0.tmp" "$0"; exit $code'
"""``sh -c`` script: run the arguments, then record the exit code
atomically in the file named by ``$0``."""


class HostExecutor(Protocol):
    host: Host

    def load(self) -> float | None:
        """The one-minute load average; ``None`` when unreachable."""
        ...

    def start(self, run: RunRecord, record: StepRecord, log: Path) -> None:
        """Starts the step and fills in ``record.pid`` (and ``workdir``)."""
        ...

    def poll(self, record: StepRecord) -> Poll: ...

    def stop(self, record: StepRecord, force: bool) -> None: ...

    def collect(self, run: RunRecord, record: StepRecord, log: Path) -> None:
        """Brings a finished step's output and log here."""
        ...


@dataclass(frozen=True)
class Places:
    """This machine's paths for the placeholders."""

    repo: Path
    artifacts: Path
    experiments: Path


class LocalExecutor:
    """Steps on this machine (the Mac)."""

    def __init__(self, host: Host, places: Places, label: str = "the Mac") -> None:
        self.host, self.places, self.label = host, places, label
        self._children: dict[int, subprocess.Popen[bytes]] = {}

    def load(self) -> float | None:
        return os.getloadavg()[0]

    def start(self, run: RunRecord, record: StepRecord, log: Path) -> None:
        step = record.step
        folder = self.places.experiments / run.folder
        out = folder / "results" / step.name
        out.mkdir(parents=True, exist_ok=True)
        log.parent.mkdir(parents=True, exist_ok=True)
        exit_file = _exit_file(log)
        exit_file.unlink(missing_ok=True)
        argv = step.expand(
            {
                "python": sys.executable,
                "repo": str(self.places.repo),
                "run": str(folder),
                "out": str(out),
                "artifacts": str(self.places.artifacts),
                "eval": str(self.places.repo / "target" / "release" / "eval"),
                "commit": run.commit,
                "machine": self.label,
            }
        )
        cwd = self.places.repo / ("ml" if step.cwd == "ml" else "")
        env = {**os.environ, "PYTHONUNBUFFERED": "1"}
        with log.open("ab") as sink:
            child = subprocess.Popen(
                ["nice", "-n", str(self.host.nice), "sh", "-c", _WRAPPER, str(exit_file), *argv],
                cwd=cwd,
                stdin=subprocess.DEVNULL,
                stdout=sink,
                stderr=subprocess.STDOUT,
                start_new_session=True,
                env=env,
            )
        self._children[child.pid] = child
        record.pid = child.pid
        record.log = str(log)

    def poll(self, record: StepRecord) -> Poll:
        if record.pid is None or record.log is None:
            return LOST
        child = self._children.get(record.pid)
        ended = child.poll() is not None if child else not _alive(record.pid)
        code = _read_exit(_exit_file(Path(record.log)))
        if code is not None:
            if child is not None and ended:
                del self._children[record.pid]
            return code
        if not ended:
            return RUNNING
        self._children.pop(record.pid, None)
        return LOST

    def stop(self, record: StepRecord, force: bool) -> None:
        if record.pid is not None:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(record.pid, signal.SIGKILL if force else signal.SIGTERM)

    def collect(self, run: RunRecord, record: StepRecord, log: Path) -> None:
        """Nothing to bring: the step wrote here."""


type Shell = Callable[[list[str], str | None, float], subprocess.CompletedProcess[str] | None]
"""Runs a local command (with stdin text, a timeout); ``None`` when it
could not finish (a timeout)."""


def run_shell(
    argv: list[str], stdin: str | None, timeout: float
) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            argv, input=stdin, capture_output=True, text=True, timeout=timeout, check=False
        )
    except subprocess.TimeoutExpired:
        return None


class RemoteExecutor:
    """Steps on a host reached by ``ssh`` (the home server)."""

    def __init__(  # noqa: PLR0913
        self,
        host: Host,
        *,
        repo: Path,
        artifacts: Path,
        experiments: Path,
        shell: Shell = run_shell,
        label: str = "the home server",
    ) -> None:
        if host.ssh is None or not host.root:
            raise ValueError(f"host {host.name}: a remote host needs ssh and root")
        self.host, self.repo, self.artifacts, self.experiments = host, repo, artifacts, experiments
        self.shell, self.label = shell, label
        self._home: str | None = None

    # ``ssh <host> bash -s``: the login shell may be anything (fish at
    # home), so every remote script is bash read from stdin.
    def _bash(self, script: str, timeout: float = 30.0) -> str | None:
        assert self.host.ssh is not None
        argv = [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            self.host.ssh,
            "bash",
            "-s",
        ]
        done = self.shell(argv, "set -eu\n" + script, timeout)
        if done is None or done.returncode != 0:
            return None
        return done.stdout

    def _root(self) -> str | None:
        if self._home is None:
            home = self._bash('echo "$HOME"')
            if home is None:
                return None
            self._home = home.strip()
        return f"{self._home}/{self.host.root}"

    def load(self) -> float | None:
        out = self._bash("cut -d' ' -f1 /proc/loadavg")
        try:
            return None if out is None else float(out.strip())
        except ValueError:
            return None

    def _code(self, commit: str) -> str:
        root = self._root()
        if root is None:
            raise ConnectionError(f"{self.host.name}: unreachable")
        code = f"{root}/code/{commit[:12]}"
        present = self._bash(f"test -f {shlex.quote(code)}/.extracted && echo yes || echo no")
        if present is None:
            raise ConnectionError(f"{self.host.name}: unreachable")
        if present.strip() != "yes":
            archive = subprocess.run(
                ["git", "-C", str(self.repo), "archive", "--format=tar", commit],
                capture_output=True,
                check=True,
            )
            unpack = f"mkdir -p {code} && tar -x -C {code} && touch {code}/.extracted"
            assert self.host.ssh is not None
            subprocess.run(
                ["ssh", "-o", "BatchMode=yes", self.host.ssh, "bash", "-c", shlex.quote(unpack)],
                input=archive.stdout,
                check=True,
                timeout=600,
            )
        return code

    def _upload(self, paths: list[str]) -> None:
        root = self._root()
        assert self.host.ssh is not None
        assert root is not None
        for path in paths:
            target = f"{root}/artifacts/{path}"
            self._bash(f"mkdir -p {shlex.quote(target)}")
            subprocess.run(
                [
                    "rsync",
                    "-a",
                    "--delete",
                    f"{self.artifacts / path}/",
                    f"{self.host.ssh}:{target}/",
                ],
                check=True,
                timeout=1800,
            )

    def start(self, run: RunRecord, record: StepRecord, log: Path) -> None:
        step = record.step
        code = self._code(run.commit)
        self._upload(step.uploads())
        root = self._root()
        assert root is not None
        work = f"{root}/runs/{run.folder}/{step.name}"
        argv = step.expand(
            {
                "repo": ".",
                "run": work,
                "out": f"{work}/out",
                "artifacts": f"{root}/artifacts",
                "eval": "target/release/eval",
                "commit": run.commit,
                "machine": self.label,
            }
        )
        build = (
            f"if [ ! -f .built ]; then cargo build --release --locked -j {step.threads} -p eval "
            "&& touch .built; fi"
        )
        inner = f"{build} && {shlex.join(argv)}"
        script = f"""
export PATH="$HOME/.cargo/bin:$PATH"
mkdir -p {shlex.quote(work)}/out
rm -f {shlex.quote(work)}/exit
cd {shlex.quote(code)}
nohup setsid nice -n {self.host.nice} sh -c {shlex.quote(_WRAPPER)} {shlex.quote(work + "/exit")} \\
    bash -c {shlex.quote(inner)} > {shlex.quote(work)}/log 2>&1 < /dev/null &
echo $!
"""
        out = self._bash(script)
        if out is None:
            raise ConnectionError(f"{self.host.name}: could not start {step.name}")
        record.pid = int(out.strip().splitlines()[-1])
        record.workdir = work
        record.log = str(log)

    def poll(self, record: StepRecord) -> Poll:
        if record.pid is None or record.workdir is None:
            return LOST
        work = shlex.quote(record.workdir)
        out = self._bash(
            f"if [ -f {work}/exit ]; then cat {work}/exit; "
            f"elif kill -0 {record.pid} 2>/dev/null; then echo {RUNNING}; else echo {LOST}; fi"
        )
        if out is None:
            return UNKNOWN
        text = out.strip()
        return int(text) if text.lstrip("-").isdigit() else text

    def stop(self, record: StepRecord, force: bool) -> None:
        if record.pid is not None:
            sig = "KILL" if force else "TERM"
            self._bash(f"kill -{sig} -- -{record.pid} 2>/dev/null || true")

    def collect(self, run: RunRecord, record: StepRecord, log: Path) -> None:
        if record.workdir is None:
            return
        assert self.host.ssh is not None
        out = self.experiments / run.folder / "results" / record.step.name
        out.mkdir(parents=True, exist_ok=True)
        log.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["rsync", "-a", f"{self.host.ssh}:{record.workdir}/out/", f"{out}/"],
            check=False,
            timeout=600,
        )
        subprocess.run(
            ["rsync", "-a", f"{self.host.ssh}:{record.workdir}/log", str(log)],
            check=False,
            timeout=600,
        )
        self._bash(f"rm -rf {shlex.quote(record.workdir)}")

    def prune(self, keep: set[str]) -> None:
        """Removes unpacked code of commits no run uses (``keep``: the
        commits of active runs), but the newest three."""
        root = self._root()
        if root is None:
            return
        kept = " ".join(shlex.quote(c[:12]) for c in sorted(keep))
        self._bash(
            f"cd {shlex.quote(root)}/code 2>/dev/null || exit 0\n"
            f"keep=({kept})\n"
            "ls -t | tail -n +4 | while read -r d; do\n"
            '  case " ${keep[*]:-} " in *" $d "*) ;; *) rm -rf -- "$d" ;; esac\n'
            "done\n"
        )


def _exit_file(log: Path) -> Path:
    return log.with_suffix(".exit")


def _read_exit(path: Path) -> int | None:
    try:
        return int(path.read_text().strip())
    except (FileNotFoundError, ValueError):
        return None


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def executors(
    hosts: Mapping[str, Host], places: Places, remote_shell: Shell = run_shell
) -> dict[str, HostExecutor]:
    out: dict[str, HostExecutor] = {}
    for name, host in hosts.items():
        if host.ssh is None:
            out[name] = LocalExecutor(host, places)
        else:
            out[name] = RemoteExecutor(
                host,
                repo=places.repo,
                artifacts=places.artifacts,
                experiments=places.experiments,
                shell=remote_shell,
            )
    return out
