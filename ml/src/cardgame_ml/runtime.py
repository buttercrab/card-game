"""Small pieces every command shares: the device to train on, files
written whole, a JSON-lines log and whether a process is alive.

Nothing here imports PyTorch at module level (the loop runs without it).
"""

import contextlib
import json
import os
import sys
from collections.abc import Callable, Generator
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import torch

type Log = Callable[[dict[str, Any]], None]
"""Where a run's events go, one JSON object each."""


def device_for(name: str) -> "torch.device":
    """``auto`` (MPS when there is one, else CPU), or a device by name."""
    import torch  # noqa: PLC0415

    if name == "auto":
        return torch.device("mps" if torch.backends.mps.is_available() else "cpu")
    return torch.device(name)


def write_text(path: Path, text: str) -> None:
    """Writes ``text`` to ``path`` whole or not at all: a crash leaves the
    old file (the new one is written beside it, then renamed over it)."""
    tmp = path.with_name(f"{path.name}.tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def write_json(path: Path, value: object, *, indent: int = 2, sort_keys: bool = False) -> None:
    """``value`` as JSON (UTF-8, not escaped), written whole."""
    text = json.dumps(value, indent=indent, sort_keys=sort_keys, ensure_ascii=False)
    write_text(path, text + "\n")


@contextlib.contextmanager
def jsonl_log(path: Path, echo: bool = True) -> Generator[Log]:
    """A log appending one JSON line per entry to ``path`` (flushed at
    once), and echoing it to stderr."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:

        def log(entry: dict[str, Any]) -> None:
            line = json.dumps(entry, ensure_ascii=False)
            f.write(line + "\n")
            f.flush()
            if echo:
                print(line, file=sys.stderr)

        yield log


def alive(pid: int) -> bool:
    """Whether process ``pid`` is running: a child of ours that exited is
    reaped (not a zombie counted alive); another's is asked by signal 0."""
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
