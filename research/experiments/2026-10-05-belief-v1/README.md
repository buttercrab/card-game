# Belief v1: where the hidden cards are, and dealing by it

**Question (P3).** Can a small model, reading one seat's observation,
say where each card it cannot see is better than the counts alone (gate
A), and does 고수 play better when it deals its sampled worlds by that
model instead of uniformly (gate B), within its think-time budget (gate
C)?

**Plan.**

- Model: a transformer over the `mighty-1` observation (one token for
  the global vector, one per card slot, one per event, events sharing
  the card slots' identity embeddings), 4 layers of width 128, about 0.6M
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
  the Mac (the home server could not be reached; gate C needs a re-check
  there).
