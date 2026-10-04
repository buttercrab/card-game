# Eval v1: `hard`

- Suite `v1` (SHA-256 `dd53cdf85cb7…`), commit `fa3f2021e6a0`
- Machine: the Mac (M4 Pro), shared with other work, Apple M4 Pro (macos aarch64, 14 threads, load 117.1 at the start); 14 worker threads
- Started 2026-10-04T14:51:31Z, took 3 h 13 min
- Reproducible: no bot decides on a clock, so a rerun of this commit plays every deal the same

## Ladder

Points per seat-hand of the measured seat, ± 95% interval.

| Table | Rules | Field | Deals | Bot |
|---|---|---|---|---|
| random | gshs | `random` | 2000 | +18.84 ± 0.79 |
| 초보 | gshs | `easy` | 2000 | +3.95 ± 0.47 |
| 보통 | gshs | `normal` | 2000 | +4.71 ± 0.52 |
| 고수 | gshs | `hard` | 2000 | -0.26 ± 0.44 |
| **Rating** | | | 8000 | **+6.81 ± 0.29** |

Rating: the mean over rungs of points per seat-hand, each rung weighted equally.

## Presets

Points per seat-hand of the measured seat, ± 95% interval. Field: `hard`.

| Table | Rules | Field | Deals | Bot |
|---|---|---|---|---|
| default | default | `hard` | 500 | -0.27 ± 0.80 |
| ddshs | ddshs | `hard` | 500 | -0.26 ± 0.88 |
| dshs | dshs | `hard` | 500 | -0.21 ± 0.91 |
| kmla | kmla | `hard` | 500 | +0.38 ± 0.90 |
| gsa | gsa | `hard` | 500 | +0.10 ± 0.97 |
| gshs | gshs | `hard` | 500 | -0.38 ± 0.93 |
| skku | skku | `hard` | 500 | +0.41 ± 1.23 |
| sshs | sshs | `hard` | 500 | -0.54 ± 0.86 |
| yonsei | yonsei | `hard` | 500 | -0.17 ± 0.78 |
| **Average** | | | 4500 | **-0.10 ± 0.31** |

## Held-out rule sets

Points per seat-hand of the measured seat, ± 95% interval. Field: `hard`; 40 rule sets, 25 deals each.

| Table | Rules | Field | Deals | Bot |
|---|---|---|---|---|
| **Average** | | | 1000 | **-0.62 ± 1.02** |

<details><summary>Every set</summary>

