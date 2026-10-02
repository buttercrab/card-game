# Card Game

A platform for card games with house rules, starting with Mighty (마이티).
Rules are data: each group's variant is a preset, checked by a simulator
before anyone plays it.

## Layout

| Part | What it is |
| --- | --- |
| [`engine`](crates/engine) | The `Game` trait every game implements, plus the `Bot` trait |
| [`mighty`](crates/mighty) | Mighty rules, nine regional presets, and bots: a simple one and a search bot that plays at the table; see [RULES.md](crates/mighty/RULES.md) |
| [`sim`](crates/sim) | Plays thousands of games and checks invariants after every step |
| [`server`](crates/server) | Rooms over WebSockets: seats by share link, reconnect tokens, bots in empty seats |
| [`web`](web) | The table in the browser (Svelte 5 + Vite), in Korean; its look is specified in [DESIGN.md](DESIGN.md) |

A game is a deterministic state machine:
- `legal_actions` is the only source of truth for what is allowed.
- `view` gives each seat only what it may see.
- Shuffling is a server-drawn chance action, so any game replays exactly
  from its log.

## Play

```sh
(cd web && npm install && npm run build)
cargo run --release -p server        # http://127.0.0.1:3030
```

Create a table, share its link, and add bots to any empty seats. Pass
`--addr 0.0.0.0:3030` so friends on your network can join. Rooms live in
memory, so restarting the server closes them.

For frontend work, run `npm run dev` in `web/` while the server runs. Vite
forwards `/api` to the server. `/deck` shows every card face, size and
state in both themes. Visual changes follow [DESIGN.md](DESIGN.md).

## Test

```sh
cargo test --workspace
cargo run --release -p sim -- --games 2000            # every preset
cargo run --release -p sim -- --preset gshs --bots random
cargo run --release -p sim -- --games 2500 --bots search   # search bot vs simple bots
cargo run --release -p sim -- --preset gshs --bots search --focus search:100 --field search  # any two bots
(cd web && npm run check)
```

After every step the simulator checks that:
- the seat to act always has a legal move
- no card is created or lost
- payoffs sum to zero
- views don't change when hidden cards are reshuffled
- every game ends
- replaying the log reproduces the final state

## Roadmap

1. Engine core, Mighty, simulator
2. **Playable with friends**: rooms, table UI, bots in empty seats (this)
3. Poker, to prove the engine is general
4. AI-written house rules, gated by the simulator
5. Public
