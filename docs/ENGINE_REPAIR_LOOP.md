# Engine repair and acceptance loop

Status: active, acceptance rejected. The user authorized fundamental repairs followed by repeated strict QA on October 18, 2026. Technical test counts from earlier delivery do not establish visual or gameplay acceptance.

## Ownership invariants

The server owns rules, hidden information and accepted commands. The game adapter supplies meaning: participants, card collections, phase facts and decisions. The engine owns selection drafts, confirmation, responsive composition, geometry, focus, input fences and motion. The DOM adapter renders the committed frame with the shared design system. Application components must not repair engine geometry with offsets or CSS positioning.

A modern high-level API describes player intent rather than a list of unrelated buttons. It must distinguish a command, a finite choice, a constrained card set and a card with action variants. Layout recipes consume these meanings; applications do not select pixel coordinates or infer responsive breakpoints. Keep the existing scoped admission, privacy, cancellation and bounded-resource machinery while replacing insufficient semantic contracts and procedural composition policies.

## Repair order

1. Correct semantic information at the game/presentation boundary. Keep persisted server records compatible. Separate visual availability from executable input; an unavailable card may still offer an explanation.
2. Restore decision parity: batch discard with one confirmation, friend shortcuts with a card picker, and leading-joker variants associated with their card. Batch discard requires an explicit transaction/continuation contract; do not emulate atomicity with an unchecked loop of stale scoped commands or enumerate every possible subset in the application.
3. Centralize shared layout recipes for the five-seat arena, identity, hand, decisions, status and results. Measurements and minimum interactive sizes are constraints, not a license to hide essential information below the fold. Preserve original grouping, artwork and straight motion.
4. Build a new candidate and run focused strict QA for each repair and adjacent transitions. Reconcile every historical finding with current evidence. Repeat until the full declared profile and independent artifact review pass.

## First repair slice

- Replaced rule-specific `DisclosureCardRef.powered` with bounded explicit annotations. Mighty retains the stored `powered` boolean and interprets suppression at its adapter boundary. Ordinary powered cards no longer imply “enhanced” or a highlighted history cell. Winner emphasis remains explicit.
- Added engine-derived card availability paint independent of input enabled state. Inspectable illegal cards retain explanation input while receiving inactive artwork.
- Investigated the hand's unconditional 44-pixel spacing ceiling. Removing it exposed a protected straight-flight collision at the own-hand count destination. The experimental spacing/identity changes were withdrawn; the existing motion safety assertion remains intact. Hand composition and motion clearance need a joint repair, not an independent spacing override.

Focused live verification confirms inactive-card explanations and legal selection/dispatch in a real human-plus-four-bot room. Inactive paper remains opaque. Current screenshots at 390×844, 844×390 and 1280×720 still reject overall layout acceptance; landscape places essential hand/control content below the viewport. Historical-card annotation mapping has automated coverage but no fresh result/replay pixel verdict yet. These checks do not clear the audit or imply completion of the semantic API migration.

## Evidence and stopping rule

The frozen profile remains `docs/qa-profile.json`. Required failures, missing physical-device/human evidence, stale build identity or missing independent review prevent acceptance. No case removals, threshold relaxation, automatic golden approval or finding waivers may manufacture a pass. Evidence stays outside the checkout. Existing frozen audit and delivery artifacts remain immutable.

Latest pre-repair audit: `/Users/jaeyong/Documents/Codex/2026-10-18/strict-game-qa-084725Z/report.md` (31 open observations/findings; full acceptance incomplete).

## Second repair slice: declarative count decisions

Implemented a shared `card-selection` count mode. A game supplies native single-card command bindings and the required count; the engine owns toggle limits, feedback, confirmation, canonical compilation, admission, input and rendering. Dependent exact sets continue to use `mode: 'many'`; independent discards no longer require enumerating every subset.

```ts
const decision = {
  kind: 'card-selection', id: 'return-cards', mode: 'count', count: 3,
  commands: [],
  variants: offeredCards.map(card => ({ cardIds: [card.id], actionId: card.actionId })),
  submit: { prefix: '버리기', prompt: '버릴 카드를 고르세요' },
} satisfies CardSelectionDecision;

const session = createCardSession({
  transport: sendOneCommand,
  batchTransport: sendOneAtomicBatch,
});
const table = createCardTable({ session });
```

Mighty now uses this API for its remaining kitty discards. The server stages a bounded same-seat batch and publishes one result, with one scoped receipt. Saved native action logs remain replayable. The public protocol hash changes automatically with the generated wire types. Details and compatibility invariants are in ENGINE_COMMAND_PROTOCOL.md.

