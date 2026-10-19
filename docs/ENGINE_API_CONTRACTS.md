# Hardened engine API contracts

## Current semantic collection boundary — 2026-10-19

`PhasePresentation.tableCollectionIds` selects which public collections are visible: absent preserves legacy visibility, `[]` paints none, otherwise exact unique current collection IDs. Games choose meaning; the engine owns all geometry. Public semantic data never automatically authorizes a history panel. The built-in `TableDocument.hand` owns zone ID `hand`; public collections must use a different ID. This makes an existing internal namespace constraint explicit at canonical ingress; it is an intentional restriction for custom adapters, with no current Mighty/Poker producer change.

`CardCollection.availability` is `current` by default or `next-deal` for an anonymous outcome-bound stock preview. A future deck is not an outgoing kitty return. Runtime projects a bounded, immutable, geometry-free public paint-resource plane independently of visible selection; private hands, commands, labels and layout never enter that plane. Unavailable resources disable dependent motion, not valid UI or commands. These source changes still need native acceptance.

## Public finite phase reservation — source21, native verification pending

`PhasePresentation.decision` is an optional inert finite-choice vocabulary, mutually exclusive with `selection`. Its exact shape is `{kind:'finite-choice', presentation:{kind:'choice-strips'}, fields:[{id,label,options:[{key,atom}]}], auxiliaryLabels, submit:{prefix,fieldIds}}`. Atoms reuse only `InformationAtom` text, number and suit variants. Suit labels carry original Korean accessible names; native caption spelling derives from the typed suit enum. Field IDs and option keys are field-scoped logical references, never action IDs, payloads or eligibility. The schema rejects unknown keys, accessors, card/participant atoms, selected/enabled data and geometry. Canonical ingress copies and freezes the entire descriptor.

The limits are eight fields, 256 options per field, 512 options in aggregate, 16 auxiliary captions, 256 characters per text label/key and the existing 16KiB UTF-8 whole-presentation budget. Submission references are a unique permutation of the declared field IDs. Actual finite fields must match the declared field order and labels; their options are ordered key subsets with exact accessible labels, preserving multiplicity rather than comparing label sets. Disabled offers are also checked. Each actual variant must produce exactly its current offered caption through the typed prefix/field template. Validation work is bounded to 16,384 actual variant-field steps; no public Cartesian caption catalogue is generated. The existing Mighty 5×255 offered domain fits these limits.

Runtime exposes `ChoiceView.decisionPresentation` separately from real fields, commands, selected actions and input leases. Its scope includes session, audience, hand generation, presentation identity/version and immutable semantic content, independently of offer revision, draft or private hand. Fresh passive snapshots receive reservation data without synthetic controls. Active Mighty fields retain only legal offered subsets, and ordered strip fields narrow later choices through earlier current native tuple values, restoring the original trump-dependent count list. Existing native action IDs/payloads and availability still control all dispatch. Host/outcome commands are excluded only through the same explicit canonical partition used by runtime rendering.

Mighty's shared rules vocabulary supplies both public reservation atoms and active option labels. It never reads a private hand or legal offer to construct the public domain. Typed cohorts omit the old flat `selectedLabels` projection; planner integration must measure and paint the same factored inline recipe, retaining existing text/target sizes, icon semantics and native horizontal reachability. Reserving inert metadata does not authorize a visible disabled/future chip or a larger action catalogue. Joint felt/control allocation and native phase-continuity evidence remain separate acceptance work.

Replacement architecture: [Card game engine foundation](ENGINE_FOUNDATION.md) is the primary proposal for semantic authoring, composition and frame publication. This document retains the detailed action, privacy and server contracts and records the existing implementation boundary; its earlier widget-first structural direction is superseded by that proposal.

Status: reviewed proposal, October 17, 2026. This is the canonical contract revision for [Engine UI API](ENGINE_UI_API.md) and [Card game domain model](CARD_GAME_ENGINE_MODEL.md). It supersedes their earlier illustrative API sketches where they differ. It is not a claim that production implements these contracts.

The executable [contract spike](api-proposal/README.md) checks a subset of descriptor shapes, pure reconciliation and validation. It is deliberately outside production imports. Protocol durability, browser privacy revocation, layout publication and game rules still require implementation and integration evidence.

