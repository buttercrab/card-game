# Engine assistance and committed feedback

Status: connected assistance and committed-feedback candidate implemented. Real desktop/phone room tests verify scoped private advice, reactions and read-only inspection; native deadline/audio scheduling and broad integration qualification are separate gates below. Manual Korean OS IME, hardware haptics and audibility remain unverified.

## Source behavior to preserve

| Behavior | Existing authoritative source | Required preservation |
| --- | --- | --- |
| Private advice | `room/client.svelte.ts`, Mighty `table/Tools.svelte`; server `room/bots.rs::hint` and `Internal::Hint` | H requests advice; opening an existing suggestion does not submit it. Suggestion wording and highlighted cards correspond to the exact current offered action. Dismissal is presentation state. Server checks current seated turn and rechecks actor/seat/version after asynchronous computation. |
| Novice guidance | Mighty `table/narration.ts::tipFor`, `table/view.ts::handView` | Existing bidding, exchange/discard, lead/follow and off-turn misdeal wording; player preference controls visibility. No independent rules evaluator. |
| Blocked-card explanation | Mighty `Hand.svelte`, shared `ui/cards/PlayingCard.svelte`, Mighty `ledger.ts::refusalText`; server `notes.unplayable` | An unplayable card remains inspectable. Refusal explanation must not submit a move or alter selection. Original refusal feedback includes a shake and optional vibration. Native disabled buttons alone cannot supply this interaction. |
| Reactions | `catalog` palette, `room/client.svelte.ts`; server `room/actor.rs` and `room/lifecycle.rs` | Closed server-approved palette, seated and observer identity, burst refusal/rate limit; client owns the single 2800ms TTL and monotonic local event IDs. Original observer presentation selects the latest known observer. |
| Committed feedback | Mighty `table/animator.svelte.ts`, shared `sound`, `room/TurnRing.svelte` | Shuffle, bid, card arrival, heavy cards, trick collection/score, special-card/friend/answer cues, turn and result. Cue visibility is normally 1500ms; misdeal 4000ms. Card sound persists with motion off. Turn vibration is optional. |
| Deadline/music | RoomClient clock and TurnRing; shared music/settings | Use server deadline and client monotonic clock, including last-five-second ticks. Reduced/off motion must not stop deadlines. Music and phase mood are separate from visual animation. |

Server Hint is an ephemeral request/private `{version, action}` response, not a command receipt or durable operation. Rate-limit/busy refusal must stay visible without manufacturing success or automatically retrying.

## Implemented pure contracts

`table/foundation/assistance.ts` owns the closed semantic vocabulary:

- `request-advice` and `send-reaction(optionId)` are the only tool operations. Neither can submit game actions.
- `AssistanceScope` includes frame context, room ID/epoch, connection epoch, authenticated actor, optional seat and game version. Capture and final resolution require exact current scope, offer and authority. Revocation/disconnection fails closed.
- Canonical bindings carry exact enabled action ID, label and card references. An advice presentation must match all three. An inspect presentation contains only card ID and reason.
- Reaction presentations carry stable event ID and participant ID, approved text and no timer. The host supplies only records still active under its existing TTL owner.
- `createAssistanceSnapshot` owns and deeply freezes plain bounded data. Accessors are rejected without invocation, as are functions, cycles, nonplain objects, sparse arrays and oversized input. Capture, resolution and inspection clone untrusted incoming values before reading fields.
- `sameAssistanceGameScope` ignores presentation revision only, so a received private hint may survive resize or purely presentational updates. Activation captures still require the exact current frame revision.

The Mighty adapter consumes the actual `mightyDocument` and authorized connected client projection. It uses existing `tipFor`, `refusalText`, exact offered command wording and canonical card keys. It does not invent legal actions or infer another participant's hand. Spectators get reaction tools without private cards, advice or reasons.

## Required receive-time ingress changes

