"""The artifact store: where data and weights too large for git live.

``$CARDGAME_ARTIFACTS``, else ``~/card-game-artifacts``, as for the Rust
``selfplay`` generator. Manifests in ``research/manifests/`` name files by
their path inside it.
"""

import os
from pathlib import Path


def artifact_store() -> Path:
    root = os.environ.get("CARDGAME_ARTIFACTS")
    return Path(root) if root else Path.home() / "card-game-artifacts"