Production implementation, October 17: Mighty bidding now uses `web/src/lib/table/decision.ts` and `DecisionPanel.svelte`. The game adapter supplies finite suit/count variants and command identities; the engine owns draft selection, deterministic repair, eligibility, layout spacing, entry/grace presentation and revision-bound input capture. Commands retain their exact offered payload and offer revision through the existing table dispatch boundary. The independently typed spike remains a design experiment, not an imported implementation.

This slice uses the current offer ID as its conservative decision scope: changed revisions reset bidding drafts; equivalent replacement objects within the same revision may preserve compatible choices. It does not establish a durable audience/hand authority epoch. Window resize, captured document scroll and observed panel allocation changes expire local captures while retaining selection and focus. Descendant-only reflows that preserve the outer allocation do not yet have universal geometry cancellation. The renderer still uses the existing numeric decision-layout recipe internally; migrating other panels, the class-based layout protocol and the broader frame publication contract remains work. Receipt durability, uncertain-acknowledgement handling, authoritative response windows, numeric/structured interactions and cross-viewer privacy revocation are not implemented by this slice.

Local verification for this slice: `npm run check` has zero errors/warnings; `npm test` passes 884 tests, including 25 production decision-controller tests and five Mighty adapter tests; `npm run build` passes. Selected Playwright decision, paint-boundary and play/reload suites pass 19 tests across phone/desktop configurations (14 configuration-specific skips), and the separate full-deal test passes through exchange, play, results, replay and the next deal. New `engine-decision.spec.ts` covers reverse arrows, held Space across resize/scroll and detached choice/submit targets after offer replacement. Visual inspection at 390×844 and 1440×900 found no page errors or framework overlay. These are local UI/integration receipts, not deployment or broader protocol/privacy acceptance.

## Public surface and capability levels

First production scope: one interaction controller/runtime, one DecisionPanel, semantic descriptors and read-only outcomes, and an engine theme preset. ChoiceGroup and ActionBar initially remain internal component implementations. No ordinary application pixel gap, inset, overflow, or absolute-placement props.

```svelte
<!-- Proposed usage. The controller owns draft, gesture and local guards. -->
<DecisionPanel decision={validatedDecision} controller={interactions} />
```

The host supplies the controller a narrow transport port once. The engine captures gesture/context, validates current binding, resolves the exact offered action, and passes an immutable submission envelope to transport. Read-only observation callbacks cannot execute an action. A nominal/branded envelope can prevent accidental construction in TypeScript, but is not server authentication or validation.

`validatedDecision` means an engine-issued handle bound to its controller instance, projection scope, decision lifetime and offer revision. It is not a plain validated descriptor that can silently rebind against whichever offer a different controller currently holds. Binding and mount/dispatch validate that association at runtime; cross-controller or expired handles fail explicitly.

| Capability | Public contract | Gate |
| --- | --- | --- |
| First production slice | Commands and finite-choice decisions; existing exact action payloads | Mighty bidding equivalence, descriptor and stale-input tests |
| Numeric contract spike | Exact integral domains and one numeric action plus command exceptions | Amount validation, raw editing and dispatch factory tests; authoritative backend domain support before general poker claims |
| Structured card interaction draft | A related set of card/choice/target/amount fields with one candidate binding | Joint-candidate validation, typed encoder/server validator, transaction semantics and concrete four-game fixtures |
| CardTable, custom widgets and arrangements | Card-domain composition over the same controller and geometry contracts | Capability fixtures and explicit engine registration; no application CSS bypass |

An unsupported capability fails explicitly. A game cannot silently use a legacy action-only transport for features that require guarded response windows or structured validation.

## Decision shapes and exact identity

The first decision descriptor is a discriminated union, not one object with optional unrelated fields:

```ts
type DecisionSpec =
  | { kind: 'commands'; id: string; commands: readonly ActionId[] }
  | {
      kind: 'finite-choice'; id: string;
      fields: readonly ChoiceField[];
      variants: readonly CompleteVariant[];
      initialValues: Readonly<Record<FieldId, OptionId>>;
      reconciliation: 'reset-to-defaults' | 'preserve-compatible';
      commands: readonly ActionId[];
      submit: { unavailable: 'disabled' | 'hidden'; presentationLabel?: LabelTemplate };
    };
```

Irrelevant properties are forbidden in the concrete type contracts. The gated numeric descriptor references exactly one numeric action and its field directly, avoiding a string reference to an unrelated undeclared field. Commands-only and empty panels need no artificial variants, defaults or primary submission.

