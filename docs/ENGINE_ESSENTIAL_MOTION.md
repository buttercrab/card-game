# Essential motion and faithful active composition

Design checkpoint; implementation and browser qualification are pending. This extends the single engine owner rather than adding an animator/controller beside it.

## Observed constraint

The frozen E9/Dq0 build passed 2218 unit tests and six exact same-hand visual comparisons. Narrow candidate commands remain below the hand to keep straight stock-to-hand flights clear, while the original places status at the top and decisions above the hand. Reordering alone would put enabled native controls and readable labels in those flight paths.

The actual Misdeal diagnostic also proved that the current deal contract correctly refuses a direct old-stock3/held50 to new-stock3/held50 transition. The server settles recycle/chance before publication, so no rendered stock53 intermediate is guaranteed. Existing immutable card/count conservation must remain intact.

## One engine-owned temporal input lease

The planner declares an internal `decisionLaneId` for the measured game decision strip above the hand. The application does not provide its coordinates or choose its descendants. Status, header, settings, read-only openers and actual stock remain outside this lane.

The native transfer adapter determines whether a bounded essential deal can start. Before patching/publishing that candidate, it requests one internal lease with `{frameId, owner}`. Runtime accepts only its current publishing frame, exact canonical document/offer/context, the engine-declared lane, and a valid live surface mount. It derives game-input descendants from canonical planned bindings, rather than trusting an application list.

Acceptance is a transaction: runtime acceptance alone never waives a path. The native adapter must verify the exact current lane element is hidden, inert and aria-hidden, and every masked native control is disabled, before any path exclusion. Failure or callback reentry aborts the whole batch. Acceptance synchronously cancels native select/range/editor captures as well as tombstoning all in-progress game gestures and blocks frame intents for game commands, finite choices, owned-card actions and card inspection. Native controls use their current canonical enabled value plus this local mask. The decision lane alone becomes unpainted, aria-hidden and inert during the cohort; its measured allocation stays fixed. Its labels are therefore not readable obstacles during flight. Retained hand artwork remains readable and its geometric protection remains in force; it is not exempted merely because game input is temporarily blocked.

A lease is not server authority. It cannot admit a command, change an offer, or issue transport. A new physical begin is required after release; standalone fresh AT activation remains supported through the existing provenance rules.

Only a successfully owned native suspension may be omitted from native protected-path rectangles. Every other current hit target, body-copy rectangle, source/destination, clipping ancestor and host bound is still checked. An optional callback failure, reentrant revoke, missing lane or refusal cancels/snaps motion rather than relaxing a path.

The same owner is renewed only across compatible current frames. Actual arrival, reduced/off motion, a known snap, modal opening, resize, scope revocation, unmount and failure all release it. Cleanup detaches ownership before callbacks. Cleanup can retire its exact owner while pending, but native restoration requires the same ready canonical frame; a pending/disarmed tree stays disabled until an ordinary fresh publication. Held-input tombstones survive compatible frame reuse. It restores only the same current element/SVG and current canonical enabled state, never an old element or a pending/disarmed tree. Opening a header dialog cancels motion strictly. No timeout assumes delivery/arrival.

Prepublication acceptance closes the commit-to-animation-start input race. Directed tests must cover callback reentry, held pointer/Space/Enter, direct/native activation, compatible publication, failed path, resize/modal/revoke, and pending measurement cleanup.

## Explicit count-conserved recycle

Proposed semantic hint alongside the existing deal:

```ts
interface RecycleTransition {
  readonly id: string;
  readonly source: string;             // exact canonical stock collection
  readonly previousGeneration: string;
  readonly totalCount: number;
}
```

