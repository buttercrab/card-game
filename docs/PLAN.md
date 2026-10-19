# Project direction

Updated 2026-10-06 against `4c4b8aa`. This document owns goals, priorities,
decisions and completion criteria. Implementation details belong in
[ARCHITECTURE.md](ARCHITECTURE.md), instructions in
[DEVELOPMENT.md](DEVELOPMENT.md), and experiment evidence in [research](../research).

## Goal

Build a platform where friends play card games with their own rules, starting
with Mighty (마이티), and build bots that play those rules well. Mighty is the
driving use case. Texas hold'em is the second game that will test the shared
platform.

1. **Product:** a responsive Korean table with understandable rules, stable
   seats, reliable reconnects and useful bots. Friend groups first; site and
   repository are public.
2. **Platform:** share rooms, links, seating, sessions, persistence, reports
   and infrastructure. Each game supplies rules, presets, bots and table UI.
3. **AI:** one model per game, eventually covering that game's presets,
   custom rules and player counts. Games share training infrastructure;
   shared weights across games are not a requirement.
4. **Research:** reproducible evaluations and scaling studies that show where
   the next hour of compute should go. Building an experiment loop is not
   proof that this goal has been reached.

## Current state

| Track | State | Evidence and remaining boundary |
| --- | --- | --- |
| Mighty product | Implemented and deployed at takeover | Server and connected worker reported `4c4b8aa`; its CI passed. A dated receipt, not a permanent health claim. |
| Codebase cleanup | Phases 0–7 merged | [REFACTOR.md](REFACTOR.md) records delivered changes and residual items. |
| Game boundary | Substantially implemented | Typed game/table traits, catalog and frontend registry; only Mighty is registered and some site pages remain specific to it. |
| Evals and environment | Implemented | Suite v1, Rust/Python parity, self-play manifests and historical baseline reports; refresh the current-rules baseline. |
| Belief model | Experiment concluded; not promoted | Prediction improved; equal-time playing-strength gate was not met. |
| Self-play RL | Paused by the owner | DMC v1/v2 missed the target; v2 assessment identifies data and target problems. |
| Scaling study | Not completed | No controlled report selects model size or compute allocation. |
| Autonomous loop | Built; operation unproven and paused | No qualifying overnight batch or daily-report series is recorded. |
| Texas hold'em | Not implemented | No poker engine, table, bots, encoding or suite. |

**REFACTOR phases 0–7** are the delivered cleanup. **Roadmap P0–P7** below
are the product/AI program. Finishing cleanup did not finish poker or AI.

## Principles

- **Rules are data.** The engine owns validation, legality, scoring and card
  meanings. Models receive rule-derived features and choose legal actions.
- **Hidden information stays hidden.** Clients and bots receive a seat's
  view. Full-state belief targets are training labels, never model inputs.
- **Boundaries follow responsibilities.** Shared drivers depend on game
  traits; registration and game-specific UI are explicit. Prove generality
  with a second game.
- **Results belong to a revision.** Record commit, config, seeds, rules,
  encoding, opponents and machine/load. Historical numbers do not describe
  current performance after rules or bots change.
- **Keep the scoreboard independent.** Freeze evaluation definitions,
  exclude held-out rule sets from training, confirm wins on fresh deals.
- **Promotion is separate.** Beat the served baseline at the intended
  thinking budget, avoid material rule regressions, and obtain the owner's
  approval before a learned bot reaches players.
- **Use PRs.** Main auto-deploys; merging is a release action. No secrets,
  player data or real game logs in the public repository.

## Roadmap and acceptance criteria

