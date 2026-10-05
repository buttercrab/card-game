# Bot fixes (FIXES 1.7)

**Question.** The play-test and the bot review found the bots throwing
in good hands, overbidding under scoring G, killing their own side's
joker and moving at one flat pace. Do the fixes of
[FIXES 1.7](../../../docs/FIXES.md) keep or improve how the bots score?

**Method.** Paired `sim` runs: one seat (rotating) plays the change, then
the same games again with the baseline in that seat; the other four seats
are the field (the previous step). Simple-bot changes: 200 000 games per
preset; the search bot (`search:200:1:0`, the table's 고수 without its
clock) against four simple bots: 1000 + 3000 games (fresh deals, seed
1000). Presets 경기과고 (`gshs`, scoring G: a failed contract pays back)
and 기본 (`default`). Old behaviour stays reachable through settings
(`simple@misdeal_below_min=false,bid_spread=0,...`), so one binary
measures both sides; [`config.toml`](config.toml) and
[`scripts/`](scripts) have the commands, [`results/results.log`](results/results.log)
every line. ± is 95%, in points per hand.

## Results

Simple bot, each step against the one before:

| Change | 경기과고 | 기본 | Kept |
| --- | --- | --- | --- |
| Misdeal only below the minimum bid | −0.005 ± 0.023 | +0.019 ± 0.007 | yes |
| `bid_base` 6.5 → 6.0 | +0.211 ± 0.024 | +0.030 ± 0.015 | yes |
| … then 5.5 (not kept) | −0.068 ± 0.023 | −0.037 ± 0.014 | no |
| Margin by scoring, `bid_spread` 1.9 | +0.117 ± 0.022 | +0.005 ± 0.003 | yes |
| (`bid_spread` 3 / 4 / 5 / 7) | +0.123 / +0.131 / +0.117 / +0.052 | +0.005 (3, 4) | — |
| (`bid_spread` 4 against 1.9, paired) | +0.007 ± 0.016 | | — |
| `aim_joker_call` on | +0.011 ± 0.006 | +0.000 ± 0.000 | yes |
| Friend spares the declarer's joker | +0.019 ± 0.005 | +0.010 ± 0.003 | yes |
| Seat temper: old +0.4 seat against new +0.2 | −0.068 ± 0.019 | −0.003 ± 0.011 | halved |
| Seat temper: old −0.4 seat against new −0.2 | −0.010 ± 0.012 | −0.038 ± 0.010 | halved |

Redeals per hand, a table of simple bots, 20 000 deals:

| | 경기과고 | 기본 |
| --- | --- | --- |
| Misdeal whenever allowed | 1.28 (misdeals 1.14) | 0.32 (0.28) |
| Only below the minimum bid | 0.66 (0.54) | 0.22 (0.18) |

Search bot (고수) against four simple bots:

| Change | Games | 경기과고 | 기본 |
| --- | --- | --- | --- |
| Redeal scored 0 in playouts | 1000 | +0.14 ± 0.34 | +0.13 ± 0.20 |
| Everything (new policy and redeals) against the old | 1000 | −0.07 ± 0.56 | +0.06 ± 0.44 |
| Redeal scored 0 | 2000 more (seed 1000) | −0.05 ± 0.29 | not run |
| Everything against the old | 3000 / 2000 more (seed 1000) | −0.17 ± 0.33 | +0.11 ± 0.28 |
| Redeal scored 0, all games | | +0.01 ± 0.22 | +0.13 ± 0.20 |
| Everything, all games | | −0.15 ± 0.28 | +0.10 ± 0.24 |

The search runs were slow on the shared, loaded Mac (median 130 ms a
decision, a 3000-game run about 45 minutes), so they rest on 3000–4000
games and only rule out large changes: the search bot is neither
measurably helped nor hurt. The second-round 기본 redeal run was cut
when the batch hit its time limit.

초보 against 보통 (focus seat, field 보통), 100 000 games:

| | 경기과고 | 기본 |
| --- | --- | --- |
| Before (any card on a slip, bids like 보통) | −1.14 ± 0.05 | −0.70 ± 0.03 |
| After (cheap slips, one point more careful) | −0.66 ± 0.05 | −0.45 ± 0.03 |

## What changed and why

- **Misdeal** (`misdeal_below_min`): only when the best estimate is below
  `bidding.min`. Halves the redeals on 경기과고, a third fewer on 기본.
- **Bidding by the scoring** (`SimpleBot::needed`): a bid of `c` needs an
  estimate of `c + bid_spread × ln(lost / won)`, at least `c`, where
  `won` is what making it by one pays and `lost` what failing it by two
  costs, both from the rules (`hand_value`). `lost / (won + lost)` is the
  make rate that breaks even; on simple-bot tables
  ([`scripts/calib.py`](scripts/calib.py), 20 000 hands of each preset)
  the make rate rises by about 0.53 log-odds per point of estimate above
  the bid, so `bid_spread` = 1 / 0.53 ≈ 1.9. Under G that asks about
  0.3 more at 14 to 18; 기본's scoring (BothOver(13), shortfall only)
  pays more for making than failing costs, so nothing changes there
  except the dealer's last-chance 13. Spreads 1.9 to 5 measure alike
  on 경기과고; 1.9 is the fitted one. Together with `bid_base` 6.0 a
  hand clears a 경기과고 bid by about 0.8 more than before, close to the
  "one point above from 15" the review asked for, and on all contracts
  (at margin 0 even the 14s lost: −1.0 a declared hand). The search
  bot's reading of other players' bids uses the same need.
- **Temper** halved: `[0, ±0.2, ±0.1, ±0.15, 0.05]`. The bold seats lost
  the most on 경기과고, the careful ones on 기본.
- **Joker calls**: `aim_joker_call` on, and a friend calls a joker only
  when the declarer has called it as the friend (the only way the
  declarer shows it lacks it). Humans may still call a joker they hold.
- **Friend calls** skip the declarer's discards (both bots). The simple
  bot never discards the cards it would call, so this only removes
  search candidates such as a discarded trump king.
- **Redeals in playouts** score 0: by symmetry a fresh hand is worth 0 to
  every seat before its cards are seen. Neutral within noise, and less
  playout noise and work.
- **초보** bids `EASY_CAUTION` = 1 point more carefully and slips only to
  cards other than the mighty, jokers and joker calls (or to the simple
  bot's own choice). Still clearly weaker than 보통, by less.
- **Pace** (server, not measured here): moves are paced by what is being
  decided (`SessionGame::decision`).

Search decisions changed on purpose; `crates/mighty/tests/search.rs` is
re-pinned.
