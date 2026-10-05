# Why the learned bot is weaker than the hand-written ones (dmc-v2 assessment)

**Question.** dmc-v2 (4.3M parameters, 경기과고 at five, `mighty-3`,
scoring G, exploring starts for the bidding) was stopped at ~119 000
hands to "assess first". It sat at about −1.9 a hand against four 보통
and −2.5 to −3.6 against four 고수 on its learning curve, and its
bidding values explained only ~8% of the payoff's variance. Where
exactly are the points lost, is the bidding really the problem, and
what should come next?

**Answer in one paragraph.** The bidding is the visible symptom, not
the cause. Against today's 보통 the network loses **−2.97 ± 0.21** a
hand; only **−1.05** of that is its bidding (it almost never declares),
and that passing is *rational* for it: given 보통's own contracts, the
network's exchange loses **−15 points per declared hand** and its
declarer play another **−7**, so declaring would cost it more than
passing does. Its card play as friend and defender also trails 보통 by
about **−1.5 a hand**. The cause is the self-play data: in training,
**98% of contracts come from exploration** (mostly `nt13`, the
network's favourite bid whatever the hand, played by the 3% runner-up
rule and by exploring starts), and the declarer then loses **−22 points on average**,
so the network learns that declaring loses, almost never sees a
sensible trump contract from the declarer's seat, and never learns the
exchange or the declarer's play. The "8% explained" figure is mostly an
artifact: **70% of training bidding decisions sit in deals that are
later thrown in** (everyone passes or a misdeal) and are labelled with
the payoff of a *different* deal. On played deals the network explains
25%, more than 고수's own search value does (12%) on 보통's games;
bidding-time payoff is mostly noise for every predictor. Recommendation:
do not continue DMC as it is; fix the redeal labelling (cheap), and make
the declarer side learnable by starting training hands from contracts
chosen by **lookahead with the network's own play** (the owner's "bid by
simulating the rounds"), then bid at play time by the same lookahead
(PIMC over the learned policy and values, the friend call part of the
plan) rather than by one value-head reading.

## Method

All on 경기과고 at five players, the current code (`mighty-3`, scoring G)
and the bots as merged after the bot fixes. Models exported from
`~/card-game-artifacts/models/dmc-v2/` (never modified) into
`~/card-game-artifacts/assess-2026-10-06/`: the final weights
(`checkpoint.pt`'s model at 118 958 hands) and the 40 001 and 80 021
hand snapshots, by `cardgame_ml.export --weights … --out …`; the Rust
side loads them as `dmc:` bots (parity with PyTorch 3.3e-6, 3.9 ms a
decision on one thread). [`scripts/export.sh`](scripts/export.sh).

Code added (small, in `crates/sim`):

- **`phased:BID+EXCHANGE+PLAY`** ([`crates/sim/src/phased.rs`](../../../crates/sim/src/phased.rs)):
  one bot spec per phase of the hand (bidding with the misdeal call;
  the declarer's trump change, discards and friend call; the card
  play), e.g. `phased:normal+dmc:DIR+dmc:DIR`. A four-line hook in
  `spec.rs`. Tested: `phased:normal+normal+normal` plays exactly as
  `normal`.
- **`lab declare`** now also records the friend and the focus seat's
  misdeal calls (`DeclareResult.friend`, `.misdeals`), so points can be
  split by role.
- **`lab bid-signal`** ([`crates/sim/src/signal.rs`](../../../crates/sim/src/signal.rs)):
  every bidding decision of hands played by one bot in every seat, with
  the seat's payoff and three predictors: the simple bot's reading of
  the hand (its `estimate` in its best trump, what the cheapest bid
  there `needed`s, where the bidding stands), a Q network's values, and
  고수's search value (100 deals the seat cannot tell from the real one,
  each action played out by simple bots; the same machinery as
  `search:200`) for the action taken, for passing and for the simple
  bot's cheapest bid.

Experiments:

1. **Behaviour and ablations against four 보통**: `lab declare`, the
   variant in one seat (rotating; `deal / 5 mod 5`), 보통 in the other
   four, **10 000 deals**, every variant on the same deals with the same
   per-seat, per-phase random streams, so differences are paired deal by
   deal. [`scripts/batch1.sh`](scripts/batch1.sh).
