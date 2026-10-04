# Docs

| Document | What it is |
| --- | --- |
| [PLAN.md](PLAN.md) | The plan: goals, principles, target layout and phases; the source of truth for direction |
| [DESIGN.md](DESIGN.md) | The web table's design brief: tokens, components, card art, motion and sound |
| [Mighty rules](../crates/mighty/RULES.md) | The rules as the engine implements them, preset by preset |
| [Research](../research/README.md) | Conventions for evals, experiments and artifacts, and the log of results |

## How-tos

### Measure a bot

```sh
cargo build --release -p eval
nice -n 10 target/release/eval run --suite v1 --bot <bot> --baseline hard --out <dir>
```

plays eval suite v1 (ladder, presets, held-out rule sets, think time,
puzzles) and writes `results.json` and `report.md`; `--quick` is a
smoke test of a few minutes. Suites, the results schema and running the
think-time part on the home server are in
[research/evals](../research/evals/README.md).

### Run the Python checks

`ml/` is a [uv](https://docs.astral.sh/uv/) project. CI runs the same:

```sh
cd ml
uv sync --locked            # without PyTorch: lint, types and tests need none
uv run ruff check && uv run ruff format --check
uv run pyright              # strict
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

### Record an artifact kept outside git

Write a manifest into `research/manifests/` (fields in its
[README](../research/manifests/README.md)); the `ml/` tests validate every
manifest there. `cardgame_ml.manifest.Manifest.verify(root)` checks a copy
of the files against it.