These changes are prerequisites for consuming the adapter in a connected host; do not restamp legacy fields during render:

1. **Advice:** when a valid private Hint packet arrives, capture `MightyScopedAdvice {scope, action}` from the same admitted publication, connection and authenticated identity. Check packet version, current authorized viewer/turn and current legal membership. Clear on State replacement, room/connection/actor/seat/generation replacement or authority loss. A bare `client.hint` must never be assigned a fresh scope later: that would launder stale private data into a new audience.
2. **Reactions:** resolve seated packet seat to its participant ID when the packet arrives. Store participant ID and connection-local event ID in the existing TTL record. Observer packets already carry participant identity. Supply `MightyScopedReactions {roomId, roomEpoch, connectionEpoch, records}` with only active participant-bound records. The pure adapter intentionally refuses seat-keyed records; current seat lookup after reseating would attribute an old reaction to a new person. Expiry callbacks must retain event-ID comparison so an old timeout cannot delete a newer reaction.
3. **Publication:** create assistance only after canonical Room/State/Session/window coherence passes `publicationReady`; the document must be the current Mighty canonical document, not a separately manufactured advice fixture. Capture current authority again at final tool dispatch.

The new adapter filters reaction records to current known participants and the approved palette. The host remains responsible for latest-observer presentation policy and TTL; this module adds no independent expiry, timeout or scheduler.

## Runtime integration boundary

Register assistance as a shared semantic tool surface adjacent to the canonical document. Let the engine own tool layout, palette, bubble geometry, advice decoration and inspection overlays. The game supplies wording, approved palette, exact action/card references and authorized projections only.

The runtime should own open/dismiss/inspect presentation state and route operations through injected ephemeral capabilities (`askHint`, approved reaction send). H/R shortcuts must respect modifiers, IME composition, editing targets and modal/native-form focus. A request send is not an accepted server result. Preferences, resize and re-projection must not replay transport or feedback.

Committed feedback needs a separate shared pipeline fed by admitted semantic transitions, keyed by stable room/connection/hand/version/event identity. Pure game projection declares semantic cue kinds and authorized participants/card refs; the runtime resolves sound/haptic/visual effects once. Never derive new committed effects from resize, hydration, preference changes or rerender. Mount/reconnect establishes a baseline rather than replaying historical cues. Room/hand/audience replacement cancels pending visual/haptic work; scheduled audio must follow the same cancellation boundary. Timed cues, bubbles and the deadline each need one explicit lifetime owner, not overlapping application and engine timers.

## Evidence and next connected gate

Pure tests cover frozen owned data, stale/revoked authority, exact action/card/label correspondence, palette/participant whitelist, accessor rejection, blocked-card read-only inspection, actual Mighty document advice/refusal projection, spectator privacy, presentation-only revisions and reaction identity replacement. They do not prove runtime fidelity.

The first coherent connected gate must demonstrate two real clients: request/dismiss/reopen advice; a stale asynchronous reply after turn or seat change; novice preference and blocked-card explanation; approved seated/observer reactions with expiry and reseating; safe H/R under IME/native forms; no duplicate sends/cues across resize/preferences; real committed turn/card/trick/result feedback; monotonic last-five-second deadline behavior; full/reduced/off motion and haptics settings. Capture actual room evidence before claiming parity.


## Native ingress checkpoint, 2026-10-18

`room/ephemeral.ts` now defines renderer-independent `NativeEphemeralScope`, `NativeAdvice` and `NativeReaction`. `RoomClient` exposes `nativeHint`, `nativeReactions` and `ephemeralConnectionEpoch` alongside the compatible legacy fields. A hint is captured at receipt only for a coherent publication, authenticated current seated viewer/turn, exact native command scope/version and current legal action. It is owned/frozen and withdrawn on incompatible state, actor, connection or authority changes. Participant identity is captured with each approved reaction at receipt; new records never re-resolve an old seat after reshuffling. Existing event IDs and the original expiration callback remain the one TTL owner.

