# Engine-owned table and Mighty rule forms

Status: implementation plan under review, 2026-10-18. This extends [native editing](ENGINE_NATIVE_EDITING.md), whose Report and typed Join/Rename slices are already opt-in. It does not claim full rules parity, change existing room settings, authorize default-root cutover, or require changing the server's accepted Rules merely to fit the editor.

## Outcome and ownership

Restore actual connected table settings and the complete Mighty RuleEditor: all 43 definitions across five groups, every compound control, pinned presets, nine built-in/five local custom choices, field/all reset, changed summaries, errors, scoped application and truthful local saving. Do not ship a presets-only substitute or mount the legacy Sheet/editor.

The canonical session owns authorized inert schema/model/operation bindings and admission. The runtime owns all drafts, disclosure, section selection, reset, conflicts and focus intent. The planner owns every ordinary/pending box. The DOM surface owns native editing under engine leases. Registered pure Mighty policy owns rule meaning, option-ID mapping, dependency reduction, validation and typed compilation. Host sinks own storage and scoped transport. No second application draft store, arbitrary callback in documents, property-path interpreter or game-specific planner node is introduced.

## Source-derived expansion and limits

The source audit is `web/src/lib/games/mighty/ruleFields.ts` (`RULE_FIELDS`, `GROUPS`, `setField`, `shown`, `problems`), `RuleEditor.svelte`, `TableRules.svelte`, `rulesets.ts`, generated Mighty catalog, and `crates/mighty/src/rules.rs`.

| Existing definitions | Definition count | Expanded scalar fields | Meaning |
| --- | ---: | ---: | --- |
| toggle | 17 | 17 | boolean |
| stepper | 7 | 7 | numeric raw text |
| segment | 11 | 11 | opaque finite option ID |
| maybe | 2 | 4 | enable boolean + numeric draft |
| flags | 1 | 6 | six friend booleans |
| rounds | 4 | 8 | first/last finite fields |
| cardValues | 1 | 10 | five declared enable/value rows |
| **Rule controls** | **43** | **63** | 30 boolean, 14 numeric, 19 finite |

With two jokers, no-trump enabled, both optional values enabled and all declared card rows selected, group expansions are deal 19, bidding 9, friend 11, power 16 and score 8. Existing finite controls contain 59 options in total. Starting rules and a local custom name bring the normal editor to 65 scalar fields. The generated catalog currently has nine presets; ordinary local saving caps custom sets at five, yielding 14 starting choices. Table settings are a separate two-field form: four allowed turn limits and shuffle.

These are not a formal maximum for every server-accepted custom model. `Misdeal.card_values` is a Vec without a corresponding length/uniqueness/domain check in `Rules::validate`; legacy RuleEditor renders every existing row. Other numeric fields are i8/u8, wider than the legacy suggested stepper limits. Current preset Rules serialize to roughly 1.3–1.6 KiB individually, but this is not proof that a complete schema/model fits 64 KiB.

This gate supports all 54 meaningful card override identities. Replace the five-card row expansion with 54 enable/value rows: 53 other rule fields +108 override fields =161. Add three conditional scoring-number parameters (BothOver, PaysBack, and the selected back-run threshold) to preserve and edit full typed values, plus starting choice/name: **166 logical fields**. This fits a proposed 192-field ceiling. At most 54 repeated card rows fit a 64-row ceiling. Seven logical sections cover the five rule groups plus starting rules/local metadata. Field clusters and repeated rows have separate bounded registries; they are not counted as arbitrary top-level sections.

Finite enums remain compact. Numeric parameters are not enumerated. Existing nonstandard card-call pairs from the current model/custom sets get explicit existing-value options, mapped to typed card pairs by the policy. They are never JSON text commands. Preset values, closed enum alternatives and up to five captured custom sets remain bounded; the initial total-option ceiling is 256, verified against the emitted worst schema rather than assumed from 59.

Proposed generic validation ceilings: 192 scalar fields, 64 repeated rows, 16 sections, 64 labelled clusters, 256 total finite options, 256 object members/array items where required, 8,192 inert-model nodes and depth 12. Retain **64 KiB aggregate schema/model/draft and 64 KiB compiled payload** initially. Every stage validates before owned allocation; no sparse arrays, capabilities, getters, exotics, reserved dictionary IDs or nonfinite numeric values.