| Phase | Outcome | Status / exit requirement |
| --- | --- | --- |
| P0 — foundations | Encoding, ML project, provenance and CI | Delivered. Encoding now lives in `engine-ml`; the early dynamic API was replaced by the table/catalog boundary. |
| P1 — evaluations | Paired deals, rotated seats, presets, held-out rules, timing and puzzles | Historical reproduction delivered; freeze current rules and refresh the served-bot baseline before promotion claims. |
| P2 — environment/data | Deterministic batches, Python bindings, parity and reproducible shards | Delivered, including 1.19M decisions in self-play v1. Historical data uses older encodings. |
| P3 — belief | Predict hidden-card owners and guide search | Prediction gate A passed; equal-time strength gate B did not. Not promoted. |
| P3b — self-play RL | Learn all phases from self-play | Paused. Exit: beat 보통 on the agreed suite with a learning curve; report whether it beats 고수 alone or in search. |
| P4 — scaling | Compare strength against games, size and compute | Paused. Exit: a controlled report selecting served sizes and the next compute investment. |
| P5 — experiment loop | Queue, run, evaluate, confirm and report | Built, paused. Exit: at least ten unattended overnight experiments with readable results. |
| P6 — shared service | Preserve Mighty behind shared room/game interfaces | Mostly delivered by cleanup Phase 7. Resolve residual site coupling and validate the same player flows. |
| P7 — Texas hold'em | Limit/no-limit rules, table, bots, encoding and suite | Unstarted. Exit: friends/bots can play, and env/evals integrate without rewriting shared drivers. |

### Results already obtained

- [Baseline](../research/experiments/2026-10-04-eval-v1-baseline): historical
  고수 rating +6.81 ± 0.29 on v1's four-rung mean, including random opponents.
  Predates scoring G and later bot changes.
- [Belief v1](../research/experiments/2026-10-05-belief-v1): validation loss
  1.461 versus 1.595 nats per hidden card; held-out 1.517 versus 1.645.
  Equal-time preset play +0.02 ± 0.29 points per seat-hand. Home-server cost
  was not rechecked; playing-strength target not established.
- [DMC v1](../research/experiments/2026-10-05-dmc-v1): about 510k hands;
  −0.40 ± 0.31 against 초보 and −1.38 ± 0.32 against 보통 on recorded rules.
  Stopped before the full-suite exit check.
- [DMC v2 assessment](../research/experiments/2026-10-06-rl-assessment):
  stopped near 119k hands; −2.97 ± 0.21 against the assessment's 보통.
  Almost all contracts came from exploration, mostly poor ones. Exchange
  and declarer play stayed weak; discarded deals inherited later rewards.
  All thirty assessment artifacts matched their manifest at takeover.

### Conditions for restarting AI

Training, scaling and unattended research remain paused. Before a restart:

1. Correct discarded-deal targets and reset exploring-start bookkeeping at
   redeals; verify targets by seat and deal.
2. Make declarer training useful. The assessment recommends plausible
   contracts chosen by lookahead using the network's own play. Using a
   hand-written teacher remains an owner decision.
3. Establish frozen rules, the served-bot spec/time budget, primary metric
   and fresh-deal confirmation.
4. Use a new compatible run: current encoding is `mighty-4`; v1 weights use
   `mighty-1`, v2 uses `mighty-3`. Loaders refuse mismatches by design.
5. Agree compute/spending limits before loop installation. The $5/call and
   $20/day policy values are defaults, not a new approval.

More capacity or more unchanged self-play is not the recommended next step.

## Next milestone: shared platform for games we build

Direction selected 2026-10-11: the team implements and ships all games.
Dynamic user-code loading, sandbox runtimes and a plugin marketplace are out
of scope. Games remain compiled/registered. Shared contracts are required on
both backend and frontend; renderer choice is a separate decision. Existing
AI/training pauses and deployment authority remain unchanged.

The proposed proving game is Texas hold'em. The following sequence is a plan,
not a claim that its SDK, renderer experiment or poker implementation exists.

1. **Enforce shared controls first.** Inventory existing actions and define
   primary, secondary, quiet, danger, icon and selection primitives with
   named sizes and complete interaction states. Migrate Mighty/room controls;
   callers own placement and content, not surface/font/focus/disabled styles.
   Approved card/seat interaction primitives remain distinct from buttons.
   Gate: light/dark component gallery plus real desktop/mobile visual review,
   consistent effective hit targets and checks against private style variants.
2. **Define backend and frontend game contracts.** Retain Rust Game/Table/
   HandReport and shared Room ownership. Games own legality, scoring and any
   game-specific state across hands. Frontend adapters supply card/identity
   presentation and actions; common code owns participation, layout, motion
   and shared controls. Allow parameterized actions such as raise amounts
   rather than requiring every possible amount in an enumerated button list.
   Gate: document owners, extension points and a concrete Mighty/poker mapping;
   preserve generated protocol alignment and Mighty behavior.