Canonical ingress owns bounded inert fields and requires one matching deal source, current registered stock, and no waiting/outcome combination. Mighty offers this only from an explicit public fresh-redeal observation using the existing bounded native previous-State/participant capture and baseline/room-epoch/connection fences; bootstrap/reconnect, missed ambiguous transitions and roster replacement do not synthesize it. The optional preprojection history context reuses that single host owner. Native `redealt.count` can reset after bidding, so a known Exchange-to-Bidding Misdeal must mint a distinct frontend generation even when the native count returns to one. Ordinary bids do not mint generations. No application supplies a motion path, duration, hidden face or old private snapshot.

The engine additionally requires:

- Same mounted session/audience/continuity and environment eligibility, exact hinted prior generation, and the actual latest source frame/context/roster, with a fresh authorized next generation and distinct transition ID. A cached generation string is insufficient. Reconnect, admission-await with unknown source publication, or an incompatible pending frame refuses motion.
- Unchanged original participant identities; unique stock and participant count markers; no unrelated public face zones in the recycled source partition.
- Both old and new local counts equal their independently authorized own-hand entities. Recipient counts cover the same public participants.
- `old stock + all old held counts == totalCount == new stock + all new held counts`, within the declared stock bound; the new deal total remains within the existing 64-transfer cap.
- A real current neutral-back prototype and current clipping/path validation. An Exchange Misdeal may have old stock zero and local13; no old stock artwork is required or manufactured. No old face SVG is cloned, no physical-card ID is matched across generations, and no stale generation or duplicate hint can replay.

One immutable internal `RecycleAdmission` is issued from this exact proof and captures only redacted counts, participant/context bindings, source-frame identity and next-transition identity. It never retains old private face data and never builds a synthetic previous stock53/private-empty frame for `transferCandidates`. Other stocks/zones must be unchanged or the proof is refused.

The adapter then owns a bounded neutral recollection phase at the actual visible current stock allocation. Old private artwork retires; new private faces and decision input remain concealed. Canonical stock/hand state is not rewritten. A distinct engine presentation landmark represents the validated reconstituted deck, with its truthful accessible/painted count, while the contradictory canonical stock caption is temporarily suppressed. Its count label has a planner-measured reserved footprint through the supported bound; caption suppression cannot introduce unmeasured paint. The marker must receive an exact current-frame native clipping/visibility acknowledgement and a paint-separated bounded visible dwell before it can become the source of a strictly checked 50-back deal. A same-microtask BCR check followed by removal is insufficient. Reduced/off/no-origin paths may snap without inventing an arrival or replay.

This is a declared presentation transition, not a fabricated canonical frame or a silent stock3-to-stock53 exception. Original quick-deal animation does not require inventing 50 additional return ghosts; a visible, counted neutral reconstitution is sufficient, followed by the ordinary strictly checked deal. Source/count proof and ownership must remain inspectable without private payloads.

The native owner has at most one recollection phase and one subsequent deal batch. Compatible metadata may retain them only after current geometry/scope checks. Resize, modal, scroll affecting endpoints, actor/connection loss, or source replacement cancels both synchronously and never restarts them as history. Public timed feedback remains hidden/unfocusable through both phases and begins its four-second lifetime only after actual current presentation. This does not pause/restart the native 2800ms reaction-ingress TTL. A newer server state that invalidates the transition retires the proof immediately; historical redeals are not queued indefinitely.

## Active status and participant meaning

Compact status should reference existing canonical information (primary/minimum or round plus current turn summary) rather than duplicate game strings. A bounded semantic presentation reference selects these exact fields; all remaining meaning stays available in the full information view/desktop rail. A measured permanent status/notice signal envelope prevents benign notices from moving card endpoints; notice priority must not overlap status text.

Persistent public participant bid/pass status and dimming belong to a separate bounded participant presentation field, not the 1.5-second reaction/cue stream. Reuse existing information-value atoms and tones. Games provide meaning; engine owns its measured badge, muted appearance, order and stable allocation.

## Acceptance

