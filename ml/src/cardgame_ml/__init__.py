"""Training for the card-game bots: a library with thin command-line entry points.

Subpackages, by stage of the work (docs/PLAN.md):

- ``data``: encoding specs, self-play shards and batches.
- ``models``: belief, policy and value networks.
- ``train``: training loops and their configs.
- ``export``: ONNX export and parity checks against the Rust side.
- ``scaling``: sweeps and curve fitting.

``manifest`` describes artifacts kept outside git (shards, weights) by
path, size and SHA-256, with the commit and config that produced them;
``store`` says where they live, ``runs`` where a trained model goes, and
``provenance`` which commit made it.
"""
