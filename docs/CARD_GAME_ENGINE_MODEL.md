# Card game engine domain model and compatibility plan

Replacement architecture: [Card game engine foundation](ENGINE_FOUNDATION.md) consolidates the public semantic document, component ownership, runtime and proof gates. The game capability research and detailed domain constraints here remain background for that primary proposal.

Status: research-backed proposal, October 17, 2026. Companion to [Engine UI API](ENGINE_UI_API.md). Mighty bidding has a first production decision-controller integration; the wider domain APIs here remain sketches, not implemented capabilities.

[Hardened engine API contracts](ENGINE_API_CONTRACTS.md) is the canonical follow-up: public capability gates, controller ownership, joint candidates, privacy/membership types, command receipts/windows, and pending-layout lifecycle supersede the earlier broad sketches. [Executable fixtures](api-proposal/README.md) demonstrate only the named pure-contract subset.

## Decision and scope

Build a card-game engine: typed game rules and authorized views, a shared card-table vocabulary, reusable interaction controllers, and engine-owned UI/layout/motion. Cards, hands, piles, melds, tricks, wagers and card movement are appropriate domain concepts. A generic UI framework alone is too little; shared code that recognizes Mighty phase names is too narrow.

The target is extensibility across card-game families. Four games are concrete compatibility probes: Mighty, Texas Hold'em as a representative poker variant, Korean 훌라, and Korean 원카드. Passing these probes would establish coverage of those capabilities, not prove every possible card game works without extensions. Custom decks, arrangements, interactions and resources need explicit registration boundaries.

## Source access and variant limits