1. Independent source/design challenge before heavy implementation.
2. Unit proof of exact recycle partition, stale/malformed/duplicate refusal, private-face exclusion and one owner; input-lease reentry/retirement proof.
3. Real initial50, common-phone counted pickup3 and held gestures with the original decision order; current protected paths remain unchanged outside the suspended lane.
4. Actual Misdeal normal-motion flow: visible counted recollection, exact newest50 backs, held4.5s public fan hidden/untabbable, same cohort resumed, then exact public hand visible for four seconds. AllPassed exercises recycle without public fan.
5. Matched original/candidate bidding, late play and outcome at390/768/1440 and200% text, including persistent participant state and visible top status.
6. Broad functional regression, native accessibility/resource checks and isolated frozen performance after the final source is stable.

## Current implementation checkpoint

The semantic hint, private count-only proof, canonical statuses, temporal input mask and native recollection/deal handoff are implemented in source. The proof retains a bounded collection/count signature and renews only against the same complete partition. Initial masking or native-mask verification failure aborts movement; failed/reduced recollections are consumed rather than replayed after a later resize or preference change. A scoped cleanup callback cannot cancel a replacement owner.

Focused checks cover held native/physical input and fresh assistive changes, exact-frame owner release, private-frame retirement with count-only admission, and branded count-plan rejection. Combined source type checking passed before the final compact-layout adjustments. Full-suite and actual browser qualification are still pending; this is not a motion or visual acceptance receipt.

### First integrated browser diagnostic

The frozen integrated candidate passed the real five-human normal-motion Misdeal path: it created exactly the newest 50 back-only ghosts, kept the ten authorized public cards hidden and unfocusable while that cohort was paused for 4.5 seconds, then showed the cards for the measured four-second lifetime after the same cohort settled. The test was corrected to avoid requiring a scroll tab stop when the ten-card fan fits its viewport; it still forced focus into the hidden fan and required rejection. Evidence: `/tmp/foundation-essential-integrated-20261018/deal-trace-browser.log`.

Acceptance remains open. The same diagnostic found an initial waiting-to-deal refusal: the waiting recipe had removed the canonical zero-count participant markers along with their visible zero-count paint. The unchanged transfer guard correctly rejected zero old recipient markers versus four new recipients. The follow-up retains explicit canonical zero-count evidence without displaying zero labels or inventing count values. The active 200% decision-content bounds also extended beyond their native viewport (clipped rather than visibly overlapping), so the declared decision lane must identify the actual viewport. Visual follow-up still needs cohesive status tokens, fully visible essential status, no duplicate pass cue, and compact aligned current-turn identity.

### Phase composition follow-up (source, not final acceptance)

The follow-up uses the actual `decisions` native viewport as the lane identity. The card-selection lane reserves its measured future command envelope before any card is selected; secondary selection text remains reachable in that same viewport. The board receives the exact space left after the local dock, decision lane, tools and essential status. When its natural content is taller, only the board scrolls. An engine-issued `primaryViewport` declaration validates the local dock and decision allocations against the initial environment and every ancestor clip. Exceptional fixed chrome that cannot fit uses an explicitly declared native root-scroll policy rather than silently expanding a pinned recipe.

The common 390×844 fixture at 200% text retains the full 72-pixel local figure, scaled name/status text and actionable card sizes. Its five complete figures are initially visible at normal text size across phone, tablet and desktop fixtures; at 200%, the board may scroll while the local hand remains visible. These are measured source tests, not a rendered-device receipt. Auxiliary stock keeps a real visible back and exact count, while current public result overview artwork has no live entity or input bindings. Canonical public collections remain separate motion targets.

Observer reactions occupy a measured passive gap and cannot move the card scene. Native paint can only hide a proposed gap after checking current glyphs, figures, cards, controls, header and ancestor clips; scrolling rechecks synchronously. Before essential controls are restored, passive observer paint is hidden and then revalidated against the restored current frame. Complete observer meaning remains available in the readonly table-information view when no safe gap exists.

