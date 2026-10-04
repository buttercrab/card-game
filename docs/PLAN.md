# Plan

A platform for card games with house rules, and the AI that plays them.
Mighty is the first game; the service and the AI are built so that a second
game (poker) plugs in without changing either.

This file is the source of truth for direction and order of work. It changes
by commit, like the code. Results live next to it in `research/`.

## Where we are (2026-10-04)

- **Service:** cards.buttercrab.io plays Mighty with nine presets plus 기본 (the
  base rules), custom rules with an editor, bots, share links, stats and error
  reports on `/stats`, Cloudflare Web Analytics. The server and web client
  still know Mighty by name.
- **Engine:** `engine::Game` and `engine::Bot` are generic; Mighty implements
  them. The simulator checks invariants over every preset and random rule
  combinations (`sim --vary`, 3–7 players).
- **Bot:** 고수 is a determinised search (PIMC). Measured headroom is in early
  card play under hidden information (up to +1.46 points per seat-hand with
  every hand known); bidding, exchange and endgame show none. The search is
  2.5× cheaper with identical decisions; more samples did not add strength.

## Goals

1. **Service:** one platform, many games. A game is a plugin: rules engine,
   presets, a rule schema, a table screen. Rooms, links, bots, stats, reports,
   the rulebook and the rule editor are shared.
2. **AI:** one model family for any rules and any card game. The engine says
   what is legal and what each card means right now; the model never encodes a
   game's rules in its weights' assumptions.
3. **Research setup** that keeps improving bots on its own: fixed evals, an
   RL environment, scaling studies, and an experiment loop, all reproducible
   from this repository.

## Principles

- **Rules are input, not code.** Models get rule-derived features from the
  engine (per card: point value, special role, power in this trick, may it
  lead) plus a global rules vector, and score only legal actions.
- **Generic boundaries.** Everything above a game (server, evals, env,
  training) depends on `engine` traits, never on `mighty`.
- **Evals are the scoreboard and are out of reach.** Versioned suites; the
  training side and the experiment loop read results but cannot change suites
  or see held-out rule sets. A win counts once it repeats on fresh deals.
- **Reproducible from a commit.** Every experiment is a config file plus a
  commit hash plus seeds. Large artifacts (self-play data, weights) live
  outside git; their manifests (path, size, SHA-256, producing config) are
  committed.
- **Nothing reaches players without beating what is live**, head to head, and
  the owner's go-ahead.
- **Public repository.** No secrets, no player data, no real game logs in git.

## Target layout

```
crates/
  engine/         Game, Bot; plus Encode (model features), Describe (rule schema), DynGame (JSON boundary)
  mighty/         the Mighty game: rules, presets, bots, its Encode and Describe
  sim/            simulator and the lab, generic over Game
  eval/           eval suites and runner (new)
  env/            batched RL environment over Game (new)
  env-py/         Python bindings for env (PyO3, maturin) (new)
  infer/          model inference from Rust (ONNX via tract), used by bots (new)
  server/         rooms, sessions, bots, stats; games registered as plugins
ml/               Python training (uv project)
  pyproject.toml
  src/cardgame_ml/
    data/         shard reading, batching
    models/       belief, policy/value networks
    train/        training loops, configs
    export/       ONNX export, parity checks against Rust
    scaling/      sweeps and curve fitting
  tests/
research/
  evals/          suite definitions by version (v1, v2, …)
  experiments/    one folder each: config, results (JSON), notes
  manifests/      artifact manifests
  loop/           the experiment runner and its agent protocol
web/              the client; a table module per game
docs/             PLAN.md (this), DESIGN.md, RULES links, how-tos
```

## Code standards

- **Rust:** as today: `cargo fmt`, `clippy -D warnings`, tests beside the
  code, comments that say why. New crates get a crate-level doc comment and
  examples in tests.
- **Python:** `uv` for environments and the lockfile; `ruff` (lint and
  format); `pyright` in strict mode; `pytest`; typed configs (dataclasses);
  no notebooks in the tree; seeds explicit everywhere. Training code is a
  library plus thin CLIs, not scripts.
- **CI:** Rust jobs as today, plus `ml/` lint, types and tests, plus a parity
  test that the Rust and Python sides encode the same position identically.
- **Every new boundary gets a test before use:** encoder parity, env
  determinism, export parity, eval reproducibility.

## Phases

Each phase ends with its exit check met and a short entry in `research/`.
P1–P5 are the AI track; P6–P7 the service track. The tracks share only the
`engine` traits, added in P0, so they can run side by side.

### P0 — Foundations

- Add `engine::Encode` (positions to features, actions to indices, hidden
  card owners as belief targets) and `engine::DynGame` (serde JSON in and
  out, object-safe) with Mighty implementations.
