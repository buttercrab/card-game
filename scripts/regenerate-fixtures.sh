#!/usr/bin/env bash
# Rewrites every pinned fixture from the code as it is now, for a change
# that means to move them: a new encoding VERSION, a scoring change, a
# search that decides differently on purpose, a new preset. Review the diff
# before committing it; a fixture that moved unexpectedly is a bug.
#
#   scripts/regenerate-fixtures.sh          # everything
#   scripts/regenerate-fixtures.sh --rust   # skip the PyTorch-made ones
#
# Rust:
#   crates/mighty/tests/presets.json        the presets' rules
#   crates/mighty/tests/payoffs.json        scoring (the web tests read it)
#   crates/mighty/tests/encoding.json       the encoding spec
#   crates/mighty/tests/pinned/*.jsonl      encodings and search decisions
#   crates/env/tests/parity.json            the environment, for Python
# Python (uv, with the torch extra):
#   crates/infer/tests/tiny, tiny-q         tiny models and their outputs
#
# The pinned games' rules (crates/mighty/tests/pinned/*-games.json,
# crates/env/tests/parity-rules.json) are frozen and never rewritten here,
# so changing a preset moves only presets.json and payoffs.json.
set -euo pipefail
cd "$(dirname "$0")/.."

rust_only=false
case "${1:-}" in
    --rust) rust_only=true ;;
    '') ;;
    *)
        echo "usage: $0 [--rust]" >&2
        exit 2
        ;;
esac

write() {
    echo "== $*"
    cargo test --quiet "$@"
}

write -p mighty --lib -- --ignored write_preset_snapshot
write -p mighty --lib -- --ignored write_payoff_fixture
write -p mighty --test encode -- --ignored write
write -p mighty --test search -- --ignored write
write -p env --test parity -- --ignored write

if ! $rust_only; then
    echo "== infer fixtures (PyTorch)"
    # uv rebuilds the bindings when their Rust changed (see crates/env-py).
    uv sync --directory ml --locked --extra torch
    uv run --directory ml python -m cardgame_ml.export.fixture
fi

git status --short -- crates/mighty/tests crates/env/tests crates/infer/tests