The first combined source run passed 2,446 tests and found two remaining failures: an obsolete expectation that public Play roles were absent, and a real 2,049-entry measurement working set against the unchanged 2,048-entry cache in the full native bidding domain. The former is corrected; the latter must be resolved without increasing limits or removing legal actions. Current phase/result visual, final collection motion and combined isolated performance qualification remain open.

The exact follow-up source checkpoint passes type checking with zero errors/warnings and all 2,453 tests across 188 files (`/tmp/phase-final-exact-{check,units}.log`). The maximum native bidding working-set regression is closed by selecting relevant prerequisites rather than raising limits: native option/choice and all submit-label measurements remain, while body measurements for option summaries are discovered only at actual overflow widths. Both supported 1,276-action profiles and cached 255/No-Trump draft switching pass. Current result overviews use one independently owned readonly matrix with local frozen roster/card references and structurally aligned round headers; small historical artwork has no live entity/input identity. Rendered phase fidelity, final collection paths and combined performance remain separate browser gates.

### Compact phase follow-up source checkpoint (2026-10-18)

The source checkpoint after the `zpM6kVl3` browser failures passes `npm run check` (0 errors, 0 warnings) and all 2482 tests in 189 files. Logs: `/tmp/phase-compact-final-check.log`, `/tmp/phase-compact-final-units.log`.

The measured finite-decision viewport may flex to preserve the own-hand reservation, but its minimum includes each complete measured native command envelope. Labels taller than the preferred strip retain their full size and use explicit root scrolling when no bounded fit exists. Committed primary-viewport metadata and region IDs are independently copied and frozen.

The compact result retains selected canonical contract and captured-point fields, uses the shared 20/28 compact display role, and keeps full result details in Table Information. Historical matrix short labels preserve full round semantics; natural public team pills and zero-size canonical empty-recipient markers avoid extra zero-count paint. The observer reaction may occupy only an engine-issued empty measured header slot, with current native ink, clip and control checks before paint.

These are source/unit results. Actual 390px 2× bidding hand visibility, normal-size full result ring/matrix visibility, observer reaction paint, final collection motion and the combined performance gate still require a fresh frozen browser run. Earlier failed browser evidence remains authoritative for its tested source.

### Whole-result density follow-up source checkpoint (2026-10-18)

The later frozen browser passed hand containment, observer paint and native maximum-bid interaction, but visual inspection still found the last matrix row and two settled peer names clipped. The next source checkpoint passes `npm run check` (0 errors/warnings) and 2492 tests in 190 files (`/tmp/phase-density-final-{check,units}.log`).

The primary historical matrix now omits its duplicate visual record heading while retaining the complete accessible group/table title, keeps name and card rows adjacent, and uses 2px row separation. Five single-line rows save 82px without changing text sizes, names, artwork or 2× scaling. Settled role captions use the existing shared small typography, and complete peer names precede status. Any wider settled wing is capped by the renderer's shared measured column minimum, preserving the existing horizontal-scroll boundary and normal-size complete columns.

Domain fixture acceptance uses the existing full-stage host rather than the scrolling workbench. Static rule prose remains available in full information and is explicitly nonessential; current phase/winner remains essential. These changes still require the next frozen visual/native browser proof. The held redeal and final collection failures observed on the previous source remain open and are not closed by density tests.

The final source correction also prevents a settled wing from shrinking below its original allocation. This preserves the matrix's chosen 16/24px density regime while allocating wider measured identities; a threshold regression covers the previous 232→244px center-width jump. The exact subsequent checkpoint passes check (0/0) and all 2493 tests in 190 files: `/tmp/phase-density-threshold-{check,units}.log`. Frozen browser qualification remains pending.

### Active primary collection and complete peer allocation source checkpoint

The next frozen result browser demonstrated all 50 historical cards and all four peer names at normal size across 390/768/1440. It also exposed active-play side-name clipping and a final-collection source fan wider than its native viewport. The following source checkpoint passes check (0/0) and all 2500 tests in 190 files (`/tmp/phase-active-primary-{check,units}.log`).

