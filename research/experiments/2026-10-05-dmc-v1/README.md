# DMC v1: Mighty from self-play alone

**Question (P3b).** Can a network that scores every legal action,
`Q(observation, action)`, learn Mighty purely from its own self-play
hands by Deep Monte Carlo (DouZero, 2021), one model for every phase of
the hand and every rule set, and beat 보통 on suite v1? How does it do
against 고수?

**From scratch** (the owner's rule, 2026-10-05): random initial weights
(the belief model's code reused, never its weights; no warm start but
this run's own checkpoints); no imitation, supervised pretraining or
datasets, the only signal being the payoffs of its own hands; every
seat of every training hand is the current network. The built-in bots
only measure it.

## Setup

- **Network** (`cardgame_ml.models.q`, 0.76M parameters): the belief
  model's token trunk (`models.trunk`, now shared: one token for the
  global vector, one per card slot, one per event; 3 layers of width
  128, 4 heads), its global token as the state. An action is the sum of
  embeddings of its index, its template and its number, read from the
  spec's action names alone (`models.actions`: "bid ♠#", "play <card>",
  …), plus the trunk's token of the card it names; then it attends over
  the card tokens (the action as the query), and an MLP (2 × 256) over
  state and action gives its value. The trunk runs once per position;
  only the asked actions are scored (the legal ones to play, the one
  taken to train). Nothing in it is Mighty's.
- **DMC** (`cardgame_ml.train.dmc`): five actor processes (CPU copies,
  two PyTorch threads, 128 hands at once each) play self-play hands in
  `cardgame_env` over `Rules::varied` draws around every preset, 3–7
  players, never the 40 held-out sets. Every decision of a finished
  hand gets its seat's payoff × 0.025 (self-play v1's payoffs have a
  standard deviation of 40 points) as its target. The learner (MPS)
  keeps the latest 200 000 decisions (float16 rows), samples batches of
  1 024 (drawn eight at a time and cut by sequence length), and takes
  AdamW steps (3e-4, no decay) on the squared error of
  `Q(observation, action taken)`; it publishes its weights every 10
  steps, from which the actors reload.
- **Exploration**: each action drawn by the softmax of the values at a
  temperature of 2 points; 5% of decisions the network's second-best
  action; 2% a uniformly random legal action (see "Runs" for why all
  three).
- **Learning curve**: every 50 000 hands, the network (greedy) in one
  seat of 경기과고 against four 초보 and against four 보통, the same 2 000
  deals each time (`train.dmc.curve`). A quick, fixed probe, not suite
  v1's deals.

Config: [`config.toml`](config.toml) (main run), [`smoke.toml`](smoke.toml)
(two minutes, small network). Manifests:
[`dmc-v1`](../../manifests/dmc-v1.json),
[`dmc-v1-smoke`](../../manifests/dmc-v1-smoke.json).

## Result: a shakedown run

