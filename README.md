# Card Game

A platform for card games with house rules, starting with Mighty (마이티).
Rules are validated data; games replay from explicit actions and share room
infrastructure. The Korean table is built for playing with friends.

Mighty is implemented. The cleanup phases are merged; Texas hold'em is not
yet implemented. Learned-bot research is paused; the playable 고수 uses
search, not a promoted neural model. [Current direction](docs/PLAN.md).

## Play locally

```sh
(cd web && npm ci && npm run build)
cargo run --release -p server        # http://127.0.0.1:3030
```

Create a table, share its link, and add bots to any empty seats. Pass
`--addr 0.0.0.0:3030` so friends on your network can join. Pass
`--data <dir>` to save tables there, so a restart picks every hand up where
it was; without it rooms live in memory only.

For frontend work, run `npm run dev` in `web/` while the server runs. Vite
forwards `/api` to the server. `/deck` shows every card face, size and
state in both themes. Visual changes follow [DESIGN.md](docs/DESIGN.md).

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

## Layout

| Directory | Purpose |
| --- | --- |
| [crates/](crates) | Rust game core, Mighty, bots, environment, research tools, inference and server |
| [web/](web) | Svelte 5 browser table and shared UI |
| [ml/](ml) | Python training, export and experiment-runner library |
| [research/](research) | Suites, experiments, manifests and loop policy |
| [docs/](docs) | Direction, architecture, design and operating references |

The [architecture map](docs/ARCHITECTURE.md) names each crate's owner and
boundary. A game replays explicit chance/seat actions; authorized views keep
hidden information out of clients and bots.

## Documentation

| Read | Purpose |
| --- | --- |
| [Plan](docs/PLAN.md) | Goals, current state, roadmap, decisions and AI restart conditions |
| [Architecture](docs/ARCHITECTURE.md) | Ownership, data flow and adding a game |
| [Design system](docs/DESIGN.md) | Tokens, component APIs, layout, motion, sound and UI verification |
| [Development](docs/DEVELOPMENT.md) | Local setup, checks, generators and research-tool reference |
| [Operations](docs/OPERATIONS.md) | Deployment, worker, monitoring, privacy and backups |
| [Remaining work](docs/FIXES.md) | Open gaps and product regression contracts |
| [Cleanup record](docs/REFACTOR.md) | What phases 0–7 delivered and what they did not prove |
| [Mighty rules](crates/mighty/RULES.md) | Rules as implemented, including preset differences |
| [Research](research/README.md) | Historical experiments, manifests and evidence limits |

## Delivery

The intended topology is a Seoul site plus a home build/bot worker. Main
auto-deploys after CI: use branches and PRs, and treat merge as a release.
Check `/version` for server and worker identities; see the operating reference
for validation, rollback and backup limitations.