The focused client/ephemeral/assistance run passes 47 tests, and independent bounded source review found no concrete blocker. The subsequent full source suite passes 1,524 tests with clean type checks. This proves the native ingress boundary, not connected tool dispatch or UI. The future adapter conversion must compare full native scope and connection epoch with current authority before introducing current presentation context; it must not restamp the bare legacy hint. Runtime tools, reaction bubbles, read-only card inspection and committed feedback remain the next connected gate.

## Connected candidate (2026-10-18)

The connected host now projects assistance from receive-time `nativeHint`/`nativeReactions` and publishes it through canonical session ownership. The final ephemeral send rechecks connection, actor, room epoch, seat, game version, turn and approved palette; it never uses the game/Room operation journal. Runtime owns advice dismissal/reopening, the reaction palette and read-only inspection. H/R shortcuts preserve native editing/IME, modifiers, repeat and modal fences.

Immutable command offers may declare `cardIds` as canonical own-hand references. Session ingress validates and freezes these references. This covers ambiguous same-card commands such as Joker lead alternatives without pretending there is one selectable card action. Advice still names an exact command and never executes it; a card with legal command alternatives is not classified as blocked.

The feedback coordinator owns a bounded 256-entry seen ledger, 128 pending events, 64 active effects, one deadline/expiry scheduler, frame preparation/publication bindings and cancellation handles. Unpublished superseded effects are retired; already committed arrivals can continue only through current registered visible entities. Native transfer settlement distinguishes arrival, snap and revocation. Bootstrap/reconnect is silent, while known live hand/redeal transitions remain eligible. Figure cue IDs prevent replay after metadata updates, resize and modal dismissal. Misdeal cards come only from the server-public redeal payload and expire after four seconds.

The fixed browser sink owns every scheduled Web Audio source/node and optional haptic handle for an emission. Revocation/disposal cancels them. The opt-in connected host suppresses the legacy RoomClient reaction/error audio path and composes those received events into the same coordinator, avoiding two effect owners. Background music follows current phase mood with an owned cleanup. Deadline paint updates the allocated clock vector directly, without creating new input-authority frames; final seconds are deduplicated by native action identity, independent of deadline calibration and motion settings.

Directed tests cover callback reentrancy, stale settlement frames, exact command/card/participant references, resource bounds, cancellation, authority loss, ambiguous Joker ingress and read-only tools. The first coherent full suite passed 1,626 frontend tests in 111 files with clean type checks/build. Real two-client desktop and phone assistance tests passed (plus desktop synthetic-IME/held-key guards); token-free audits and screenshots are under `/tmp/foundation-assistance-{390x844-light,1440x900-dark}.{json,png}`. Their sound, music, haptics and turn deadline were disabled, so those runs do not establish audio/deadline parity. Native scheduling/deadline and broad motion/recovery regressions remain explicitly separate qualification receipts.

### Connected qualification follow-up

The fresh integrated source passes 1,633 frontend tests in 112 files and clean checks/build. The actual assistance rerun passes three cases with one duplicate phone-keyboard skip: both viewports verify that blocked cards are inspection buttons with an explicit purpose and **no** `aria-pressed`; only canonical selectable cards expose selection state. A first broad driver incorrectly treated every enabled card as playable and opened inspection; its corrected driver now targets canonical selection semantics. This does not disable read-only inspection.

`foundation-feedback-clock.spec.ts` independently passes against a real 20-second server turn. The native clock progresses through five/four/three seconds without an authority-frame publication, paints its ring monotonically, schedules exactly one last-second source per second, and does not repeat a tick after resize. The test disconnects native Web Audio output while recording source scheduling; this is scheduling evidence, not audibility or hardware-haptics evidence. Manual Korean IME and direct screen-reader operation remain unverified. The final corrected broad regression is a separate pending receipt.