The user supplied the Namu pages for [훌라](https://namu.wiki/w/%ED%9B%8C%EB%9D%BC) and [원카드](https://namu.wiki/w/%EC%9B%90%EC%B9%B4%EB%93%9C). Those pages were not read: web opens failed and browser access was denied by site-safety policy. No mirrors or access workarounds were used. Findings use independent first-party operator/developer descriptions instead.

Hangame and Netmarble's 훌라 guides are on legacy URL paths; they document implemented variants, not verified current universal rules. OneCard product descriptions differ materially. Poker TDA describes tournament procedures; it is not a universal specification for every online, cash, or home poker game. Rule selection is deferred to each game module.

## What the games require

| Game family | Documented examples | Engine capabilities exercised | Remains game-specific |
| --- | --- | --- | --- |
| Mighty: trick-taking | Current production source: bidding, kitty exchange, friend choice, trick collection, results | Private hand, ordered played-card areas, card variants, selections, bids, role/status markers, score summary | Trump/friend rules, legal play, rank order, scoring |
| Hold'em: wagering | Private hole cards, staged community cards, betting forms and split pots; tournament rules include side pots and short all-ins | Mixed card disclosure, arbitrary player/shared zones, exact amounts, action domains, pools, multiple awards, reveals | Betting legality, raise reopening, hand ranking, side-pot construction, odd-chip allocation |
| 훌라: melding | Draw/register/add/discard, multiple public sets/runs, additions to another player's meld; combat variant has out-of-turn 땡큐 | Persistent dynamic groups, multi-card selection, explicit destinations, atomic compound moves, contested response windows | Valid melds, wildcard meaning, Stop conditions, arbitration and penalties |
| 원카드: shedding | Matching, suit decisions, attack/draw chains, reverse/skip, declaration/catch windows in documented variants | Stock/discard areas, large hands, batch draw motion, direction/status, repeated local decisions, concurrent response opportunities | Rank abilities, defense hierarchy, draw policy, turn progression, catch deadlines and penalties |

Sources: [PokerStars Hold'em](https://www.pokerstars.com/poker/games/texas-holdem/), [Poker TDA rules](https://www.pokertda.com/view-poker-tda-rules/), [Hangame variants and claims](https://images.hangame.co.kr/hangame/renewal_2010/gameguide/poker/game_hoola1_2.html), [Hangame adding and discarding](https://images.hangame.co.kr/hangame/renewal_2010/gameguide/poker/game_hoola2_2.html), [Netmarble method](https://c2.img.netmarble.kr/web/2007/html/gopo/po_guide/hoola/method.html), [Playfulo OneCard](https://playfulo.com/en/games/one-card), [Korean One Card developer description](https://apps.apple.com/ro/app/korean-one-card/id6800218494).

Important differences demonstrate why the engine cannot attach rules to printed card faces. Playfulo describes K as a two-card attack, while the app developer describes K extra play and configurable attack defense. Netmarble and Hangame disagree on a two-player Stop threshold. Those are ruleset choices, not engine layout defaults.

## Domain vocabulary

| Contract | Meaning and required flexibility |
| --- | --- |
| Card instance and viewer representation | Distinguish physical identity from rank/suit, artwork, current annotations and viewer-visible handle. Support duplicate decks, jokers and custom faces. Hidden contents can be anonymous backs or count-only. |
| Zone | Stable semantic destination with optional owner and membership. Built-in roles include hand, stock, discard, shared board, trick, captured cards and meld area. Roles choose engine recipes, not legality. Custom roles register a recipe. |
| Card group | Stable ordered/unordered collection or annotation across card references. Persistent melds differ from transient tricks; best-hand highlights reference existing cards rather than duplicating physical ownership. |
| Interaction opportunity | Viewer-authorized commands and structured selections, choices, amounts or targets, associated with a revision and optional response window. Several opportunities may coexist. |
| Activity, resources and outcomes | Pacing actor, eligible responders and participation are distinct. Counters, stacks, contributions, pools and award entries are optional structured data supplied by rules. |

Zones are the only canonical card membership owner. Contained groups reference cards in one declared zone; cross-zone relations such as best-hand highlights create no ownership. Transfers update zones and group references in the same accepted transition. A visual drag preview or traveling overlay is a presentation proxy, never a second authoritative card.

Group ownership does not imply exclusive modification rights: 훌라 can allow adding to another player's meld. The adapter supplies valid targets and permissions. Ordered endpoints/insertion targets are explicit when needed; the engine must not guess among several legal destinations.

Local hand sorting and draft grouping are local presentation state. They must not change authoritative ownership or send a game action merely because the player rearranges their hand. A game may declare an ordering requirement that constrains local rearrangement.

Wildcard assignment is separate from printed identity: a joker remains that physical card while the rules describe its represented role in a meld. The engine renders the annotation without calculating valid substitution.

## Proposed application surface

```svelte
<!-- One proposed card-game-facing surface, not an existing component. -->
<CardTable
  model={authorizedTableView}
  controller={interactions}
/>
```

```ts
interface CardTableView<A> {
  revision: string;
  players: readonly PlayerView[];
  topology: TableTopology;
  zones: readonly CardZoneView[];
  groups: readonly CardGroupView[];
  resources: readonly ResourceView[];
  opportunities: readonly InteractionOpportunity<A>[];
  activity: ActivityView;
  outcomes?: readonly OutcomeView[];
  transitions?: readonly AuthorizedTransition[];
}
```

The game supplies relationships and authorized content. The engine composes hands, piles, boards, groups, identities, decisions and status, chooses fitting arrangements, and owns coordinates/gaps/paint bounds. Applications do not supply ordinary gap, inset, overflow, button dimensions or viewport branches.

`DecisionPanel`, `ChoiceGroup`, `NumberField` and `ActionBar` from the UI proposal remain useful building blocks inside CardTable. They are not the complete card-game abstraction. A card interaction also needs card candidates, selection ordering, targets and response context.

Structured interaction opportunities carry their own identity/revision, optional authoritative response-window context, authorized action/domain binding and a validated input model. The first executable UI API is limited to commands and finite choices; numeric and structured card forms advance through separate gates.

A structured form composes related card selections, finite choices, targets and amounts into one candidate. Small domains bind exact complete candidates to command IDs; combinatorial domains require a game-owned encoder and authoritative validator. This expresses joker+lead, play-7+suit and meld+target+wildcard without introducing a new top-level union variant for every combination. Independent candidate/target lists do not establish legal combinations. See [canonical interaction contracts](ENGINE_API_CONTRACTS.md#composite-interactions-and-amounts).

Selection specs need supplied candidates, min/max or exact count, ordering requirements, preview/confirm policy, and an authoritative way to validate the final structured candidate. Target references distinguish a zone, group, card or insertion endpoint. Selection and destination are data; the engine does not validate a run by inspecting rank/suit.

The existing ActionOffer alone cannot express authoritative card-and-target candidate validation. Preserve its command/number behavior while separately designing structured-action bindings; current transports do not thereby gain the new capabilities.

A multi-card meld should submit one typed game action containing the selected sequence and target, validated/applied all-or-nothing. Existing commandBatch is explicitly sequential and non-atomic; it is not an atomic meld transaction. Preserve its existing Mighty use while designing the separate structured-action path.

Atomicity here is a proposed engine/protocol guarantee. Operator guides establish the visible multi-card operation, not their internal server transaction implementation.

Optional drag/drop and keyboard/click selection are alternate ways to construct the same guarded intent. No rule should require precise dragging. All routes share validation, target highlighting, confirmation and revision cancellation.

## Visibility and card identity

Visibility is per viewer and can differ per card inside a zone. A whole-zone face-up flag is insufficient for mixed hands and staged reveals. Folded, all-in, participating and eligible-for-award statuses are separate; being all-in must not automatically reveal cards or remove pool eligibility.

Server-internal card IDs may be stable. Viewer handles must preserve only authorized correlations: never send a secret face or a trackable hidden stock order just to animate a back. Unknown piles may expose a count, an unknown-count marker, an authorized top card, or anonymous visual tokens. After hidden reshuffling/recycling, previously known physical IDs must not let a client reconstruct the new hidden order. Where a transition needs correlation, the rules projection supplies only the correlation that viewer is allowed to know.

This boundary applies to DOM, accessibility labels, diagnostics, animation payloads, caches and replay. Reveal events can expose a face only when that viewer's authorized projection permits it. Round completion alone does not universally authorize revealing every remaining hand.

## Multiple actors and response windows

Separate three concepts: whose action paces the game, which seats may act now, and which response window is open. Combat 훌라 claims and OneCard catches cannot be modeled as exceptions attached to one active button bar. The normal turn and a response opportunity may coexist.

The server owns window identity, deadlines, valid responses, priority and arbitration. A player's projected opportunities are private; do not publish all eligible seats if that reveals hidden hand information. The UI may show a public window while exposing actions only to the authorized viewer. Countdown rendering uses server time/offset, and reaching zero locally does not decide legality.

Submitting a contested response enters a pending state. Exactly one accepted winner may consume a discard; losing or superseded offers are canceled. Final state and accepted events determine public card movement. Client animation completion or client timestamps must not select the winner. Reconnect, duplicates, timeout, simultaneous Stop/claim precedence and bot response policies require explicit game/runtime tests.

Uniqueness applies to that contested discard/resource, not to every window type. Other card games may legitimately collect several independent responses in one window.

Other frameworks demonstrate the distinction without supplying our rules: boardgame.io has phases, within-turn stages and multiple active players. [Stages](https://raw.githubusercontent.com/boardgameio/boardgame.io/main/docs/documentation/stages.md), [Phases](https://raw.githubusercontent.com/boardgameio/boardgame.io/main/docs/documentation/phases.md)

## Amounts, pools and settlement

Resources are optional. An engine can render chips and counters without requiring every game to have a pot. Use exact integral base units and explicit formatting. JS safe-integer limits must be validated; larger amounts need a deliberate integer/string representation rather than silent floating-point rounding.

An amount action states whether the amount means additional payment or total contribution. Its allowed domain comes from rules: discrete choices, a stepped interval, or an interval plus separately offered exceptional commands. A short all-in need not be a normal minimum raise or reopen raising. The engine must not make every value between a minimum and stack legal.

Represent several pools and several awards. Each pool can have its own eligible participants; each award identifies pool, recipient, exact amount and optional explanation. Rules compute side pots, ties, odd chips and scoring. The engine formats, lays out and animates supplied results. Session score accumulation is not automatically a poker bankroll.

## Accepted transitions and animation

Card-domain transitions include deal, draw, discard, reveal, transfer, collect, reorder/group update and resource transfer. Repeated stock draws, initial deals and stock replenishment are distinct event meanings. The engine derives animation paths and timing from authorized source/destination references and registered recipes, without embedding rules in animation code.

Support ordered operations and simultaneous batches with stable event IDs. State snapshots remain authoritative; transitions are optional explanatory data. Missing history after reconnect should snap/reconcile safely, not fabricate a hidden-card history. An interrupted draw into a growing hand, a claim that changes the actor, or a resize during a flight must retarget or finish consistently.

Layout, paint/clearance, hit regions, clip owners and overlay planes follow the UI proposal. An accepted move across zones can travel in an overlay rather than clipping at the source pile. Existing selected-card fan ordering remains intentional. Large penalty hands require inspect/scroll or other accessible arrangements instead of unreadably shrinking every card.

## Current implementation boundaries and backend implications

The Rust rules boundary already helps. `Game` has associated State, Action and View types; legality is queried by seat and application is seat-addressed (`crates/engine/src/lib.rs:64-105`). Arbitrary stock, meld and betting state can live in each game module. Do not create one universal mutable GameState containing every game's rules.

| Observed limitation | Required design work |
| --- | --- |
| `Turn` is pacing metadata; off-turn human actions are already accepted, but one turn clock and deal-triggered off-turn bot scheduling remain | Add explicit response-window scheduling, deadlines and responder/bot behavior; preserve existing single-actor games |
| `legal_actions -> Vec<Action>` and off-turn membership checking assume enumerable actions | Add typed authoritative candidate validation/action-domain capabilities for numeric and combinatorial actions, plus bounded bot/simulation candidates; retain legacy enumeration through a compatibility default |
| Client Act contains an action without expected offer/window generation | Design a server-validated command context; local ActionOffer guards alone do not prevent semantically stale server acceptance |
| Every chance sequence increments deal handling and resets deal grace | Separate initial/redeal pacing from ordinary draws, replenishment and other chance events |
| Frontend zones are hand/table/pile/reserve; card identity is Mighty value-based; table topology supports only 3/5/6 | Add viewer-safe identity, stock counts, dynamic groups/targets and explicit arrangement capabilities; test new seat counts before claiming support |

Source locations: `crates/server/src/room/hand.rs:144-162,248-284`, `room/bots.rs:221-247`, `room/view.rs:67-85`, `crates/server/src/protocol.rs:513-515`, `web/src/lib/table/presentation.ts:23-65`, `web/src/lib/games/mighty/cards.ts:25-29`, `web/src/lib/table/layout.ts:6-11`.

The [canonical command contract](ENGINE_API_CONTRACTS.md#command-scope-receipts-and-server-authority) adds durable hand incarnation/authority epoch, server-issued validation scope, command IDs/fingerprints, receipts, uncertainty and advertised persistence guarantees. The [window lifecycle](ENGINE_API_CONTRACTS.md#window-deadlines-arbitration-and-restore) defines trusted deadline cutoff, pending versus applied response, deterministic expiry, restore policy and generation-bound bot jobs. Existing frontend guards and asynchronous snapshots do not provide those server guarantees. Stale pixels retain old bindings and disable; privacy-scope revocation additionally removes forbidden content immediately.

Structured candidates cannot trust client-provided target lists or legality hints. Game validation is authoritative and must leave state unchanged on failure. New action-domain methods must account for existing bots, simulations, replay, generated protocol types and persisted sessions together. A frontend slider or meld selector alone does not complete this work.

Typed table summaries can already carry persistent poker stacks into later hand options. Rebuys, elimination, participation and stake policy remain deliberate game/session semantics; replacing the score counter with a bankroll label is insufficient.

## Reusable card-rule helpers

Card-game specificity can also include shared server-side utilities: deck construction with distinct instances, deterministic shuffle/deal/draw, validated zone transfers, rank-order strategies, and optional set/run/trick-evaluation helpers. Games opt into and configure those helpers. A rules module still chooses ace wrapping, wildcards, trump order, attack strength, scoring and settlement. The renderer never recomputes authoritative legality from those helpers.

Movement helpers can enforce declared invariants such as unique membership, expected source and all-or-nothing transfer. Ordinary decks can declare card conservation; games that create tokens or new cards need explicit creation/destruction operations instead of being excluded by a universal fixed-deck assumption. This is a proposed shared utility boundary, not an inventory of utilities already implemented.

## Revised proof and migration plan

| Stage | Deliverable | Gate |
| --- | --- | --- |
| 1. Domain fixtures before API freeze | Authorized Mighty, Hold'em, 훌라 and 원카드 scenario fixtures and capability contracts; explicit rule-variant labels | All four can describe their zones, decisions and transitions without adding game-named layout modes; hidden information tests inspect serialized views as well as DOM |
| 2. First production slice | Engine theme/measurement/bounds contracts and Mighty bidding through semantic controls | Exact action equivalence, no per-game gap/inset/scroll, safe gestures and offers, stable resize/focus/paint behavior |
| 3. Card interactions | Reusable selection/targeting, persistent groups, stock/discard and acknowledged movement; migrate appropriate Mighty decisions | Hoola ordered run, unordered rank set, variant-permitted singleton seven and additions to another player's group; OneCard batch draw/large-hand fixture; explicit atomic versus sequential semantics |
| 4. Runtime capabilities | Parameterized action validation, revision/window context, deadlines, responders and bot/simulation support; exact amounts and multiple awards | Contested claim has one winner; duplicates/stale/timeout/reconnect handled; numeric exceptional action and side-pot fixtures preserve server legality |
| 5. Composition and generality | Shared CardTable arrangements/status/results, current Mighty end-to-end regression and all four families through the same APIs | 2/4/5/6/9-seat UI fixtures where implemented, normal/reduced/off motion, narrow/large-text/resize cases, no unregistered game CSS geometry; profile before any kernel/WASM change |

Full playable poker, 훌라 and 원카드 rules and server registration follow their own implementation gates. Today only Mighty is a demonstrated registered game. UI fixtures do not change that status.

Essential stress scenarios: two competing 훌라 claims for one discard; several legal meld destinations with a wildcard; OneCard attack/counter/batch draw while a catch window exists; a reordered hand growing during resize; Hold'em multiple side pots with folded and all-in players; a short exceptional all-in; hidden-stock reshuffle without identity leakage; and a stale action ID whose displayed amount changed.

## Extension contract for broader card games

Register custom card assets/backs, zone arrangements, group annotations, structured interaction forms and optional resources/outcome presenters. Extension components must provide measurement, paint/clearance, input semantics, accessibility and validation tests. Persistent game states such as exhausted/tapped cards belong in supplied annotations/orientation semantics, not inferred from a decorative rotation.

The engine owns implementation of registered presentation behaviors; each game owns its rules and authorized projection. That boundary permits additional card-game families without either a giant switch on game names or raw CSS/coordinates in every game. Supporting every conceivable card game remains a direction backed by extension contracts and new compatibility fixtures, not a proven property of four implementations.
