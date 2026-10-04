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

## At the table

- **Seats and bots:** share the link; fill empty seats with bots at 초보,
  보통 or 고수 (a search bot; the default).
- **Rules:** pick a preset, read it as a rulebook generated from the rule
  values, or change it between hands with the rule editor.
- **Between friends:** quick reactions, replay of every finished hand, and
  a per-device record (내 기록).
- **Learning:** a seven-step guide that ends in a practice table, a tip line
  on each turn, and an optional 💡 that shows what the bot would do.
- **Comfort:** sound, optional background jazz (CC0, from Open Lo-Fi),
  installable to the home screen, screen kept awake during a hand.
- **When something breaks:** 문제 신고 sends the table's move log; the deploy
  host files it as a GitHub issue labelled `report`, and
  [`report-fix`](.github/workflows/report-fix.yaml) has Claude propose a
  fix as a pull request (needs the `ANTHROPIC_API_KEY` secret). An
  [uptime check](.github/workflows/uptime.yaml) opens an `outage` issue
  when cards.buttercrab.io stops answering.

## Play

```sh
(cd web && npm install && npm run build)
cargo run --release -p server        # http://127.0.0.1:3030
```

Create a table, share its link, and add bots to any empty seats. Pass
`--addr 0.0.0.0:3030` so friends on your network can join. Pass
`--data <dir>` to save tables there, so a restart picks every hand up where
it was; without it rooms live in memory only.

For frontend work, run `npm run dev` in `web/` while the server runs. Vite
forwards `/api` to the server. `/deck` shows every card face, size and
state in both themes. Visual changes follow [DESIGN.md](DESIGN.md).

## Deploy

[cards.buttercrab.io](https://cards.buttercrab.io) runs on a small AWS
Lightsail instance in Seoul (`cards-seoul`), reached directly: through
Cloudflare's free plan, Korean ISPs are routed via Los Angeles (about
500 ms a round trip). The home server builds the image and runs the bot
worker that thinks for its bots.

[`Dockerfile`](Dockerfile) builds the web client and the server into one
image serving port 3030. On the home server, a systemd timer runs
[`deploy/update.sh`](deploy/update.sh) every two minutes: when `main`
moves it rebuilds, restarts the bot worker
([`deploy/compose.yaml`](deploy/compose.yaml)) and ships the image to
Seoul, where [`deploy/seoul/`](deploy/seoul) runs it behind
Caddy with an automatic certificate. Tables are saved in a `tables`
volume, so a deploy only drops connections for a moment.

```sh
docker build -t card-game .
docker run --rm -p 3030:3030 card-game   # http://localhost:3030
```

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
