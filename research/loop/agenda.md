# Research agenda

What the loop tries, in order of expected value per hour of compute. The
researcher reads this before every batch, queues from **Now**, moves items
as results come in and says why; people edit it too. Items marked
**needs code** cannot be queued: the researcher files them in
[`requests.md`](requests.md) and a person implements the method runner.
The researcher works in a sandbox (README, *The researcher*): it reads
only `research/` and `docs/` (never `research/evals/`), writes only its
specs, new configs, this agenda, the requests and runs' notes, has no
shell, and stops for the day at the policy's spend cap.

The goal (PLAN, P3b–P5): a self-play agent that beats 보통 on suite v1,
then 고수, alone or inside the search; and the scaling picture that says
where the next hour of compute goes.

## Learnt

Newest first: one short dated entry each, with the runs behind it (links
to their `summary.md`). A finding counts once its runs are confirmed on
fresh deals, or it is a clear loss.

Nothing yet: the first batch waits for DMC v1 (P3b).

## Now (runnable)

The seeded queue covers the first round of each; extend from results.

0. **고수's think time** (owner, 2026-10-05; `search-tuning`,
   `think-time-gshs` and `think-time-default`): about 2.4 s of search a
   decision against about 1.3 s, deal by deal on 경기과고 and 기본,
   ±0.3 pooled. Clock-bound, so not bit-reproducible; it decides whether
   the table's pace for 고수 goes up. Not confirmed by the runner (its
   suites are not the scoreboard): repeat on new seeds by hand if close.
1. **Score DMC v1 (P3b) on the full protocol** (`eval-only`,
   `dmc-v1-score`): the parent every DMC variant is compared with. Waits
   for P3b's export (`models/dmc-v1/model.onnx`).
2. **DMC exploration** (ablation): uniform ε only (DouZero's) against
   v1's softmax + runner-up; then ε and temperature on a grid once the
   direction is known. P3b found exploration decides whether the agent
   bids at all, so this is first.
3. **DMC learning rate** (hparam): 1e-3 and 1e-4 against 3e-4; then
   halve towards the better side.
4. **DMC size** (scaling): width 64 / 128 (v1) / 256 at a fixed 5.25 h;
   then the same sizes at 2× hours to separate size from hands. Fit
   rating against log hands and parameters once there are 6+ points.
5. **DMC data use** (hparam): batch 2048; replay ratio 1 against 2; then
   actors (processes 3/5/7) to see whether actors or learner limit v1.
6. **Rules ablation**: 경기과고 only against varied rules (cost of one
   model for every rule set, on presets and held-out rules).
7. **Reward scaling** (ablation): points/80 against points/40.
8. **Search settings** (`search-tuning`, home server, CPU only):
   samples 400 against 200, endgame 3, reading off. Cheap and they
   size what better beliefs or policies can add to 고수.
9. **Search-free levels** (`eval-only`): DMC v1 at temperatures (2, 5,
   10 points) against 초보/보통 on the ladder, for the table's levels.
10. **Belief v2** (`belief`, GPU): only after DMC's first round, and only
    with a dataset that exists (self-play v2 was cut short): low value
    now (P3 gate B failed at equal time).

## Next (needs code)

Ranked by expected value; each is a request in `requests.md` when the
researcher wants it.

1. **DMC history ablation** (needs code: a config switch to cut the
   event sequence to the last N events or none). Tests how much of the
   network's play reads the hand's history.
2. **No per-card rule meanings** (needs code: an encoder flag masking the
   per-card meaning features). Tests "rules are input": does the model
   lean on the engine's card meanings?
3. **Oracle critic / perfect-information guidance** (needs code: a
   value head fed the hidden hands during training only, à la
   PerfectDou/Suphx). Expected to speed learning markedly.
4. **PPO / actor-critic with legal-action masking** (needs code: a
   policy head and an on-policy learner on the same trunk). The standard
   alternative to DMC; compare at equal hands.
5. **Hybrids with the PIMC search** (needs code: a `search` setting that
   plays playouts by a Q network, `@policy=dmc:<model>`): RL as the
   playout policy; then Q-guided candidate pruning (search only the top-k
   actions by Q); then belief model + RL inside the search.
6. **AlphaZero-style ISMCTS** with the RL network as prior and value
   (needs code; PLAN "Later"). Largest expected gain, largest cost.
7. **Checkpoint league** (needs code: actors playing against older
   snapshots sometimes) against pure self-play.

## Pruned

Nothing yet. Each entry: what, when, which runs showed it, why stopped.

## How to choose

- One change against the parent per run; replicate before building on a
  surprise (the runner confirms wins on fresh deals by itself).
- Cheap first: search settings and eval-only runs use the home server
  while the GPU trains.
- Two clear losses in a direction prune it; note it under Pruned.
- Scaling runs vary one of parameters, hands or hours over at least three
  points, the rest fixed.