A real connected room produced exactly one `submit_batch` with three discards, one persisted accepted receipt and a direct private hand transition from 13 to 10 cards. The captured wire and timestamped UI sequence are outside the checkout in `engine-repair-loop-02`.

The first rendered batch check also exposed clipped selection feedback. The shared confirmation region now measures feedback and the button together, considering wrapped inline and stacked composition, and reserves all future draft-label footprints. Card confirmation buttons use content sizing; unrelated prominent recipes are preserved. Preferred region gaps yield to essential measured content before root overflow. Existing visibility assertions remain; a test helper now measures actual gaps and asserts they stay between zero and the preferred 8 pixels, instead of assuming every gap is exactly 8.

Full visual acceptance remains rejected. Friend/card-variant decisions, arena/identity composition, motion clearance and the remaining audit findings still require repair and the declared strict QA campaign.

The live text-scale check exposed a separate draft-lifetime defect: runtime projection object replacement cleared card drafts even when the native offer was unchanged. Draft identity now follows session/audience/generation, offer ID, decision ID/mode/count, hand membership and enabled native bindings/payloads. Display-only revisions and preferences preserve selection. Changed payloads, authority or offers clear it; old frame captures remain invalid. No automatic submission follows reconciliation.

## Third repair slice: semantic choice catalogues

The existing finite-choice algebra now accepts an optional catalogue descriptor: featured option IDs, a title/opener label and groups of exact option IDs. Options may carry public card artwork and explanatory text. The game supplies meaning and native action bindings; the engine owns the featured controls, complete card grid, isolated picker draft, cancellation, confirmation, keyboard navigation, focus return and responsive allocation. Every catalogue group must partition the offered options; unknown or duplicated references are rejected.

Mighty friend selection uses that contract, including Mighty/Joker/top-trump/first-trick/no-friend shortcuts, a complete card picker and a held-card warning. It supplies no geometry or application picker state. Existing native actions remain unchanged.

Catalogue modal preservation uses a distinct engine-issued choice lease. It does not borrow historical disclosure authority. Draft choice never sends a command; cancel preserves the main draft. Confirmation uses the original current finite variant and canonical admission. Resize retains the choice lease; changed offer authority, disconnect and detach retire it. Native arrow navigation is restricted to the active modal. Card artwork is passive and has no live entity/hand identity; its radio target reserves the full focus-ring footprint.

This slice is under focused verification. It does not clear the outstanding layout, motion, card-variant or full acceptance gates.


Catalogue drafts use an engine-owned lease. Display-only revisions and viewport changes retain the draft; changed offer/decision/action authority closes it. Cancel and Escape restore the opener without changing the main selection or sending a command. Confirmation resolves the exact offered action through ordinary session admission. Catalogue artwork is passive, separate from live card entity ownership. Controller snapshots deeply own and freeze catalogue metadata and artwork.

The catalogue recipe reserves a stable dialog envelope and action target. A current option consequence consumes scroll-body space; absent consequences leave that space available for cards. Option consequences reach radios and confirmation through accessible descriptions. Focused options are revealed inside the catalogue scroll viewport. The real connected friend confirmation produced one native CallFriend submission and one persisted acceptance receipt before entering Play. Focused screenshots and independent image review cover compact doubled text, phone, landscape and desktop; they do not establish screen-reader, physical touch or full table acceptance.

The full table remains rejected. Shared seat/identity/hand allocation, status and scoreboard visibility, detached card variants and moving-frame evidence remain open. The ongoing goal must not stop at this catalogue repair.

## Fourth repair slice: shared participant identity owner

Local and peer identities now use the same measured allocation/composition owner for artwork, name, card count, markers and status/feedback. Semantic count destination IDs remain stable. Name pills use the actual measured text footprint. Transient thinking/cue paint does not choose geometry. Peer counts reserve the same bounded 0–104 label domain as local counts, including wrapped height, so digit changes cannot switch name/count recipes or move recipient anchors.

The tested guarantee covers transient cues/thinking and count changes. Persistent status/role/badge changes can still cross an admission threshold; a phase-wide semantic envelope is not yet implemented. Existing artwork sizes remain pending original-design visual reconciliation.

A pure measured stack allocator is preparatory work, not wired into production. Its first integration exposed phone hand-visibility regressions when a complete vertical stack could not fit; that experimental integration was withdrawn and existing visibility/motion assertions retained. Alternate measured compositions and separate essential-information budgets are required before replacing the existing active-table allocator. The current 44px whole-arena fallback remains a known rejected policy; passing reachability tests cannot approve it.

## Fifth repair slice: measured short-landscape candidate

