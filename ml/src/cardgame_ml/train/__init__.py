"""Training loops and their configs.

A run is a typed config plus a commit plus explicit seeds, so it reproduces
from the repository; results go to ``research/experiments``. ``config``
reads configs, ``belief`` trains a belief model (``python -m
cardgame_ml.train --config <config.toml>``), ``batching`` cuts the
batches and ``metrics`` scores beliefs by phase of the hand.
"""
