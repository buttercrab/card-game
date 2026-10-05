"""Where a run comes from: the repository, its commit, and whether the
working tree matches it. Manifests record the commit, so runs that write
one refuse uncommitted changes unless told otherwise."""

import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Checkout:
    root: Path
    commit: str
    dirty: bool
    """Tracked files differ from the commit."""

    @classmethod
    def of(cls, path: Path) -> "Checkout":
        def git(*args: str) -> str:
            out = subprocess.run(
                ["git", "-C", str(path), *args], check=True, capture_output=True, text=True
            )
            return out.stdout.strip()

        root = Path(git("rev-parse", "--show-toplevel"))
        changes = git("status", "--porcelain", "--untracked-files=no")
        return cls(root, git("rev-parse", "HEAD"), bool(changes))

    def require_clean(self, allow_dirty: bool) -> None:
        if self.dirty and not allow_dirty:
            raise SystemExit("uncommitted changes: commit first, or pass --allow-dirty")

    def relative(self, path: Path) -> str:
        """``path`` relative to the repository root, as manifests name configs."""
        return path.resolve().relative_to(self.root.resolve()).as_posix()