2. **Against four 고수**: the same on 1 000 deals (four searching seats
   are slow). [`scripts/batch3.sh`](scripts/batch3.sh).
3. **The exchange alone**: 3 000 hands played by five 보통 (`lab gen`),
   the declarer's exchange replayed by the network, by its discards with
   보통's call, and by 보통's discards with its call, then 보통 everywhere
   (`lab exchange`). [`scripts/exch.sh`](scripts/exch.sh).
4. **Bidding-time signal**: `lab bid-signal` on 4 000 hands of five 보통
   (search on every decision), and 300 hands of five networks at 2
   points' temperature (search on every third). [`scripts/signal.sh`](scripts/signal.sh).
5. **The training data**: dmc-v2's actor loop replayed with the final
   weights and the run's exploration (softmax at 2 points, 3%
   runner-up, 1% uniform, exploring starts 1/16 at 4 points), 1 502
   self-play hands, every decision with its Monte Carlo target
   ([`scripts/replicate.py`](scripts/replicate.py)).

Raw results: one JSON line per hand or decision in
`~/card-game-artifacts/assess-2026-10-06/results/` (too large for the
repo; checksums in [`../../manifests/rl-assessment-2026-10-06.json`](../../manifests/rl-assessment-2026-10-06.json)); the tables below, regenerated by `scripts/analyze_*.py`, are in
[`results/`](results). ± is a 95% interval; "paired" is the mean
difference to 보통 in the same seat on the same deal.

## 1. Where the −3 a hand comes from (against four 보통)

