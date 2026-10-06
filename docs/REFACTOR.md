# Codebase plan (2026-10-05)

Eight read-only reviews covered the codebase on 2026-10-05:
- web client architecture;
- web styles and components;
- server;
- engine and Mighty;
- research crates (sim, eval, env, infer);
- the ML package;
- cross-cutting duplication;
- tests, CI, deploy and repo hygiene.

The verdict was consistent. Line by line the code is careful: lint and type checks are clean, tests are real, and there are no TODOs or commented-out code. The problems are structural:
1. **Facts stated in several places that have started to drift:** scoring, rules, the protocol, bot levels, presets, error text and limits.
2. **Hooks and flags added for each feature instead of a design:** the server's `SessionGame` trait, the bot's always-on switches, rule booleans, and the bot-spec mini-language.
3. **God files:** `Table.svelte` (3,600 lines, about 10 jobs, 1,700 lines of CSS), `room.rs` (1,400 lines), `lab.rs` (1,500 lines).
4. **Missing shared primitives:** a card set, trick context, PIMC core, the Button/Sheet/Popover/Segmented UI primitives, a typed config/schema reader.
5. **Process:** code lands on `main` before CI runs, pinned hashes are re-pinned on every rule change, and the web client has no unit tests.

Work goes in phases. Each phase ships on its own, keeps every test green, and gets the owner's go-ahead before deploy. Phase 0 starts once the current work (room redesign plus shuffle fixes) is deployed.

## Phase 0: real bugs (first, small)

| Bug | Where | Fix |
|---|---|---|
| Leaving a table while it reconnects re-seats you, and a dead client keeps running | `web/src/lib/client.svelte.ts` reconnect timer | Cancel the timer on close; check `closed` after awaits; forget the token even when unseated |
| A failed build or Seoul ship is never retried, and the worker and Seoul can split versions | `deploy/update.sh` (resets HEAD before building) | Record the deployed commit in a state file; ship Seoul first; `OnFailure=` alert; alert when blocked on red CI |
| The research loop picks up and commits a researcher's specs mid-call, which hides violations | `ml/.../loop/scheduler.py`, `gitops.py` | Treat a researcher call as a critical section; use a staging inbox, settled after validation |
| A dead DMC actor goes unnoticed; the run idles and "succeeds" | `ml/.../train/dmc/learner.py` | Check actor exit codes each loop; send actor errors to the learner |
| Manifest commit rewritten by export; config changes on resume not recorded | `ml/.../runs.py`, `learner.py` | Per-session commit, config hash and seed; refuse a changed resume |
| Simple bot counts never-dealt low cards in 3마/4마 as unseen (phantom trumps) | `crates/mighty/src/bot.rs` `deck()` | Build the deck from `rules.cards()`; regression test at 3 and 4 players |
| Turn ring and first-bid bar are broken under reduced motion and speed 끄기 | `TurnRing.svelte`, `BidPanel.svelte`, `app.css` | One motion source; indicators that carry state never use CSS animation |
| The result ledger can disagree with the payoffs (BidBonus clamp) | `Table.svelte` `ledger`, `Rulebook.svelte` `handValue` | Quick clamp fix now; removed for good in Phase 2 |
| The client shows today's preset rules instead of the table's pinned rules | `Room.svelte`, `RulebookSheet`, `RuleEditor` | Use `preset_rules` from the room message |
| A stale hint can show after the hand moved on | `client.svelte.ts` (ignores `hint.version`) | `version` on `state`; drop stale hints |
| Notices ("자리를 섞었어요", card refusals) play the error sound | `client.svelte.ts` `notice()` shares `error` | A toast store with a `kind` |
| Bot worker version skew stalls every bot move by 2 s, silently | `crates/server/src/bots.rs` | Handshake with protocol version; always reply, even with an error |
| `away` not cleared on reclaim; leaving mid-hand isn't recorded in stats | `room.rs` join/Leave | Clear on reclaim; record the event |
| An old puzzle log can replay "successfully" to a different position | `crates/eval/src/puzzle.rs` | Versioned puzzle file; explicit one-time migration |
| The Python "reproducible bot" regex passes `search` and `search:400` | `ml/.../loop/methods/evalonly.py` | A Rust `eval check-bot --json` command |
| The bot-spec parser accepts unknown keys and extra parts | `crates/sim/src/spec.rs` | Reject unknown keys and extra parts (full typed spec in Phase 4) |
| The GitHub token is visible in `ps` on the home server | `deploy/update.sh` | `curl --config` with a mode-600 file |

## Phase 1: process and safety nets

