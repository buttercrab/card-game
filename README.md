# Card Game

A platform for card games with house rules, starting with Mighty (마이티).
Rules are data: each group's variant is a preset, checked by a simulator
before anyone plays it.

## Layout

| Part | What it is |
| --- | --- |
| [`engine`](crates/engine) | The `Game` trait every game implements and the `Bot` trait; `Encode` (positions as model inputs) and `DynGame` (any game through JSON) |
| [`mighty`](crates/mighty) | Mighty rules, nine regional presets, bots (a simple one and a search bot that plays at the table) and its model encoding; see [RULES.md](crates/mighty/RULES.md) |
| [`sim`](crates/sim) | Plays thousands of games and checks invariants after every step |
| [`env`](crates/env) | The batched RL environment over any game with an encoding, and the self-play data generator |
| [`env-py`](crates/env-py) | The environment in Python (`cardgame_env`, PyO3), which `ml` depends on |
| [`eval`](crates/eval) | Runs the eval suites in [`research/evals`](research/evals): bots measured on fixed deals, with a JSON record and a report |
| [`infer`](crates/infer) | Runs models trained in `ml` from Rust (ONNX, through the pure-Rust runtime tract): the belief model a search can deal hidden cards by |
| [`server`](crates/server) | Rooms over WebSockets: seats by share link, reconnect tokens, bots in empty seats |
| [`web`](web) | The table in the browser (Svelte 5 + Vite), in Korean; its look is specified in [DESIGN.md](docs/DESIGN.md) |
| [`ml`](ml) | Python training for learned bots (uv, PyTorch as an extra) |
| [`research`](research) | Eval suites, experiments, artifact manifests and the experiment loop |
| [`docs`](docs) | The plan, the design brief and how-tos; [index](docs/README.md) |

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
- **When something breaks:** 문제 신고 sends the table's move log, kept on
  the server for 14 days and listed on the owner's `/stats` page, each
  report readable in full for replaying the hand. An
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
state in both themes. Visual changes follow [DESIGN.md](docs/DESIGN.md).

## Deploy

[cards.buttercrab.io](https://cards.buttercrab.io) runs on a small AWS
Lightsail instance in Seoul (`cards-seoul`), reached directly: through
Cloudflare's free plan, Korean ISPs are routed via Los Angeles (about
500 ms a round trip). The home server builds the image and runs the bot
worker that thinks for its bots.

[`Dockerfile`](Dockerfile) builds the web client and the server into one
image serving port 3030. On the home server, a systemd timer runs
[`deploy/update.sh`](deploy/update.sh) every two minutes: when `main`
is not what runs yet and its CI run is green, it builds the image, ships
it to Seoul, where [`deploy/seoul/`](deploy/seoul) runs it behind Caddy
with an automatic certificate, checks that the site reports the new
commit at `/version`, and only then restarts the bot worker
([`deploy/compose.yaml`](deploy/compose.yaml)) on the same image. The
deployed commit is kept in `~/.local/state/card-game/deployed`, written
only when both are up, so a failed build, ship or restart is tried again
(10 minutes later, then further apart, at most hourly); a new server that
does not come up healthy in Seoul is replaced by the one that ran before.
The bot worker and the server greet each other with a protocol version
and their build commits; a worker of another protocol is turned away and
shows on `/stats`, and tables think for themselves meanwhile. The
[`deploy-watch`](.github/workflows/deploy-watch.yaml) workflow reads
`/version` every 15 minutes and opens an issue labelled `deploy`,
assigned to the owner, when main's newest green commit has not reached
the site 40 minutes after CI finished, or when main has waited on red or
unfinished CI for an hour; it closes the issue once the site catches up.
It runs on GitHub, so it also notices a home server that stopped
deploying, and the home server needs no token that can write. A failed
run of the update service also starts `card-game-update-failed.service`,
which logs it at error priority. `bash deploy/test/run.sh` runs both
scripts against stand-ins for docker, ssh, curl and gh. On a stop signal the server saves
every table to its `tables` volume and the next start restores them, so a
deploy only drops connections for a moment; players see "잠깐 다시 연결하는
중" and get their seats back. The image that ran before stays as
`card-game:previous`, and [`deploy/rollback.sh`](deploy/rollback.sh) puts
it back in both places (run it again to undo). A second timer runs
[`deploy/backup.sh`](deploy/backup.sh) daily, keeping 30 days of the
Seoul data directory (stats log, tables, reports) on the home server.