10 000 paired deals each; "B / E / P" is who bids, exchanges and plays
in the focus seat (N = 보통, Q = the network, H = 고수's search);
[`results/normal.md`](results/normal.md) has every table (by role,
contracts, role transitions).

| Focus seat (B / E / P) | Points per hand | Paired vs 보통 | Declares | Made | Declarer payoff |
| --- | --- | --- | ---: | ---: | --- |
| N / N / N (보통) | +0.04 ± 0.22 | – | 20.0% | 70.4% | +5.42 ± 0.74 |
| **Q / Q / Q (the network)** | −2.93 ± 0.16 | **−2.97 ± 0.21** | 0.3% | 47% (30 hands) | +0.8 ± 7.5 |
| Q / N / N | −1.01 ± 0.17 | **−1.05 ± 0.18** | 0.3% | 57% | +2.1 ± 6.0 |
| Q / Q / N | −0.98 ± 0.17 | −1.02 ± 0.18 | 0.3% | 77% | +12.7 ± 6.1 |
| N / N / Q | −2.81 ± 0.22 | **−2.85 ± 0.20** | 20.0% | 54.4% | −1.46 ± 0.81 |
| N / Q / N | −2.76 ± 0.25 | **−2.80 ± 0.22** | 20.0% | 40.6% | −8.58 ± 0.94 |
| N / Q / Q | −5.44 ± 0.26 | −5.48 ± 0.29 | 20.0% | 31.7% | −14.62 ± 0.99 |
| H / Q / Q | −5.49 ± 0.26 | −5.53 ± 0.30 | 21.1% | 31.2% | −14.54 ± 0.95 |
| H / N / N | +0.28 ± 0.22 | **+0.24 ± 0.12** | 21.1% | 70.6% | +5.61 ± 0.71 |
| Q / Q / Q at 40 001 hands | −2.63 ± 0.17 | −2.67 ± 0.22 | 0.4% | 42% | −5.2 ± 6.7 |
| Q / Q / Q at 80 021 hands | −2.50 ± 0.18 | −2.53 ± 0.22 | 1.8% | 47% | −4.9 ± 3.9 |

By role (share of hands · mean points · contribution to points per
hand):

| Focus seat | declarer | alone | friend | defender |
| --- | --- | --- | --- | --- |
| 보통 | 20.0% · +5.4 · +1.07 | 0.0% | 20.8% · +2.6 · +0.55 | 59.2% · −2.7 · −1.59 |
| the network | 0.3% · +0.8 · +0.00 | – | 30.5% · −0.4 · −0.12 | 69.2% · −4.1 · −2.81 |
| N / Q / Q | 19.7% · −14.0 · −2.76 | 0.3% · −51.1 · −0.16 | 20.8% · −0.5 · −0.11 | 59.2% · −4.1 · −2.41 |

The network's −2.97, by the role 보통 had on the same deal and the one
the network ended in (hands per 1 000 · mean paired difference ·
contribution):

| 보통 was \ the network was | declarer | friend | defender |
| --- | --- | --- | --- |
| declarer (200) | 3 · −7.1 · −0.02 | 89 · −7.2 · **−0.64** | 108 · −7.7 · **−0.83** |
| friend (208) | – | 198 · −2.8 · **−0.56** | 10 · −6.8 · −0.07 |
| defender (593) | – | 18 · +0.4 · +0.01 | 575 · −1.5 · **−0.85** |

So about half the loss (−1.5) is in the 20% of hands where 보통 would
have declared and the network passes, and half (−1.4) is worse card
play as friend and defender in the hands where both had the same role.

Reading the rows:

- **The network alone (`dmc`) loses −2.97 ± 0.21** against today's 보통
  (the learning curve said −1.9 against the 보통 of before the bot fixes,
  on its own 2 000 deals; the same snapshots score 0.6–0.8 lower here
  against today's 보통). It
  declares in 0.3% of hands (보통: 20%) and calls a misdeal 0.04 times a
  hand (보통 0.11).
- **Its bidding costs −1.05 ± 0.18** (network bidding, 보통 exchange and
  play). All of it is hands 보통 would have declared: −0.66 from hands
  it then defends, −0.33 from hands it ends up friend.
- **Its card play costs −2.85 ± 0.20** given 보통's bidding and exchange:
  −1.37 as declarer (makes 54% of 보통's contracts against 보통's 70%;
  −6.9 per declared hand), −0.66 as friend (−3.2 per hand), −0.82 as a
  defender (−1.4 per hand).
- **Its exchange costs −2.80 ± 0.22** with 보통 bidding and playing
  (−14 per declared hand; 41% made). With its own exchange *and* play
  the declarer makes 32% and loses −14.6 a declared hand: **−5.48 a hand
  if it bid like 보통**. Passing is the right choice for this network.
- **The snapshots go backwards.** Against today's 보통 the 40 001-hand
  snapshot scores −2.63 ± 0.17 and the 80 021-hand one −2.50 ± 0.18;
  paired with the final weights on the same deals they are **+0.30 ±
  0.14** and **+0.43 ± 0.15** better ([`results/snapshots.md`](results/snapshots.md)).
  The last 40 000 hands made the network worse.

### The exchange alone

Hands 보통 bid, the declarer's exchange swapped, 보통 playing every seat
afterwards ([`results/exchange.md`](results/exchange.md)):

| Exchange | Declarer payoff | Paired vs 보통's exchange | Made |
| --- | --- | --- | ---: |
| 보통 (recorded) | +5.90 ± 0.59 | – | 72% |
| network (discards, trump change, call) | −9.12 ± 0.75 | **−15.02 ± 0.80** | 39% |
| network's discards, 보통's call | −3.93 ± 0.68 | −9.84 ± 0.63 | 49% |
| 보통's discards, network's call | +0.86 ± 0.67 | −5.04 ± 0.61 | 61% |

Both halves are bad: the discards cost about 10 points a declared hand
and the friend call 5. The network never calls a joker as its friend
(보통 does in 30% of hands: the strongest cards it lacks) and spreads
its calls over side aces and kings.

## 2. Against four 고수

1 000 paired deals (the last row was stopped at 511 to finish the
assessment: **partial**); [`results/hard.md`](results/hard.md).

| Focus seat (B / E / P) | Deals | Points per hand | Paired vs 보통 | Declares | Made |
| --- | ---: | --- | --- | ---: | ---: |
| N / N / N (보통) | 1 000 | −2.34 ± 0.71 | – | 18.9% | 58.7% |
| Q / Q / Q (the network) | 1 000 | −3.78 ± 0.51 | **−1.44 ± 0.76** | 0.6% | 50% (6 hands) |
| N / N / Q | 1 000 | −4.31 ± 0.71 | **−1.97 ± 0.64** | 18.9% | 47.6% |
| N / Q / Q (partial) | 511 | −6.63 ± 1.24 | −4.76 ± 1.40 | 18.2% | 30.1% |

Same picture as against 보통, smaller in size for the bidding: against 고수
보통's declarations pay little (+2.0 a declared hand, 59% made), so never
declaring costs less. The network's card play costs about −2 a hand
here too (declarer −0.9 a hand, friend −0.3, defender −0.3 to −0.7),
and its exchange and play together make 30% of 보통's contracts.

## 3. Bidding by lookahead (the owner's way) against bidding by a heuristic

The owner's description of how a strong player bids: simulate the
rounds, which tricks I win and lose, whether the friend I will call can
cover the losers. That is what 고수's bidding does mechanically (deal the
unseen cards many ways, play each candidate bid out, keep the best),
with 보통's play in the playouts.

From the table in section 1 (10 000 paired deals):

| Bidding | Exchange and play | Paired vs 보통 throughout |
| --- | --- | --- |
| 보통 (one-shot estimate of the hand) | 보통 | – |
| **고수 (lookahead, playouts by 보통)** | 보통 | **+0.24 ± 0.12** |
| 보통 | the network | −5.48 ± 0.29 |
| 고수 (lookahead, playouts by 보통) | the network | −5.53 ± 0.30 |
| the network (one value reading) | the network | −2.97 ± 0.21 |

- **Lookahead bidding beats the heuristic when the playouts are the
  play that follows**: 고수's bidding with 보통's exchange and play gains
  +0.24 ± 0.12 a hand over 보통's own bidding (it declares a little
  more, 21.1% against 20.0%, and keeps the make rate, 70.6%).