Action and option IDs identify behavior. Labels and displayed values do not. Two commands may display the same contract or amount while having different meanings. The embedded current contract preview demonstrates this: choosing Heart 17 exposes two distinct choices labeled Heart 17. Preserve exact bindings or declare a distinguishing option; do not deduplicate actions by label or silently select one ambiguous tuple.

Validate unique IDs, expected action kinds, complete tuples containing exactly the declared fields, existing options, compatible defaults, and unambiguous tuple-to-action bindings. Default validity is structural: a disabled default does not invalidate the descriptor. Initialization selects an eligible replacement under the declared policy, or returns unavailable. Disabled options may remain inspectable with reasons. An executable variant requires both all selected options and its exact bound action to be enabled. No eligible variant means no executable submit. Do not promote Pass or All-in to primary merely because it is the only remaining command; offered intent remains authoritative presentation metadata.

### Reconciliation algorithm

For an explicit local change `(field, option)`, pin that requested enabled option first and filter the enabled complete relation. If no full tuple survives, reject the change explicitly; never silently undo it. In declared field order, retain each other old value only if some surviving full tuple supports the growing assignment; otherwise choose the first supported value in declared option order. Resolve exactly one bound command from the final tuple.

There is no separate dependency graph in V1. The finite relation is the single feasibility authority; field order only supplies deterministic tie-breaking. On offer/model replacement, apply the declared reset/preserve policy without an artificial user-pinned field. Local changes are captured against the decision lifetime and offer revision, so a delayed event cannot mutate a replacement draft. A→B→A selection does not resurrect an obsolete gesture/confirmation generation.

Counterexample fixture: legal tuples are `(A1,B2)` and `(A2,B1)`; user changes B2 to B1. The result must be `(A2,B1)`, not a fallback that restores B2 to preserve A1.

## Composite interactions and amounts

The future structured form is one related candidate, not independent lists of legal cards and legal targets. Fields may describe ordered/unordered card selections, finite choices, explicit targets and exact amounts. A candidate must bind jointly either to an exact offered command or to an identified game-owned structured domain and typed encoder/authoritative validator.

This expresses Mighty joker+lead choice, OneCard card+suit choice, and Hoola cards+target+wildcard assignment without adding `cards-and-target-and-choice` union branches indefinitely. Small finite relations can enumerate complete candidates. Combinatorial domains must not enumerate every subset or treat the Cartesian product of independently legal fields as legal. UI preview/continuation hints are scoped and advisory; the server validates the complete candidate.

Structured forms remain gated: first define the game-owned candidate decoder/encoder and validation contract, then expose that capability. The engine does not infer wildcard substitution, meld validity, attack strength or betting legality from printed card faces.

Exact numeric domains use safe integer base units initially:

```ts
type IntegerDomain =
  | { kind: 'discrete'; values: readonly SafeInteger[] }
  | { kind: 'stepped'; min: SafeInteger; max: SafeInteger; step: SafeInteger; origin: SafeInteger };
```

Validation rejects non-finite, fractional and unsafe values, nonpositive step, invalid range, duplicate/empty discrete domains and misaligned initial values. Step alignment is relative to origin. Amount meaning explicitly distinguishes total contribution from additional payment; formatting/resource units are separate. Exceptional short All-in is a distinct offered command, not an invented interval below the ordinary raise minimum. Never clamp or silently retry a changed amount. Larger integer/string amounts need a separate supported representation.

Raw edit buffer, parsed candidate, caret/selection and IME composition are separate state. Preserve the native edit node during ordinary placement changes. Defer destructive adaptation during active composition when possible; any required replacement needs an explicit transfer/cancellation policy.

## Projection, membership and privacy

Every authorized projection has an audience scope/generation, session and hand context, and revision. Audience is explicitly player, observer or replay access. Public player IDs, seat association, account authentication and permission are distinct. Reservation never grants a private hand.

An observed viewer/access/session-scope change is a high-priority revocation barrier. Before awaiting layout, synchronously remove or redact forbidden old DOM, accessibility text, hit bindings, local drafts, motion proxies and audience-sensitive caches. Discard old-scope asynchronous replies. Retaining an old frame is permitted only within its still-authorized scope. A scope string is not authorization by itself, and removing data cannot erase knowledge already legitimately observed by a human.

