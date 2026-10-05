# Belief v1: where the hidden cards are, and dealing by it

**Question (P3).** Can a small model, reading one seat's observation,
say where each card it cannot see is better than the counts alone (gate
A), and does 고수 play better when it deals its sampled worlds by that
model instead of uniformly (gate B), within its think-time budget (gate
C)?

**Plan.**

- Model: a transformer over the `mighty-1` observation (one token for
  the global vector, one per card slot, one per event, events sharing
  the card slots' identity embeddings), 4 layers of width 128, 0.6M
  parameters; per card, logits over the 9 belief classes relative to the
  counts (a card is in class k with probability proportional to
  `count[k] · exp(logit[k])`, the counts being public).
- Data: self-play v1 (1.19M decisions, 20 000 games over varied rules),
  5% of the games held back for validation; config in
  [`config.toml`](config.toml). Gate A also on
  [held-out self-play v1](../2026-10-05-selfplay-heldout-v1), 2 000 games
  on suite v1's 40 held-out rule sets, eval-only.
- Gate B: suite v1 with `belief:<model>:<samples>` against `hard`, at
  equal samples (200) and at equal think time.
- Gate C: the cost part's median and p99 per decision against `hard`, on
  the Mac (the home server could not be reached).

**Encoding.** Belief v1 (and v1-large, and the self-play data both
trained on) reads `mighty-1`. The engine moved to `mighty-2` the same
day (the schools' failed-contract scoring): the model was not retrained,
and today's `sim` and `beliefs` refuse it, the specs differing. To run it,
check out a commit before that change.

**Stopped by the owner** (2026-10-05) to move to self-play RL: the
planned follow-ups (belief v2 on more data, larger head-to-heads on
경기과고 and 기본) were not run. Everything below did run.

## Runs

| What | Commit | Where |
| --- | --- | --- |
| Training, 12 epochs on the Mac's GPU, 71 min | `1d718e0` | manifest [`belief-v1`](../../manifests/belief-v1.json) (written again at export, `6b7ef10`) |
| Gate A | `a6d5354` | [`results/gate-a-*.json`](results) (`python -m cardgame_ml.train.score`) |
| Beliefs against the search's own | `d37ea5c` | [`results/beliefs-*.txt`](results) (`crates/infer` example `beliefs`) |
| Gate B/C, 200 samples | `a6d5354` | [`results/equal-samples`](results/equal-samples) |
| Gate B/C, 1200 samples | `2cdabfd` | [`results/equal-time`](results/equal-time) |
| Belief v1 large (2.2M parameters, same data), 4 h | `2cdabfd` | manifest [`belief-v1-large`](../../manifests/belief-v1-large.json), config in [`../2026-10-05-belief-v1-large`](../2026-10-05-belief-v1-large) |

Results name the model as `~/card-game-artifacts/models/belief-v1`
(the runs used the absolute path) and the binary as `target/release/eval`.

## Gate A: better than the counts — passed

Log-loss in nats per hidden card (accuracy), model against the counts
baseline:

| | Validation games (1.57M cards) | Held-out rule sets (3.12M cards) |
| --- | --- | --- |
| all | **1.461** vs 1.595 (33.4% vs 24.3%) | **1.517** vs 1.645 (32.0% vs 23.2%) |
| bidding | 1.666 vs 1.680 | 1.707 vs 1.721 |
| exchange | 1.421 vs 1.442 | 1.481 vs 1.502 |
| early tricks | 1.450 vs 1.612 | 1.515 vs 1.669 |
| late tricks | 1.138 vs 1.496 | 1.185 vs 1.534 |

The same gain (0.13 nats a card) on rules it never saw. Against what the
search itself believes, on 80 hands of 고수 in every seat (log-loss, all
phases):

| | 경기과고 | 기본 | held-out |
| --- | --- | --- | --- |
| counts | 1.520 | 1.516 | 1.648 |
| search's deals (voids, bidding redeals) | 1.451 | 1.450 | 1.599 |
| search's deals and reading (고수 now) | 1.403 | 1.409 | 1.570 |
| **model** | **1.332** | **1.357** | **1.500** |
| search dealing by the model | 1.339 | 1.359 | 1.509 |
| dealing by the model and reading too | 1.374 | 1.389 | 1.545 |

The gain is in the play (early tricks 1.35 against reading's 1.45 on
경기과고); the bidding is nearly the counts' for everyone. Reading on top
of the model counts the bids and plays twice, so `belief:` bots do not
read.

**Curves.** Validation log-loss 1.475 after one epoch, 1.461 after
twelve, flat within ±0.005 from epoch 3; training loss ends a little
lower (1.43). The large model (2.2M parameters, dropout 0.1) peaks at
1.458 and ends at 1.475 with training loss 1.42: v1's 1.19M decisions,
not size, limit it.

## Gate B: better play at equal think time — not passed

Points per seat-hand, belief bot minus `hard` in the same seat on the
same deals (suite v1, ± 95%):

| | 200 samples | 1200 samples (equal median time) |
| --- | --- | --- |
| 경기과고 (500 deals) | −0.05 ± 0.93 | −0.40 ± 0.95 |
| 기본 (500 deals) | +0.63 ± 0.98 | +0.14 ± 0.81 |
| all 9 presets | +0.15 ± 0.30 | +0.02 ± 0.29 |
| held-out (40 sets × 25) | +0.99 ± 1.02 | +0.87 ± 0.93 |
| puzzles (scored) | 6 / 6 | 6 / 6 |

No loss anywhere outside the intervals, positive on held-out rules at
both sample counts (just short of significant), but nothing near the
aimed +0.3 on 경기과고 and 기본 at equal time. More samples did not
help, as for `hard` itself. Five hundred deals cannot resolve +0.3 (the
intervals are ±0.9); a fair verdict on the aim needs several thousand.

## Gate C: think time — passed at 200 samples on the Mac

Per decision, cost part (40 deals of 경기과고, one thread):

| | median | p99 |
| --- | --- | --- |
| `hard` | 104 / 96 ms | 212 / 203 ms |
| belief, 200 samples | **19 ms** | **139 ms** |
| belief, 1200 samples | 98 ms | 787 ms |

Without reading's 32 draws per world a belief search is about five
times cheaper per sample, but its cost grows with candidates × samples,
so at equal median its p99 is four times `hard`'s (under the table's 1 s
budget on the Mac; the home server is about a third slower, so check
it there). The model itself takes 1.4 ms (p99 2.2 ms) a call, once per
decision. At 200 samples the belief bot plays at least as well as `hard`
(presets +0.15 ± 0.30) for a fifth of the time.

## What it means, and what is reusable for RL

- The model reads the table better than 고수 does, on seen and unseen
  rules, but that turns into little play: the playouts (the simple bot
  in every seat) more than the deals decide what the search finds. A
  learned policy and value, as RL will train, attack that directly.
- Reusable: the encoding-generic transformer (`cardgame_ml.models.belief`:
  card, event and global tokens, a head per card) as a trunk for policy
  and value heads; the training library (typed configs, game-level
  splits, length-bucketed batches, MPS, resume, manifests); ONNX export
  with a parity fixture both suites check, and `crates/infer` (tract,
  ~1.4 ms a call, `engine::Belief`) for running models inside bots; the
  belief sampler (`SearchBot::sampler`, off by default) and the `belief:`
  bot spec for evals; eval-only datasets on held-out rules.
- Not done: belief v2 on more data ([self-play v2](../2026-10-05-selfplay-v2)
  was cut short; its [config](../2026-10-05-belief-v2/config.toml) never
  ran), thousands-of-deals head-to-heads, gate C on the home server.
