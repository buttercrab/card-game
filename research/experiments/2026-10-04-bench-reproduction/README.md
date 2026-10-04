# Reproducing the 2026-10-04 benchmark from one command

**Question.** P1's exit check: do the 2026-10-04 benchmark's numbers
come back from the eval runner, with one command?

```sh
nice -n 10 target/release/eval run --suite bench-2026-10-04 \
  --bot search:430:1:0 --baseline search:200:1:0
```

The suite ([`research/evals/bench-2026-10-04`](../../evals/bench-2026-10-04))
holds the benchmark's head-to-head runs (the speedup spent on more deals:
`search:430` against `search:200` in one seat, four `search:200` around
it, paired) and its think-time setup. Commit `6e2ed83`, on the Mac shared
with other work: 2 h 54 min.

## Results

Head-to-head, `search:430` over `search:200` per hand, ± 95%:

| Table | Benchmark | This run | |
| --- | --- | --- | --- |
| 경기과고, seed 60000, 1500 deals (home) | +0.266 ± 0.502 | +0.266 ± 0.502 | identical |
| 경기과고, seed 90000, 1000 deals | +0.07 ± 0.66 | +0.07 ± 0.66 | identical |
| **경기과고, pooled** | **+0.19 ± 0.40** | **+0.19 ± 0.40** | identical |
| default, seed 60000, 1000 deals | −0.70 ± 0.59 | −0.70 ± 0.59 | identical |
| default, seed 70000, 1000 deals | +0.54 ± 0.69 | +0.54 ± 0.69 | identical |
| default, seed 80000, 1000 deals (home) | −0.228 ± 0.575 | −0.228 ± 0.575 | identical |
| **default, pooled** | **−0.20 ± 0.35** | **−0.13 ± 0.36** | see below |

Every table reproduces exactly (to the digits the benchmark printed,
three where it kept the raw output): same deals, same decisions. The eval
runner plays a table exactly as `sim --bots search --view-every 0` did.

- **Pooled default:** the benchmark's own three runs average −0.13
  (−0.70, +0.54, −0.23 over 1000 deals each), as here; its report's
  −0.20 was a slip in pooling, not a difference in play. Either way,
  neither preset shows a difference, which was the benchmark's finding.
- **Which rules.** The benchmark's head-to-head runs were made after its
  rebase onto the new first-trick rule (trump may not lead the first
  trick but may follow, `NoLead`), and so is this run; the card-play
  breakdown (`cheat`, `x10`, regret, audit) was made under the old rule
  (`Invalid`) and is not redone here. The benchmark's `default` preset
  was web-mighty's base rules (`Rules::default()`): 기본 became the
  owner's written rules later the same day. The suite names those base
  rules in full; a first run against today's 기본 matched both 경기과고
  tables exactly and gave +0.77 ± 0.58 at seed 60000, where the benchmark
  had −0.70.
- **Two runs agree:** that first run (commit `64be00c`, tables played one
  after another) and this one (`6e2ed83`, tables sharing the workers)
  gave identical 경기과고 tables.
- **Think time** (40 deals of 경기과고, one thread, on the shared Mac at
  load ~80): `search:200` median 95 ms, p99 208 ms; `search:430` 224 /
  433 ms, 2.4× the time for 2.15× the deals. The benchmark measured
  `search:200` on the home server at 163 / 367 ms beside another
  benchmark; the v1 baseline's cost part, on the home server, measured
  the table's 고수 (`search:200` with its seat temper) at 131 / 346 ms
  ([`../2026-10-04-eval-v1-baseline`](../2026-10-04-eval-v1-baseline)).
  Think times depend on the machine and its load; compare them only
  within one run.
- **Not reproduced:** the card-play breakdown (`lab play` with `cheat` and
  `x10` on recorded hands, under the old first-trick rule) and the
  exchange and bidding experiments. They replay recorded hands with the
  lab, not the eval's paired tables, and `x10` alone costs about ten
  times a table of `search:200`; the lab still runs them.