```ts
type CardView =
  | { kind: 'face'; ref: ViewerCardRef; face: FaceSpec; annotations: readonly Annotation[] }
  | { kind: 'tracked-back'; ref: ViewerCardRef; back: AssetRef }
  | { kind: 'anonymous-back'; back: AssetRef; ref?: never };

type ZoneContents =
  | { kind: 'enumerated'; order: 'meaningful' | 'presentation-only'; cards: readonly CardView[] }
  | { kind: 'aggregate'; count: { kind: 'exact'; value: number } | { kind: 'unknown' }; exposedTop?: CardView };
```

ViewerCardRef includes scope and an opaque authorized handle, not a raw physical card ID. Anonymous render tokens are local and cannot be submitted as card references. Unknown-count decoration must not derive from the secret true count. A known exposed top belongs to the aggregate count, not an extra card. Hidden mixing/recycling must not expose a correlation map or source indices that reveal new stock order. Duplicate faces are allowed; duplicate physical membership is not.

Zones are the only canonical card membership owner. Contained groups reference members in one declared zone; relation groups such as best-hand highlights may cross zones without creating ownership. Creator/owner labels grant no modification rights. Targets discriminate zone/group/card and insertion start/end/before/after. Insertion into an unordered group needs registered semantics rather than a guessed index.

Validate reference scope/existence, unique handles across canonical zones, contained-group membership, declared disjointness, nonnegative exact counts, and consistency of exposed tops/counts. Group annotations, assets and accessible descriptions remain subject to authorized projection. A schema validator cannot independently prove that the server's content is authorized.

Transitions are separately projected: correlated transfer, anonymous public-count transfer, or concealed update; creation, destruction and reveal need explicit branches. They carry scope and source/destination revisions. Never include concealed card IDs/indices merely for animation. Missing source history or an expired handle reconciles to the authorized snapshot. Replay seeking establishes its own projection at that seek point; unrestricted logs/current-player caches are not replay permission.

## Command scope, receipts and server authority

New guarded transport must bind a command to an authenticated participant, hand incarnation, opportunity revision, optional window revision, payload and command ID. Actor/room authority comes from the authenticated server connection, not a client-supplied seat. Persisted hand IDs are never reused; a restored runtime also changes its authority epoch or otherwise guarantees that old revision values cannot alias new opportunities.

```ts
interface ProposedSubmit<A> {
  commandId: string;
  handId: string;
  authorityEpoch: string;
  observedStateRevision: string;
  opportunity: { id: string; revision: string };
  window?: { id: string; revision: string };
  action: A;
}
```

The server issues the opportunity's validation scope. A strict-state opportunity rejects changed state. A dependency-scoped opportunity can survive unrelated actions only when its server-maintained dependencies remain valid. Echoing a window ID never weakens validation, and current complete game-action validation is mandatory in either case. Two windows sharing one discard conflict even if their clocks are independent. The client cannot choose a less strict scope.

Idempotency key is authenticated participant + hand incarnation + command ID; a canonical server fingerprint covers context and action. Same ID/same fingerprint refers to one operation and returns its current receipt; same ID/changed content is refused. Terminal applied/rejected outcomes are immutable. A recorded-pending response may progress monotonically to a final resolution without being applied twice. Responses must not disclose another player's private payload.

After authentication, known-receipt lookup and fingerprint comparison precede stale epoch/opportunity rejection. This permits an identical durable retry to recover its known outcome after restore. Unknown commands with old authority/context remain rejected. Canonical fingerprints preserve semantically ordered lists such as selected card sequences.

After a lost acknowledgement, client state is uncertain, not rejected. A capable transport queries the receipt or retries the identical command ID/content; it never creates a new ID automatically. An unknown receipt does not prove non-application unless the advertised durability/retention contract establishes that. Use bounded, advertised receipt retention and a reconciliation-required result after its horizon.

Do not prune a receipt while its original context can still admit that operation. Expire/rotate the server-issued opportunity generation before its deduplication evidence is discarded, and retain the advertised recovery horizon after closure. An unknown expired operation must not become executable again merely because its receipt was pruned.

The controller uses an explicit captured → pending → applied/rejected/recorded-response lifecycle, with uncertain as a recoverable transport state. Repeated activation of a busy opportunity does not allocate another command ID or queue an implicit second action. Retry is the same operation. Replacing its view does not erase uncertainty. V1 uses single-flight behavior for its decision; later independent opportunities may proceed only under advertised server-owned conflict/dependency scopes. A pending catch need not block an unrelated normal-turn draft. Resolution requires a receipt or authoritative correlated reconciliation, not an assumption that a timeout means failure.

