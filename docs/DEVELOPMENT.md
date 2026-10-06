# Development

Run commands from the repository root unless a section says otherwise.
Research execution remains paused: the training/loop commands below describe
the tools, not permission to launch jobs. [PLAN.md](PLAN.md) owns that decision.

## Local play and frontend work

```sh
(cd web && npm ci && npm run build)
cargo run --release -p server
```

The server defaults to http://127.0.0.1:3030. `--data <dir>` persists rooms;
without it rooms are in memory. `--addr 0.0.0.0:3030` exposes it to your LAN.
For frontend iteration, run `npm run dev` in web/; Vite proxies /api to the
server. `/deck` shows cards; `/preview` shows table/overlay fixtures.

## Relevant checks

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
(cd web && npm run check && npm test && npm run build)
```

For UI/interaction changes, build the release server and web before e2e:

```sh
cargo build --release -p server
(cd web && npm run build && npm run test:e2e)
```

The browser suite starts two local servers itself. `SERVER_BIN` selects
another binary and `PORT` changes its ports. It checks four viewport sizes
in light/dark, with reduced motion by default; inspect full/off motion too
when animation changes. CI additionally checks generated files, MSRV, three
operating systems, Python parity, simulation and shell/deploy scripts.
Run checks matching the change; do not launch long research to validate docs.

## Generated protocol and catalog

```sh
cargo run -p server -- --write-generated web/src/lib/generated
git diff -- web/src/lib/generated
```

Review and commit generated changes with their Rust source. CI runs the same
generator and rejects drift. `--dump-catalog` prints site and per-game
catalogs; it does not write generated files.

## Simulator and phase diagnostics

```sh
cargo run --release -p sim -- --games 2000
cargo run --release -p sim -- --vary --bots random
cargo run --release -p sim -- --players 4
cargo run --release -p lab -- --help
```

The simulator checks legality, card conservation, zero-sum payoff, hidden
view invariance, termination and replay. Lab is now its own crate/binary;
there are no belief/dmc Cargo feature flags to enable on current main.
Historical experiment scripts may need their recorded revision.

## Measure a bot

```sh
cargo build --release -p eval
nice -n 10 target/release/eval run --suite v1 --bot <bot> --baseline hard --out <dir>
```

plays eval suite v1 (ladder, presets, held-out rule sets, think time,
puzzles) and writes `results.json` and `report.md`; `--quick` is a
smoke test of a few minutes. Suites, the results schema and running the
think-time part on the home server are in
[research/evals](../research/evals/README.md).

## Run the Python checks

`ml/` is a [uv](https://docs.astral.sh/uv/) project. It depends on the
environment's bindings, `crates/env-py`, which `uv sync` builds with
maturin, so it needs a Rust toolchain too; uv rebuilds them whenever the
Rust they are made of changes. CI runs the same:

```sh
cd ml
uv sync --locked --extra torch
uv run ruff check . ../crates/env-py/python
uv run ruff format --check . ../crates/env-py/python
uv run pyright              # strict, the bindings' Python included
uv run pytest
```

PyTorch (with `onnx` and `onnxscript` for export) is the optional
`torch` extra; on Linux it comes from PyTorch's CPU-only index, which
keeps CI light. Without it the model tests are skipped, but pyright
needs it. On the Mac training runs on MPS
(`torch.backends.mps.is_available()`).

## Change what a model sees

The encoding (`engine_ml::Encode`, Mighty's in `crates/mighty/src/encode.rs`)
defines every model's input, so it changes only on purpose:

1. Change the encoder, bump its `VERSION` (`mighty-4` to `mighty-5`) and
   append the new version to `SPECS` next to it, with the spec
   fingerprint the failing `the_spec_changes_only_with_its_version` test
   prints. That test fails while the spec and the last `SPECS` line
   disagree, so the spec cannot change without a new version.
2. Rewrite every fixture built on it with `scripts/regenerate-fixtures.sh`
   (Rust's `tests/encoding.json`, the pinned encodings in
   `crates/mighty/tests/pinned` and search decisions in
   `crates/mighty-ai/tests/pinned`, `crates/env/tests/parity.json`,
   and, with `uv`, `crates/infer/tests/tiny` and `tiny-q`), and review the
   diff. The pinned games' rules are frozen there, so changing a preset's
   house rules moves none of these, only `presets.json` and `payoffs.json`.
3. Commit them together. Data and models record the version they were
   made with: a dataset in its `meta.json` and manifest (`encoding`), a
   model in its `config.json` (`encoding`, and the whole spec under
   `spec`). Ones made with another version do not mix, and are not
   retrained or converted: `sim`'s `belief:` bots and the `beliefs`
   example refuse a model whose spec is not the engine's.

Versions: `mighty-1` (2026-10, P0); `mighty-2` (2026-10-05) adds how a
failed contract is scored (`rules.scoring.lose`); `mighty-3` (2026-10-05,
faster 딜미스) drops the misdeal round (`phase=misdeal_round` and the
`kind=no_misdeal` events), since a misdeal is now called from the deal,
out of turn, and 기본 has no round of answers; `mighty-4` (2026-10-06)
says when a misdeal may be called as one `rules.misdeal.window` one-hot
(until the seat's own bid, all through the bidding, or before the first
bid) instead of the `after_bidding` and `ask_first` flags. Belief v1 and
every dataset before 2026-10-05 are `mighty-1`; data and models from the
`mighty-2` days (such as a training run started then) need a commit
before the `mighty-3` change, and `dmc-v2` and the 2026-10-06 RL
assessment are `mighty-3`.

`ml/` reads the same pinned spec (`crates/mighty/tests/encoding.json`), so
the Python tests see the change too.

## Run the environment from Python

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

## Generate self-play data

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

A config with `eval_only = true` and `rules = "file:<rule sets>.json"`
makes data to measure with on a fixed list of rule sets (the evals'
held-out ones): its manifest's kind is `eval` and training refuses it.

## Train a belief model and play with it

A run is a config in an experiment folder (see
`research/experiments/2026-10-05-belief-v1/config.toml`). From a clean
checkout, in `ml/` with the torch extra:

```sh
nice -n 10 uv run python -m cardgame_ml.train --config ../research/experiments/<folder>/config.toml
uv run python -m cardgame_ml.train.score --run <name> --dataset selfplay/<data> --out <json>
uv run python -m cardgame_ml.export --run <name>
cargo run --release -p infer -- check ~/card-game-artifacts/models/<name>
```

Training writes `models/<name>/` in the artifact store (it resumes from
the last epoch if stopped) and the manifest; `score` compares the model
with the baseline that knows only how many hidden cards each place holds,
by phase of the hand; `export` adds `model.onnx` and `parity.json`, and
`infer check` runs them from Rust, compares the logits with PyTorch's and
times a call. The search then deals by the model as the bot
`belief:<model dir>:<samples>` in `eval`, `sim` and `lab`;
`SearchBot::sampler` is the setting, off (uniform) by default and at the
table.

The model's architecture is pinned by a tiny fixture both test suites
check (`crates/infer/tests/tiny`); rewrite it with
`uv run python -m cardgame_ml.export.fixture` when the architecture
changes.

## Queue an experiment in the loop

The experiment loop ([research/loop](../research/loop/README.md)) runs
specs from `research/loop/queue/` unattended and scores them the same
way. Write a spec (the README has an annotated example; the seeded queue
has more), then check it as the runner will:

```sh
cd ml
uv run python -m cardgame_ml.loop validate ../research/loop/queue/<id>.toml
uv run python -m cardgame_ml.loop status          # what runs, what waits and why
uv run python -m cardgame_ml.loop report          # leaderboard and plots
```

When explicitly installed, the runner uses its own worktree on branch
`loop` and a launchd agent: `research/loop/ops/install.sh` sets it up. Results land
in `research/experiments/<date>-<id>/`, the leaderboard in
`research/loop/leaderboard.md`, daily reports in `research/reports/`.
`pause`, `resume` and `cancel <id>` steer it.

## Train a self-play agent (DMC) and play it

A run is a config in an experiment folder (see
`research/experiments/2026-10-05-dmc-v1/config.toml`; `smoke.toml` there
checks the whole loop in two minutes). From a clean checkout, in `ml/`
with the torch extra:

```sh
nice -n 10 uv run python -m cardgame_ml.train.dmc --config ../research/experiments/<folder>/config.toml
uv run python -m cardgame_ml.train.dmc.report --run <name> --out <curve.json>
uv run python -m cardgame_ml.export --run <name>
cargo run --release -p infer -- check ~/card-game-artifacts/models/<name>
```

Training starts actor processes that play self-play hands with CPU
copies of the network (every seat, ε-greedy, rules from `rules` but
never the held-out sets in `exclude`) while the learner fits
`Q(observation, action)` to each seat's payoff on the GPU. It writes
`models/<name>/` in the artifact store: `log.jsonl` (throughput every
`log_seconds`, losses by phase of the hand, and the learning curve:
the network against 초보 and 보통 on fixed deals every
`curve.every_hands` hands, with a snapshot of the weights at each
point), `checkpoint.pt` (Ctrl-C checkpoints; the same command resumes),
then `model.pt` and the manifest. `report` turns the log into the
curve's table. `export` writes `model.onnx` and `parity.json`
(`--weights snapshots/<file> --out <dir>` exports a snapshot instead).

The exported directory is a bot for `eval`, `sim` and `lab`:
`dmc:<model dir>` plays the legal action of highest
value, `dmc:<model dir>:<temperature>` draws by `exp(value /
temperature)`, the temperature in points (weaker levels). For example:

```sh
nice -n 10 target/release/eval run --suite v1 --bot dmc:$HOME/card-game-artifacts/models/<name> --out <dir>
```

`hybrid:<model dir>:<samples>` is 고수 at that many deals leaning on the
network (`crates/mighty-ai/src/hybrid.rs`): `@prior=K` weighs the K moves
it values most instead of the search's candidates, `base=q` makes its
choice the one a candidate must beat instead of the simple bot's, and
`leaf=K` stops each playout K tricks on and takes the network's value
there instead of playing to the end; search settings (`threads`,
`read.*`, …) go alongside. With none, it is `hard` at that sample count.

A network reads one encoding (`config.json`'s `spec`): `dmc:`, `export`,
`load` and resuming a run all refuse one whose encoding is not this
build's (dmc-v1 reads `mighty-1`), rather than load weights that would
not fit or would mean something else. Retrain under a new name.

Learned-model bot specs are research interfaces; the table levels currently
use the built-in policies/search, not these models.

## Record an artifact kept outside git

Write a manifest into `research/manifests/` (fields in its
[README](../research/manifests/README.md)); the `ml/` tests validate every
manifest there. `cardgame_ml.manifest.Manifest.verify(root)` checks a copy
of the files against it.


## Manual pacing versus fast bot tests

For a human playtest, start the server without bot timing overrides. The normal
`--bot-delay-ms` default is 1000; bots vary their wait by decision and difficulty.
The e2e quick-bot server uses 20ms delay/think overrides solely to finish tests
quickly. Do not use that server as the human-facing play preview.

`WEB_DIST` overrides the e2e build directory. Building into a separate temporary
directory and serving it on a new port preserves an existing in-memory table
while a revised frontend or server is being tested.
