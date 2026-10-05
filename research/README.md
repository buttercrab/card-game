# Research

Results of the AI track live here, next to the code that produced them.
[docs/PLAN.md](../docs/PLAN.md) says what to do and in what order; this
folder records what happened.

| Folder | What it holds |
| --- | --- |
| [`evals/`](evals) | Eval suite definitions, by version: the scoreboard |
| [`experiments/`](experiments) | One folder per experiment: config, results, notes |
| [`manifests/`](manifests) | Manifests of large artifacts kept outside git |
| [`loop/`](loop) | The experiment runner and the rules for agents that use it |

## Conventions

- **An experiment is a config file, a commit and seeds.** Anyone with the
  repository reproduces it from those three; nothing else may matter.
- **Large artifacts stay outside git.** Self-play shards and weights are
  stored elsewhere; their manifests (path, size, SHA-256, the producing
  commit, config and seeds) are committed in `manifests/`.
- **Evals are out of reach of training.** The training side and the loop
  read eval results but never change suites or see held-out rule sets.
- **A win counts once it repeats on fresh deals**, and reaches players
  only after beating what is live and the owner's go-ahead.
- **Public repository:** no secrets, no player data, no real game logs.

## Log

Each phase ends with a short entry here.

- **P0, foundations (2026-10):** `engine::Encode` (encoding spec
  `mighty-1`, pinned in `crates/mighty/tests/encoding.json`),
  `engine::DynGame`, the `ml/` project and these folders. No results yet.
- **P1, evals v1 (2026-10):** `crates/eval` and suite
  [v1](evals/v1); the table's 고수 rates +6.81 ± 0.29 on it
  ([baseline](experiments/2026-10-04-eval-v1-baseline)), and the runner
  reproduces the 2026-10-04 benchmark's head-to-head tables exactly
  ([reproduction](experiments/2026-10-04-bench-reproduction)).
- **P2, environment and data (2026-10):** `crates/env` and its Python
  bindings `cardgame_env`, with a Rust–Python parity test; the first
  dataset, [self-play v1](experiments/2026-10-04-selfplay-v1): 1.19
  million decisions by mixed bots over varied rules, manifest
  `manifests/selfplay-v1.json`.
- **P3, belief model (2026-10):** [belief v1](experiments/2026-10-05-belief-v1)
  says where hidden cards are better than the counts (0.13 nats a card,
  also on held-out rules) and better than the search's own reading, but
  dealing by it does not make 고수 measurably stronger at equal think
  time (presets +0.02 ± 0.29); at a fifth of the time it plays as well.
  Stopped by the owner for self-play RL; self-play v2 was cut short.
