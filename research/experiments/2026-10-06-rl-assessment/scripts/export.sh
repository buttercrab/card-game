#!/bin/bash
set -e
cd /Users/jaeyong/Development/Github/card-game/.claude/worktrees/agent-a199a6aff6c91e76e/ml
A=$HOME/card-game-artifacts/assess-2026-10-06
nice -n 10 uv run python -m cardgame_ml.export --run dmc-v2 --weights "$A"/dmc-v2-final-weights.pt --out "$A"/dmc-v2-final --allow-dirty
nice -n 10 uv run python -m cardgame_ml.export --run dmc-v2 --weights snapshots/hands-0000040001.pt --out "$A"/dmc-v2-h40k --allow-dirty
nice -n 10 uv run python -m cardgame_ml.export --run dmc-v2 --weights snapshots/hands-0000080021.pt --out "$A"/dmc-v2-h80k --allow-dirty
ls "$A"/*
