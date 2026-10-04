# Eval v1 baseline: the table's 고수

**Question.** Where does the live 고수 stand on eval suite v1? This run is
the reference that later bots and models are measured against (with
`--baseline hard`, on the same deals).

**Bot.** `hard`: the table's 고수 with its per-seat bidding temper, at a
fixed 200 deals per decision (`search:200:1:0`) instead of the table's
time budget, so the run reproduces. At the table it deals for about a
second on all worker threads, thousands of deals; the 2026-10-04
benchmark found doubling 200 deals worth less than ~0.4 points a hand.

**Run.** Commit `fa3f202`, `eval run --suite v1 --bot hard`, on the Mac
shared with other work (load about 100 throughout): 3 h 13 min. The cost
part again on the home server: `results/cost-home/`. Config in
[`config.toml`](config.toml); everything else is in the suite.

## Results

[`results/report.md`](results/report.md) in full. Points per seat-hand of
the measured seat, ± 95%:

| Ladder (경기과고, 2000 deals each) | |
| --- | --- |
| against random | +18.84 ± 0.79 |
| against 초보 | +3.95 ± 0.47 |
| against 보통 | +4.71 ± 0.52 |
| against 고수 (itself) | −0.26 ± 0.44 |
| **rating** (mean over rungs) | **+6.81 ± 0.29** |

- **Presets** (500 deals each against 고수): every preset within its
  interval of zero, average −0.10 ± 0.31: the bot plays itself to a draw
  under every rule set, as it should.
- **Held-out rule sets** (40 sets, 25 deals each, against 고수): −0.62 ±
  1.02, also a draw. 25 deals a set say little per set; the average is
  the number to watch when a model is measured on rules it never saw.
- **Think time** per decision with a choice (40 deals of 경기과고, one
  thread): on the home server median 131 ms, p99 346 ms (a first,
  identical run beside more load: 146 / 367 ms; the 2026-10-04 benchmark
  measured 163 / 367 ms there); on the shared Mac 168 / 395 ms. 408
  decisions in each run: the same decisions, timed differently.
- **Puzzles:** 6 of 6 scored passed. Of the informational ones, the bot
  calls its own side's joker early in all three early-call positions (0,
  1 and 0 tries of 3 without the call), the weakness the benchmark's audit
  flagged; it never throws the joker onto its partner's mighty.

## Notes

- The bot takes fewer points per hand from 초보 (+3.95 ± 0.47) than
  from 보통 (+4.71 ± 0.52), though 초보 plays a random card 35% of the
  time; the difference, 0.76 ± 0.70, is barely significant. Not explained here;
  worth a look when the levels are tuned. It does not affect the suite.
- The bot against itself scores slightly below zero in most tables, all
  within the interval; nothing in the setup favours the field (seats and
  first bidders rotate evenly).
- Hard against hard is the expensive part of the suite (four searching
  seats); a full run with a baseline takes about twice as long.
