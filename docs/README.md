# Docs

| Document | What it is |
| --- | --- |
| [PLAN.md](PLAN.md) | The plan: goals, principles, target layout and phases; the source of truth for direction |
| [DESIGN.md](DESIGN.md) | The web table's design brief: tokens, components, card art, motion and sound |
| [Mighty rules](../crates/mighty/RULES.md) | The rules as the engine implements them, preset by preset |
| [Research](../research/README.md) | Conventions for evals, experiments and artifacts, and the log of results |

## How-tos

### Run the Python checks

`ml/` is a [uv](https://docs.astral.sh/uv/) project. It depends on the
environment's bindings, `crates/env-py`, which `uv sync` builds with
maturin, so it needs a Rust toolchain too; uv rebuilds them whenever the
Rust they are made of changes. CI runs the same:

```sh
cd ml
uv sync --locked            # without PyTorch: lint, types and tests need none
uv run ruff check . ../crates/env-py/python
uv run ruff format --check . ../crates/env-py/python
uv run pyright              # strict, the bindings' Python included
uv run pytest
```

Training needs PyTorch, an optional extra so CI stays light:
`uv sync --extra torch`. On the Mac it runs on MPS
(`torch.backends.mps.is_available()`).

### Change what a model sees

The encoding (`engine::Encode`, Mighty's in `crates/mighty/src/encode.rs`)
defines every model's input, so it changes only on purpose:

1. Change the encoder and bump its `VERSION` (`mighty-1` to `mighty-2`).
2. Rewrite the pinned spec:
   `cargo test -p mighty --test encode -- --ignored write_spec_snapshot`.
3. Commit both. Data and models record the version they were made with;
   ones made with another version do not mix.

`ml/` reads the same pinned spec (`crates/mighty/tests/encoding.json`), so
the Python tests see the change too.

### Run the environment from Python

```python
import numpy as np
from cardgame_env import Env

env = Env(num_envs=256, seed=0, rules="varied")    # the caller plays every seat
step = env.reset()                                  # arrays, batch first
rng = np.random.default_rng(0)
for _ in range(1000):
    scores = rng.random(step["legal"].shape)
    scores[~step["legal"]] = -1                      # a random legal action
    step = env.step(scores.argmax(axis=1))           # rewards when step["done"]
```

`controlled=[0], bots={"hard:50": 1, "보통": 2}` plays seat 0 against
bots; `exclude="research/evals/v1/heldout-rules.json"` keeps held-out
rule sets out. The module docstring of `cardgame_env` has the rest: rule
sources, bot names, the reward convention. In Rust it is `env::Env`;
`cargo run --release -p env --example throughput` measures it.

### Generate self-play data

A dataset is a config in an experiment folder (see
`research/experiments/2026-10-04-selfplay-v1/config.toml`). From a clean
checkout:

```sh
nice -n 10 cargo run --release -p env --bin selfplay -- \
    --config research/experiments/<folder>/config.toml
```

Shards go to `$CARDGAME_ARTIFACTS/selfplay/<name>/` (by default
`~/card-game-artifacts`) and the manifest to `research/manifests/`; commit
the manifest. The same config and commit give the same bytes.
`cardgame_ml.data.shards.Dataset.open(path).batches(...)` reads it.

### Record an artifact kept outside git

Write a manifest into `research/manifests/` (fields in its
[README](../research/manifests/README.md)); the `ml/` tests validate every
manifest there. `cardgame_ml.manifest.Manifest.verify(root)` checks a copy
of the files against it.