- **Nothing reaches `main` without green CI.** Agent work goes through pull requests with required checks; deploy is still "merge to main". The owner already said yes to protecting `main`; requiring PRs is the next step of the same thing.
- **Faster CI:**
  - `opt-level = 1` for tests;
  - `fail-fast: false`;
  - path filters;
  - Windows off the critical path;
  - shellcheck;
  - `svelte-check` at threshold `warning`.
- **Pins that protect something:**
  - build the pinned games from frozen `Rules` literals, not presets;
  - search decisions as a readable golden action log, not a single hash;
  - one script regenerates all fixtures, plus a spec-hash test.
- **Seeded randomness and shared helpers:**
  - seed every test RNG and print the seed on failure;
  - shared `tests/common` for the server;
  - a `mighty::testing` module (`cards!`, fixed deals, a random-hand driver);
  - replace sleeps with polling or a paused clock;
  - an e2e ready signal instead of a fixed 900 ms wait.
- **Web unit tests:** vitest for the pure modules, plus one Playwright flow that plays a card, reloads and reclaims the seat.
- **Repo:**
  - add a `LICENSE` (MIT, as declared);
  - ignore `.claude/` and prune merged worktrees and branches (106 GB);
  - pin image digests and the Rust toolchain;
  - one `tokio-tungstenite` version on rustls;
  - offsite backups with a monthly restore test;
  - a real health check for the bot worker.

## Phase 2: one source of truth between server and client

1. **Error codes.** `enum RoomError` is serialized as `{code}`. The client keeps an exhaustive Korean map, which replaces 22 ordered regexes and fixes the generic toasts. HTTP errors use the same codes.
2. **Typed protocol.**
   - `ServerMsg`, `ClientMsg`, the view, rules and action types get `#[derive(TS)]` (ts-rs), generated into `web/src/lib/generated/`, with CI failing on a diff.
   - Delete the hand-written `types.ts` and about 30 `?? default` fallbacks.
   - Build preview fixtures from `presets.json`.
3. **The server says what the client was guessing:**
   - the score breakdown in `Done`;
   - why each card can't be played;
   - the contract each `ChangeTrump` would produce;
   - the effective rules and a `customized` flag in the room message;
   - rules accepted on `POST /api/rooms`.

   Then delete `ledger`, `handValue`, `refuse`, `changedCount`, both `DEFAULT_SCORING`s and the pending-rules session storage.
4. **One generated catalog.** `server --dump-catalog` produces it at build time. It holds presets (id, title, note, rules), bot levels, turn limits, reactions, name and report limits, first-bid grace, the default preset and idle minutes. Then delete `presets.ts`, `site::preset_name`, `dashboard::level_name`, `TURN_CHOICES` and the reaction lists.
5. **Bot levels defined once:** `mighty::bot::Level { Easy, Normal, Hard }` with `build(seat, budget)` and `label()`, used by the server, env, sim and lab. Delete env's `BotSpec` levels and the lab's `HARD`.

## Phase 3: server structure

- **Config:** one `Config` (clap plus environment), parsed once, and an `Arc<RoomEnv>` (bots, clock, remote, stats, persistence) handed to rooms. Delete the four room setters.
- **Split `room.rs`** into a thin actor with a `settle()` step (advance, arm the clock, think, persist, broadcast) plus:
  - `seating`;
  - `session` (scores, history);
  - `hand` (state and typed log);
  - `clock`;
  - `bots` (pacing and the driver);
  - `snapshot`.
- **Typed internal channel** for bot moves; no `Box<dyn Any>`.
- **Persistence:**
  - `SnapshotV2` with a typed `LogEntry` and `migrate_v1`;
  - dirty-flag writes from a persister task, not serialize-and-compare on every wake;
  - stats through a buffered writer task.
- **Time and tests:** `tokio::time::Instant` everywhere. Unit-test the room directly with paused time, replacing the sleep-based TCP tests and `with_turn_second`.
- **Rate limits** in `limit.rs` only, with an injected hint pool instead of a static.
- **Broadcasts:** send the session (history, hands) only when it changes.

## Phase 4: engine, Mighty and the research crates

- **Cards:** one `CardSet(u64)` and `Card::slot()` in `card.rs`, replacing three encodings and three `card_of` helpers.
- **Trick rules once:**
  - `Rules::trick_context`;
  - a single `powered()` check;
  - private `State` fields with constructors;
  - read and endgame replay through `State::step` instead of their own copies of the play rules.
- **Phase structs:** pull `Declared { declarer, contract, discards }` out of the phases; `Arc<Rules>` in `State` and `View`.
- **Rule options:**
  - a `MisdealWindow` enum instead of five booleans;
  - `validate` rejects meaningless combinations and always-misdeal thresholds;
  - `MAX_PLAYERS`;
  - rename `Rules::default` to `web_mighty()`;
  - per-option RNG streams in `varied`.

  This changes the encoding (`mighty-4`).
