# Experiments

One folder per experiment, named `YYYY-MM-DD-short-name`, holding:

- `config.toml`: everything the run depends on, seeds included. Typed
  configs from `ml/` or a tool's own; no setting left to a default that
  could change under it.
- `README.md`: the hypothesis before the run, then what happened and what
  it means. Short.
- `results/`: what the run wrote (JSON, Markdown reports), small enough for
  git. Anything larger goes outside git with a manifest in
  [`../manifests`](../manifests).

The commit an experiment ran at is part of it: record it in the README or
in the results, so `git checkout <commit>` plus the config and seeds
reproduces it. A result counts once it repeats on fresh deals.
