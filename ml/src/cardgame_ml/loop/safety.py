"""Names and paths the loop builds from what it reads, and the
environment its children get.

Queue files, run records and the policy are text a person, the runner or
the researcher wrote; the loop turns parts of them into folders here and
on the home server, ``rsync`` and ``ssh`` arguments, and ``rm -rf``
targets. So every such part is checked before it is used:

- a **name** (a run's folder, a step, a queue file) is one path segment:
  lowercase letters, digits, ``-``, ``_`` and ``.``, starting with a letter
  or digit (so never ``-option``, ``.`` or ``..``), at most 128 long, and
  never containing ``..``;
- an **artifact path** (``{artifacts}/models/x``) is relative: segments of
  letters, digits, ``-``, ``_`` and ``.``, none starting with ``.`` or
  ``-``, no ``..``;
- every path built from them is resolved and must stay inside its fixed
  root (``inside``, ``remote_inside``);
- an ``ssh`` destination, a remote root and a commit have shapes of their
  own.

A check that fails raises ``UnsafePathError``; nothing is touched.
"""

import os
import posixpath
import re
from collections.abc import Mapping
from pathlib import Path

NAME = re.compile(r"[a-z0-9][a-z0-9_.-]{0,127}")
SEGMENT = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}")
COMMIT = re.compile(r"[0-9a-f]{7,64}")
SSH_DESTINATION = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.@-]{0,254}")
MAX_DEPTH = 16


class UnsafePathError(ValueError):
    """A name or path that could reach outside the loop's folders."""


def name(text: object, what: str) -> str:
    """``text`` as one safe path segment, or ``UnsafePathError``."""
    if not isinstance(text, str) or not NAME.fullmatch(text) or ".." in text:
        raise UnsafePathError(f"{what}: {text!r} is not a safe name (a-z, 0-9, - _ .)")
    return text


def relative(text: object, what: str, *, min_parts: int = 1) -> str:
    """``text`` as a safe relative path of ``min_parts`` segments or more."""
    if not isinstance(text, str) or ".." in text:
        raise UnsafePathError(f"{what}: {text!r} is not a safe relative path")
    parts = text.split("/")
    if not min_parts <= len(parts) <= MAX_DEPTH or not all(SEGMENT.fullmatch(p) for p in parts):
        raise UnsafePathError(f"{what}: {text!r} is not a safe relative path")
    return text


def commit(text: object) -> str:
    if not isinstance(text, str) or not COMMIT.fullmatch(text):
        raise UnsafePathError(f"commit: {text!r} is not a commit hash")
    return text


def ssh_destination(text: object) -> str:
    if not isinstance(text, str) or not SSH_DESTINATION.fullmatch(text):
        raise UnsafePathError(f"ssh: {text!r} is not a host name or alias")
    return text


def absolute(text: object, what: str) -> str:
    """A remote absolute folder (the home directory, say) of safe segments."""
    if not isinstance(text, str) or not text.startswith("/") or text == "/":
        raise UnsafePathError(f"{what}: {text!r} is not an absolute folder")
    relative(text[1:], what)
    return text


def inside(root: Path, *parts: str) -> Path:
    """``root/parts…``, after checking that it resolves inside ``root``
    (symbolic links included) and is not ``root`` itself."""
    if not parts:
        raise UnsafePathError(f"a path inside {root} needs a name")
    path = root.joinpath(*parts)
    base = root.resolve()
    real = path.resolve()
    if real == base or not real.is_relative_to(base):
        raise UnsafePathError(f"{path} is outside {root}")
    return path


def remote_inside(root: str, *parts: str) -> str:
    """The same on a remote host, by the path's text: ``root`` is absolute
    and checked, and the result must stay under it."""
    absolute(root, "remote root")
    if not parts:
        raise UnsafePathError(f"a path inside {root} needs a name")
    path = posixpath.normpath(posixpath.join(root, *parts))
    if not path.startswith(root.rstrip("/") + "/") or any(p.startswith("/") for p in parts):
        raise UnsafePathError(f"{path} is outside {root}")
    absolute(path, "remote path")
    return path


SECRET_WORDS = ("TOKEN", "SECRET", "PASSWORD", "PASSWD", "API_KEY", "PRIVATE", "CREDENTIAL")
SECRET_PREFIXES = ("AWS_", "ANTHROPIC_", "CLAUDE_", "GH_", "GITHUB_", "OPENAI_", "SSH_")


def step_environment(env: Mapping[str, str]) -> dict[str, str]:
    """The runner's environment for a step, without anything that looks
    like a secret (``BOT_TOKEN``, ``STATS_TOKEN``, API keys, the ``ssh``
    agent): steps run code from queued specs and need none of it."""
    return {
        k: v
        for k, v in env.items()
        if not any(w in k.upper() for w in SECRET_WORDS)
        and not k.upper().startswith(SECRET_PREFIXES)
    }


RESEARCHER_KEEP = ("HOME", "PATH", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR")
RESEARCHER_AUTH = ("ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN")


def researcher_environment(env: Mapping[str, str] | None = None) -> dict[str, str]:
    """Only what ``claude`` needs: home, path, locale and its own login."""
    source = os.environ if env is None else env
    return {k: source[k] for k in (*RESEARCHER_KEEP, *RESEARCHER_AUTH) if k in source}
