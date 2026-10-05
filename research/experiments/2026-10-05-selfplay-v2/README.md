# Self-play v2 (cut short)

**Plan.** [`config.toml`](config.toml): self-play v1's mix on 60 000
fresh games (about 3.5M decisions), for belief models that want more
data than v1 (belief v1 large overfit on v1).

**Run.** Commit `4224aa5`, 2026-10-05, 12 threads at `nice -n 10`.
**Stopped by the owner** at about 57 600 of 60 000 games, when P3 was
closed to move to self-play RL. The generator writes `meta.json`,
`rules.jsonl.gz` and the manifest only at the end, so none exists:

- 17 whole shards survive in `selfplay/selfplay-v2/` of the artifact
  store: 3 400 542 decisions of games 0–56 305 (56 306 games), 3.1 GB.
- Without `meta.json`, `cardgame_ml.data.shards.Dataset` cannot open
  them, and there is no manifest. The shards are byte for byte what
  the full run would have written first (games are written in order),
  so rerunning the config from the commit reproduces them; nothing
  trained on them (belief v2's config was never run).