Active trick allocation reserves the complete canonical participant capacity before wings, independent of current play count. Current meaningful play precedes auxiliary collections; empty trick ordering retains the existing initial-deal path. Bounded board recomposition carries the actual visible budget and pins a complete side identity only when the measured upper row plus the whole identity fits. Compact passive captions retain normal shared small typography, distinct role/point styling and count/artwork; only passive inter-row spacing is reduced. Directed tests cover all current-trick sources and peer leaves against every native clip.

Auxiliary counted stock retains a real 24×34 back, exact canonical count and typed recollection anchor/caption with measured alternate text. Mighty’s retained Bidding kitty is explicitly auxiliary. This does not relax visibility or stock conservation checks. The caller’s intermittent command-readiness interruption still needs causal tracing and an independently reviewed ownership design; no disconnected-continuity exception is implemented at this checkpoint. Actual final collection and held redeal remain unqualified until the new frozen browser run.

### Accepted-view ownership distinct from command recovery

Actual native traces confirmed the caller received a coherent, fresh publication with command recovery not ready. Reusing command readiness as visual ownership therefore discarded the caller's redeal continuity while other audiences admitted it. This was not caused by `awaitState()`.

The session now issues an opaque, revocable accepted-view ownership token independent of send readiness. Its live association is bound to the exact session port; the public facade exports only its type. Coherent `receive(...,{connected:false})` retains ownership for the same session/audience/local identity, while commands remain unavailable. Hard disconnect, revoke/private-view revoke, disposal, scope/identity replacement and notification overflow revoke the token before callbacks. A fresh receive after hard loss issues a different token; reopening readiness alone cannot revive it.

The runtime stamps only a successfully committed current frame. Recovery recycle admission requires the same authentic live session token, that exact committed-frame stamp, the exact previous canonical context and unchanged environment, in addition to all existing native-hint, roster and count-conservation checks. Missing-token custom ports retain only the older both-connected behavior; they gain no blocked-publication continuity. Foreign/copied/serialized/revoked tokens are rejected. Modal, mount, environment and hard-loss boundaries discard the pending recovery proof. There is no second private-frame cache or command replay.

Canonical receive now captures an authority epoch/document/notice before any incoming reflection. Its closed shallow document schema and four-field context are owned before the existing payload validators; unknown/callable/accessor root metadata is refused. Admission connectivity is captured once as an own-data boolean. Reentrant revocation/replacement during descriptor inspection or later form cleanup cannot commit an older publication or issue replacement ownership. This is a bounded schema/ownership guarantee, not an assertion that arbitrary host heaps have been inspected.

Exact source checkpoint: check 0 errors/0 warnings and 2525 tests in 191 files, `/tmp/ownership-final-{check,units}.log`. A fresh independent source review closed the ingress/reentry findings. Actual peer-and-caller held redeal, partial local settlement, final five-card collection, strict phase composition and combined performance remain the next frozen browser gates.

### Measured primary counts and final collection targets source checkpoint

The next bounded correction reserves the measured whole primary board footprint before preferred control height when feasible. Initial Bidding targets therefore include complete peer count landmarks, not just a 44px arbitrary board minimum; larger-text layouts retain the explicit native board scroll and pinned own hand policy. Directed default/1276-domain waiting53→Bidding3 tests conserve all50 transfers and check every normal-size source/destination against native clips and protected straight paths.

With an owned outcome overview, auxiliary current captured faces use the shared dense16×23 art policy and accessible full collection caption. They remain canonical entity/owner/zone targets; the historical matrix never acquires scene identity. The validator permits full16px exposure only for a closed readonly current captured fan with valid standard/joker faces and no activation/inspection/lease/count bindings. Ordinary28px and interactive44px clearances, clipping and path guards are unchanged. Missing/unknown/malformed faces and interactive or private-hand spoofing are refused.

