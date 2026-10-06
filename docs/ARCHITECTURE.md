# Architecture

Current boundaries after cleanup Phase 7 (`4c4b8aa`, 2026-10-06).
[PLAN.md](PLAN.md) owns direction; this file owns implementation structure.

## One hand and one room

A game is a deterministic state machine. Chance is drawn outside it and
applied as an explicit action. Seat actions are checked by
`legal_actions(state, seat)` and applied with that seat; legality can exist
off turn (immediate 딜미스). `turn` says whom the driver waits for and when
chance is needed, not who is allowed to act.

A room owns seating, connections, pacing, a session of hands, scores,
persistence and broadcasts. It runs a game through table traits. Clients and
bots see the authorized view, not the full state. Replay uses versioned actions.

## Rust ownership

| Crate | Owns | Boundary |
| --- | --- | --- |
| [engine](../crates/engine) | Game, Bot, GameInfo, Table, HandReport, TableBots, Level | Core, rule metadata and table hooks; no model runtime |
| [engine-ml](../crates/engine-ml) | Encode, Spec, Observation, Belief, ActionValues | Model features/outputs; hidden targets separate from inputs |
| [mighty](../crates/mighty) | Rules, presets, state, actions, views, table hooks, encoding | Canonical Mighty legality/scoring; [RULES.md](../crates/mighty/RULES.md) describes it |
| [mighty-ai](../crates/mighty-ai) | Simple/search/hybrid bots, reading, endgame and sampling | Shared PIMC core; table bots implement TableBots |
| [harness](../crates/harness) | Checked play, parallel games, timing/stats/provenance | Generic over Game |
| [sim](../crates/sim) | Typed bot specifications and Research hooks | Shared research interface; explicit Mighty registration/spec handling |
| [lab](../crates/lab) | Controlled replay/phase diagnostics | Mighty-specific experiments; binary lab |
| [env](../crates/env), [env-py](../crates/env-py) | Deterministic batches, arrays, self-play/Python interface | Research + Encode; Python dispatch registers game ids |
| [eval](../crates/eval) | Suites, paired comparisons, puzzles, reports | Research hooks; CLI registers the measured game |
| [infer](../crates/infer) | ONNX loading, parity and prediction | Implements model-output traits via tract |
| [server](../crates/server) | Rooms, transport, stats, persistence, game catalog/codegen | Shared rooms; compiled games registered by id |

Generic cores and explicit registration are different responsibilities.
A binary naming Mighty at registration is expected; a shared room deciding
Mighty's scoring is not. The early `engine::dynamic`, `JsonGame` and
`SessionGame` abstractions are no longer the architecture.

## Server flow

1. GameCatalog resolves the game id and parses its typed rules/settings.
2. A typed Room receives shared RoomEnv dependencies and that game's bots.
3. Room actor receives player/internal messages; settle advances the hand,
   arms deadlines, schedules thinking, persists and broadcasts.
4. Bot jobs carry authorized view/legal actions to the remote worker or
   local fallback. Worker protocol/build identity is reported by /version.
5. HandReport supplies summaries/notes/outcomes; session owns multi-hand totals.
6. Typed snapshots replay/restore through the game's registry entry.

The room module is split into actor, seating, session, hand, clock, bots,
snapshot and view. Persistence/stats writers keep disk work out of the actor's
main decision path.

Game routes are `/api/games/{game}/...`; older routes alias the default game.
A saved room records its game. This is compiled registration, not a runtime
extension loader. [game.rs](../crates/server/src/game.rs) is the registry seam.

## Browser ownership

| Layer | Owns |
| --- | --- |
| [room/](../web/src/lib/room) | Connection, room lifecycle, seats, menu/lobby, notices and shared controls; generic client types |
| [games/registry.ts](../web/src/lib/games/registry.ts) | Game id to table, rules sheet, labels, rulebook and tools |
| [games/mighty/](../web/src/lib/games/mighty) | Mighty table, phases, card art, rules UI, replay and preview |
| [table/view.ts](../web/src/lib/games/mighty/table/view.ts) | Pure display state from the authorized view |
| [table/animator.svelte.ts](../web/src/lib/games/mighty/table/animator.svelte.ts) | Shown state, queued movement and local cues |
| [generated/](../web/src/lib/generated) | Server-derived protocol and catalogs |
| [ui/](../web/src/lib/ui) | Shared presentation primitives; [design contract](DESIGN.md) |

Server-generated data owns payoff breakdown, card refusals, proposed contracts,
pinned rules and catalog facts. Browser modules format/draw them; they should
not independently reimplement those domain decisions. CI rejects stale
generated files.

Remaining coupling: Mighty page titles/sitemap, stats preset titles,
rulebook/editor pages, practice preference keys and concrete codegen types.
The registry currently contains one game; a second game has not validated
every proposed boundary.

## Research and artifacts

Python `ml/` owns typed configs, data readers, models, training, export and
the experiment runner. Rust owns game transitions/encodings. Parity fixtures
cross the Python/environment and PyTorch/ONNX boundaries.

A model reads one versioned encoding. Current Mighty is `mighty-4`; historical
models/data record older versions. Do not silently load or convert incompatible
weights. Reproduce historical experiments at their recorded revision.

Large shards/models/raw synthetic evaluation results live outside git with
committed checksums. The public repository contains configs, manifests and
bounded reports, not secrets or real player logs. [Research index](../research).

## Adding a game

1. **Rules:** implement Game and GameInfo, then Table/HandReport for settings,
   catalog, hand options, pacing metadata, summaries and notes. Add invariants,
   deterministic replay and hidden-information tests.
2. **Bots:** implement Bot and TableBots in the game's bot crate. Keep difficulty
   policy and off-turn choices game-owned.
3. **Research:** implement sim::Research; add Encode if models are required,
   pin its spec and parity, then register Python dispatch and an eval suite.
4. **Server:** register Game + GameBots in GameCatalog::standard and visit its
   types in codegen. Add concrete protocol/client type handling; test save,
   restore, worker and game-scoped routes.
5. **Web:** create games/<id>/ with a GameEntry and GameTypes, register it,
   supply its table/rules/labels/tools. Resolve shared site assumptions as
   encountered; verify friends, bots, watchers and reconnects.

A poker implementation should expose gaps before adding further speculative
traits. Limit/no-limit Texas hold'em is the agreed scope; no poker behavior
is implemented yet.
