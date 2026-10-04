# Eval bench-2026-10-04: `search:430:1:0`

- Baseline: `search:200:1:0`, in the same seat on the same deals
- Suite `bench-2026-10-04` (SHA-256 `ad26a5d079cd…`), commit `6e2ed835ef6a`
- Machine: the Mac (M4 Pro), shared with other work, Apple M4 Pro (macos aarch64, 14 threads, load 76.3 at the start); 14 worker threads
- Started 2026-10-04T16:49:28Z, took 2 h 54 min
- Reproducible: no bot decides on a clock, so a rerun of this commit plays every deal the same

## Matches

Points per seat-hand of the measured seat, ± 95% interval.

| Table | Rules | Field | Deals | Bot | Baseline | Bot − baseline |
|---|---|---|---|---|---|---|
| gshs, seed 60000 | gshs | `search:200:1:0` | 1500 | +0.84 ± 0.56 | +0.57 ± 0.57 | +0.27 ± 0.50 |
| gshs, seed 90000 | gshs | `search:200:1:0` | 1000 | -0.02 ± 0.66 | -0.09 ± 0.65 | +0.07 ± 0.66 |
| web-mighty base, seed 60000 | 5 players, 53 cards | `search:200:1:0` | 1000 | -0.22 ± 0.60 | +0.48 ± 0.60 | -0.70 ± 0.59 |
| web-mighty base, seed 70000 | 5 players, 53 cards | `search:200:1:0` | 1000 | +0.73 ± 0.74 | +0.19 ± 0.67 | +0.54 ± 0.69 |
| web-mighty base, seed 80000 | 5 players, 53 cards | `search:200:1:0` | 1000 | -0.12 ± 0.59 | +0.10 ± 0.64 | -0.23 ± 0.57 |

## Think time

Per decision with a real choice, one deal at a time on one thread: 40 deals of `gshs` against `search:200:1:0`.

| Bot | Decisions | Median | p90 | p99 | Max |
|---|---|---|---|---|---|
| `search:430:1:0` | 397 | 223.9 ms | 360 ms | 433 ms | 465 ms |
| `search:200:1:0` | 395 | 95.1 ms | 160 ms | 208 ms | 213 ms |