3. **Connect Mighty fully to the frontend contract.** Separate semantic game
   events from DOM playback; introduce a renderer-neutral scene/motion adapter
   using authorized player views, stable identities and shared design tokens.
   Keep game-specific composition where genuinely necessary; do not design a
   restrictive universal screen. Gate: entry, seating, bots, observer handoff,
   full hand, round review, result and next-hand flows, with phase/turn-stable
   opponent geometry and interruption-safe movement. Capture screens/videos
   on desktop, tablet and two phone profiles.
4. **Compare renderers in a bounded prototype.** Feed the same scene, assets,
   controls and timeline to current DOM/SVG and a PixiJS/WebGL adapter. Compare
   dealing, exchange-size hands, play, collection, shuffle and return-to-center.
   Gate: visual fidelity including Korean text/emoji, input/focus equivalence,
   resize/DPR/reduced-motion behavior, loading cost, frame timing and idle work.
   Adopt Canvas only if measured/user-visible benefits justify its cost;
   retaining DOM is a valid outcome. Keep native menus/forms and accessible
   card controls; define initialization/context-loss behavior before adoption.
5. **Prove reuse with actual Texas hold'em.** Start with play-money, fixed
   table capacity and initial stacks. Implement legal betting, showdown and
   side pots, stack/dealer/blind continuity, and basic bots. Extend shared
   session hooks only where required; chip semantics belong to poker, not
   generic Room. Gate: two complete games reuse rooms, reconnects, observers,
   controls, table infrastructure and reports without copying those owners;
   play through multiple hands with changing stacks and verify both games.
   Buy-ins, tournament progression and advanced poker AI are later scope.

Implementation receipt for the first presentation/action slice (2026-10-11):
registered games supply a pure presenter; Mighty uses it for visible-card
availability and joker commands. Shared controls also render a bounded numeric
poker offer fixture, with observer/stale-input guards. This is not a poker engine,
complete scene renderer, or completion of the legacy control migration.
The follow-up card slice shares the existing frame/back/court/pip artwork between
Mighty and normalized card descriptors. Hidden faces render as backs; ordinary
playing-card/joker visuals are supported, while custom artwork remains a labelled
fallback. This does not change the renderer decision or implement poker rules.

The decision-control follow-up moves Mighty bid/pass/misdeal and exchange
confirmations through the shared command renderer. Choices use exact offered
payloads, retain existing entry/grace timing, and invalidate old targets after
observed offer changes. Discard selections are validated together before
individual sends. Game-specific suit and friend composition remains in Mighty;
full scene and animation migration remain separate work.
Verification: 711 unit tests, clean Svelte checking, and 76 active browser
checks passed (108 intentionally excluded profile cases). The browser gate
covers retained stale command/numeric targets, entry/grace timing, stationary
picker selection, responsive controls, continuous table geometry, and an actual
full deal through replay and the next deal. Desktop and small-phone screenshots
were also visually inspected in both themes.

Canvas follow-up: compare an actual Canvas 2D renderer with DOM rendering over
one numeric scene, in a separate preview. Prove pointer/keyboard card selection,
private card backs, stable identities across waiting/play/result, resize/DPR,
reduced motion and context lifecycle. The initial simple-vector artwork was rejected in visual review. The follow-up
reuses production PlayingCard/PlayerFigure SVG artwork and CSS layout samples,
actual TableFrame/Felt/Tray budgets, and real Seat metadata. Live-room integration
and full gameplay animation remain separate gates. A renderer prototype alone does not establish performance gains.
Receipt (2026-10-11): clean Svelte checking, 720 unit tests and 27 active
browser checks passed (93 profile exclusions). Checks cover actual Canvas
pixels, exact DOM/Canvas card bounds, primary-pointer and keyboard selection,
stale targets, observer backs, full/reduced motion, responsive resize and
synthetic context loss with working fallback selection and restoration. Twelve
screenshots across desktop, 390px, 320px and short landscape were captured;
representative views were inspected and card/name overlap corrected. This
is Chromium proof, not Safari/device, hardware context-loss or FPS proof.