- **It is worthless when they are not**: the same lookahead with the
  network executing the exchange and play is as bad as bidding like
  보통 (−5.53): the search assumed 보통's exchange and declarer play
  (+5.6 a declared hand) and got the network's (−14.5). A lookahead is
  only as good as its model of the play; for a learned bot that model
  has to be its own policy.
- This is the owner's way of bidding ("simulate the rounds: which I
  win, which I lose, whether the friend covers"), and it is what a
  single value head at the bidding decision is asked to compress into
  one reading of ten cards. That head *can* rank hands (section 4) but
  must learn the level from single returns with an SD of ~23 points, of
  a play policy that keeps changing; a lookahead averages many deals at
  decision time with the current play and puts the friend call in the
  plan.

## 4. How much of the payoff can be told at bidding time

R² of the seat's payoff for the hand at each bidding decision; "fit" is
calibrated by least squares out of fold (5 folds by hand). Five 보통
(30 193 decisions, 4 000 hands; [`results/signal.md`](results/signal.md)):

| Decisions | n | SD | network Q (fit) | simple bot's reading (fit) | 고수's search value (raw) | all three (fit) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| all (as DMC labels them) | 30 193 | 11.2 | 0.016 | 0.048 | 0.075 | 0.075 |
| in the deal that was played | 21 606 | 11.2 | 0.023 | 0.083 | 0.121 | 0.122 |
| … bids | 5 606 | 15.7 | −0.001 | 0.059 | 0.077 | 0.080 |
| … passes | 16 000 | 8.7 | 0.011 | 0.017 | 0.081 | 0.082 |

And in the network's own training data (experiment 5, 1 502 hands,
26 000 bidding decisions):

| Bidding decisions | R² of Q(chosen) |
| --- | ---: |
| all (the learner's "explained", 0.08 in the log) | 0.069 |
| in deals later thrown in (70% of them) | −0.006 |
| in the deal that was played | **0.247** |
| all, target 0 for a thrown-in deal | 0.231 |

- **Little of a hand's payoff is knowable at bidding time, for anyone.**
  Even 고수's search value (100 sampled deals, played out with the very
  policy that then plays the hand) explains 12% on played deals of
  보통's games; the simple bot's reading 8%. The rest is the unseen
  cards and the play.
