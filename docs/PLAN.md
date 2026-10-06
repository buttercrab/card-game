# Project direction

Updated 2026-10-06 against `4c4b8aa`. This document owns goals, priorities,
decisions and completion criteria. Implementation details belong in
[ARCHITECTURE.md](ARCHITECTURE.md), instructions in
[DEVELOPMENT.md](DEVELOPMENT.md), and experiment evidence in [research](../research).

## Goal

Build a platform where friends play card games with their own rules, starting
with Mighty (마이티), and build bots that play those rules well. Mighty is the
driving use case. Texas hold'em is the second game that will test the shared
platform.

1. **Product:** a responsive Korean table with understandable rules, stable
   seats, reliable reconnects and useful bots. Friend groups first; site and
   repository are public.
2. **Platform:** share rooms, links, seating, sessions, persistence, reports
   and infrastructure. Each game supplies rules, presets, bots and table UI.
3. **AI:** one model per game, eventually covering that game's presets,
   custom rules and player counts. Games share training infrastructure;
   shared weights across games are not a requirement.
4. **Research:** reproducible evaluations and scaling studies that show where
   the next hour of compute should go. Building an experiment loop is not
   proof that this goal has been reached.

## Current state

| Track | State | Evidence and remaining boundary |
| --- | --- | --- |
| Mighty product | Implemented and deployed at takeover | Server and connected worker reported `4c4b8aa`; its CI passed. A dated receipt, not a permanent health claim. |
| Codebase cleanup | Phases 0–7 merged | [REFACTOR.md](REFACTOR.md) records delivered changes and residual items. |
| Game boundary | Substantially implemented | Typed game/table traits, catalog and frontend registry; only Mighty is registered and some site pages remain specific to it. |
| Evals and environment | Implemented | Suite v1, Rust/Python parity, self-play manifests and historical baseline reports; refresh the current-rules baseline. |
| Belief model | Experiment concluded; not promoted | Prediction improved; equal-time playing-strength gate was not met. |
| Self-play RL | Paused by the owner | DMC v1/v2 missed the target; v2 assessment identifies data and target problems. |
| Scaling study | Not completed | No controlled report selects model size or compute allocation. |
| Autonomous loop | Built; operation unproven and paused | No qualifying overnight batch or daily-report series is recorded. |
| Texas hold'em | Not implemented | No poker engine, table, bots, encoding or suite. |

**REFACTOR phases 0–7** are the delivered cleanup. **Roadmap P0–P7** below
are the product/AI program. Finishing cleanup did not finish poker or AI.

## Principles

- **Rules are data.** The engine owns validation, legality, scoring and card
  meanings. Models receive rule-derived features and choose legal actions.
- **Hidden information stays hidden.** Clients and bots receive a seat's
  view. Full-state belief targets are training labels, never model inputs.
- **Boundaries follow responsibilities.** Shared drivers depend on game
  traits; registration and game-specific UI are explicit. Prove generality
  with a second game.
- **Results belong to a revision.** Record commit, config, seeds, rules,
  encoding, opponents and machine/load. Historical numbers do not describe
  current performance after rules or bots change.
- **Keep the scoreboard independent.** Freeze evaluation definitions,
  exclude held-out rule sets from training, confirm wins on fresh deals.
- **Promotion is separate.** Beat the served baseline at the intended
  thinking budget, avoid material rule regressions, and obtain the owner's
  approval before a learned bot reaches players.
- **Use PRs.** Main auto-deploys; merging is a release action. No secrets,
  player data or real game logs in the public repository.

## Roadmap and acceptance criteria

| Phase | Outcome | Status / exit requirement |
| --- | --- | --- |
| P0 — foundations | Encoding, ML project, provenance and CI | Delivered. Encoding now lives in `engine-ml`; the early dynamic API was replaced by the table/catalog boundary. |
| P1 — evaluations | Paired deals, rotated seats, presets, held-out rules, timing and puzzles | Historical reproduction delivered; freeze current rules and refresh the served-bot baseline before promotion claims. |
| P2 — environment/data | Deterministic batches, Python bindings, parity and reproducible shards | Delivered, including 1.19M decisions in self-play v1. Historical data uses older encodings. |
| P3 — belief | Predict hidden-card owners and guide search | Prediction gate A passed; equal-time strength gate B did not. Not promoted. |
| P3b — self-play RL | Learn all phases from self-play | Paused. Exit: beat 보통 on the agreed suite with a learning curve; report whether it beats 고수 alone or in search. |
| P4 — scaling | Compare strength against games, size and compute | Paused. Exit: a controlled report selecting served sizes and the next compute investment. |
| P5 — experiment loop | Queue, run, evaluate, confirm and report | Built, paused. Exit: at least ten unattended overnight experiments with readable results. |
| P6 — shared service | Preserve Mighty behind shared room/game interfaces | Mostly delivered by cleanup Phase 7. Resolve residual site coupling and validate the same player flows. |
| P7 — Texas hold'em | Limit/no-limit rules, table, bots, encoding and suite | Unstarted. Exit: friends/bots can play, and env/evals integrate without rewriting shared drivers. |

