# Eval v1: `belief:~/card-game-artifacts/models/belief-v1:1200`

- Baseline: `hard`, in the same seat on the same deals
- Suite `v1` (SHA-256 `dd53cdf85cb7…`), commit `2cdabfd5c1fd`
- Machine: the Mac (M4 Pro, 14 threads), otherwise idle, Apple M4 Pro (macos aarch64, 14 threads, load 3.8 at the start); 14 worker threads
- Started 2026-10-05T00:05:19Z, took 2 h 21 min
- Reproducible: no bot decides on a clock, so a rerun of this commit plays every deal the same

## Presets

Points per seat-hand of the measured seat, ± 95% interval. Field: `hard`.

| Table | Rules | Field | Deals | Bot | Baseline | Bot − baseline |
|---|---|---|---|---|---|---|
| default | default | `hard` | 500 | -0.13 ± 0.77 | -0.27 ± 0.80 | +0.14 ± 0.81 |
| ddshs | ddshs | `hard` | 500 | -0.06 ± 0.88 | -0.26 ± 0.88 | +0.20 ± 0.85 |
| dshs | dshs | `hard` | 500 | -0.62 ± 0.83 | -0.21 ± 0.91 | -0.41 ± 0.85 |
| kmla | kmla | `hard` | 500 | +0.38 ± 0.96 | +0.38 ± 0.90 | -0.00 ± 0.83 |
| gsa | gsa | `hard` | 500 | +0.33 ± 0.86 | +0.10 ± 0.97 | +0.22 ± 1.02 |
| gshs | gshs | `hard` | 500 | -0.24 ± 0.94 | +0.15 ± 0.90 | -0.40 ± 0.95 |
| skku | skku | `hard` | 500 | +0.44 ± 1.18 | +0.41 ± 1.23 | +0.03 ± 0.96 |
| sshs | sshs | `hard` | 500 | +0.13 ± 0.86 | -0.54 ± 0.86 | +0.66 ± 0.82 |
| yonsei | yonsei | `hard` | 500 | -0.41 ± 0.82 | -0.17 ± 0.78 | -0.23 ± 0.84 |
| **Average** | | | 4500 | **-0.02 ± 0.30** | -0.04 ± 0.31 | **+0.02 ± 0.29** |

## Held-out rule sets

Points per seat-hand of the measured seat, ± 95% interval. Field: `hard`; 40 rule sets, 25 deals each.

| Table | Rules | Field | Deals | Bot | Baseline | Bot − baseline |
|---|---|---|---|---|---|---|
| **Average** | | | 1000 | **+0.25 ± 1.04** | -0.62 ± 1.02 | **+0.87 ± 0.93** |

<details><summary>Every set</summary>

