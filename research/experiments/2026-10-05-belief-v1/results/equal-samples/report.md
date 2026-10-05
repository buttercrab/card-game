# Eval v1: `belief:~/card-game-artifacts/models/belief-v1:200`

- Baseline: `hard`, in the same seat on the same deals
- Suite `v1` (SHA-256 `dd53cdf85cb7…`), commit `a6d53545187c`
- Machine: the Mac (M4 Pro, 14 threads), otherwise idle, Apple M4 Pro (macos aarch64, 14 threads, load 2.2 at the start); 14 worker threads
- Started 2026-10-04T22:01:40Z, took 2 h 3 min
- Reproducible: no bot decides on a clock, so a rerun of this commit plays every deal the same

## Presets

Points per seat-hand of the measured seat, ± 95% interval. Field: `hard`.

| Table | Rules | Field | Deals | Bot | Baseline | Bot − baseline |
|---|---|---|---|---|---|---|
| default | default | `hard` | 500 | +0.36 ± 1.04 | -0.27 ± 0.80 | +0.63 ± 0.98 |
| ddshs | ddshs | `hard` | 500 | -0.21 ± 0.83 | -0.26 ± 0.88 | +0.04 ± 0.89 |
| dshs | dshs | `hard` | 500 | -0.10 ± 0.83 | -0.21 ± 0.91 | +0.12 ± 0.91 |
| kmla | kmla | `hard` | 500 | +0.20 ± 0.93 | +0.38 ± 0.90 | -0.18 ± 0.84 |
| gsa | gsa | `hard` | 500 | +0.27 ± 0.93 | +0.10 ± 0.97 | +0.16 ± 0.99 |
| gshs | gshs | `hard` | 500 | +0.10 ± 0.86 | +0.15 ± 0.90 | -0.05 ± 0.93 |
| skku | skku | `hard` | 500 | +0.23 ± 1.13 | +0.41 ± 1.23 | -0.18 ± 1.00 |
| sshs | sshs | `hard` | 500 | +0.17 ± 0.88 | -0.54 ± 0.86 | +0.70 ± 0.80 |
| yonsei | yonsei | `hard` | 500 | -0.07 ± 0.83 | -0.17 ± 0.78 | +0.10 ± 0.81 |
| **Average** | | | 4500 | **+0.10 ± 0.31** | -0.04 ± 0.31 | **+0.15 ± 0.30** |

## Held-out rule sets

Points per seat-hand of the measured seat, ± 95% interval. Field: `hard`; 40 rule sets, 25 deals each.

| Table | Rules | Field | Deals | Bot | Baseline | Bot − baseline |
|---|---|---|---|---|---|---|
| **Average** | | | 1000 | **+0.37 ± 1.07** | -0.62 ± 1.02 | **+0.99 ± 1.02** |

<details><summary>Every set</summary>

