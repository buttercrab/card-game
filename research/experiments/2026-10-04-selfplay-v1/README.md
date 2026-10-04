# Self-play v1

The first training data, and P2's exit check: at least a million
decisions by bots of every level over varied rules, none of them
held out, with a committed manifest.

**Plan.** [`config.toml`](config.toml): 20 000 games of `varied` rules
(every preset's optional rules drawn afresh, 3 to 7 players), each seat
drawing its bot by weight: 고수 at 50 samples (3), 고수 as served at 200
samples without its time limit (1), 보통 (3), 초보 (2), random (1).
Excluded: `research/evals/v1/heldout-rules.json`. Generated on the Mac at
`nice -n 10` with the `selfplay` binary; the manifest is
[`../../manifests/selfplay-v1.json`](../../manifests/selfplay-v1.json),
the run's statistics [`results/stats.json`](results/stats.json).

**Run.** Commit `2e9e67a`, 2026-10-04, 14 threads at `nice -n 10`,
while the P1 eval runs kept about 13 of the Mac's 14 cores busy.

| | |
| --- | --- |
| Decisions | 1 191 665 in 20 000 games (59.6 a game) |
| Time | 5 111 s: 233 decisions/s, nearly all of it 고수 searching |
| On disk | 633 MB in 6 shards of about 106 MB (200 000 decisions each, the last 191 499), 532 bytes a decision; `meta.json` 24 KB, `rules.jsonl.gz` 1.5 MB |
| Loaded | about 4 GB a shard; one loads in 2.5 s |
| Rule sets | 19 999 distinct, 3 to 7 players: 3 948 / 3 898 / 4 070 / 3 969 / 4 115 games |
| Held out | 40 rule sets (`heldout-rules.json` with SHA-256 `a80da476…`, recorded in `meta.json`); none played |

Decisions by bot:

| Bot | Decisions | Share |
| --- | ---: | ---: |
| `hard:50` (고수, 50 samples) | 348 044 | 29.2% |
| `hard` (고수, 200 samples) | 114 312 | 9.6% |
| `보통` | 348 956 | 29.3% |
| `초보` | 232 000 | 19.5% |
| `random` | 148 353 | 12.4% |

The shares follow the weights (30/10/30/20/10%), except that random
seats make more decisions a hand than the others.

**Checks.** `Manifest.verify` passes against the store; reading the
rule sets back, none is in the held-out list. The held-out list came
from the P1 branch before it was committed; if it changes, check the
dataset against the new one (`Dataset.rules()` against the list).

**Use.** `cardgame_ml.data.shards.Dataset.open(store / "selfplay/selfplay-v1")`.
Regenerating from the commit and config gives the same bytes.

## Throughput on an idle Mac (2026-10-05)

Re-measured with the Mac otherwise idle (load ~3), random play, 4096 envs,
varied rules, 15 s per setting:

| Driver | Hands/s | Decisions/s |
|---|---|---|
| Python (`cardgame_env`), all threads | 5,846 | 329,946 |
| Python, one thread | 1,113 | 68,459 |
| Rust `--example throughput`, 1024 envs | 7,565 | 482,192 |

Encoding takes 10.7 µs an observation on one thread. P2's exit target,
thousands of games per second from Python, is met.