Fidelity follow-up receipt (2026-10-11): the comparison now renders actual
shared court/pip/joker/back/character artwork through decoded SVG layers and
CSS-sampled asset recipes. Mighty uses production TableFrame/Felt/Tray regions
and real names/role badges above Canvas figures. Compact review controls restore
the original arena budget; short landscape uses the existing played-order row.
Reviewed 12 current screenshots across desktop, 390px, 320px and landscape,
including matched DOM references. Clean type checking, 730 unit tests and 37
active browser checks passed (107 intentional profile exclusions), including
actual Mighty full-deal/replay/next-deal regression. Three renderer regressions
prove stale face textures are rejected before private-layer access; scene
updates also clear backing pixels before asynchronous art preparation.
This remains a comparison fixture with DOM-backed artwork preparation. Exact
pixel equality, production hover/gaze/deal choreography, real-room Canvas
integration, Safari/device proof and performance gains are not claimed.

Flicker follow-up receipt (2026-10-11): safe decoded artwork now persists during
metadata/motion/offer updates; unchanged resize events cannot reset backing
pixels. Reference metrics and CSS viewport readings avoid redundant snapshots
and the initial mobile tablet-mode misclassification. Strict frame regression
reproduced missing artwork before the fix, then passed 24 samples per profile
under repeated incidental resize/class updates on 390px light and desktop dark.
A separate idle probe kept 40 pixel hashes identical over four seconds. Type
checking is clean; 732 unit tests and 47 active browser checks passed (113
intentional profile exclusions), including real Mighty full-deal/replay/next-deal
and original geometry regressions. Face identity checks and immediate private
redaction remain covered; this is bounded Chromium proof, not an FPS benchmark.

First reviewable deliverable: the control inventory and approved component
reference sheet. Complete the current visual-review gate before choosing a
renderer. [FIXES.md](FIXES.md) remains the cleanup/acceptance gap register.

Later ideas remain optional: learned search priors/values, belief-state
search, search-free difficulty levels, cross-game transfer, and AI-assisted
translation of house rules into simulator-validated rule data.

## Adding a game