Before adopting these bounds, generate the real worst Mighty schema/model, including 54 overrides, full numeric parameters, five validated custom sets, all changed/reset/error summaries and the longest permitted names. Assert its exact UTF-8 serialized size. If it exceeds 64 KiB, first remove duplicate data/help and keep immutable built-in catalog data in the registered policy. Any remaining limit change requires an explicit measured revision, not silent truncation or unlimited input.

## Compatibility at editor ingress

Never truncate, deduplicate, clamp or rewrite existing room Rules to make the UI fit. Gameplay, room restore and the original opaque settings remain intact independently of editor availability.

The registered Mighty editor decoder checks the complete current/pinned/custom model before offering an executable editor. Duplicate, out-of-domain or over-budget override collections, unknown base identifiers, or malformed/over-budget custom storage explicitly decline editor allocation with a readable diagnostic. They do not fail the table document, overwrite storage, drop offending entries, change the room configuration or affect game actions. A future explicit compatibility/migration action may repair them, but is not part of this gate. There is no backend contract change solely for UI limits.

Authoritative scalar values outside the old suggested UI intervals remain supported. Numeric fields distinguish the full typed domain from optional suggested values: i8 misdeal values use -128..127; u8 bidding/cost/threshold parameters use 0..255 where the server permits them, with cross-field constraints (such as nonzero minimum bid) validated separately. Stepper shortcuts and help may suggest the old common ranges, but the native numeric draft accepts the complete typed range. Never mark an otherwise valid base invalid merely because its value is outside an old control's suggestion, and never block unrelated edits without a diagnostic.

Preserve noneditable properties such as players, hand size, lowest rank and extra cards exactly. A supported existing finite value absent from the common alternatives receives a labelled existing-value option or a typed parameter field; changing some other rule must not replace it. Invalid/unrepresentable data follows explicit decline behavior instead.

## Reusable schema and draft transactions

Extend the scalar union to text/multiline/numeric raw strings, booleans, and finite opaque option IDs. Keep numeric intermediates such as empty text and minus editable. Finite values are mapped to typed constants within registered policy; the document never contains executable property paths or callback closures.

Add semantic sections, labelled clusters, bounded repeated rows, optional leading card artwork/information, field reset metadata and field/section references for summaries/errors. These describe meaning and accessibility; no widths, CSS layout, spacing or responsive rules are supplied by Mighty.

A registered draft reducer operates on an owned snapshot:

```ts
reduce(offer, previousValues, edit): {
  values;
  visibility;
  enabled;
  issues;
  changedFields;
  summary;
}
```

The engine owns the entire scalar draft. Mighty decodes a cloned semantic Rules model from the authorized base plus these values, applies only the known edited rule, calls existing dependency logic, and projects the complete result back. No independently mutable game model survives between calls. Registered code may use its internal closed field map; user field IDs are not paths passed to `setPath`.

Reduction is one bounded synchronous transaction with owned inert output and a post-policy check of canonical offer, source/draft revision and composition epoch. Throw, Promise, invalid output or reentrancy invalidation rejects the local transition without side effects. Do not run unbounded fixed-point normalization.

Invalid numeric intermediates remain in their native fields and produce issues rather than being coerced to zero. A dependency change that would overwrite/hide/remove a composing field waits for explicit composition completion or explicitly terminates that lease. It does not queue a server action for compositionend. Unrelated field changes and authority renewal preserve compatible native editor nodes, caret, selection and undo. Field/all reset and starting-set changes are explicit replacement boundaries; cancelling clears only the engine draft.

The starting-choice ID and captured custom-set data determine the local comparison baseline; authoritative `baseVersion` still means the room settings being edited, not the selected local preset or every Room version. Choosing another preset/custom set resets through the reducer and preserves the legacy pinned-base semantics. Built-in rules come from the registered immutable catalog revision; current pinned and custom models are captured bounded input. A changed authoritative room base causes conflict and requires explicit reload/reset. An unrelated Room change renews only submission authority without replacing native editing leases.

