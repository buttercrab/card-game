# Evals

Eval suites, by version: `v1/`, `v2/`, and so on. A suite is the
scoreboard every bot and model is measured on, so it changes only by a new
version, never in place; results always name the version they ran (and the
suite file's SHA-256).

A suite fixes everything that decides a score: the bots or rule sets
played, deal seeds, seat rotation, game counts and the statistics reported
(points per seat-hand with 95% intervals, think time). Deals are paired
and seats rotated so two bots meet the same cards.

The runner is `crates/eval`:

```sh
cargo build --release -p eval
nice -n 10 target/release/eval run --suite v1 --bot hard --out <dir>
nice -n 10 target/release/eval run --suite v1 --bot <new> --baseline hard --out <dir>
target/release/eval run --suite v1 --bot hard --quick     # a smoke test, minutes
```

It writes `results.json` (the record, below) and `report.md` (the same
for people) into `--out` (default `target/eval/<suite>`). `--parts
ladder,cost` runs only some parts; `--threads N` limits the workers (all
cores by default); `--machine <label>` notes which machine it was.

Bots are named as for `sim` (`sim --help`): `random`, `simple`,
`search:SAMPLES:CONFIDENCE:BUDGET_MS` with `@name=value` settings, and the
table's levels `easy` (초보), `normal` (보통) and `hard` (고수). The levels
are the server's bots, per-seat bidding temper included, except that
`hard` deals a fixed 200 times (`search:200:1:0`) where the table deals
until a time budget runs out: that keeps every run reproducible.
`belief:MODEL_DIR:SAMPLES` is `hard` at `SAMPLES` deals, dealing the
cards it cannot see by the belief model in `MODEL_DIR` (an exported run,
`ml/`'s `cardgame_ml.export`) instead of uniformly, without reading the
table on top (the model has; `@read.on=true` reads again).

## Suites

| Suite | What it is |
| --- | --- |
| [`v1`](v1) | The first scoreboard (2026-10-04) |
| [`bench-2026-10-04`](bench-2026-10-04) | Not a scoreboard: the 2026-10-04 benchmark's head-to-head runs, kept to check the runner reproduces them |

### v1

| Part | What is played | Size |
| --- | --- | --- |
| ladder | 경기과고; the bot in one seat against four of `random`, `easy` (초보), `normal` (보통), `hard` (고수) | 2000 deals a rung |
| presets | every preset (기본 and the eight schools); against `hard` | 500 deals a preset |
| heldout | 40 held-out rule sets (3–7 players); against `hard` | 25 deals a set |
| cost | 경기과고 against `hard`, one deal at a time on one thread | 40 deals |
| puzzles | 10 positions, 6 scored and 4 informational | 3 tries each |

A full run of `hard` takes about 80,000 CPU-seconds: 3 h 13 min on the
Mac while it was shared with other work, about 1.5 h when it is not;
about twice that with a baseline. `--quick` takes a minute or two.

## How a table is played

Deal `d` of a table is played on seed `seed + d`; who bids first is
`d mod players` and the measured seat is `(d / players) mod players`, so
over `players²` deals every seat meets every first bidder once. Within a
part, table `k` (rung, preset or held-out set, in the suite's order) starts
at `seed + k·deals`, so no two tables share deals. With `--baseline`, every
deal is played again with the baseline in the measured seat: the cards
come from their own random stream, so both meet the same cards. This is
exactly `sim --bots search --view-every 0`, and the two reproduce each
other's numbers.

**Points per seat-hand** is the measured seat's payoff per deal. With a
baseline, **bot − baseline** is the deal-by-deal difference, whose
interval is much narrower than either bot's own. Intervals are 95%
(1.96 standard errors).

**Rating** (`mean-over-rungs`): the mean, over the ladder's rungs, of
points per seat-hand, each rung weighted equally; its interval adds the
rungs' variances (`√Σci² / k`). It is a performance against a fixed field,
not an Elo: it says how much a bot takes from the table's bots per hand,
on average over the four levels, and two bots' ratings on the same suite
compare directly. The presets' and held-out sets' averages are formed the
same way.

**Reproducibility:** a bot that does not think on a clock (no
`BUDGET_MS`) decides the same way on the same seeds, so two runs of a
commit give identical numbers on any machine and thread count;
`results.json` says whether the run was such (`reproducible`), and each
table's `digest` (SHA-256 of every deal's payoffs) lets two runs be
compared exactly. Think times differ from run to run.

## Held-out rule sets

[`v1/heldout-rules.json`](v1/heldout-rules.json) is a JSON array of
serialized `mighty::rules::Rules`, 40 of them, drawn once with
`Rules::varied` from fixed seeds (presets in turn as the bases; see
`write_heldout_rules` in `crates/eval/tests/suites.rs`), validated,
distinct and none a preset. The suite records the file's SHA-256 and the
runner refuses a file that does not match.

**They must never be used for training.** The repository is public, so
they are not hidden; instead the training side excludes them: the RL
environment (`crates/env`) reads this exact file and never samples these
rule sets. Keep the format exactly "JSON array of `Rules`".

## Puzzles

[`v1/puzzles.json`](v1/puzzles.json) holds positions where a bot went
wrong: each the rules (a preset), a deal number (which sets the first
bidder), every action from the start of the hand up to the decision, and
the acceptable actions, with a title and why. A puzzle passes when the bot
picks an acceptable action on every try (seeds `0..tries`).

- **Scored** puzzles have a proven answer: the acceptable actions are
  exactly those that do best in every world the seat cannot tell from the
  real one (the real deal and 300 redeals of the hidden cards, ignoring
  even what the play so far showed), each played on perfectly with every
  hand known. `crates/eval/tests/puzzles.rs` checks this for every scored
  puzzle.
- **Informational** puzzles record a known weakness whose right answer
  depends on what the seat cannot see. They are reported, never scored.

New puzzles come from the miner in the same test file
(`cargo test --release -p eval --test puzzles -- --ignored mine
--nocapture`), which prints positions from hands of `hard` bots that fit
a pattern, with the proven answer where there is one.

## Think time on the home server

Think time means something only on the machine that thinks for the
tables: the home server, which also runs the live bot worker. Run the cost
part there at low priority, single-threaded, from a checkout in a scratch
folder (cargo is installed; nothing else is needed):

```sh
git archive --format=tar HEAD | ssh home 'mkdir -p ~/bench/eval && tar -x -C ~/bench/eval'
ssh home "cd ~/bench/eval && nice -n 10 cargo +stable build --release -j 4 -p eval &&
  nice -n 10 target/release/eval run --suite v1 --bot hard --parts cost \
    --machine 'home server' --commit $(git rev-parse HEAD) --out cost-home"
scp -r home:bench/eval/cost-home <experiment folder>/
```

The exported tree is no git checkout, so `--commit` records the commit.
Remove the folder afterwards.

## `results.json`

Schema `eval-results/1`. A change a reader would notice bumps the number.

| Field | Meaning |
| --- | --- |
| `schema` | `eval-results/1` |
| `suite` | `name`, `game`, `sha256` of the suite file, `quick` (a smoke test: not a measurement) |
| `bot`, `baseline` | The bots as named (`baseline` may be `null`) |
| `reproducible` | No bot in the run thinks on a clock |
| `run` | `commit` (and `dirty`: tracked files differed), `started` (UTC), `wall_seconds`, `threads`, `command` |
| `machine` | `label`, `os`, `arch`, `cpu`, `threads`, `load` (load averages at the start) |
| `ladder` | `rungs` (tables), `rating` (a summary), `seconds` |
| `presets`, `heldout` | `tables`, `average` (a summary), `seconds` |
| `matches` | Tables |
| `cost` | `rules`, `field`, `seed`, `deals`, `bot` and `baseline` think times, `seconds` |
| `puzzles` | `passed` of `scored`, `baseline_passed`, and per puzzle `id`, `title`, `scored`, `bot` and `baseline` answers |

A **table** is `name`, `rules`, `field`, `seed` (its first), `deals`,
`bot`, `baseline` and `diff` (estimates; the last two `null` without a
baseline) and `digest`. An **estimate** is `mean`, `ci95` (the
half-width) and `n`. A **summary** is `bot`, `baseline` and `diff`
estimates. **Think time** is `decisions` (with a real choice), `mean_ms`,
`median_ms`, `p90_ms`, `p99_ms`, `max_ms`. A puzzle **answer** is `right`
of `tries`, and `chose`, each try's action. Parts not run are `null`.
