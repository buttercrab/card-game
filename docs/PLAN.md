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
2. **AI:** one model per game that plays any rules of that game (one Mighty
   model for 기본, the presets, custom sets and 3–7 players; its own model for
   poker). The engine says what is legal and what each card means right now,
   so the model needs no rules built in. Games share the code (environment,
   evals, training library, architecture), not the weights.
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

Done (2026-10-04), pending CI on the branch:
- `engine::Encode`: a spec (shapes and feature names) plus observations as
  flat arrays: a global vector (the rules whole, then public state), one
  row per card of the largest deck (meaning under the current contract
  and trick, and where the viewer knows it to be), up to 160 events, and
  a legal mask over a fixed action space. Seats are relative to the
  viewer, with presence masks for seats and cards. Belief targets come
  from the full state, separately. Mighty's spec, `mighty-1` (now
  `mighty-3`: `mighty-2` added the failed-contract scoring, `mighty-3`
  dropped the misdeal round), is one for
  every rule set the engine accepts (up to 8 seats, contracts up to 30)
  and is pinned in `crates/mighty/tests/encoding.json`, which `ml/` reads.
  About 40 µs an encoding in release.
- `engine::DynGame`/`DynState` over serde JSON, with `JsonGame` for games
  to opt in and a `Registry`; the server does not use it yet (P6).
- `ml/` (uv; ruff, strict pyright, pytest; PyTorch as the `torch` extra),
  `research/` with its conventions and a manifest schema
  (`cardgame_ml.manifest`), the `ml` CI job, `docs/README.md`, and
  DESIGN.md moved here.
- Deviations: `sim --vary`'s rule sampler moved into `mighty` as
  `Rules::varied` (same draws). The Rust–Python parity test proper waits
  for `env-py` (P2); until then the two sides share the pinned spec.

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

Done (2026-10-04), pending CI on the branch:
- `crates/eval`: `eval run --suite <name> --bot <spec> [--baseline <spec>]`
  writes `results.json` (schema `eval-results/1`) and `report.md`;
  `--quick` is a smoke test (in CI), `--parts` runs some parts.
  Generic over an `EvalGame` trait (bot specs, deal options, rule sets);
  Mighty's bots are `sim`'s specs, which gained the table's levels
  `easy`, `normal` and `hard` (a test checks 초보 and 보통 against the
  server's; `hard` deals a fixed 200 times instead of a time budget).
  Tables are `sim --bots search` exactly; the worker loop, timing and
  statistics moved into `sim`'s library.
- Suite v1 (`research/evals/v1`): ladder under 경기과고 (2000 deals a
  rung) with a rating, the mean over rungs; every preset (500 each) and 40
  held-out rule sets (25 each) against 고수; think time; 10 puzzles, 6
  scored with answers proven by solving the rest of the hand in every
  redeal of the hidden cards, 4 informational. The held-out sets are a
  JSON array of `Rules` that training must exclude.
- Baseline (`research/experiments/2026-10-04-eval-v1-baseline`): the
  table's 고수 rates +6.81 ± 0.29 (random +18.84, 초보 +3.95, 보통 +4.71,
  itself −0.26), draws itself in every preset and on held-out rules,
  thinks median 131 ms, p99 346 ms per decision on the home server, and
  passes 6 of 6 puzzles; it still calls its own side's joker early.
- Exit met (`research/experiments/2026-10-04-bench-reproduction`): every
  head-to-head table of the benchmark reproduces exactly from one
  command, and two runs agree exactly (deterministic bots; tested).
  Deviations: the benchmark's `default` was web-mighty's base rules, so
  the suite gives them in full; its pooled default (−0.20) was a slip for
  −0.13; the card-play breakdown (`cheat`, `x10`) stays in the lab.

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

