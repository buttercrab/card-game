# Scoring G: does paying back failed contracts stop the overbidding?

**Question.** Under the school presets' old scoring a failed contract
cost only its shortfall, so bidding paid from a make rate of about 25%
(at 16) and the bots overbid. The owner's scoring G (2026-10-05,
[RULES.md, 실패 배상](../../../crates/mighty/RULES.md)) makes a failure pay
back what the contract would have won made exactly, plus the shortfall;
break-even moves to about 57%. Do the table's bots bid less and make
more under it?

**Expectation.** 고수 decides its bids by playouts scored with the rules,
so it should bid lower and make more. 보통 and 초보 bid by a fixed hand
estimate that never reads the scoring, so their own bids cannot change;
only what the 고수 around them do can.

**Run.** 경기과고, one focus seat (rotating, `deal / 5 mod 5`) at 고수,
보통 or 초보, the other four the table's 고수 (`hard`), deals 0–399,
before (`gshs-shortfall.json`: the preset with `scoring.lose:
Shortfall`) and after (the preset). Each seat and phase draws from its
own stream seeded by the deal, so before and after meet the same cards.
`lab declare` at commit `3d6cc02`; [`config.toml`](config.toml) has the
commands. On the Mac beside an RL training run, 6 threads at `nice -n 10`.

**Cut short.** The run script stopped at its two-hour limit: 보통 after
finished deals 0–340 only, so 보통 is compared on those 341 deals (its
before file has all 400; the report filters it to the same deals), and
초보 was not run. `normal-after.jsonl` holds the 341 hands.

## Results

[`results/report.md`](results/report.md) in full; ± 95%. "Never bid":
the focus seat passed every turn of the deal that was played.

| Focus | Scoring | Hands | Never bid | Declared | Made | Declarer payoff | Per hand |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 고수 | before | 400 | 62% ± 5 | 20% ± 4 | 48% ± 11 | +8.86 ± 5.27 | +0.91 ± 1.29 |
| 고수 | after (G) | 400 | 70% ± 4 | 21% ± 4 | **76% ± 9** | +11.25 ± 5.07 | +1.41 ± 1.45 |
| 보통 | before | 341 | 76% ± 5 | 10% ± 3 | 47% ± 17 | +5.41 ± 6.69 | −2.06 ± 1.03 |
| 보통 | after (G) | 341 | 66% ± 5 | 25% ± 5 | 60% ± 10 | +3.58 ± 4.70 | −1.63 ± 1.48 |

고수's contracts by number (hands, made):

| Contract | Before | After (G) |
| --- | --- | --- |
| 14 | 2, 100% | 40, 75% |
| 15 | 18, 61% | 31, 74% |
| 16 | 32, 44% | 11, 82% |
| 17 | 17, 53% | 1 |
| 18–19 | 10, 20% | 0 |

- **고수 stops overbidding.** It declares as often (20% → 21%) but at
  14–15 instead of 15–17, and makes 76% instead of 48%, above G's
  break-even. It passes a little more (62% → 70% never bid), and hands
  are dealt again more often (0.43 → 0.68 redeals per hand) as the whole
  table of 고수 passes more.
- **보통 does not adapt, as expected,** but declares more (10% → 25%):
  the 고수 around it pass where they used to outbid it, so it gets the
  minimum contract more often. It makes 60% (14: 65%, 15: 52%), near
  break-even, and its declarer payoff falls (+5.41 → +3.58, within the
  intervals). Teaching the simple bot's bidding the scoring is the
  follow-up (`bid_base` reads no rules).
- Payoffs before and after are on different scales (a failure costs
  more under G), so the per-hand columns compare only roughly.

## Eval

- Suite v1 `--quick` of the new `hard` ([`results/eval-quick`](results/eval-quick)):
  runs, puzzles 6 of 6. A smoke test, not a measurement.
- Suite v1's 경기과고 preset table (seed 2 002 500), the first 250 of its
  500 deals, `hard` against four `hard`
  ([`results/gshs-preset-table.txt`](results/gshs-preset-table.txt)):
  −0.85 ± 1.48 per hand, a draw, as before (baseline −0.38 ± 0.93 on
  all 500 under the old scoring). Think time median 519 ms, p99 1.6 s on
  the loaded Mac.
