"""The package's stages import without the optional training dependencies."""

import importlib

import pytest


@pytest.mark.parametrize("stage", ["data", "models", "train", "export", "scaling"])
def test_stage_imports(stage: str) -> None:
    module = importlib.import_module(f"cardgame_ml.{stage}")
    assert module.__doc__, f"cardgame_ml.{stage} says what goes there"