### Invalid raw overlays and dependent edits

An invalid numeric draft does not prevent decoding or editing the rest of the form. Reconstruct a temporary semantic model from the captured validated comparison base plus only valid typed overlays. Invalid numeric cells keep their exact raw text and issue; their temporary semantic value falls back to the captured value (or the declared default for a newly enabled cell). This temporary fallback is never written over the raw draft and never makes final submission valid. There is still only one engine-owned raw draft, not a second mutable application model.

The closed Mighty decoder establishes structural discriminants first, then interprets dependent fields against that structure. It does not replay every scalar through `setField` in arbitrary object-key order. Once the prior semantic model is reconstructed, apply the single proposed edit and its known dependency normalization as one transaction. Project changed dependent values back only where no invalid/composing raw cell would be overwritten.

Unrelated changes remain usable with an invalid cell: `numeric A = "-"` followed by independent toggle B preserves A and applies B; recovering A completes its typed overlay. A parent edit that would hide/remove or replace a different invalid/composing dependent cell is rejected as a local transition with a concrete issue identifying the cell to finish/reset. It does not partially flip the parent, silently discard the raw value, or queue the edit for compositionend. Explicit reset or disabling that very optional row is a declared local value-discard boundary, provided composition has completed. Preset/reset-all likewise uses an explicit replacement boundary. Multi-cell normalization commits wholly or not at all.

### Native subleases

The stable form lease is insufficient once fields can hide or sections can change. Each mounted editable field also needs an engine-issued native sublease token/composition epoch. Compatible geometry and authority renewal retain that token. Hiding/removing/replacing a field retires its token; showing the same field ID later allocates a new one. Late events carrying an old token cannot alter the newly mounted field, even inside the same form instance. Section navigation is an explicit field-lease transition, preserving raw drafts while not promising uninterrupted native undo across intentional editor removal. Geometry-only updates must still preserve caret/undo/IME.

## Pure Mighty policy and server agreement

Implement all 43 definitions, including optional values resetting to declared defaults, six friend mechanisms, first/last policies, both joker-call fields and every meaningful card-value row. Reuse `setField`, `shown`, `differences`, `say` and `problems` where correct. Preserve raw field data when normalization is deferred for editing.

Client `problems()` currently omits two server checks: `FakeWithoutCard` and `AlwaysMisdeal`. Add parity in the new pure validation path (and share with the old helper if appropriate), with directed examples from Rust tests. `AlwaysMisdeal` is bounded: enumerate the actual supported deck, sort by misdeal value, choose the strongest hand, and where all-point hands misdeal, substitute the best non-point card. It is not a combinatorial search. Validate bid ranges/no-trump limits, deck/hand/card availability, joker-call count and deck membership, available friend mechanisms, fake-friend dependency and scoring thresholds.

Changing the deck normalizes joker-call cardinality on a cloned model. Conditional no-trump fields and the second call field retain declared semantics. Hidden values are still validated/normalized coherently; stale hidden input cannot modify another field or become transport payload.

Compile Apply into exact typed `HostCommand`/`RoomAction.set_settings` with the offered Room scope. Preserve fixed room/game/seat authority, fixed player count and appropriate pinned base. The compiled preset/base snapshot and rule differences must describe exactly what the user previewed; transport never fetches a newer preset or rebases scope. Server validation and correlated receipts remain authoritative.

## Multiple actions, separate outcomes

The current single target/status is insufficient for Apply plus local Save. Extend forms with declared opaque actions and exact typed targets. Keep the existing single default-target API as a compatibility convenience for names/report, but normalize it into the same action model internally.

- **Apply to table** uses the existing command journal, exact Room authority, operation identity, receipt/reconnect recovery and combined-offer fence. Accepted does not mean a local set was saved.
- **Save on this device** uses a fixed registered storage operation with a bounded typed CustomSet payload and independent result. It consumes no Room sequence and does not mark Apply accepted.
- Reset field/all, select section, jump to issue and cancel are local engine draft/navigation operations, not host callbacks or server commands.