The sideways candidate measures a complete participant ring and an identity/hand dock beside a full decision/tool lane. It restores the original smaller hand/public-card scale, retains readable 40px participant artwork and 44px native interaction spacing, and admits only a fully fitting candidate. Header controls/status share a row only when their measurements fit. Historical cards retain semantic entities in a labelled secondary viewport. A public-card-width transit corridor keeps a straight stock-to-own-count path clear of retained hand targets. Names, count destinations, native command bindings and information access remain intact. Impossible doubled-text/name cases retain a rejected fallback; fitting arithmetic alone does not approve this composition.

An optional authority-free phase presentation caption cohort is also implemented at the contract/session/projection boundary. It is preparatory and not yet used by the planner. Independent review found that valid auxiliary Joker/call commands also need semantic card association and presentation-envelope coverage before claiming full phase stability. Current offers remain the only executable authority. No fake stale buttons or actions are created to reserve space.

## Sixth repair slice: action variants and phase continuity

`CardSelectionDecision` has an explicit `disambiguation: 'choose-action'` option for one/many selection. Multiple native actions may bind the same exact card set only with that opt-in. Count discard retains its unique independent mapping. Multiple offered matches, including disabled alternatives, never silently choose a command. Ambiguous-card activation and choosing a variant only change the draft; an explicit confirmation submits one exact original offered action. Card or authority changes clear the variant draft. Mighty maps Joker/call alternatives to their card instead of detached command rows.

The phase caption cohort now supplies measurement domains to the existing real selection/status/button recipes on active and passive frames. Passive frames paint empty reservation groups, with no old commands or fake card eligibility. Hand lift/padding and interaction stride also remain reserved across the phase without adding actionable bindings. Observer geometry does not reserve a local decision lane. Card action choices use an engine-owned bounded modal picker with an isolated variant draft and current choice lease. The ordinary status slot becomes a measured picker opener when the selected card is ambiguous; no always-empty row is reserved. Cancel/Escape preserve the previous variant and restore focus; modal confirmation resolves one exact current native action. Ordinary uniquely bound cards retain single/repeat activation preferences.

The cohort parser caps aggregate action-variant labels at 104 in addition to per-group and byte limits. Independent review found that the original group×label cap could admit more than the runtime's measurement budget; a maximum-admitted-domain runtime regression now covers that boundary. Current geometry tests compare fresh passive, active and own→peer frames exactly at phone normal/doubled text, landscape and desktop, while preserving stale-action rejection. These are technical proofs; rendered continuity, native focus, every game phase and final visual acceptance still require the strict campaign.

Short-landscape public zones now allocate the full trick capacity independently of current play count, alongside a bounded auxiliary stock column. Empty/full tricks retain the same primary→auxiliary ordering. This fixes the measured composition switching observed during the fourth-card transition; final moving-frame verification is still required.


The inline strip was an unsuccessful intermediate experiment and has been removed, including its horizontal-overflow capability. Shared choice-dialog chrome now also handles a valid maximum-length catalogue consequence: when a complete footer warning would evict the readable body, the warning becomes scroll content while accessible association and visible cancel/confirmation remain intact. Required coverage expanded to 651 cases for both picker states and their interaction/continuity paths. No implementation or unit-test receipt clears that expanded campaign.

## Original UI remains the authority

The user's original-design, component-system, selected-fan-order and straight-motion decisions remain binding. A foundation layout proof or a safe rectangle does not authorize replacement visuals. Preserve the original figure/role/points/name composition, responsive table-card placement and native card gestures. Internal motion landmarks must be inert and unpainted; they must not introduce permanent card-back ports or extra controls merely to simplify engine code.

Captured-card provenance and capture ownership are separate facts. `TableCard.ownerId` identifies the participant who supplied a public card. A captured `CardCollection.collectedBy` identifies the public winner receiving the trick. Mighty derives the latter from authoritative public trick history, never its display label. Historical winners who are no longer in the current roster are omitted rather than reassigned to a replacement occupant. Absence provides no winner-sweep authority.

The engine must use that semantic winner to restore the original collection toward the winner's seat, while retaining current canonical history as the final public state. Staged motion is presentation only; it cannot advance rules, manufacture a server document, infer a hidden hand or submit an action. Current work on inert landmarks and staged trick motion is not yet visually accepted. Full source-bound moving-frame verification and the existing strict QA campaign remain required.

Persistent identity metadata and announcements also have distinct semantics. `ParticipantStatus.purpose: 'standing'` identifies the current role/points row; `'announcement'` identifies bid/pass or similar feedback. Omission retains announcement behavior for existing producers. Games supply values and separate badges, never positions or font sizes. The shared participant recipe places standing badges, the tight name pill and transient feedback, while inert count landmarks preserve movement authority without adding visible hand-count chrome. This contract does not by itself guarantee a phase-wide envelope for future status changes; that remains an explicit layout and motion verification boundary.