### Results already obtained

- [Baseline](../research/experiments/2026-10-04-eval-v1-baseline): historical
  고수 rating +6.81 ± 0.29 on v1's four-rung mean, including random opponents.
  Predates scoring G and later bot changes.
- [Belief v1](../research/experiments/2026-10-05-belief-v1): validation loss
  1.461 versus 1.595 nats per hidden card; held-out 1.517 versus 1.645.
  Equal-time preset play +0.02 ± 0.29 points per seat-hand. Home-server cost
  was not rechecked; playing-strength target not established.
- [DMC v1](../research/experiments/2026-10-05-dmc-v1): about 510k hands;
  −0.40 ± 0.31 against 초보 and −1.38 ± 0.32 against 보통 on recorded rules.
  Stopped before the full-suite exit check.
- [DMC v2 assessment](../research/experiments/2026-10-06-rl-assessment):
  stopped near 119k hands; −2.97 ± 0.21 against the assessment's 보통.
  Almost all contracts came from exploration, mostly poor ones. Exchange
  and declarer play stayed weak; discarded deals inherited later rewards.
  All thirty assessment artifacts matched their manifest at takeover.

### Conditions for restarting AI

Training, scaling and unattended research remain paused. Before a restart:

1. Correct discarded-deal targets and reset exploring-start bookkeeping at
   redeals; verify targets by seat and deal.
2. Make declarer training useful. The assessment recommends plausible
   contracts chosen by lookahead using the network's own play. Using a
   hand-written teacher remains an owner decision.
3. Establish frozen rules, the served-bot spec/time budget, primary metric
   and fresh-deal confirmation.
4. Use a new compatible run: current encoding is `mighty-4`; v1 weights use
   `mighty-1`, v2 uses `mighty-3`. Loaders refuse mismatches by design.
5. Agree compute/spending limits before loop installation. The $5/call and
   $20/day policy values are defaults, not a new approval.

More capacity or more unchanged self-play is not the recommended next step.

## Next milestone: not selected

[FIXES.md](FIXES.md) lists cleanup and acceptance gaps. Close or explicitly
defer them before choosing between Texas hold'em (prove the platform) and
a corrected learned-bot experiment (prove the AI direction).

Later ideas remain optional: learned search priors/values, belief-state
search, search-free difficulty levels, cross-game transfer, and AI-assisted
translation of house rules into simulator-validated rule data.

## Adding a game

See [ARCHITECTURE.md](ARCHITECTURE.md#adding-a-game). Games are compiled and
registered with the application; there is no runtime-download or user-script
plugin system.

## Compute

| Host | Intended role | Constraint |
| --- | --- | --- |
| Mac: M4 Pro, 14 CPU cores, 20-core GPU, 24 GB | MPS training/local research | One GPU job at a time; research paused. |
| Home: 12 cores, 31 GB | Live worker, builds, low-priority CPU eval | Preserve worker responsiveness; loop policy caps research threads/load. |
| Seoul instance | Interactive site | Never use for research. |

## Decisions carried forward

- Mighty first; friends first; public repository.
- Korean UI, original four-color card art, raise-then-play default, calm
  motion, sound and optional jazz. [Design contract](DESIGN.md).
- Home starts with 기본 or the last selected preset; 고수 is the default bot.
- Poker means Texas hold'em only. Ratings remain internal.
- Scoring G applies to school presets; 기본 retains its specified scoring.
  [Rule authority](../crates/mighty/RULES.md).
- Research code/results stay here; large artifacts stay outside git with
  manifests. Real player logs require an explicit privacy/product decision.
- Training stopped for assessment, then paused while cleanup continued.
  Takeover does not revoke that pause or approve a teacher, unattended
  research, new spending or deployment.