Form view state therefore tracks action status separately from the editable draft. Successful local Save can leave the draft editable; successful Apply can show accepted/reload/close under the existing base-conflict rules. Admit one local save per action/draft revision, rather than locking the entire form after the first host result. Editing a new revision makes an explicit subsequent save possible. Queued/sending exact actions retain their captured values and authority even if the user later edits; no automatic retry/recompile is introduced.

The custom name is local metadata and never appears in the Room settings payload. Preserve existing custom-set replacement/order rules and the five-set cap, but return truthful outcomes. `saveCustom()` currently catches storage failure and returns a set anyway; introduce a sink/result contract that distinguishes stored, memory-only (if deliberately supported), rejected/conflict and failed. Do not claim persistence after a swallowed quota/denial error. Storage-side effects happen only after canonical form action admission, never during normalization/compilation. Compare the current local catalog with the captured offer before replacing data; do not claim global cross-tab transactional guarantees from localStorage alone.

Validate/upgrade captured local sets with bounded input and preserve original raw storage on refusal. New saving does not silently cleanse unrelated invalid saved records. Results from a closed/reopened form or different actor cannot update its draft/status. A new saved-set choice may be refreshed on reopening; it need not mutate the schema of an editor still holding an active native composition.

### Accepted Apply and authoritative publication order

Track the captured Apply candidate/original base separately from the draft and from its receipt status. The pure policy produces a bounded immutable expected semantic result (effective Rules, selected preset and pinned comparison base) alongside compilation. This is operation evidence owned by the session, not another mutable game draft. It is private, not persisted with payload-free recovery, and retired after reconciliation or actor revocation. Compare semantic canonical values, not weak hash equality alone and not incidental JSON omission/order.

- Publication matching that expected result before its receipt keeps the action pending, retains the captured draft and suppresses a false foreign-base conflict. It never invents acceptance.
- An accepted receipt before publication shows accepted/awaiting fresh table state; the editor cannot submit again or treat the old base as current authority. Reconcile when a matching authoritative publication arrives.
- Acceptance plus matching publication shows applied/reload/close. This is an own-result transition, not an unrelated base conflict.
- A distinct concurrent authoritative result remains an explicit base conflict, including when the earlier Apply has a valid accepted receipt. Show both facts (the operation was accepted; the table now has different settings) rather than overwrite the newer base or hide its conflict.

This classification does not authorize another command. Subsequent Apply still requires an explicitly adopted current base, renewed exact Room offer and fresh frame. A transient match without a receipt is not a server success signal. Reconnect without retained local expected-result evidence falls back to authoritative readable state and honest receipt outcome; it does not reconstruct a discarded draft.

Action authority is separate from the retained draft basis. A foreign room-base conflict revokes Apply's authority but need not grant or revoke an unrelated local archive operation. Save may remain available for a valid same-actor captured draft only while the canonical policy explicitly continues that fixed local-save action under its original validated comparison model and unchanged local-storage binding. It saves that draft, not a merge into the newer room base, and neither clears the room conflict nor renews Apply. If the schema/policy or local-save binding is incompatible, Save is disabled with a diagnostic. Actor/audience revocation still retires every draft and action. This distinction must be represented by per-action authority leases; do not revive an old whole-form command capability merely to allow local saving.

## Measurement and native presentation

Keep the 2,048-metric working set and 512-read batches for the first measured implementation. Mount only one engine-selected rule section at a time while retaining the complete private draft. Starting-choice details and large card-value collections use engine-owned disclosures/subsections. Changed/error summaries expose bounded paginated engine navigation, with all affected fields reachable; do not instantiate every hidden section merely to calculate its height.

This is not a CSS accordion delegated to Mighty. The planner measures current section labels/help/options/summary/action envelopes, owns navigation and scroll allocation, and emits all boxes. Native editing values are not text-measurement inputs. The stable modal/editor lease and synchronous pending allocation from the names/report gate remain in force. Section changes during composition are explicit local lease transitions and preserve unaffected drafts.

Measure the largest active section—including the 54-card override collection—at 320px and 2× text scale, both themes and long legal custom names. Record exact unique metric count, rounds, maximum read batch and fallback behavior. A source count of 166 fields does not prove 2,048 metrics suffice. If the active section exceeds budget, subdivide/paginate semantically within the engine before raising a global cache limit. No scene-private content may survive audience revocation while a local editor is retained.