Done (2026-10-04), pending CI on the branch:
- `crates/env`: `Env` steps a batch of hands for a caller playing any
  seats, bots (by level or `sim` spec) in the rest; one contiguous buffer
  per field per step; auto-reset, with every seat's payoff (times a
  scale) as the reward on the step that ends a hand. Each slot draws its
  hands' seeds from its own stream, so trajectories depend on neither
  batch size nor threads. Rules: a preset, a pool, or `varied` draws,
  never one of an excluded list (the evals' held-out sets), compared by
  equality. Per-game choices sit behind a small `EnvGame` trait.
- `crates/env-py` (`cardgame_env`, PyO3 and maturin, abi3) is a path
  dependency of `ml/`, so `uv sync` builds it; numpy arrays take over the
  Rust buffers. The parity test replays a run the Rust side records
  (`crates/env/tests/parity.json`), every field of every step.
- The encoder is 3.5× faster (about 11 µs), bit for bit the same: a pinned
  fingerprint of every seat's encoding over random games proves it.
  Encoding is still most of a step.
- Throughput with random play in every seat: the Rust example reached
  5 700 hands (464 000 decisions) a second on the Mac's 14 cores; from
  Python, 312 hands a second a thread, and 1 280 on all cores while eval
  runs held about 13 of them.
- `selfplay` writes deflated `.npz` shards (numpy alone reads them; events
  stored ragged) with `meta.json`, the rule sets played and a manifest,
  byte-for-byte reproducible; `cardgame_ml.data.shards` reads them in
  batches. [Self-play v1](../research/experiments/2026-10-04-selfplay-v1):
  1.19M decisions, 633 MB in six shards, 20 000 varied rule sets.
- Deviation: the held-out list came from the P1 branch before it was
  committed; the dataset records its SHA-256.

### P3 — Baseline belief model

- `ml/`: a small transformer over the event sequence with per-card features;
  predicts each hidden card's owner. Trained on the Mac (MPS).
- Export to ONNX; `crates/infer` runs it from Rust; parity test.
- Belief-guided sampling in 고수's search behind a setting.

Exit (gates): A — log-loss better than uniform, including held-out rules;
B — beats live 고수 at equal think time on 경기과고 and 기본 (aim +0.3 per
seat-hand) with no loss on held-out rules; C — p99 think time within budget.
Passing B and C, with the owner's go-ahead, ships it.

Result (2026-10-05), stopped by the owner to move to self-play RL
([belief v1](../research/experiments/2026-10-05-belief-v1)):
- `cardgame_ml.models.belief` (0.6M parameters, logits relative to the
  public counts), its training library and CLIs, ONNX export with a
  parity fixture checked from both sides, `crates/infer` (tract, 1.4 ms
  a call) and `SearchBot::sampler` (off by default; decisions with it
  off pinned and checked identical), bot spec `belief:<model>:<samples>`.
- Gate A passed: 1.461 against 1.595 nats per hidden card on validation
  games, 1.517 against 1.645 on the held-out rules; better than the
  search's own reading (1.33 against 1.40 on 경기과고).
- Gate B not passed: at equal think time (1200 samples) presets +0.02 ±
  0.29 a seat-hand against `hard`, 경기과고 −0.40 ± 0.95, 기본 +0.14 ±
  0.81, held-out +0.87 ± 0.93; at 200 samples presets +0.15 ± 0.30.
- Gate C: at 200 samples median 19 ms and p99 139 ms against `hard`'s
  104 and 212 ms (Mac; not re-checked on the home server). Not shipped.
- Not run: belief v2 on more data (self-play v2 cut short), larger
  head-to-heads.

### P3b — Self-play RL (owner, 2026-10-05: RL right after P3)

The closest published match to Mighty is DouZero (DouDizhu, 2021): pure
self-play, no human data, modest compute. Its method, Deep Monte Carlo, fits
our environment directly.

- **Agent:** a network scores every legal action, `Q(observation, action)`:
  the observation is the Mighty encoding (`mighty-1` when planned,
  `mighty-3` since the faster 딜미스 of 2026-10-05; shared with the belief model's token
  layout), each action an embedding of its index plus features of the
  card or contract it names. Play picks the best legal action, with
  ε-greedy exploration while learning.
- **Learning:** many actors play self-play hands in the batched environment
  with the current network; when a hand ends, every decision in it is
  labelled with that seat's final payoff (Monte Carlo return), and the
  network regresses `Q` onto it. No search, no value bootstrapping; an
  actor/learner split so the Mac's CPU plays while its GPU learns.
- **Rules:** training samples rule sets (presets, `Rules::varied`, 3–7
  players), excluding the held-out sets; one model plays all of them.
- **Phases of the hand:** one network for bidding, exchange, friend call and
  play (the encoding already marks the phase); if one phase lags, a head per
  phase.
- **Measured** with suite v1 against random, 초보, 보통 and 고수, presets and
  held-out rules, plus checkpoints played against each other over time.
- **Uses:** a fast search-free bot (natural 초보/보통 levels by temperature),
  and as the policy inside 고수's playouts or to order its candidates.

Exit: a self-play agent that beats 보통 on suite v1, with its learning curve
(rating against fixed opponents by games played) in `research/`; whether it
beats 고수, alone or inside the search, is the report's headline.

### P4 — Scaling study

- How the RL agent's strength grows with self-play games, model size and
  compute (rating against fixed opponents), plus the belief model's log-loss
  against model size and data (~0.1M–10M parameters, 1M–100M decisions),
  with spot checks that log-loss tracks points per hand.

Exit: a report in `research/` choosing the served model sizes under the
think-time budget and the cheaper next step (games, size or compute).

### P5 — Experiment loop (owner, 2026-10-05: now, autonomous, 24/7)

Moved up: once the P3b DMC baseline exists, every method, hybrid, ablation,
hyperparameter sweep and scaling study runs as an experiment in this loop.
Compute: this Mac around the clock (one GPU job at a time) and the home
server's CPU at low priority; the research agent queues experiments within
the agenda on its own and writes a daily report. Agenda:
`research/loop/agenda.md`.

#### Original scope


- `research/loop`: an experiment spec (hypothesis, config, budget, suite), a
  queue run on the Mac and the home server (low priority beside the live bot
  worker), automatic eval, results and notes written to
  `research/experiments/`.
- Agent protocol: how an agent proposes, what it may change (configs, `ml/`
  code on a branch), what it may not (suites, held-out sets, production).
- Promotion: a win repeats on fresh deals, then goes to the owner.

Exit: an unattended overnight run of ≥10 experiments with readable results.

Built (2026-10-05), not yet installed
([research/loop](../research/loop/README.md)):
- `cardgame_ml.loop`: typed TOML specs validated against
  `research/loop/policy.toml` (hosts, budgets, the scoring protocol, what
  the researcher may queue); method runners `dmc`, `belief`,
  `eval-only`, `search-tuning`; a runner with one GPU job at a time,
  thread caps per host, wall budgets, restart-safe steps and a lock;
  CPU evals dispatched to the home server from `git archive` of the run's
  commit at `nice` 15; records in `research/experiments/`, a leaderboard
  with plots, daily reports in `research/reports/`.
- Scoring is fixed: DMC v1's learning curve, suite v1 through `eval`
  against 고수 deal by deal, think time on the home server; a win over
  the parent is confirmed automatically on a fresh-deal twin of suite v1
  (`research/loop/suites/v1-fresh-1`) before it counts.
- The researcher is Claude Code headless, called when the queue runs
  low (rate-limited), restricted to `research/loop/` and runs' notes;
  the runner validates everything it writes and switches it off on a
  violation. New methods are requests for people
  (`research/loop/requests.md`).
- Seeded queue: DMC v1 scored on the protocol, nine DMC variants
  (exploration, learning rate, size, batch, replay, rules, reward
  scale), three search settings and 고수's think time (1.3 s against
  2.4 s, the owner's) on the home server; they wait for P3b's export.
  Installing (`research/loop/ops/install.sh`) waits for review and for
  P3b's branch to be merged.

### P6 — Game-agnostic service

- Server rooms, sessions, bots, stats over `DynGame`; Mighty registered as a
  plugin; presets and rule schema served by the game; the web rule editor and
  rulebook driven by that schema; the table chosen per game.

Exit: the site behaves exactly as before (seat-stability and live-play
checks pass); no `mighty::` outside the Mighty plugin and its web module.

### P7 — Second game: poker

- Texas hold'em only (owner, 2026-10-05): engine, presets (limit and
  no-limit), a simple table, bots, `Encode`, eval suite.

Exit: poker playable with friends and bots; the env, evals and a baseline
model work for it unchanged.

### Later

- Search guided by the RL agent's policy and value (AlphaZero-style
  improvement on top of P3b), and ReBeL-style search over belief states.
- Search-free bots for 초보 and 보통, levels set by temperature.
- Optional research question, nothing depends on it: whether one model
  trained on several games transfers to a new one.
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

## Decisions

- 2026-10-05: P7 is Texas hold'em only.
- 2026-10-05: ratings stay internal to the evals; players see none on the
  site for now.