| Table | Rules | Field | Deals | Bot |
|---|---|---|---|---|
| set 0 | 3 players, 33 cards | `hard` | 25 | -0.72 ± 7.30 |
| set 1 | 6 players, 53 cards | `hard` | 25 | +6.24 ± 11.24 |
| set 2 | 4 players, 43 cards | `hard` | 25 | -3.80 ± 2.23 |
| set 3 | 3 players, 33 cards | `hard` | 25 | -2.12 ± 4.01 |
| set 4 | 6 players, 53 cards | `hard` | 25 | -1.56 ± 4.27 |
| set 5 | 7 players, 54 cards | `hard` | 25 | -10.00 ± 12.57 |
| set 6 | 3 players, 33 cards | `hard` | 25 | +3.04 ± 12.80 |
| set 7 | 7 players, 53 cards | `hard` | 25 | +4.88 ± 4.97 |
| set 8 | 5 players, 53 cards | `hard` | 25 | -1.40 ± 3.37 |
| set 9 | 5 players, 53 cards | `hard` | 25 | +0.48 ± 3.05 |
| set 10 | 7 players, 53 cards | `hard` | 25 | +3.24 ± 3.70 |
| set 11 | 6 players, 53 cards | `hard` | 25 | -0.12 ± 5.99 |
| set 12 | 3 players, 33 cards | `hard` | 25 | -4.56 ± 7.63 |
| set 13 | 4 players, 43 cards | `hard` | 25 | -0.60 ± 4.14 |
| set 14 | 7 players, 54 cards | `hard` | 25 | +1.64 ± 8.19 |
| set 15 | 7 players, 53 cards | `hard` | 25 | -7.00 ± 11.49 |
| set 16 | 5 players, 53 cards | `hard` | 25 | +0.48 ± 1.84 |
| set 17 | 5 players, 53 cards | `hard` | 25 | +0.56 ± 3.71 |
| set 18 | 5 players, 53 cards | `hard` | 25 | +0.44 ± 1.04 |
| set 19 | 3 players, 33 cards | `hard` | 25 | +0.80 ± 3.64 |
| set 20 | 3 players, 33 cards | `hard` | 25 | +2.96 ± 10.79 |
| set 21 | 4 players, 43 cards | `hard` | 25 | +0.44 ± 4.40 |
| set 22 | 3 players, 33 cards | `hard` | 25 | -5.44 ± 8.51 |
| set 23 | 3 players, 34 cards | `hard` | 25 | +1.12 ± 6.79 |
| set 24 | 7 players, 53 cards | `hard` | 25 | -2.20 ± 7.73 |
| set 25 | 5 players, 53 cards | `hard` | 25 | +0.60 ± 4.83 |
| set 26 | 7 players, 53 cards | `hard` | 25 | -4.04 ± 8.89 |
| set 27 | 7 players, 53 cards | `hard` | 25 | -0.32 ± 3.64 |
| set 28 | 3 players, 33 cards | `hard` | 25 | -3.20 ± 8.04 |
| set 29 | 6 players, 53 cards | `hard` | 25 | -0.56 ± 4.06 |
| set 30 | 6 players, 53 cards | `hard` | 25 | -0.08 ± 7.03 |
| set 31 | 6 players, 53 cards | `hard` | 25 | -1.88 ± 1.65 |
| set 32 | 5 players, 54 cards | `hard` | 25 | +0.96 ± 3.56 |
| set 33 | 7 players, 53 cards | `hard` | 25 | -0.24 ± 2.59 |
| set 34 | 7 players, 53 cards | `hard` | 25 | +0.28 ± 4.18 |
| set 35 | 7 players, 53 cards | `hard` | 25 | -0.60 ± 4.41 |
| set 36 | 7 players, 53 cards | `hard` | 25 | +1.16 ± 7.56 |
| set 37 | 7 players, 53 cards | `hard` | 25 | -3.64 ± 4.75 |
| set 38 | 4 players, 43 cards | `hard` | 25 | +0.40 ± 2.40 |
| set 39 | 5 players, 53 cards | `hard` | 25 | -0.44 ± 2.49 |

</details>

## Think time

Per decision with a real choice, one deal at a time on one thread: 40 deals of `gshs` against `hard`.

| Bot | Decisions | Median | p90 | p99 | Max |
|---|---|---|---|---|---|
| `hard` | 408 | 167.5 ms | 282 ms | 395 ms | 414 ms |

## Puzzles

Passed 6 of 6 scored puzzles. A puzzle passes when every try picks an acceptable action; informational ones are not scored.

| Puzzle | Kind | Bot |
|---|---|---|
| `joker-before-last-trick-follow`: The friend, two tricks left under 경기과고, with the joker and the ♥9: play the joker now | scored | pass 3/3 |
| `joker-before-last-trick-default`: Two tricks left under 기본, the joker and the ♠7 in hand: play the joker now | scored | pass 3/3 |
| `joker-before-last-trick-lead`: Leading the second-to-last trick with the red joker or the ♦6: lead the joker | scored | pass 3/3 |
| `joker-before-last-trick-trick-nine`: The declarer, with the red joker and the ♥7 on the second-to-last trick: play the joker | scored | pass 3/3 |
| `partner-trick-bank-the-queen`: The friend's ♥A wins the trick; the declarer holds the joker and two trumps: throw the ♦Q | scored | pass 3/3 |
| `joker-before-last-trick-not-always`: Two tricks left under 기본, the joker and the ♦K, with the ♦A still out: play the king | scored | pass 3/3 |
| `early-joker-call-own-side-1`: Declarer leads the second trick holding the joker-call card; the friend has the joker | informational | fail 0/3 |
| `early-joker-call-own-side-2`: Declarer leads the second trick under 기본 and may call the joker, which the friend holds | informational | fail 1/3 |
| `early-joker-call-own-side-3`: Declarer leads the second trick under 경기과고 and may call the joker, which the friend holds | informational | fail 0/3 |
| `joker-onto-partners-mighty`: Partner's mighty is winning the fourth trick; you hold the red joker among eight cards | informational | pass 3/3 |