## Table settings and implementation gates

Use the same boolean/finite primitives for turn limit and shuffle. Project editable controls for seated users under the original between-hands UI policy, and read-only values otherwise. Compile one exact `set_table` command from the captured offer. Server permission/value validation remains authoritative; these fields are not immediate local preferences.

Implementation order is a coherent connected vertical slice, not an unused proof:

1. Add typed scalar/section/action/reducer contracts, validation and transaction tests. Produce all normal and 54-override Mighty schemas and enforce exact byte/field/option budgets. Reject unsupported legacy editor ingress while preserving room play/data.
2. Implement registered complete Mighty reduction/validation/compile policies and the two-field table policy. Wire actual connected settings/rules entry points and the truthful local-save sink.
3. Extend the shared planner/native renderer for groups/toggles/finite controls/stepper edits/summary navigation and action results. Keep native leases and authority renewal intact.
4. Verify actual room application for every control family, server rejection/recovery, pinned/base conflicts and independent local saving; then perform phone/tablet/desktop and worst-section measurement qualification.

Acceptance requires full43-definition coverage, 54 override rows, all numeric typed-range bases, invalid/duplicate/oversized legacy refusal without mutation, pure dependency transactions, missing-server-check parity, same-actor scope renewal, field/base reset and dirty cancel, composition-sensitive dependency/section changes, exactly one scoped Apply, truthful storage denial, independent Save/Apply outcomes, and no local metadata in Room payloads. Manual Korean IME remains distinct from synthetic composition/direct native-click evidence. No default-root cutover or deployment is implied by this milestone.

## Implemented candidate evidence (2026-10-18)

The connected candidate implements all 43 definitions as 166 fields, 43 clusters and 54 card-value rows in seven engine-owned sections. Repeated rows use readable card labels without duplicated miniature artwork. The generated worst accepted model (54 overrides, full byte numeric values, pinned/current snapshots and five 24-emoji custom names) measures 59,099 UTF-8 bytes for the offer and 62,186 bytes including draft and one eight-entry changed/error page. No declared budget was increased.

Directed planner tests exercise the actual expanded schema at 320/390px with 2× text and desktop width, with each measurement request round at most 512 and the complete working set at most 2,048. The reviewed integrated frontend run passed all 1,498 unit tests in 94 files, including field-reset lifetime, explicit pristine/custom initialization, scoped result-hook reentrancy and summary focus/reveal coverage. Actual connected browser qualification is a separate pending gate, not implied by those counts. Native Korean OS IME remains unverified.

The session now owns pure reducer transactions, exact action compilation and expected-result evidence. Apply uses the ordinary scoped command journal; Save has its separate fixed local operation and truthful storage outcomes. A foreign room base blocks Apply while a structurally compatible same-actor captured draft can still be saved locally. Structural/schema/storage binding changes retire that local action; actor revocation retires every source. Field hide/disable/section/reset transitions retire the affected native subleases.

### Own local-save continuation

A successful fixed local Save can renew only its host action authority while the same editor keeps its raw values, native field leases, comparison model and Room Apply fence. The connected host binds a fresh opaque token to the exact bytes its storage write produced, the saved identity, starting-choice token and the admitted actor/form/action lineage. The canonical offer carries only `{token, savedId, sourceId}`; repeating a potentially 20 KiB catalog beside the captured comparison catalog would exceed the proven schema budget. A continued immutable Save payload carries that exact token, never a request to reread/rebase current storage. The fixed sink resolves it only within that lineage and still compares against the exact written bytes. Foreign storage changes therefore remain conflicts. A different chosen starting rule does not inherit the previous newly created saved identity.

Room-base conflict does not adopt a new comparison model just to renew this local action: the session merges only structurally compatible canonical draft-host targets into the captured offer and leaves Room Apply retired. Queued saves whose token changed are cancelled before handoff. Actor revocation, disconnect, close/reopen and stale operation outcomes cannot restore a retired continuation. Tests cover independent local renewal and exact token handoff; actual repeated-Save browser verification remains separate.
