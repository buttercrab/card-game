# DMC v2: 경기과고 at five, a bigger network, exploring starts for the bidding

**Status: prepared, not run.** The overnight run waits for the owner's
go-ahead and a free Mac. The smoke run below checks the pipeline.

**Question.** With the current rules and scoring (encoding `mighty-3`:
the out-of-turn 딜미스; scoring G, `LoseScore::PaysBack(10)`), on one
rule set (경기과고, five players), can a Q network learnt purely from its
own self-play hands by Deep Monte Carlo beat 보통, and how close does it
come to 고수, in one night of the Mac?

**From scratch** (the owner's decision, 2026-10-05): random initial
weights; no imitation, supervised pretraining, datasets or warm start
(dmc-v1's weights are `mighty-1` and would not load anyway: every loader
refuses another encoding); every seat of every training hand is the
current network. The built-in bots (초보, 보통, 고수) only measure it.

## Setup ([`config.toml`](config.toml))

The machinery is dmc-v1's (see its README): actors play self-play hands
on CPU copies of the network, the learner (MPS) fits `Q(observation,
action)` to each seat's payoff for the hand. What changed, and why:

| | v1 | v2 | Why |
| --- | --- | --- | --- |
| rules | `varied`, 3–7 players, old scoring, `mighty-1` | `gshs/5`, current rules and scoring, `mighty-3` | the owner's decision: one rule set first; the ladder is 경기과고 |
| network | 0.76M: width 128, 3 layers, head 256 | **4.3M**: width 256, 4 layers (4 heads, feed-forward 1 024), head 512 × 2 | v1's card play kept improving to the end and its bidding fit was poor: room to learn more |
| batch, lr | 1 024, 3e-4 | 512, 2e-4, warm-up 1 000 | at this size the MPS learner does as many samples a second at 256–512 as at 1 024 (and thrashed at 1 024 with 8 heads: 0.03 steps/s), so smaller batches give more steps; a lower rate for the bigger network |
| actors | 5 processes | 2 processes (2 threads each) | v1's learner was the bottleneck (0.8 trains a decision); more actors only staled the data. Two produce ~1 000 decisions/s on a quiet Mac, enough for the learner at a replay ratio of 2 |
| replay ratio | cap 2, reached 0.8 | cap 2, reached (smoke: 2.0) | each decision trained on about twice |
| exploration | softmax at 2 points, 5% runner-up, 2% uniform | softmax at 2 points, 3% runner-up, 1% uniform, **exploring starts** | see below |
| curve | 초보, 보통 on 2 000 deals of 경기과고 | 초보, 보통 on 2 000 deals and **고수 on 300**, every 40 000 hands | the owner wants 고수 on the curve; 300 deals keep a point to a few minutes |
| budget | 3.5 h | 11 h | overnight |

**Exploring starts for the bidding** (`actors.declare = 0.0625`,
`declare_temperature = 0.1`). v1's diagnosis: the bidding is never
explored usefully. Exploration there is one decision at a time; a lone
exploratory bid, with the network's poor declarer play behind it, loses,
so the network learns that bidding loses and passes for ever (v1 passed
every hand until it added the runner-up action, and its declarations
still lost 14 points a hand at 300 000 hands). v2 starts some hands from
a contract: each seat's first chance to bid in a hand is, one time in
16, a bid (never a pass), drawn among the legal bids by the softmax of
the network's own values for them at 4 points; from there the hand is
played exactly as any other. About a quarter of hands
(1 − (15/16)^5) start from at least one such bid.

This is Monte Carlo with exploring starts (Sutton & Barto §5.3): the
target of the forced bid is the real payoff of that bid followed by the
current policy, so its value is learnt without bias for the policy, and
the later decisions of the hand (the exchange and the declarer's play,
which v1 rarely saw from sensible contracts) get data. Nothing changes
the rewards: no bonus for declaring, no shaping. It is generic: a "bid"
is any action whose name in the spec starts with `bid `; passing and the
misdeal are not bids. The rate is a guess: high enough that a contract
is tried in a quarter of hands, low enough that most hands are the
network's own bidding. The log reports `exploring_starts_per_hand`.

Not changed, on purpose: the learner's precision (float16 autocast
measured +5–10% on MPS at this size, not worth the risk), the reward
scale (points / 40), the action features and the network's shape.

## Smoke run ([`smoke.toml`](smoke.toml))

