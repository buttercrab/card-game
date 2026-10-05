#!/usr/bin/env bash
# Which CI jobs a change needs, from the files it touches (one per line on
# stdin). Prints `rust=`, `ml=`, `web=` and `e2e=` lines of true/false for
# $GITHUB_OUTPUT. CI runs it on pull requests only; pushes to main run
# everything. A job that is not needed still reports success, so required
# checks never wait on it:
#
#   git diff --name-only origin/main... | scripts/ci-changes.sh
#
# Anything this does not recognise runs every job.
set -euo pipefail

rust=false ml=false web=false e2e=false
everything() { rust=true ml=true web=true e2e=true; }

while IFS= read -r file; do
    case $file in
        '') ;;
        # Words only: nothing builds or reads them.
        *.md | docs/* | LICENSE | .gitignore) ;;
        # The deploy scripts have their own job, which always runs.
        deploy/* | Dockerfile) ;;
        # The web tests read the payoffs and presets the Rust side records.
        crates/mighty/tests/*) everything ;;
        crates/* | Cargo.toml | Cargo.lock) rust=true ml=true e2e=true ;;
        # Suites the eval crate and its tests load.
        research/evals/* | research/loop/suites/*) rust=true ml=true ;;
        # Configs and specs the Python tests check.
        research/*) ml=true ;;
        ml/*) ml=true ;;
        web/*) web=true e2e=true ;;
        *) everything ;;
    esac
done

printf 'rust=%s\nml=%s\nweb=%s\ne2e=%s\n' "$rust" "$ml" "$web" "$e2e"
