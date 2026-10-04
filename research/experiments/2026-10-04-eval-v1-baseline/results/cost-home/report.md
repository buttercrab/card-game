# Eval v1: `hard`

- Suite `v1` (SHA-256 `dd53cdf85cb7…`), commit `2a6095a1f5e2`
- Machine: home server, beside the live bot worker, AMD Ryzen 5 5600X 6-Core Processor (linux x86_64, 12 threads, load 3.1 at the start); 12 worker threads
- Started 2026-10-04T15:03:37Z, took 4 min 34 s
- Reproducible: no bot decides on a clock, so a rerun of this commit plays every deal the same

## Think time

Per decision with a real choice, one deal at a time on one thread: 40 deals of `gshs` against `hard`.

| Bot | Decisions | Median | p90 | p99 | Max |
|---|---|---|---|---|---|
| `hard` | 408 | 130.7 ms | 226 ms | 346 ms | 383 ms |

