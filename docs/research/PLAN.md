# Learned bots: research plan

Goal: one model that plays Mighty under any rules (기본, the school presets,
custom sets, 3–7 players) better than today's 고수, and the setup to keep
improving it. Nothing reaches the table unless it wins head to head.

This repository is the source of truth for the plan, the eval definitions,
experiment configs and results. Large artifacts (self-play data, model
weights) live outside git; their manifests and hashes live here.

## Where the bot stands (2026-10-04)

Measured with the `lab` and `sim` tools (see `crates/sim`):

| Area | Headroom, points per seat-hand |
|---|---|
| Card play, tricks 1–3 | up to +1.46 ± 0.66 with every hand known; +0.47 ± 0.51 from 10× more samples |
| Last three tricks (exact solver) | +0.04 ± 0.30 |
| Exchange and friend call | +0.06 ± 0.24 |
| Bidding | +0.01 / +0.04 |

The gap is hidden information early in the hand, not search depth. The search
was made 2.5× cheaper with identical decisions; spending that on more samples
did not change strength measurably.

## Principles

- **Rules are input, not code.** The engine supplies legal actions, so a model
  can never play illegally. Each card's meaning under the current rules (point
  card, mighty, joker, joker call, power in this trick, may it lead) comes from
  the engine as features, plus a global rules vector. Training samples rule
  sets from `sim --vary`; some combinations are held out for evaluation only.
- **Game-agnostic plumbing.** The environment sits on `engine::Game`, so a
  second game (poker) reuses it.
- **Evals are fixed, versioned and out of reach of training.** Results are
  only compared within one eval version.

## Components, in order

1. **Evals (v1).** Paired deals, rotated seats, 95% intervals. Layers:
   cheap proxies (belief log-loss, agreement with search), strength against a
   fixed ladder (random, 초보, 보통, 고수) as points per hand and a rating,
   generalisation (presets plus held-out rule sets), cost (median and p99 think
   time on the home server), and regression puzzles (known misplays). One
   command, JSON results, a readable report.
2. **RL environment.** Batched Python bindings over the Rust engine: legal
   action masks, observations from the feature extractor, rules as an
   environment parameter, self-play and opponent pools. Shared with the evals.
3. **Baseline belief model.** Predicts where each unseen card is; used by the
   search to sample deals. First end-to-end run through the evals.
4. **Scaling laws.** Belief log-loss against model size (~0.1M–10M
   parameters), data (1M–100M decisions) and compute, plus spot checks that
   log-loss tracks points per hand. Picks the size that fits the think-time
   budget and says whether data or size is the cheaper next step.
5. **Auto-research loop.** An agent proposes an experiment config, a scheduler
   runs it on the Mac or the home server within a budget, the fixed evals score
   it, and the result and a short write-up are logged here. The loop cannot
   edit the evals or see held-out rule sets; a win must repeat on fresh deals
   before it counts; promotion to production goes through the owner.

Then, as experiments inside the loop: the belief model in search (step 1),
policy and value from search-guided self-play (step 2), search-free bots for
초보 and 보통 (step 3).

## Gates for the belief model in search

- A: better log-loss than uniform sampling, also on held-out rule sets.
- B: beats current 고수 at equal think time on 경기과고 and 기본, aiming at
  +0.3 points per seat-hand, with no loss on held-out rule sets.
- C: p99 think time within the current budget on the home server.

## Compute

- Self-play: the home server (12 cores, low priority beside the live bot
  worker) and the Mac.
- Training: the Mac (Apple M4 Pro, 20-core GPU, 24 GB) with PyTorch on MPS.
- Serving: the bot worker on the home server, CPU only; models exported to
  ONNX and run from Rust.

## Risks

- Bots play unlike people: mix bot styles; real game logs only with a notice
  in the privacy page and the owner's agreement.
- Rare rule options: sample them more; the held-out evals show the gap.
- It may not beat 고수: stop at the failed gate; the evals and environment
  stay useful.