Completed Mighty captured labels/owners now use one strictly validated frozen historical roster. Original names remain in captions/card labels; a live owner/reveal reference exists only if that original participant ID remains in the nonempty current canonical registry. Replacement occupants cannot inherit a departed actor's cards; a reseated original actor retains the same identity.

Exact final source checkpoint: check0 errors/0warnings,2534 tests in191 files (`/tmp/phase-primary-final-{check,units}.log`). Independent bounded source review cleared the primary/target/exposure/provenance corrections. Actual frozen peer/caller held redeal and final-five collection remain pending. Separately, the prior backend8a7 is no longer an acceptance candidate because the final audit found a settled Poker audience privacy defect; server and frontend audience fixes are proceeding in a separate lane. This frontend source checkpoint does not claim those future changes or any default cutover.

### Caller feedback and first-result presentation checkpoint

The caller recovery trace separated authorized-view ownership from command readiness. Runtime now retains feedback through a coherent command-blocked publication only with an authentic live presentation token belonging to that exact session; legacy ports retain the previous connected-only behavior. Hard connection loss retires the baseline, and a recovered historical event cannot replay. A final current-document and subscription-identity fence after form/disclosure callbacks prevents a reentrant newer publication from receiving stale outer feedback. This grants no command, form or disclosure authority.

The planner now declares a separate closed `outcomeLaneId: 'outcome'` for its result panel. On the first active-to-settled publication only, actual same-scope transfer candidates all targeting current captured collections can acquire the existing essential lease before native patching. The result panel, its continuation controls and exact Table Information opener become hidden/inert/disabled under that current owner while retaining measured space. Native verification precedes ordinary source, destination and protected-path checks; failure snaps without a path waiver. Reload/baseline results paint immediately. Release sends no actions and requires fresh physical gestures.

Source verification: 2546 tests across 191 files pass; type check reports 0 errors and 0 warnings. Focused ownership/feedback/essential tests and actual planner result-mask tests pass. Bounded independent source reviews cover the result barrier and caller feedback ownership boundary. Actual caller held-redeal and phone final-collection browser qualification remain pending on the next frozen candidate; these source checks do not close those gates.

### Terminal destination allocation correction

The corrected native-Done driver revealed a separate genuine clip: final16×23 targets extended3–4px beyond the settled native board viewport on desktop and phone. A bounded native trace proved all source candidates were captured and no transform was involved; prior in-flight play was not the cause. The settled planner now measures the complete ring-local bottoms of current canonical captured cards, whole peer identities and the readonly overview, rounds that priority upward, and spends preferred board-to-dock spacing before clipping those destinations. Header spacing, fixed local dock, text/art/control sizes and all motion clip/path guards remain unchanged. Larger unsupported priority footprints still use explicit board scrolling.

Current source verification:2549 tests across191 files pass,42 focused settled composition tests pass, type checking is clean, and the bounded source review is clear. Actual phone/desktop final-five collection remains pending on the next frozen build; caller held-redeal already passed the preceding CMT_n2gJ build.

### Essential stock-return admission

The broader real Exchange test reached all three discarded-card returns and exposed decision commands obstructing a legitimate hand-to-stock path. The same essential decision lane is now requested only when actual current `transferCandidates` prove a nonempty count-conserved return into the hinted counted back stock. Every local source must be an authorized removed hand face; observer/peer sources remain anonymous backs matching the exact hinted recipient. A persisted return hint with no stock increase or accompanying unrelated Play grants no suspension. Retained hand artwork stays painted while game inputs are disabled; native hidden-lane certification and all source/destination/path guards remain mandatory. Terminal outcome admission uses the same pure classifier without changing its first-result conditions.

Directed tests cover conservation/scope rejection, baseline/no replay, unrelated Play, observer back privacy, retained hand paint and hard view loss. Bounded independent source review is clear. Actual three-return browser qualification remains pending on the next frozen build.