- **The network's 0.08 is not a learning failure.** 70% of the bidding
  decisions it trains on lie in deals that are thrown in (everyone
  passes, or a misdeal); the hand goes on with new cards and those
  decisions are labelled with the next deal's payoff, which nothing at
  the decision can predict (R² −0.006). On the played deal its values
  explain 25%, more than the search manages on 보통's games (its own
  contracts are wilder, so more predictable). In the network's own games
  the search, whose playouts are 보통's, explains less than the network
  (0.015 against 0.095, 486 searched decisions).
- **What is wrong is the level, not the ranking.** Where both a bid and
  a pass were legal, the network values its best bid **21–23 points
  below passing** on average and above passing in 0.2–0.8% of
  decisions; the search values 보통's cheapest bid above passing in
  28–29% (by more than 3 points in 13–15%). The two margins correlate
  0.47 on 보통's games and 0.78 on the network's: it orders hands much
  as the search does, but believes declaring costs about 20 points. For
  its own exchange and declarer play that belief is roughly right
  (section 1: −14.6 a declared hand against 보통's +5.4).

## 5. The training: what the network learnt bidding from

From the replay of the actors (experiment 5) and the run's log:

- **Bidding decisions are 17 a hand** (24% of decisions; the log says
  16–18 throughout), of which 70% are in deals later thrown in: the
  network passes nearly every hand, five passes and the first bidder's
  last chance redeal, about 2.3 deals a hand.
- **Every hand ends with a contract, but 98% of them come from
  exploration** (1 477 of 1 502): forced bids from exploring starts
  (22%) and the runner-up/uniform picks (the rest). Those declarers lose
  **−22.0 a hand** (forced −29.7). The 25 hands won by a greedy bid paid
  the declarer +6.5.
- **The contracts are no-trump**: `nt13` 881 times, `nt14` 184, `nt15`
  85, `nt16` 43; the commonest trump contract (`♠14`) 27 times. The
  runner-up action at a bidding decision is the network's favourite
  bid, the same whatever the hand (dmc-v1 showed the same with `♦14`),
  and exploring starts draw among the bids by the network's own values,
  which favour the same few. So the declarer-side data (exchange,
  declarer play) is almost all no-trump contracts on unselected hands,
  and the trump-contract exchange 보통 needs is barely in the data:
  hence −15 a declared hand there.
- **The trap is self-reinforcing.** Declarers lose → bids are valued
  ~20 points below passing → the greedy policy never bids → contracts
  only come from exploration on random hands → declarers lose. Exploring
  starts made declarer data exist (0.3 a hand) but not *good* declarer
  data: a bid forced on a random hand with a near-random contract mostly
  should lose, and that is what Monte Carlo learns from it.

Checks of the training for bugs (`ml/src/cardgame_ml/train/dmc/`):

| Check | Finding |
| --- | --- |
| Target per decision: payoff × scale | Correct: `rewards[seat]` by the acting seat's absolute index; friend and defenders get their own payoffs from the env. |
| Redeals | **Design flaw.** A hand runs through redeals (`env` ends an episode only at `Turn::Over`), so decisions of a thrown-in deal get the next deal's payoff: unbiased (a fresh deal is worth ~0: mean +0.04) but pure noise for 70% of bidding rows. The search treats a redeal as 0 (`search::finish`); the learner should too, or end the episode there. |
| Passes in the buffer | 87% of bidding rows are passes, 5% misdeals, 7.5% bids; bidding is 24% of all rows. Not dominating the buffer, but the useful rows (bids in played deals) are ~1 a hand. |
| Exploring starts | Apply to the network's own seats (all seats are the network), recorded as the action taken and trained on like any other; `seen` is cleared only when the hand ends, so after a redeal no seat gets another start. Contract choice by the network's own bid values at 4 points: concentrates on its favourites. |
| Temperature, ε, runner-up | With bids ~20 points below passing the softmax at 2 points never bids; the 3% runner-up and 1% uniform produce nearly all contracts (uniform: absurd ones). The declarer's later play also explores (~4% of decisions each), a further cost on the declaring side. |
| Bid encoding | Distinguishable: 120 bid actions (`bid ♠1`…`bid nt30`), a template per trump (`bid ♠#`) and the count scaled by 1/30, plus an index embedding; no card named, so the link to the hand's suits goes through the action's attention over the card tokens. Adequate, not the bottleneck. |
| Features at bidding | The hand (card tokens), the rules, the bids so far (events), the redeal count and reason, the best bid: enough to judge a hand. |
| Friend / joker call / no friend | The friend call is poorly learnt (section 1); in self-play only 17% of calls name the mighty (♠A) and many name low cards (`call ♣2`, `call ♦3`) or seats. |

## 6. What has worked elsewhere

- **DouZero** (Zha et al., ICML 2021) learnt DouDizhu's card play by
  exactly this DMC but did **not** learn the bidding with it: the paper
  plays the card phase with the landlord given, its released bidding
  model is supervised, and it names bringing bidding into the RL loop
  as future work. Follow-ups add a separate bidding model (DouRN,
  2023–24: an MLP on the own hand and the bids so far) or change the
  learner (oracle guiding and adaptive DMC, IJCAI 2024; PerfectDou,
  2022, perfect-information training of the critic).
- **Bridge bidding**: the RL bidders (Rong, Qin & An, AAMAS 2019;
  Gong et al. 2019; Tian et al.'s joint policy search, NeurIPS 2020)
  never learn bidding from the play's raw return: the reward of a
  contract is the **double-dummy result** of the deal, a low-variance
  oracle that is separate from the play policy. Later work adds belief
  Monte Carlo search at bidding time (IEEE/CAA JAS 2024).
- **Skat**: bidding by learned estimators of the declarer's win chance
  over **many open-hand (double-dummy) solutions of sampled deals**
  (Kupferschmid & Helmert; Keller & Kupferschmid's k-NN), and the
  Buro group's PIMC with learned inference and policies (Rebstock et
  al. 2019): search for bidding and play, networks for priors and
  belief.
- **Suphx** (Mahjong, 2020): oracle guiding, global reward prediction
  (a separate model for the round's final reward, to cut its variance),
  run-time policy adaptation by search.
- **ReBeL, Student of Games** (2020, 2023): search at every decision,
  over public belief states, with learned values; strong but costly to
  build and to run, and for five players with a hidden friend the
  theory (two-player zero-sum) does not carry over.
- **PIMC + learned values** (the hybrid already in `hybrid.rs`; Skat
  and bridge engines): determinize the unseen cards, evaluate each
  candidate with a learned value or policy rollout. Known weaknesses
  (strategy fusion, no information-hiding) matter less at the bidding,
  where the decision is "can I make this", than in the card play.

What fits Mighty on a CPU and one Mac GPU: a **separate bidding model
trained on low-variance, search-derived targets** (bridge and Skat do
this with double-dummy results; here: the average over many deals of
the network's own play), and **search at bidding time** with the
learned play as the playout policy (Skat engines, the owner's way). Full
ReBeL/SoG is out of budget.

## Findings

1. Against today's 보통 the network loses −2.97 ± 0.21 a hand. Bidding
   −1.05; card play −2.85 given 보통's contracts (declarer −1.37, friend
   −0.66, defender −0.82); exchange −2.80 (−15 a declared hand).
2. The network's passing is consistent with its own declarer skill.
   Bidding like 보통 with its exchange and play would cost −5.48 a hand.
3. Self-play trap: 98% of training contracts come from exploration,
   mostly `nt13`, and lose −22; the declarer side (trump contracts,
   exchange, friend call) is barely learnt.
4. The 0.08 bidding R² is an artifact of labelling thrown-in deals with
   the next deal's payoff (70% of bidding rows). Played-deal R² is 0.25;
   고수's search explains 0.12 on 보통's games. Bidding-time payoff is
   mostly noise for every predictor; what matters is the bid-vs-pass
   margin, which the network ranks sensibly (correlation 0.47–0.78 with
   the search) but sets ~20 points too low for a good declarer.
5. No progress after 40 000 hands against today's 보통; the final
   weights are worse than the 80 000-hand snapshot (−0.43 ± 0.15).
6. Lookahead bidding (고수's) with 보통's play gains +0.24 ± 0.12 over
   보통's one-shot bidding; with the network's play it gains nothing
   (−5.53, as bad as 보통's bids). Bidding by lookahead works when the
   lookahead plays the hand the way it will actually be played.

## Recommendations, by expected value for cost

1. **Stop dmc-v2 as configured; do not just train longer.** It has not
   improved against today's 보통 since 40 000 hands (the final weights
   are worse than the 80 000-hand snapshot), and nothing in the loop
   breaks the trap (finding 3). (Cost: none.)
2. **Fix the redeal labelling** (hours, `ml/` only): label decisions of a
   thrown-in deal 0, or end the learner's episode at a redeal. Removes
   70% of the bidding rows' noise; cheap, but it does not by itself fix
   the trap. Also clear exploring starts' `seen` at a redeal.
3. **Make the declarer side learnable — exploring starts from good
   contracts** (days; the core change). Start a share of training hands
   at the exchange, with the contract and the declarer chosen by a
   **lookahead with the network's own play**: for each seat's hand, deal
   the unseen cards N ways, value each plausible contract by the
   network's own values after the exchange (or a short rollout of its
   policy), give the contract to the seat whose best is highest. The
   network then plays declarer in the contracts a good bidder would
   declare, and learns the exchange and trump play there. Everything
   still comes from the network itself: no hand-written bot, no
   imitation. (Using 고수's search with simple-bot playouts to pick those
   contracts instead would be cheaper to build and probably stronger at
   first, but it puts a hand-written bot inside the training data: **a
   question for the owner**, as is using it as a teacher anywhere.)
4. **Bid by lookahead at play time** (days, after 3): the bidding (and
   the friend call) decided by PIMC over the learned play — the owner's
   "simulate the rounds": sample the unseen cards, for each candidate
   contract (and friend call) play the hand out with the network's
   policy or value it after a few tricks, keep the best. `hybrid.rs`
   already does this with `leaf=K`; restricted to the bidding and
   exchange (`phased:hybrid:…+hybrid:…+dmc:…`) it costs ~0.3–1 s a
   bidding decision. A single value head at the bidding decision has
   to compress that lookahead into one reading of 10 cards and learn it
   from returns with an SD of ~23 points of which at most ~10–25% is
   predictable: thousands of samples per kind of hand, against a play
   policy that keeps changing. The lookahead does the averaging at
   decision time, with the current play, and makes the friend call part
   of the plan. Section 3 is the evidence both ways: lookahead with the
   matching play gains (+0.24), lookahead with a mismatched play is
   ruinous (−5.53), so the playouts must be the network's own.
5. **A separate bidding model trained on search-derived targets**
   (days, alternative to 4 at the table): regress the bid-vs-pass value
   onto the lookahead's averages (many deals per decision) instead of
   single returns, as bridge (double-dummy) and Skat bidders do. Fast at
   play time, keeps the search out of the table's think-time. Same
   owner question as in 3 if the search uses a hand-written bot.
6. **Card play** (ongoing): even with 보통's contracts its play loses
   −2.85 a hand, so the play needs work too: lower exploration late in
   training (temperature and runner-up anneal), more declarer data (3
   does that), and search at play (`hybrid` with `prior`/`base=q`) once
   the values are better.
7. Not recommended now: a bigger network or more of the same data
   (v1 → v2 added capacity and gained nothing against 보통), full
   ReBeL/Student of Games (budget), per-phase heads alone (the data is
   the problem, not the capacity).

Reproduce: build `cargo build --release -p sim --features dmc`, then
the scripts in [`scripts/`](scripts) in order (export, batch1, exch,
signal, batch3, `replicate.py` from `ml/` with `uv run`), then
`analyze_declare.py`, `analyze_exchange.py`, `analyze_signal.py`.
Total compute ~2 hours of a shared Mac at nice 10, 3–8 threads.