- **Bots:**
  - delete the four always-on flags and dead branches;
  - name the lead-score constants;
  - serde for bot knobs instead of a hand-kept list;
  - move the measurement history to `research/`.
- **New `mighty-ai` crate** (simple bot, a PIMC core shared by search and hybrid, endgame, reading, sampler). `Arc` models instead of `Box::leak`. Inference failures fall back to the baseline instead of panicking. This also removes the deal↔search cycle and narrows the public API.
- **Research crates:**
  - a typed bot spec with one parser and printer;
  - split a `harness` (play driver, statistics, provenance) out of `sim`;
  - `lab` becomes its own crate split by experiment, with tests;
  - drop the `belief`/`dmc` feature flags;
  - one `ModelError` in `infer`;
  - opponent fingerprints in eval results.

## Phase 5: ML package

- One typed schema reader replaces three config parsers. `Policy`, `Spec`, `RunRecord` (with `StrEnum` statuses) and `EvalResult` move onto it; a bad record is quarantined instead of crashing the runner.
- `RunDir` with an explicit kind, plus `models/io.py` with one `load_model()` and an encoding check for every kind.
- One `Observation` type and `to_tensors()`.
- Typed loop roles and a shared `CurveReport`. Promote on the primary metric only. Hosts come from policy roles, not hard-coded "mac"/"home".
- Remove dead code (`prune`, the `scaling` stub, `resumable`, duplicated helpers).

## Phase 6: web client and design system

- **Tokens:**
  - write each dark-theme value once (`light-dark()`);
  - type, space, radius, z-index and motion tokens;
  - colours for content on team badges and cards;
  - remove unused aliases and literal hexes;
  - a `tokens.ts` shared with ShareCard and CardBack.
- **Motion:** one source, so "keep fades, drop movement" holds. Remove particles, idle loops and blurred shadows.
- **Primitives:** an unstyled base `button`, then:
  - `Button` and `Chip`;
  - `Segmented` and `Switch`;
  - `Sheet`;
  - `Popover`, with dismissal and back-gesture behaviour shared;
  - `Pill` and `Bubble`;
  - a self-colouring `SuitIcon` (with drawn suits in copy).
- **Split `Table.svelte`:**
  - pure modules (view model, narration, labels, seats);
  - an animator and element registry instead of global `querySelector`;
  - `StatusBar`, `Felt`, `Tray`, `ResultSheet`, `SidePanel`, each owning its CSS;
  - one `Reactions` and one hint instance;
  - one breakpoint set shared with `Hand`.
- **Preview and tools:** a `TableClient` interface with a fake for previews (no preview props or sentinels in production code); lazy-load `/preview`, `/deck` and `/share`.
- **DESIGN.md** updated to the sizes actually kept.

## Phase 7: game boundary (before a second game) — done (2026-10-06)

Done: legality by seat (`legal_actions(state, seat)`, `apply(state, seat,
action)`; the 딜미스 window is ordinary legality, and saved `out_of_turn`
log entries read as the seat's move); the traits are `Game`, `GameInfo`,
the table's `Table`/`HandReport`/`TableBots` (Mighty's in `mighty` and
`mighty-ai`, none in the server) and the research tools' `sim::Research`
(replacing `EnvGame` and `EvalGame`); `engine::dynamic` is gone; a
`GameCatalog` with `/api/games/{game}/...` routes (the old ones alias the
first game) and a generated catalog per game; `engine-ml` split out; a
web `room/` without Mighty and a game registry. What a new game needs is
in [PLAN.md](PLAN.md#adding-a-game). The plan as written:

- `Game` legality addressed by seat: `legal_actions(state, seat)`, `apply(state, seat, action)`. This removes out-of-turn actions and `bids_as`.
- Merge the five game traits (`Game`, `JsonGame`, `SessionGame`, `EnvGame`, `EvalGame`).
  - `impl` for Mighty moves out of the server.
  - The server's `SessionGame` hook pile is split into small traits.
  - A `GameCatalog` keyed by game id, with game-scoped routes.
  - Delete or fold `engine::dynamic`.
- Split `engine-ml` (spec, observation, belief, action values) out of `engine`.
- Front end: a `room/` that knows nothing about Mighty, and a game registry.

## Owner decisions (2026-10-05)

1. **Merge to `main` only through pull requests with green CI:** yes. Agent branches become PRs, and the deploy flow is otherwise unchanged.
2. **Deploy alerts:** yes. Open a GitHub issue when a deploy fails or is blocked for over an hour.
3. **`research/loop`:** stays in this public repo, with its own CI job.
4. **Rules in the browser:** compile `mighty` to WASM, or rely on server-computed values from Phase 2. Decide after Phase 2.

Code fixes start only after the room redesign and shuffle fixes are deployed.
