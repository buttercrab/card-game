from pathlib import Path

import pytest


@pytest.fixture
def repo() -> Path:
    """The repository root: ml/ sits directly under it."""
    return Path(__file__).resolve().parents[2]
