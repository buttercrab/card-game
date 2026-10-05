# Eval v1: `hard`

> **Quick run**: a few deals of everything, to see that it runs. Not a measurement.

- Suite `v1` (SHA-256 `dd53cdf85cb7…`), commit `ad05cbca0c6f` (with changes)
- Machine: the Mac (M4 Pro, 14 threads), shared with an RL training run, Apple M4 Pro (macos aarch64, 14 threads, load 29.6 at the start); 3 worker threads
- Started 2026-10-05T05:13:54Z, took 3 min 22 s
- Reproducible: no bot decides on a clock, so a rerun of this commit plays every deal the same

## Ladder

Points per seat-hand of the measured seat, ± 95% interval.

| Table | Rules | Field | Deals | Bot |
|---|---|---|---|---|
| random | gshs | `random` | 5 | +49.20 ± 7.08 |
| 초보 | gshs | `easy` | 5 | +7.80 ± 7.85 |
| 보통 | gshs | `normal` | 5 | +5.20 ± 19.59 |
| 고수 | gshs | `hard` | 5 | -2.60 ± 12.39 |
| **Rating** | | | 20 | **+14.90 ± 6.37** |

Rating: the mean over rungs of points per seat-hand, each rung weighted equally.

## Presets

Points per seat-hand of the measured seat, ± 95% interval. Field: `hard`.

| Table | Rules | Field | Deals | Bot |
|---|---|---|---|---|
| default | default | `hard` | 1 | -6.00 ± 0.00 |
| ddshs | ddshs | `hard` | 1 | -20.00 ± 0.00 |
| dshs | dshs | `hard` | 1 | +10.00 ± 0.00 |
| kmla | kmla | `hard` | 1 | -6.00 ± 0.00 |
| gsa | gsa | `hard` | 1 | -5.00 ± 0.00 |
| gshs | gshs | `hard` | 1 | +16.00 ± 0.00 |
| skku | skku | `hard` | 1 | -5.00 ± 0.00 |
| sshs | sshs | `hard` | 1 | -5.00 ± 0.00 |
| yonsei | yonsei | `hard` | 1 | +14.00 ± 0.00 |
| **Average** | | | 9 | **-0.78 ± 0.00** |

## Held-out rule sets

Points per seat-hand of the measured seat, ± 95% interval. Field: `hard`; 5 rule sets, 1 deals each.

| Table | Rules | Field | Deals | Bot |
|---|---|---|---|---|
| **Average** | | | 5 | **-3.80 ± 0.00** |

<details><summary>Every set</summary>

| Table | Rules | Field | Deals | Bot |
|---|---|---|---|---|
| set 0 | 3 players, 33 cards | `hard` | 1 | +12.00 ± 0.00 |
| set 1 | 6 players, 53 cards | `hard` | 1 | -4.00 ± 0.00 |
| set 2 | 4 players, 43 cards | `hard` | 1 | -4.00 ± 0.00 |
| set 3 | 3 players, 33 cards | `hard` | 1 | -24.00 ± 0.00 |
| set 4 | 6 players, 53 cards | `hard` | 1 | +1.00 ± 0.00 |

</details>

## Think time

Per decision with a real choice, one deal at a time on one thread: 1 deals of `gshs` against `hard`.

| Bot | Decisions | Median | p90 | p99 | Max |
|---|---|---|---|---|---|
| `hard` | 12 | 236.9 ms | 351 ms | 391 ms | 391 ms |

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