**Stopped by the owner** after 2.5 h and 510 000 hands (32 million
decisions), plateaued since about 250 000 hands, to move to the next
run (경기과고 only, 5 players, the current rules and scoring, a bigger
network, and a hybrid with 고수's search) once the misdeal and encoding
changes merge. It ran on `mighty-1` and the old scoring. Suite v1 was
not run: the curve already shows it short of 보통. **Exit check not
met.** What it established is the machinery: from random weights, pure
self-play, the loop learns card play quickly, and its bidding is what
holds it back.

### Runs

| Run | Commit | Hands | 초보 / 보통 at the end | What happened |
| --- | --- | ---: | --- | --- |
| uniform ε = 0.02 only | `eb11608` | 50 000 | −1.47 / −2.35 | passes every hand: a random bid is nearly always far too high, so every bid it saw lost |
| + softmax at 2 points | `bfafa02` | 50 000 | −1.59 / −2.40 | still passes every hand; its best bid valued ~9 points below passing, so the softmax never drew one |
| + 5% runner-up | `696c128` | 236 000 | −0.89 / −1.67 | its declarers (by exploration) lost 14 points a hand; the bid it valued most was ♦14 whatever the hand |
| + actions attend over the cards (**dmc-v1**) | `270d94f` | 510 000 | −0.40 / −1.38 | bids on its own from ~300 000 hands (16% of first decisions, mostly nt13); plateau |

The first three were stopped early by hand; the third's curve is in
[`results/attempt1-curve.json`](results/attempt1-curve.json). Each
restarted from random weights.

### Learning curve (dmc-v1)

Greedy, one seat of 경기과고 against four of each, the same 2 000 deals
at every point, points per seat-hand ± 95%
([`results/curve.json`](results/curve.json), from
`python -m cardgame_ml.train.dmc.report`):

| hands | decisions | hours | 초보 | 보통 |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 0.00 | −56.71 ± 1.67 | −58.05 ± 1.65 |
| 50,017 | 3,160,343 | 0.20 | −1.48 ± 0.29 | −2.36 ± 0.31 |
| 100,007 | 6,478,958 | 0.46 | −1.06 ± 0.30 | −1.96 ± 0.30 |
| 150,028 | 9,690,238 | 0.73 | −0.78 ± 0.29 | −1.67 ± 0.29 |
| 200,089 | 12,833,737 | 0.93 | −0.88 ± 0.29 | −1.66 ± 0.30 |
| 250,069 | 15,948,388 | 1.15 | −0.63 ± 0.30 | −1.39 ± 0.31 |
| 300,032 | 19,037,390 | 1.34 | −0.62 ± 0.37 | −1.49 ± 0.40 |
| 350,055 | 22,113,337 | 1.56 | −0.73 ± 0.32 | −1.58 ± 0.32 |
| 400,029 | 25,188,018 | 1.77 | −0.59 ± 0.30 | −1.40 ± 0.30 |
| 450,042 | 28,267,922 | 2.08 | −0.33 ± 0.35 | −1.29 ± 0.35 |
| 500,004 | 31,339,034 | 2.41 | −0.40 ± 0.31 | −1.38 ± 0.32 |

For scale: suite v1's ladder has 고수 at +3.95 against 초보 and +4.71
against 보통 (different deals). The random network bids wildly (−57);
within 50 000 hands it learns to pass and to defend, and then gains
about a point a seat-hand in 450 000 hands, mostly from card play.

### Fit by phase of the hand

Mean squared error (targets are points / 40) and the share of the
targets' variance explained, on the training batches of the stretch
before each point:

| hands | bidding | exchange | early tricks | late tricks |
| ---: | --- | --- | --- | --- |
| 50,017 | 0.965 / 0.06 | 2.200 / 0.33 | 0.553 / 0.67 | 0.520 / 0.69 |
| 100,007 | 0.308 / 0.09 | 0.322 / 0.47 | 0.078 / 0.73 | 0.068 / 0.76 |
| 200,089 | 0.249 / 0.10 | 0.246 / 0.53 | 0.061 / 0.73 | 0.048 / 0.78 |
| 300,032 | 0.230 / 0.11 | 0.256 / 0.51 | 0.061 / 0.72 | 0.040 / 0.81 |
| 400,029 | 0.230 / 0.11 | 0.248 / 0.51 | 0.061 / 0.71 | 0.037 / 0.82 |
| 500,004 | 0.208 / 0.11 | 0.217 / 0.56 | 0.054 / 0.73 | 0.031 / 0.84 |

**The bidding lags.** Its values explain about a tenth of the payoff
(the hand is still to be played, so much of it is noise by nature), and
the bidding policy is where the run fails: at 300 000 hands its own
declarations (in self-play, with exploration) lost 14 points a hand on
average and only 23–36% of the commonest contracts were made, so
passing stays the better choice for most hands and the network is
mostly a defender, which against bots that declare cannot score above
zero. The exchange (discards, friend call) is learnt half; card play
three quarters and more, improving to the end.

### Throughput and utilisation

Means over the run's stretches: 43–73 hands (2 600–4 500 decisions) a
second from the five actors on 4–6.5 cores (inference is 97% of an
actor's time; two PyTorch threads give little over one), the learner
2.5–3.1 steps (2 500–3 200 decisions) a second, busy 88% of the time
with the GPU at 95–97%, so each decision is trained on 0.8 times on
average and the learner is the bottleneck; actors play with weights
0.15 publications old. The Mac was shared with another session (load
averages 10–25), which cost the actors. Before batching by sequence
length the learner managed 2.2 steps a second.

### Think time

Exported to ONNX (parity with PyTorch within 4.3e-6), `infer check`
times one decision on one thread at **1.45 ms median, 2.22 ms p99** (the
Mac): about seventy times faster than `hard` (104 ms median). The bot is
`dmc:<model dir>[:temperature]` in `eval` and `sim`; nothing reaches the
server.

### What it means, and next

- The machinery works end to end: actors and learner, the learning
  curve, checkpoints and resume, export with parity, the Rust bot and
  its spec. Card play is learnt from nothing in minutes.
- Bidding is the problem, not card play. DouZero never learnt bidding
  with DMC (its landlord was fixed); here a bid's value depends on play
  that is still bad when the bidding is learnt, and exploration rarely
  produces sensible declarations. Ideas: explore whole hands (a seat
  that bids its best bid for the hand, a share of hands), a bigger
  network and longer runs (the learner was the bottleneck at 0.8 trains
  a decision), one rule set first (경기과고, 5 players) before varied
  rules, and the hybrid with 고수's search the owner has planned (the
  search's playouts or its candidate ordering by the learned values).
- For a follow-up run, in `config.toml`: `rules` (an `Env` rule source:
  `"gshs"` for 경기과고 alone, `"gshs/5"` at five players explicitly,
  `"pool:…"`, `"varied"`, `"varied:gshs"`), `exclude` (the held-out
  list, required), `[model.trunk]` (`width`, `heads`, `layers`,
  `feedforward`) and `[model]` (`head_width`, `head_layers`) for the
  network's size, `[actors]` (`processes`, `envs`, `threads`,
  `epsilon`, `temperature`, `runner_up`) for play and exploration,
  `[optim]`, `[buffer]` and `[budget]`; `[curve]` sets the probe.