| Table | Rules | Field | Deals | Bot | Baseline | Bot − baseline |
|---|---|---|---|---|---|---|
| set 0 | 3 players, 33 cards | `hard` | 25 | -0.56 ± 5.36 | -0.72 ± 7.30 | +0.16 ± 4.59 |
| set 1 | 6 players, 53 cards | `hard` | 25 | +8.60 ± 12.25 | +6.24 ± 11.24 | +2.36 ± 4.88 |
| set 2 | 4 players, 43 cards | `hard` | 25 | -2.44 ± 2.72 | -3.80 ± 2.23 | +1.36 ± 2.92 |
| set 3 | 3 players, 33 cards | `hard` | 25 | -1.16 ± 4.34 | -2.12 ± 4.01 | +0.96 ± 4.27 |
| set 4 | 6 players, 53 cards | `hard` | 25 | -5.80 ± 6.69 | -1.56 ± 4.27 | -4.24 ± 7.14 |
| set 5 | 7 players, 54 cards | `hard` | 25 | -0.12 ± 7.82 | -10.00 ± 12.57 | +9.88 ± 14.68 |
| set 6 | 3 players, 33 cards | `hard` | 25 | +7.44 ± 14.56 | +3.04 ± 12.80 | +4.40 ± 9.63 |
| set 7 | 7 players, 53 cards | `hard` | 25 | +3.00 ± 4.43 | +4.88 ± 4.97 | -1.88 ± 5.88 |
| set 8 | 5 players, 53 cards | `hard` | 25 | -0.60 ± 2.67 | -1.40 ± 3.37 | +0.80 ± 3.19 |
| set 9 | 5 players, 53 cards | `hard` | 25 | -2.00 ± 2.40 | +0.48 ± 3.05 | -2.48 ± 3.43 |
| set 10 | 7 players, 53 cards | `hard` | 25 | +0.56 ± 2.93 | +3.24 ± 3.70 | -2.68 ± 2.77 |
| set 11 | 6 players, 53 cards | `hard` | 25 | +5.68 ± 4.60 | -0.12 ± 5.99 | +5.80 ± 6.16 |
| set 12 | 3 players, 33 cards | `hard` | 25 | -1.36 ± 7.73 | -4.56 ± 7.63 | +3.20 ± 5.53 |
| set 13 | 4 players, 43 cards | `hard` | 25 | +1.20 ± 3.57 | -0.60 ± 4.14 | +1.80 ± 4.54 |
| set 14 | 7 players, 54 cards | `hard` | 25 | +0.32 ± 5.46 | +1.64 ± 8.19 | -1.32 ± 6.18 |
| set 15 | 7 players, 53 cards | `hard` | 25 | -12.88 ± 15.71 | -7.00 ± 11.49 | -5.88 ± 12.32 |
| set 16 | 5 players, 53 cards | `hard` | 25 | +1.64 ± 1.89 | +0.48 ± 1.84 | +1.16 ± 1.70 |
| set 17 | 5 players, 53 cards | `hard` | 25 | +0.32 ± 3.41 | +0.56 ± 3.71 | -0.24 ± 1.86 |
| set 18 | 5 players, 53 cards | `hard` | 25 | -0.32 ± 1.22 | +0.44 ± 1.04 | -0.76 ± 1.55 |
| set 19 | 3 players, 33 cards | `hard` | 25 | +3.56 ± 2.49 | +0.80 ± 3.64 | +2.76 ± 3.60 |
| set 20 | 3 players, 33 cards | `hard` | 25 | +3.44 ± 12.08 | +2.96 ± 10.79 | +0.48 ± 8.72 |
| set 21 | 4 players, 43 cards | `hard` | 25 | -1.12 ± 4.95 | +0.44 ± 4.40 | -1.56 ± 4.68 |
| set 22 | 3 players, 33 cards | `hard` | 25 | +2.08 ± 5.86 | -5.44 ± 8.51 | +7.52 ± 5.51 |
| set 23 | 3 players, 34 cards | `hard` | 25 | +2.72 ± 7.07 | +1.12 ± 6.79 | +1.60 ± 4.25 |
| set 24 | 7 players, 53 cards | `hard` | 25 | +2.24 ± 7.16 | -2.20 ± 7.73 | +4.44 ± 9.14 |
| set 25 | 5 players, 53 cards | `hard` | 25 | +3.36 ± 3.42 | +0.60 ± 4.83 | +2.76 ± 3.37 |
| set 26 | 7 players, 53 cards | `hard` | 25 | -6.12 ± 10.74 | -4.04 ± 8.89 | -2.08 ± 6.17 |
| set 27 | 7 players, 53 cards | `hard` | 25 | -1.96 ± 5.88 | -0.32 ± 3.64 | -1.64 ± 6.61 |
| set 28 | 3 players, 33 cards | `hard` | 25 | +1.04 ± 8.36 | -3.20 ± 8.04 | +4.24 ± 8.34 |
| set 29 | 6 players, 53 cards | `hard` | 25 | +1.16 ± 4.97 | -0.56 ± 4.06 | +1.72 ± 3.93 |
| set 30 | 6 players, 53 cards | `hard` | 25 | +0.48 ± 4.83 | -0.08 ± 7.03 | +0.56 ± 6.39 |
| set 31 | 6 players, 53 cards | `hard` | 25 | -2.64 ± 2.08 | -1.88 ± 1.65 | -0.76 ± 2.00 |
| set 32 | 5 players, 54 cards | `hard` | 25 | +1.40 ± 3.07 | +0.96 ± 3.56 | +0.44 ± 3.16 |
| set 33 | 7 players, 53 cards | `hard` | 25 | -0.44 ± 6.50 | -0.24 ± 2.59 | -0.20 ± 5.89 |
| set 34 | 7 players, 53 cards | `hard` | 25 | -2.68 ± 3.59 | +0.28 ± 4.18 | -2.96 ± 4.02 |
| set 35 | 7 players, 53 cards | `hard` | 25 | +0.00 ± 4.78 | -0.60 ± 4.41 | +0.60 ± 2.01 |
| set 36 | 7 players, 53 cards | `hard` | 25 | +1.88 ± 7.03 | +1.16 ± 7.56 | +0.72 ± 3.82 |
| set 37 | 7 players, 53 cards | `hard` | 25 | -1.92 ± 5.29 | -3.64 ± 4.75 | +1.72 ± 7.14 |
| set 38 | 4 players, 43 cards | `hard` | 25 | +0.72 ± 2.26 | +0.40 ± 2.40 | +0.32 ± 2.25 |
| set 39 | 5 players, 53 cards | `hard` | 25 | +1.44 ± 2.79 | -0.44 ± 2.49 | +1.88 ± 3.19 |

</details>

## Think time

Per decision with a real choice, one deal at a time on one thread: 40 deals of `gshs` against `hard`.

| Bot | Decisions | Median | p90 | p99 | Max |
|---|---|---|---|---|---|
| `belief:~/card-game-artifacts/models/belief-v1:1200` | 408 | 98.1 ms | 657 ms | 787 ms | 832 ms |
| `hard` | 409 | 95.8 ms | 165 ms | 203 ms | 222 ms |

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
