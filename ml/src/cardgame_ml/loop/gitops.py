"""The runner's own use of git: committing its records on the loop's
branch (never pushing), and seeing what the researcher changed.

The runner works in a checkout of its own (a worktree on the policy's
``loop_branch``), so its commits never mix with interactive work; it
commits only paths under ``research/``, and refuses on any other branch.
"""

import subprocess
from dataclasses import dataclass
from pathlib import Path

RECORD_PATHS = ("research/experiments", "research/loop", "research/reports", "research/manifests")


class GitError(RuntimeError):
    pass


@dataclass(frozen=True)
class Git:
    repo: Path

    def _git(self, *args: str, check: bool = True) -> str:
        done = subprocess.run(
            ["git", "-C", str(self.repo), *args], capture_output=True, text=True, check=False
        )
        if check and done.returncode != 0:
            raise GitError(f"git {' '.join(args)}: {done.stderr.strip()}")
        return done.stdout

    def head(self) -> str:
        return self._git("rev-parse", "HEAD").strip()

    def branch(self) -> str:
        return self._git("rev-parse", "--abbrev-ref", "HEAD").strip()

    def dirty(self) -> bool:
        """Tracked files differ from HEAD (what training refuses)."""
        return bool(self._git("status", "--porcelain", "--untracked-files=no").strip())

    def changed(self) -> list[str]:
        """Every path that differs from HEAD, untracked ones included."""
        out = self._git("status", "--porcelain", "--untracked-files=all", "-z")
        paths: list[str] = []
        entries = out.split("\0")
        i = 0
        while i < len(entries):
            entry = entries[i]
            i += 1
            if len(entry) < 4:  # noqa: PLR2004
                continue
            status, path = entry[:2], entry[3:]
            if "R" in status or "C" in status:
                i += 1  # the rename's source follows
            paths.append(path)
        return paths

    def commit(self, message: str, branch: str, paths: tuple[str, ...] = RECORD_PATHS) -> bool:
        """Commits changes under ``paths`` on ``branch``; False when there
        was nothing to commit. Raises on any other branch."""
        current = self.branch()
        if current != branch:
            raise GitError(f"records are committed on {branch}, but the checkout is on {current}")
        present = [p for p in paths if (self.repo / p).exists()]
        if not present:
            return False
        self._git("add", "-A", "--", *present)
        staged = self._git("diff", "--cached", "--name-only", "--", *present).strip()
        if not staged:
            return False
        self._git("commit", "--quiet", "-m", message, "--", *present)
        return True

    def restore(self, paths: list[str]) -> None:
        """Puts tracked files back as HEAD has them."""
        if paths:
            self._git("checkout", "HEAD", "--", *paths)

    def tracked(self, path: str) -> bool:
        return bool(self._git("ls-files", "--", path).strip())