```sh
docker build -t card-game .
docker run --rm -p 3030:3030 card-game   # http://localhost:3030
```

Caddy ([`deploy/seoul/Caddyfile`](deploy/seoul/Caddyfile)) adds HSTS and
a Content Security Policy. The client needs a `blob:` worker (its
background timer), `blob:` images (the share card), its own fonts and
music, and Cloudflare's beacon; change the policy when the client starts
loading anything new. The server itself rate-limits table creation,
reports, client errors and WebSocket connects per client address; caps
open tables (`--max-rooms`, 500), request bodies, WebSocket message size
and each connection's message and hint rate; and runs at most two hint
searches at once. `/stats` shows open tables and the bot worker's link,
and the log warns when tables think with in-process bots instead.

### Stats and analytics

The server notes tables, seats, hands (finished or abandoned), reports and
client errors in `stats.jsonl` in its data directory: no cookies, IPs or
names, and players only as a salted hash of the id their browser keeps to
reclaim a seat. The salt is made on first run (`stats-salt`, next to the
log) unless `STATS_SALT` is set. The owner reads it at `/stats` (and as
JSON at `/api/stats`), which exist only when `STATS_TOKEN` is set: open
`/stats?token=<token>` once and a cookie keeps you in, or send
`Authorization: Bearer <token>`.

With `CF_BEACON_TOKEN` set, every page loads Cloudflare Web Analytics
(cookieless). On the Seoul instance both go in `~/card-game/site.env`,
which compose reads if present and which never enters the repository:

```sh
# on cards-seoul
cat > ~/card-game/site.env <<EOF
STATS_TOKEN=$(openssl rand -hex 32)
CF_BEACON_TOKEN=<token from Cloudflare: Analytics & Logs > Web Analytics > Add a site, "manual JS">
EOF
chmod 600 ~/card-game/site.env
cd ~/card-game && docker compose up --detach
```

Browsers report uncaught errors to `/api/errors`; `/stats` groups them by
message and top stack frame. Nothing is filed on GitHub: the repository is
public, and reports carry players' names and move logs.

## Test

```sh
cargo test --workspace
cargo run --release -p sim -- --games 2000            # every preset
cargo run --release -p sim -- --preset gshs --bots random
cargo run --release -p sim -- --players 4             # 3 to 7 players
cargo run --release -p sim -- --vary --bots random    # random optional rules each game
cargo run --release -p sim -- --games 2500 --bots search   # search bot vs simple bots
cargo run --release -p sim -- --preset gshs --bots search --focus search:100 --field search  # any two bots
cargo run --release -p eval -- run --suite v1 --bot hard --quick   # the eval suite, a few deals of each part
(cd web && npm run check)
(cd web && npm run build && npm run test:e2e)       # every page and /preview state, 4 sizes, light and dark; needs the release server build
cargo run --release -p env --example throughput     # the RL environment's speed
(cd ml && uv sync --locked --extra torch && uv run ruff check && uv run pyright && uv run pytest)  # builds env-py too
```

After every step the simulator checks that:
- the seat to act always has a legal move
- no card is created or lost
- payoffs sum to zero, and a made contract never costs the declarer (a
  failed one always does)
- the bidding never stays open past a bid nobody can top
- views don't change when hidden cards are reshuffled
- every game ends
- replaying the log reproduces the final state

## Roadmap

[docs/PLAN.md](docs/PLAN.md) is the plan: the game-agnostic service, the
learned bots (evals, RL environment, scaling studies, an experiment loop),
poker as the second game, and the order of work.
