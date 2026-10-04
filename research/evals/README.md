# Evals

Eval suites, by version: `v1/`, `v2/`, and so on. A suite is the
scoreboard every bot and model is measured on, so it changes only by a new
version, never in place; results always name the version they ran.

A suite fixes everything that decides a score: the bots or rule sets
played, deal seeds, seat rotation, game counts and the statistics reported
(points per seat-hand with 95% intervals, think time). Deals are paired
and seats rotated so two bots meet the same cards.

Held-out rule sets are listed here only by hash; the sets themselves stay
where the training side and the experiment loop cannot read them.

The runner (`crates/eval`, P1) reads a suite from here and writes JSON and
a Markdown report into the experiment that asked for it.