| Table | Rules | Field | Deals | Bot | Baseline | Bot − baseline |
|---|---|---|---|---|---|---|
| set 0 | 3 players, 33 cards | `hard` | 25 | -2.96 ± 7.88 | -0.72 ± 7.30 | -2.24 ± 5.81 |
| set 1 | 6 players, 53 cards | `hard` | 25 | +7.64 ± 11.75 | +6.24 ± 11.24 | +1.40 ± 4.24 |
| set 2 | 4 players, 43 cards | `hard` | 25 | -3.48 ± 2.06 | -3.80 ± 2.23 | +0.32 ± 2.56 |
| set 3 | 3 players, 33 cards | `hard` | 25 | -1.68 ± 4.52 | -2.12 ± 4.01 | +0.44 ± 3.37 |
| set 4 | 6 players, 53 cards | `hard` | 25 | +5.68 ± 11.61 | -1.56 ± 4.27 | +7.24 ± 12.62 |
| set 5 | 7 players, 54 cards | `hard` | 25 | +1.68 ± 8.27 | -10.00 ± 12.57 | +11.68 ± 14.69 |
| set 6 | 3 players, 33 cards | `hard` | 25 | +3.76 ± 13.01 | +3.04 ± 12.80 | +0.72 ± 10.51 |
| set 7 | 7 players, 53 cards | `hard` | 25 | +6.88 ± 4.04 | +4.88 ± 4.97 | +2.00 ± 4.71 |
| set 8 | 5 players, 53 cards | `hard` | 25 | -0.52 ± 3.02 | -1.40 ± 3.37 | +0.88 ± 3.94 |
| set 9 | 5 players, 53 cards | `hard` | 25 | -1.72 ± 2.44 | +0.48 ± 3.05 | -2.20 ± 3.48 |
| set 10 | 7 players, 53 cards | `hard` | 25 | -1.08 ± 2.88 | +3.24 ± 3.70 | -4.32 ± 3.60 |
| set 11 | 6 players, 53 cards | `hard` | 25 | -2.44 ± 4.97 | -0.12 ± 5.99 | -2.32 ± 6.18 |
| set 12 | 3 players, 33 cards | `hard` | 25 | -2.08 ± 7.71 | -4.56 ± 7.63 | +2.48 ± 4.78 |
| set 13 | 4 players, 43 cards | `hard` | 25 | +0.24 ± 2.74 | -0.60 ± 4.14 | +0.84 ± 4.19 |
| set 14 | 7 players, 54 cards | `hard` | 25 | +7.56 ± 6.18 | +1.64 ± 8.19 | +5.92 ± 10.50 |
| set 15 | 7 players, 53 cards | `hard` | 25 | -11.12 ± 14.11 | -7.00 ± 11.49 | -4.12 ± 13.46 |
| set 16 | 5 players, 53 cards | `hard` | 25 | +1.84 ± 1.60 | +0.48 ± 1.84 | +1.36 ± 1.70 |
| set 17 | 5 players, 53 cards | `hard` | 25 | -0.56 ± 2.30 | +0.56 ± 3.71 | -1.12 ± 2.35 |
| set 18 | 5 players, 53 cards | `hard` | 25 | -0.36 ± 1.27 | +0.44 ± 1.04 | -0.80 ± 1.55 |
| set 19 | 3 players, 33 cards | `hard` | 25 | +2.04 ± 3.74 | +0.80 ± 3.64 | +1.24 ± 3.30 |
| set 20 | 3 players, 33 cards | `hard` | 25 | -2.24 ± 10.59 | +2.96 ± 10.79 | -5.20 ± 10.30 |
| set 21 | 4 players, 43 cards | `hard` | 25 | -0.80 ± 8.50 | +0.44 ± 4.40 | -1.24 ± 8.15 |
| set 22 | 3 players, 33 cards | `hard` | 25 | +2.64 ± 8.37 | -5.44 ± 8.51 | +8.08 ± 8.24 |
| set 23 | 3 players, 34 cards | `hard` | 25 | +2.32 ± 6.86 | +1.12 ± 6.79 | +1.20 ± 4.55 |
| set 24 | 7 players, 53 cards | `hard` | 25 | +7.52 ± 11.85 | -2.20 ± 7.73 | +9.72 ± 8.59 |
| set 25 | 5 players, 53 cards | `hard` | 25 | +3.68 ± 3.96 | +0.60 ± 4.83 | +3.08 ± 4.58 |
| set 26 | 7 players, 53 cards | `hard` | 25 | -1.24 ± 7.46 | -4.04 ± 8.89 | +2.80 ± 2.95 |
| set 27 | 7 players, 53 cards | `hard` | 25 | -1.92 ± 7.43 | -0.32 ± 3.64 | -1.60 ± 5.20 |
| set 28 | 3 players, 33 cards | `hard` | 25 | +3.20 ± 7.17 | -3.20 ± 8.04 | +6.40 ± 6.48 |
| set 29 | 6 players, 53 cards | `hard` | 25 | -2.36 ± 3.57 | -0.56 ± 4.06 | -1.80 ± 4.68 |
| set 30 | 6 players, 53 cards | `hard` | 25 | -3.32 ± 4.01 | -0.08 ± 7.03 | -3.24 ± 6.42 |
| set 31 | 6 players, 53 cards | `hard` | 25 | -2.44 ± 1.97 | -1.88 ± 1.65 | -0.56 ± 1.97 |
| set 32 | 5 players, 54 cards | `hard` | 25 | +1.64 ± 3.79 | +0.96 ± 3.56 | +0.68 ± 4.49 |
| set 33 | 7 players, 53 cards | `hard` | 25 | -0.60 ± 5.52 | -0.24 ± 2.59 | -0.36 ± 5.36 |
| set 34 | 7 players, 53 cards | `hard` | 25 | +1.16 ± 4.68 | +0.28 ± 4.18 | +0.88 ± 4.15 |
| set 35 | 7 players, 53 cards | `hard` | 25 | -0.28 ± 5.20 | -0.60 ± 4.41 | +0.32 ± 2.72 |
| set 36 | 7 players, 53 cards | `hard` | 25 | +1.96 ± 7.46 | +1.16 ± 7.56 | +0.80 ± 4.96 |
| set 37 | 7 players, 53 cards | `hard` | 25 | -3.56 ± 5.17 | -3.64 ± 4.75 | +0.08 ± 5.48 |
| set 38 | 4 players, 43 cards | `hard` | 25 | +0.40 ± 2.43 | +0.40 ± 2.40 | +0.00 ± 2.14 |
| set 39 | 5 players, 53 cards | `hard` | 25 | -0.28 ± 2.26 | -0.44 ± 2.49 | +0.16 ± 2.87 |