Crash-safe acknowledgements require mutation/log and receipt to be persisted atomically before acknowledging that durability. Current coalesced asynchronous snapshots do not establish this. Capability negotiation distinguishes process-lifetime acknowledgements from durable ones. A process-only restart invalidates old authority and requires resynchronization for uncertain commands; do not promise durable exactly-once behavior. A durable implementation must test crash-before/after commit and acknowledgement. Legacy action-only transport keeps its existing behavior and must not claim server revision guards, receipt retries, or response-window support.

Atomic multi-card operations are one typed action validated entirely before committing mutation. Existing sequential command batches can partially apply and are not retried as atomic operations. Candidate validation becomes the named rules authority with a legacy finite-membership default; bounded bot candidates are a search strategy, not a second legality source. Human, off-turn, bot, timeout and replay paths must use the same authority.

## Window deadlines, arbitration and restore

Each server-issued window defines dependencies, allowed responder behavior, cutoff and resolution policy. Proposed default cutoff is trusted server admission time: responses admitted strictly before the deadline qualify; equality is expired. Client timestamps are not authority. A serialized ingress/expiry barrier must ensure an expiration cannot overtake already admitted eligible responses. Recording only processing time while claiming admission-time semantics is invalid. This scheduler is a proposed implementation requirement, not present behavior.

First-valid policy evaluates valid responses in authoritative admission order and consumes the contested resource once. A game with ranked or multi-response claims records responses as pending and resolves under its own policy, often after close; it must not immediately grant ownership to the first arrival. “Recorded response” differs from “applied move.” Arbitration does not depend on animation completion.

Clock jobs and bot jobs are keyed by hand/window generation and actor. Unrelated state changes do not accidentally suppress valid expiry jobs. Log expiration/resolution and required randomness as deterministic inputs. Persist window identity, resolution state and a declared restart policy. Initial supported restart policy may cancel unresolved windows and ask rules to issue fresh generations, but games that cannot accept cancellation must require a resume-capable implementation. Resuming requires an explicit persisted deadline/time policy. Never replay old monotonic timestamps as a new process clock.

Bot work also captures opportunity/domain revision and validation context. A surviving window can contain a changed opportunity; its old bot result must be canceled or explicitly revalidated, rather than accepted solely because the window ID still exists.

On restore, re-arm permitted jobs and invalidate old authority before accepting unknown old-context submissions. Known idempotency receipts remain queryable by the authenticated actor according to retention/access policy. Old timer completions and old bot results cannot mutate a new window. No wall-clock or network-fairness guarantee is inferred from these contracts alone.

## Measurement and publication lifecycle

```ts
type Evaluation<T> =
  | { status: 'ready'; value: T }
  | { status: 'pending'; requests: readonly MeasureRequestId[] }
  | { status: 'failed'; diagnostic: LayoutDiagnostic };

interface CandidateToken {
  attempt: number;
  projectionScope: string;
  presentationRevision: string;
  environmentRevision: number;
  draftRevision: number;
}

type SolveOutcome =
  | { status: 'ready'; candidate: CandidateToken; frame: LayoutFrame }
  | { status: 'pending'; candidate: CandidateToken; requests: readonly MeasureRequestId[] }
  | { status: 'failed'; candidate: CandidateToken; diagnostic: LayoutDiagnostic };
```

Widget measurement returns Evaluation, never placeholder zero geometry. Collect/deduplicate all missing requests in a pass. Intrinsic-width hints and exact/at-most-width content measurements remain separate. Immutable measurement keys include request kind, content identity/revision, constraints, font/theme/locale revisions and relevant accessibility metrics. Sensitive entries are scope-partitioned. Tagged replies can fill only a valid key; node ID alone cannot select a current reply.

Environment revision includes allocated dimensions/safe areas, fonts, locale/direction, theme metrics and relevant input/text-scale settings. Supersede old candidates on relevant changes. Commit only a current, fully resolved token with valid geometry and binding/content revisions. Delivering an old 768 px measurement after a 320 px resize must not commit it, even when offer IDs match.

