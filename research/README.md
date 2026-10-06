# Research

Results live beside the code that produced them. [PLAN](../docs/PLAN.md) owns
direction and restart authority; this index owns evidence and outcomes.

## Current status (2026-10-06)

Learned-bot training, scaling and unattended research are paused by the owner.
The environment, evaluation, training/export and loop code exist, but no learned
model has passed the promotion gate. The table's 고수 still uses built-in search.

| Stage | Recorded result | Disposition |
| --- | --- | --- |
| Foundations | Encoding, ML package, parity/provenance conventions | Delivered; current encoding traits are in engine-ml |
| [Evals v1](experiments/2026-10-04-eval-v1-baseline) | Historical hard rating +6.81 ± 0.29; [benchmark reproduction](experiments/2026-10-04-bench-reproduction) | Baseline predates scoring G/later bots; not today's strength |
| [Self-play v1](experiments/2026-10-04-selfplay-v1) | 1.19M decisions from mixed bots/varied rules | Dataset recorded as mighty-1; not directly compatible with mighty-4 |
| [Belief v1](experiments/2026-10-05-belief-v1) | Better hidden-owner log-loss; equal-time preset play +0.02 ± 0.29 | Prediction gate passed; playing-strength gate not established; not promoted |
| [DMC v1](experiments/2026-10-05-dmc-v1) | ~510k hands; −0.40 ± 0.31 vs 초보, −1.38 ± 0.32 vs 보통 | Shakedown, mighty-1, exit not met |
| [DMC v2](experiments/2026-10-05-dmc-v2) | ~119k hands, larger network, 경기과고-only | Stopped and assessed; mighty-3 |
| [RL assessment](experiments/2026-10-06-rl-assessment) | −2.97 ± 0.21 vs assessment 보통; poor contract data and cross-redeal targets | Fix data/targets before more unchanged training |
| [Bot fixes](experiments/2026-10-05-bot-fixes) | Paired rule/policy ablations and discard follow-up | Historical measurements; reproduce removed settings at their recorded commit |
| Scaling / [loop](loop) | Runner/queue/policy implemented | No completed scaling report or qualifying unattended batch recorded |

The v2 assessment's thirty manifest artifacts matched sizes/checksums at the
takeover check. That is provenance verification, not a new experimental rerun.
Intervals and opponents are defined in the linked reports; do not compare
numbers across changed rules, fields or encodings as if they were one ladder.

## Layout

| Folder | Holds |
| --- | --- |
| [evals](evals) | Versioned scoreboards and held-out rule definitions |
| [experiments](experiments) | Config, results and interpretation per experiment |
| [manifests](manifests) | Checksums/provenance for large external artifacts |
| [loop](loop) | Runner, researcher protocol, queue and operating policy |

## Evidence conventions

- Record config, commit, seeds, rule source/encoding, opponents, machine and
  load. A preset name alone does not freeze its rules across revisions.
- Keep large weights, shards and raw synthetic results outside git with
  manifests. No secrets, player data or real player logs in the public tree.
- Exclusion lists may be read to reject held-out rules; those rules must not
  enter training examples. Keep scoreboards independent of the researcher.
- Pair comparisons on the same deals; rotate seats and use fresh-deal
  confirmation. A quick CI eval is a smoke test, not strength evidence.
- Do not infer generalization from training loss, or strong bidding from a
  payoff regression score. Separate phases/roles and use the current opponent.
- Promote only after beating the intended served baseline/time budget, checking
  rule regressions and receiving owner approval.

## Reproducing historical experiments

Use the commit/config/seeds named by the report or manifest in a separate
checkout. Old scripts can name deleted switches, former package paths or Cargo
feature flags that existed then. Keep them as historical recipes; do not alter
the scoreboard or silently rerun them on current main.

Current tool instructions are in [DEVELOPMENT](../docs/DEVELOPMENT.md).
The current encoding is mighty-4; loaders refuse older incompatible weights.
Training/loop command references do not revoke the pause.