</details>

## Think time

Per decision with a real choice, one deal at a time on one thread: 40 deals of `gshs` against `hard`.

| Bot | Decisions | Median | p90 | p99 | Max |
|---|---|---|---|---|---|
| `belief:~/card-game-artifacts/models/belief-v1:200` | 413 | 18.7 ms | 116 ms | 139 ms | 147 ms |
| `hard` | 409 | 103.5 ms | 175 ms | 212 ms | 235 ms |

## Puzzles

Passed 6 of 6 scored puzzles (baseline 6). A puzzle passes when every try picks an acceptable action; informational ones are not scored.

| Puzzle | Kind | Bot | Baseline |
|---|---|---|---|
| `joker-before-last-trick-follow`: The friend, two tricks left under 경기과고, with the joker and the ♥9: play the joker now | scored | pass 3/3 | pass 3/3 |
| `joker-before-last-trick-default`: Two tricks left under 기본, the joker and the ♠7 in hand: play the joker now | scored | pass 3/3 | pass 3/3 |
| `joker-before-last-trick-lead`: Leading the second-to-last trick with the red joker or the ♦6: lead the joker | scored | pass 3/3 | pass 3/3 |
| `joker-before-last-trick-trick-nine`: The declarer, with the red joker and the ♥7 on the second-to-last trick: play the joker | scored | pass 3/3 | pass 3/3 |
| `partner-trick-bank-the-queen`: The friend's ♥A wins the trick; the declarer holds the joker and two trumps: throw the ♦Q | scored | pass 3/3 | pass 3/3 |
| `joker-before-last-trick-not-always`: Two tricks left under 기본, the joker and the ♦K, with the ♦A still out: play the king | scored | pass 3/3 | pass 3/3 |
| `early-joker-call-own-side-1`: Declarer leads the second trick holding the joker-call card; the friend has the joker | informational | fail 0/3 | fail 0/3 |
| `early-joker-call-own-side-2`: Declarer leads the second trick under 기본 and may call the joker, which the friend holds | informational | fail 0/3 | fail 1/3 |
| `early-joker-call-own-side-3`: Declarer leads the second trick under 경기과고 and may call the joker, which the friend holds | informational | fail 0/3 | fail 0/3 |
| `joker-onto-partners-mighty`: Partner's mighty is winning the fourth trick; you hold the red joker among eight cards | informational | pass 3/3 | pass 3/3 |