See [ARCHITECTURE.md](ARCHITECTURE.md#adding-a-game). Games are compiled and
registered with the application; there is no runtime-download or user-script
plugin system.

## Compute

| Host | Intended role | Constraint |
| --- | --- | --- |
| Mac: M4 Pro, 14 CPU cores, 20-core GPU, 24 GB | MPS training/local research | One GPU job at a time; research paused. |
| Home: 12 cores, 31 GB | Live worker, builds, low-priority CPU eval | Preserve worker responsiveness; loop policy caps research threads/load. |
| Seoul instance | Interactive site | Never use for research. |

## Decisions carried forward

- Mighty first; friends first; public repository.
- Korean UI, original four-color card art, raise-then-play default, calm
  motion, sound and optional jazz. [Design contract](DESIGN.md).
- Home starts with 기본 or the last selected preset; 고수 is the default bot.
- Poker means Texas hold'em only. Ratings remain internal.
- Scoring G applies to school presets; 기본 retains its specified scoring.
  [Rule authority](../crates/mighty/RULES.md).
- Research code/results stay here; large artifacts stay outside git with
  manifests. Real player logs require an explicit privacy/product decision.
- Training stopped for assessment, then paused while cleanup continued.
  Takeover does not revoke that pause or approve a teacher, unattended
  research, new spending or deployment.


### Full live Canvas parity iteration (locally verified)

The approved local target is the complete original Mighty game with equivalent
Canvas primitive paint and all original motion, not a fixture-only comparison.
The current adapter retains the original native layout/input/animation owners;
its acceptance ledger is [CANVAS_PARITY.md](CANVAS_PARITY.md).

1. Register the canonical card and figure roots with sanitized public visual
   metadata. Preserve native handlers and stable identities across updates.
2. Paint the originals into sibling Canvas surfaces using their actual geometry,
   CSS/WAAPI transforms, SVG artwork and expressions. Reveal the same native
   source on context failure. Do not duplicate Mighty state or sequence timing.
3. Compare paired captures of the same mounted sources across phases, themes,
   mobile/desktop/landscape and hover/focus/raised states. Inspect each primitive
   separately; do not hide a missing card behind whole-frame averages.
4. Play an ordinary-backend room through every stage and ten tricks. Capture real
   deal, arrival, winner hold, sweep, credit and whole-identity motion, followed by
   result, replay, next-hand shuffle and observer/admission/reconnect boundaries.
5. Verify privacy/current-offer input, no-op flicker, background recovery, context
   recovery and disposal. Obtain an independent review against actual receipts.

The local acceptance gates now have passing frozen-runtime receipts: both real
full games, six visual profile matrices, genuine native-DPR background recovery,
eight same-state DPR3 pairs, privacy/input/animation/cleanup checks, and an
independent review. Exact receipts and historical failed runs remain in the
acceptance ledger. Equivalence uses its explicit rasterization tolerances;
universal browser or mixed display-emulation parity is not claimed.
At that historical checkpoint, default room URLs used DOM and local Canvas
rooms opted in with `?renderer=canvas`. The migration below retires that opt-in.
No deployment or publication is authorized by this iteration.


### DOM coordinate engine migration (verified locally, 2026-10-11)

User approved replacing the live Canvas paint path with native DOM/SVG and a
shared numeric coordinate owner. Keep the original design and backend rules.

1. Use one frame-local geometry registry for arena, dock and hand nodes.
2. Preserve local identity through waiting/play/result; use participant keys
   for opponent movement and numeric card positions for an absolute hand.
3. Move card arrival/collection and interrupted layout travel to SceneMotion,
   preserving Animator ordering and native current-offer input.
4. Verify real full-game/replay/observer flows, retained identity DOM, responsive
   geometry, keyboard input, interrupted movement and native visual comparison.
5. Archive then remove obsolete Canvas painting and DOM-measured flight code;
   preserve historical receipts and shared privacy/layout behavior tests.

Verified against frozen DOM build `/tmp/card-game-dom-engine-delivery-8shk07fs/dist`;
final disposal guards are built in `/tmp/card-game-dom-engine-final-fosds28y/dist`:

- Svelte check: zero errors/warnings; build passed; 745 unit tests passed.
- Final production acceptance: 22 passed with 22 viewport-specific intentional
  skips; the additional rapid-swap gate passed after correcting its stale
  paused-animation oracle. Genuine move events were 50.1ms apart and continuity
  error was 0.000061px. The original failure receipt is retained.
- Actual ten-trick hand, result recentering, ten-round replay, next hand,
  observer/handoff controls and retained identity DOM passed. Queued layout
  cancellation with disabled motion or zero duration produced no native effects.
- Twenty original-DOM comparison scenes across desktop, narrow/portrait phone,
  landscape phone and tablet retained viewport bounds with no Canvas or page
  scroll. Desktop/portrait hand coordinate differences were at most 0.16px.
- Four source-held Vite pose-oracle checks passed across desktop and touch phone:
  native raised/leading cards, interrupted ancestor motion, CSS decoration,
  perspective, no per-card measurement, native input and safe fallback.
- After the final disposal guards, all 745 unit tests passed again; the final
  frozen build passed both the ordinary full-game/replay/next-hand gate and
  genuine interrupted seat-swap gate. Check and build also passed.

This verifies the implemented Mighty DOM path and shared numeric primitives.
Other games and universal browser parity are not claimed. Historical Canvas
artifacts are retained outside the checkout; no deployment was performed.

### Reported UI regressions (verified locally, 2026-10-12)

The prior migration checks missed an intermediate tall desktop fan and an
unlifted-hand stacking case. Card z-order is now isolated inside Hand. The
shared numeric fan fits the actual desktop region using the existing 56px
readability floor before splitting; the reported 1147x1076 ten-card hand stays
in one row clear of its turn cue. Observer shuffle text now flows below the
participation controls rather than sharing their absolute center anchor.

Seat actions use standard 44px Button controls. Participation and reaction
actions use the shared Button surfaces without local font/color/border skins;
secondary participation actions have visible surfaces rather than ghost text.
Card and seat interaction primitives remain separate from command buttons.

Svelte check and build pass, with 745 unit tests passing. Targeted browser
checks verify real bot-turn bidding with an unlifted hand (the old build
reproduces card-over-popover hit capture), all 24 reaction hit targets and
sending a phrase, desktop/mobile observer joining, 44px seat actions and the
reported one-row desktop fan. Full-hand/replay/next-hand, shared session and
feedback regressions also passed. Preview visual checks at 1147x1076, 390x844,
320x568 and 568x320 have no page scroll or runtime errors. Temporary test
servers are closed; the user's local server remains at port 4534.

### Reaction emphasis and kitty inspection (verified locally, 2026-10-12)

Reaction bubbles use larger emoji (32px desktop, 28px phone), heavier text
(16px/15px), stronger paper contrast and a 240ms pop. Reduced motion fades;
motion off skips animation. Player reactions have independent fixed anchors,
while bids, important cues and score credit remain in their reserved row.
Short portrait phones use a bounded 32px avatar-area bubble instead of moving
the table or colliding with the HUD/name. Observer reactions use the sidebar
or a separate compact lane clear of the hand. Menus stay above feedback.

Inspecting a kitty card settles its translucent arrival once and retains the
original keyed card node. Selection lifts the card without changing its fan
z-order or its overlap treatment; later cards continue to cover its right edge. Deselecting
does not replay the arrival; current-offer discard validation is preserved.

747 unit tests, check and build pass. Focused browser proofs cover all three
motion policies and repeated messages, player/bid coexistence, real observer
emoji/long-text broadcasts at 320px, 390px and short landscape, and kitty
inspection at three widths (original arrival opacity 0.472 becomes 1).
The final build also passes a full hand through exchange, results, replay and
the next deal. Test-only servers are closed; no deployment was performed.

### Whole playing-screen engine refinement (2026-10-13, local)

Current sequence: refine the shared engine and Mighty together, release the
verified milestone, then build/refine playable Texas hold'em on those owners.
Keep the approved native artwork, proportions and backend authority.

The shared TypeScript engine now owns numeric outer regions, dock hand placement,
status/sidebar flow, scoreboard rows/columns, result summary/actions and arena
review/admission overlays. One frame scheduler batches native region/content
measurements before publication. CSS retains appearance and leaf text/art;
it does not choose a competing playing-screen grid.

Audio setup is deferred while both sound/music are disabled or inaudible. Music
alone does not allocate cue noise; later sound enablement initializes it once on
a gesture. Isolated experiments identified a muted first-use audio constructor
pause, not a persistent numeric-layout bottleneck. Same-result-shape WASM did
not outperform the existing kernel. No WASM dependency or renderer migration is
introduced by this slice. Browser acceptance and release receipts are separate
from unit/build checks; this local entry does not claim deployment.

Local acceptance: 798 frontend unit tests, zero Svelte errors/warnings and the
production build passed. The focused browser suite passed 48 active checks
(57 intentionally excluded viewport/profile cases), plus four first-visible HUD
containment checks. The regression checks include genuine hand,
replay, next-hand shuffle, observer admission and interrupted movement. Sixty
static states across six sizes and both themes matched the frozen pre-refinement
layout within 1px without new scroll; native entry and muted-audio/later-enable
flows were checked independently. Initial sizing regressions were retained as
failed receipts and corrected before final acceptance. These are bounded
Chromium checks, not actual-device/Safari proof or a deployment receipt.

### Complete playing-screen geometry migration (2026-10-13, local)

Individual playing objects and control groups now receive numeric engine bounds.
HTML containers retain coordinate-space structure; CSS no longer selects
playing-screen rows, wrapping, columns or responsive anchors. Shared owners
cover identity children, actions/decisions, HUD descendants, feedback,
participation, lobby, finished rounds and live overlays. App chrome and safe-area
lengths are measured frame inputs. Native text/control/artwork rendering and
ordinary app/dialog shells retain their document/skin responsibilities. The
generic three/six-seat demonstration uses the same measurement/layout owners.

Final local acceptance: 833 unit tests, zero Svelte errors/warnings, production
build, 82 active browser checks (95 intentional profile exclusions), and 72
rendered cases across six desktop/tablet/phone sizes and both themes. Verified
real seating/observer handoff, keyboard selection, a full hand, replay, continued
shuffle, responsive interrupted movement, 44px picker targets and guarded offer
revisions. Result visibility waits for current leaf, stack and enclosing-frame
geometry; empty-seat action heights propagate directly from the child solver.
The regression receipts preserve initial failures and their corrections.
Validation used Chromium/emulated viewports, not actual-device/Safari proof.
Changes remain local and uncommitted; no deployment was performed.