The main run's network, rules and exploration, 7 minutes, a 100 000
decision buffer, two curve points with 고수 on 20 deals. On `mighty-3`
at `51e4c55`; manifest [`dmc-v2-smoke`](../../manifests/dmc-v2-smoke.json).
It ran while other sessions loaded the Mac (load average 10, then
20–40).

| stretch | hands/s | decisions/s | learner steps/s | samples/s | replay ratio | learner busy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| load ~10 (first 2.5 min) | 16–19 | 975–1 105 | 2.25–2.32 | 1 150–1 190 | 1.0–1.2 (window) | 97–98% |
| load 20–40 (rest) | 0–7.5 | 0–460 | 1.6–1.8 | 800–940 | 2.0 (cap) | 84–95% |

- About 60 decisions a hand; 0.2–0.4 exploring starts a hand.
- The learner does ~1 170 samples (2.3 steps of 512) a second when the
  Mac is quiet, 900 when it is not; the GPU is at 98%.
- Two actors produce ~1 000 decisions (17 hands) a second on 2.5–3.7
  cores when the Mac is quiet; niced, they starve when other sessions
  load it.
- Fit after 3 000 hands: the share of variance explained, 0.29 bidding,
  0.05 exchange, 0.83–0.85 tricks. The curve went from −48/−47/−53
  (random) to −1.1/−1.3/−2.1 against 초보/보통/고수 (200/200/20 deals:
  wide intervals).
- A curve point took 46 s, nearly all 고수's 20 deals: 300 deals will be
  ~4–7 minutes, during which the learner waits (the actors keep
  playing). At a point every 40 000 hands, under 10% of the run.
- Exported, the smoke network keeps parity with PyTorch (3.1e-6) and
  takes 4.0 ms a decision on one thread (v1's: 1.45 ms).

**Projection for 10 hours.** At a replay ratio of 2 the learner sets the
pace: 1 170 samples/s ÷ 2 ÷ 60 decisions ≈ 9.7 hands/s, so **about
330 000 hands (20M decisions, 42M samples trained)** on a quiet Mac,
less the curve's pauses; about 250 000 if other sessions load it as
during the smoke run. (A replay ratio of 1.2, the actors' natural rate,
would give ~550 000 hands trained on less each; v1 plateaued around
250 000 hands with a network a sixth the size.) The 11-hour budget and
50M-hand cap leave the clock to stop it.

## The hybrid's think time (with the smoke network)

`hybrid:` (`crates/mighty/src/hybrid.rs`) needs a trained network to be
worth measuring for strength; its cost depends only on the network's
size. One seat of 경기과고 among four simple bots, 4 hands, `sim --bots
search`, one thread unless said, the Mac loaded (load average 10–15):

| bot | median | p99 per decision |
| --- | ---: | ---: |
| `hard` (search:200:1:0) | 175 ms | 276 ms |
| `hybrid:D:200` (no settings: 고수 at 200 deals) | 150 ms | 249 ms |
| `hybrid:D:200@prior=4,base=q` | 127 ms | 165 ms |
| `hybrid:D:200@leaf=2` | 4 650 ms | 16 980 ms |
| `hybrid:D:200@leaf=0` | 4 350 ms | 13 570 ms |
| `hybrid:D:50@prior=4,base=q,leaf=1` | 980 ms | 1 500 ms |
| `hybrid:D:200@prior=4,base=q,leaf=2,threads=4` | 1 800 ms | 2 490 ms |

The prior and baseline cost one network call a decision (4 ms) and
save playouts. Leaf values cost a network call per playout, batched 256
at a time: about 2.7 ms a position for this 4.3M network, so 200 deals
× ~8 candidates is seconds. At the table's one-second budget a leaf
search needs fewer deals (50), a prior to cut the candidates, and
threads. (The payoffs in this table are four hands: noise.)

## Before launching

1. The owner's go-ahead, and the Mac to itself overnight (other sessions
   starve the niced actors).
2. Merge to `phase-1-scaffold` and run from a clean checkout (the
   manifest records the commit).
3. `nice -n 10 uv run python -m cardgame_ml.train.dmc --config
   ../research/experiments/2026-10-05-dmc-v2/config.toml`; check the
   first curve point and the first throughput lines.
4. Afterwards: `report` for the curve, `export`, suite v1 (ladder on
   경기과고), and the hybrid (`hybrid:` bot, `crates/mighty/src/hybrid.rs`)
   with the trained network.