- Create `ml/` (uv, ruff, pyright, pytest), `research/` (folders above), CI
  jobs for both.
- Move `docs/` to the structure above; link RULES and DESIGN from it.

Exit: CI green with the new jobs; `Encode` and `DynGame` tested on Mighty.

### P1 — Evals v1

- `crates/eval` with one CLI: `eval run --suite v1 --bot <spec>` writes JSON
  and a Markdown report.
- Suites: ladder (random, 초보, 보통, 고수) as points per seat-hand with 95%
  intervals and a rating; presets; held-out rule sets (fixed list, hashed);
  cost (median and p99 think time, measured on the home server); regression
  puzzles (known misplays, kept as positions).
- Paired deals, rotated seats, fixed seeds; built from today's `lab`/`sim`.

Exit: the 2026-10-04 benchmark numbers reproduce from one command; two runs
of the same suite agree within their intervals.

### P2 — RL environment and data

- `crates/env`: batched, deterministic, any `Game` with `Encode`; rules as an
  environment parameter (fixed, sampled from `--vary`, or held out).
- `crates/env-py`: Python package with step/reset over many games at once,
  legal-action masks, observations as arrays.
- Self-play data generator writing shards plus manifests: mixed bot styles
  (고수 at reduced samples, 보통, random), with belief targets.

Exit: Python runs thousands of games per second with random play; Python and
Rust encodings match on recorded positions; a shard set of ≥1M decisions with
a committed manifest.

### P3 — Baseline belief model

- `ml/`: a small transformer over the event sequence with per-card features;
  predicts each hidden card's owner. Trained on the Mac (MPS).
- Export to ONNX; `crates/infer` runs it from Rust; parity test.
- Belief-guided sampling in 고수's search behind a setting.

Exit (gates): A — log-loss better than uniform, including held-out rules;
B — beats live 고수 at equal think time on 경기과고 and 기본 (aim +0.3 per
seat-hand) with no loss on held-out rules; C — p99 think time within budget.
Passing B and C, with the owner's go-ahead, ships it.

### P4 — Scaling study

- Sweep model size (~0.1M–10M parameters) × data (1M–100M decisions) ×
  compute on belief log-loss; fit curves; spot-check that log-loss tracks
  points per hand.

Exit: a report in `research/` choosing the served model size under the
think-time budget and the cheaper next step (data or size).

### P5 — Experiment loop

- `research/loop`: an experiment spec (hypothesis, config, budget, suite), a
  queue run on the Mac and the home server (low priority beside the live bot
  worker), automatic eval, results and notes written to
  `research/experiments/`.
- Agent protocol: how an agent proposes, what it may change (configs, `ml/`
  code on a branch), what it may not (suites, held-out sets, production).
- Promotion: a win repeats on fresh deals, then goes to the owner.

Exit: an unattended overnight run of ≥10 experiments with readable results.

### P6 — Game-agnostic service

- Server rooms, sessions, bots, stats over `DynGame`; Mighty registered as a
  plugin; presets and rule schema served by the game; the web rule editor and
  rulebook driven by that schema; the table chosen per game.

Exit: the site behaves exactly as before (seat-stability and live-play
checks pass); no `mighty::` outside the Mighty plugin and its web module.

### P7 — Second game: poker

- Engine, presets (limit and no-limit hold'em to start), a simple table,
  bots, `Encode`, eval suite.

Exit: poker playable with friends and bots; the env, evals and a baseline
model work for it unchanged.

### Later

- Policy and value from search-guided self-play (model-guided 고수).
- Search-free bots for 초보 and 보통, levels set by temperature.
- One model across games, and whether it transfers to a new one.
- House rules written by AI: a group describes its rules, an agent turns
  them into a validated rule set using the simulator.

## Compute

- **Mac** (Apple M4 Pro, 14 CPU cores, 20-core GPU, 24 GB): training (PyTorch
  on MPS), self-play overnight.
- **Home server** (12 cores, 31 GB): self-play and evals at low priority; it
  also runs the live bot worker, which must stay responsive.
- **Seoul instance:** the site only; never used for research.

## Risks

- **Bots unlike people:** mix bot styles in data. Real game logs only with a
  notice on the privacy page and the owner's agreement.
- **Rare rule options:** oversample them; held-out suites show the gap.
- **No gain over 고수:** stop at the failed gate; evals and env stay useful.
- **Over-generalising from one game:** keep P6/P7 honest by building poker,
  not by guessing what a second game needs.

## Open questions for the owner

- Poker variants for P7: hold'em only, or others your group plays?
- Ratings: show players a rating (for bots and people) on the site, or keep
  ratings internal to the evals?