Explicit failures include invalid dimensions/constraints, detached/rejected/exceptional measurement, timeout, cycle/oscillation, exhausted pass budget and unsatisfied minimums. Budgets are configured engine policy and observable diagnostics. Terminal failure stops self-rescheduling; retry requires a new relevant dependency revision or explicit request. Retain an authorized compatible old frame only temporarily under a bounded policy. On terminal failure, show a fitting accessible fallback with no invented or rebound action, rather than keep an off-screen desktop frame indefinitely.

Privacy revocation overrides all retention. Ordinary changed offers disable old-frame controls until matching content commits; “Call 10” pixels cannot be rebound to “Call 100.” Capability-removing changes can disable immediately. Layout, displayed bindings and semantics commit as one epoch; paint-only motion does not restart intrinsic measurement.

Engine-owned font selection, typography and other metric-affecting renderer styles stage with their matching frame. Retained frames retain the prior rendering recipe; a loaded replacement font or new theme variables must not resize old pixels beneath old geometry. If an external metric change cannot be staged, suspend the affected surface until compatible geometry or fallback is available. The atomic-publication guarantee covers controlled/observed changes, not arbitrary unobserved browser or injected CSS changes. Test delayed font replacement and theme changes while a candidate is pending.

## Geometry, gestures and adaptation

Leaf results and effect outsets are local. Committed rectangles are frame-root-relative with explicit transforms. Clearance is consumed once; enclosing groups propagate residual outsets rather than repeatedly adding the same padding. Clip owner resolves the full transformed ancestor clip chain, including scroll state. Hit regions intersect that chain and use the declared shape, not just a rotated card's axis-aligned bounding box.

Motion sampling time/transform revision and scroll state join the layout epoch for visual hit testing. Pressed buttons may keep a stable outer hit target; lifted cards can use their visual pose. Flight proxies are noninteractive by default. Overlay escape is explicit and does not bypass modal focus/input ownership or unrelated masks.

A gesture captures decision/binding generation and interaction generation. Incompatible target placement, clipping, variant replacement, scrolling, focus-context change or node removal cancels it. Paint-only effects with a declared stable hit target do not cancel. Held Space and pointer-down across a row→stack resize must not activate a moved/replaced target. This cancellation is distinct from authoritative action revalidation.

Normal row/stack placement retains native nodes. Compact disclosure preserves semantic identity/draft and uses explicit gesture/focus transfer; sheets open on user activation. Widening does not silently close a user-opened sheet. On dismissal, focus returns to the trigger, matching inline option, or a persistent fallback. Raw edit buffers and IME state need a tested transfer policy when identity cannot be preserved.

## Acceptance ledger and implementation boundary

| Review counterexample | Required contract/proof |
| --- | --- |
| Mixed finite/numeric fields silently ignored; missing numeric field | Discriminated decision types and negative compile fixtures |
| Later field change gets undone; disabled option still submits | Pinned complete-relation reconciliation and descriptor tests |
| Two identical labels represent different commands | IDs preserved; tuple ambiguity refused or explicitly disambiguated |
| Joker+lead, play-7+suit, meld+target+wildcard | Joint structured candidates, no independent Cartesian product |
| Short All-in accidentally creates intermediate raises | Exact numeric domain plus separate offered command |
| Player→observer while a private flight/layout is pending | Immediate scope revocation across DOM/ARIA/overlays/caches and old replies |
| Duplicate decks, unknown stock, best-hand highlight | Distinct instances, anonymous/count-only types and canonical zone membership |
| Accepted Draw loses acknowledgement; restart reuses version | Scoped command ID/receipt/durability tests, no automatic new-ID retry |
| Independent response survives unrelated turn; shared discard consumed twice | Server dependency scope, atomic resource resolution and window tests |
| Deadline backlog; old timer or bot result after restore | Trusted cutoff barrier, deterministic logged events, generation-bound jobs |
| Old font/viewport/draft measurement arrives late | Tagged request/cache/candidate validation; no partial commit |
| Resize during press; nested clip/rotated corner receives input | Interaction-generation cancellation and effective clip/shape tests |
| Persistent layout cycle leaves unusable controls | Bounded terminal failure and fitting accessible fallback |

Prototype tests cover only the subset named in their README and test output. The rest are implementation acceptance gates. Type assertions, fake receipts or schema fixtures do not prove server durability, actual game rules, private-data revocation, browser frame behavior or cross-browser accessibility. Re-run independent browser and server scenarios when those capabilities are implemented.
