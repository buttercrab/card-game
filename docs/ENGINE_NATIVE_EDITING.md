# Native editing and parameterized forms

Status: hardened design with a bounded connected-room Report implementation under qualification, 2026-10-18. **Broader form API and manual IME acceptance remain open.** This remains a completion gate in [ENGINE_COMPLETION.md](ENGINE_COMPLETION.md). This document specifies the next slice and its invariants; it does not authorize replacing the default root or deploying.

## Decision and first slice

Build one engine-owned form system with three distinct identities: **canonical form offer**, **private runtime draft**, and **native editing lease**. Presentation frames can expire without destroying a compatible editor. Editing can continue without granting permission to submit an expired offer.

The first complete slice is the connected-room **problem report**: engine menu entry, one multiline field, measured label/help/error/status, reset/cancel/submit, composition-safe resize, bounded private draft, one fixed HTTP operation lane, processed/rejected/uncertain outcomes, and cleanup on close or audience revocation. It uses the same form admission boundary intended for named Join and rules, rather than an immediate preference setter or a report-specific renderer. No legacy ReportSheet is mounted. Actual Korean IME continuity remains a manual acceptance gate.

Names, reports and rules cannot enumerate all possible values as offered finite commands. Keep the existing exact-command and finite/card decision APIs unchanged. Introduce parameterized form offers explicitly, with exact materialization at admission; do not replace ordinary commands with generic form reducers.

## Source facts and current limitations

- The runtime disarms on invalidation. The DOM surface disables native controls, suppresses scene paint and blurs active descendants. Adding text controls to the current tree would interrupt editing during resize/measurement. Sources: `web/src/lib/table/foundation/runtime.ts` (`disarm`, `invalidate`), `domSurface.ts` (`disarm`, `invalidate`).
- Rename currently calls native `client.observe(name)` from `Room.svelte`. Observe also bootstraps visitor identity, trims/truncates names, and synchronizes credential-sharing connections. It has no correlated rename outcome. Sources: `web/src/lib/room/Room.svelte`, `client.svelte.ts`, `crates/server/src/room/lifecycle.rs::observe`.
- `RoomClient` already sends Observe on socket open, even with an empty saved name, and separately reclaims an existing seat through the native credential path. A room can expose public discovery before authenticated private command authority is ready. Source: `client.svelte.ts` (`ws.onopen`, `#refreshCommands`).
- Direct Join already supports scoped `RoomAction::Join { name, seat, device }`; its server tests show the authenticated observer actor survives joining. Sources: `crates/server/src/protocol.rs`, `room/room_commands_tests.rs`.
- `/api/reports` is rate/body bounded but has no authenticated actor, request ID or idempotency contract. It collects the room state when the request is processed, possibly returning a null snapshot after a timeout. It returns **204 even when filesystem persistence fails** (the failure is logged), and can run without a data directory. A 204 proves processing, not durable report storage. Sources: `web/src/lib/ReportSheet.svelte`, `crates/server/src/lib.rs::report`.
- Mighty has 43 rule definitions across five groups. The rendered controls expand beyond 43 through flags, first/last round pairs, nullable numbers and card/value rows. Normalization can change dependent fields: changing deck adds/removes joker-call entries. Validation crosses fields and sometimes reports issues without a directly visible field. Sources: `RuleEditor.svelte`, `ruleFields.ts` (`RULE_FIELDS`, `setField`, `shown`, `problems`).

## Ownership and semantic contracts

| Concern | Sole owner |
| --- | --- |
| Authorized form offer, schema/base/subjects and captured submit authority | Canonical session |
| Private raw/semantic draft, dirty/conflict state, composition epoch and edit intents | Runtime |
| Field/group/dialog geometry, scrolling and compatible pending allocation | Engine planner |
| Stable native controls, caret/selection/undo/IME and publication | DOM surface under an explicit runtime lease |
| Bounded rule normalization, validation and payload compilation | Trusted registered pure host/game policy |
| Operation admission/journal and exactly one transport invocation | Session coordinator |
| Fixed HTTP endpoint/browser metadata or scoped Room transport | Narrow host operation sink |
| Authoritative mutation validation, receipts and persistence | Server |

Proposed internal shapes, with final TypeScript names subject to implementation review:

```ts
FormOffer {
  id; instanceId; schemaVersion; policy: { id; version };
  editBinding; baseVersion; subjects;
  title; groups; fields; baseValues;
  submit: ScopedRoomFormBinding | FixedHostFormBinding;
}
FormDraft {
  instanceId; baseVersion; draftRevision; compositionEpoch;
  base; rawValues; semanticValues; dirtyFields; issues; conflict;
}
EditingLease {
  id; actorAudience; instanceId; schemaVersion; fieldId; nativeKind;
}
```

These are different types and lifetimes, not interchangeable tokens. `submit` captures an exact room window or an allowlisted fixed host operation plus its allowed subject/context. Documents carry no functions, DOM, property paths, transport handles, or application coordinates. Registry IDs/version must resolve to trusted host/game registration; arbitrary document strings cannot register code or choose an endpoint.

Field kinds cover text, multiline text, numeric raw text, boolean and finite selection. Rules compose these into bounded groups/optional sections/repeated rows with stable opaque IDs. Numeric editing retains intermediate empty/minus strings; successful semantic validation requires the declared finite range and step. A nullable number is a declared optional value, not `NaN` or an overloaded empty-string payload.

Initial implementation limits must be validated before allocation and cover the **expanded** field tree, not only rule-definition count. Proposed ceilings: one open form/runtime, 256 expanded fields, 32 groups, 64 repeated rows, 256 finite options/field, 2,048 total options, 256 issues, nesting depth 8, 64 KiB total encoded draft/model and 64 KiB compiled operation. Report/name limits come from the catalog (currently 2,000/24 Unicode code points). A field additionally has an explicit UTF-16 storage ceiling with bounded composition slack; `maxlength` is only a DOM guard and must not silently redefine Rust's character limit. Validate duplicate IDs, sparse arrays, accessors, exotic values, unknown fields/options, nonfinite numbers and oversized labels/help. These proposed ceilings require a worst-case expanded Mighty fixture before being accepted; increase only with measured evidence.

Raw drafts never enter ordinary public documents, inspectors, performance receipts, replay or localStorage by default. An admitted immutable payload may reside in the private bounded operation record for dispatch/recovery; public inspection still exposes only operation identity/status, and audience revocation redacts it under existing journal policy. Report text is released after dispatch/outcome tracking no longer needs it; HTTP retries are never reconstructed automatically.

## Draft and conflict lifetime

- Compatible frontend revision, unrelated public roster change, text measurement and resize preserve a lease with unchanged actor/audience, form instance, schema and field/native kind.
- Dirty and composing state belong to the runtime. The native input supplies editing events; the game does not maintain another mutable draft or await a callback to repaint typed text.
- Room-scope changes revoke the old submit binding, not necessarily the raw draft. A fresh canonical form offer can present unchanged subjects/base with new authority; only a fresh explicit submission may use it. Held input and destructive confirmation never inherit the new authority.
- Changed authoritative base values create a conflict for a dirty or actively edited form. Keep the local draft private and disable submission until explicit reload/discard or a later supported, explicit rebase. Do not merge automatically. An untouched, unfocused form may adopt a new base through a declared reinitialization boundary.
- Actor/audience replacement, canonical revocation (including a disconnect path that revokes private publication), incompatible schema, field removal/native-kind change or explicit close destroys the affected lease. Close/reopen receives a new instance ID even if schema/base match. Reconnect/remount does not resurrect cleared text.
- Reset is an explicit engine transaction with a new draft revision and native value replacement. Do not apply reset while composition is active without first completing composition or explicitly cancelling that edit. Cancel clears the private draft; it never claims an in-flight request was undelivered.

## Stable editing allocation, modality and IME

Use one engine-owned stable editing root outside the scene subtree whose ordinary suspension hides/blurs all controls. The form's native modal dialog and active editor stay mounted from open through close. At most one native top-layer dialog owns modality: transition out of an ordinary menu dialog before opening the form, or migrate the shared modal root coherently. Do not retain an underlay dialog plus an independent editor dialog/focus trap. The editor cannot sit outside its actual modal and merely be exempted from `inert`.

Before asynchronous measurement begins, the engine must synchronously issue a safe **pending allocation** for the leased editor: viewport-bound dialog/editor boxes plus scroll/clip ownership, derived from the prior committed allocation and the new environment. The surface cannot invent CSS widths, clamping or breakpoints. If no safe compatible allocation exists, explicitly suspend/terminate editing with the draft retained under the same audience until a safe plan returns; do not keep an editable offscreen field. This exceptional path cannot be advertised as uninterrupted IME continuity.

Compatible preparation preserves only local editor behavior. Background/game/submit actions remain disarmed. Never reparent the active editor, replace its DOM node, assign `.value`, restore selection, or disable/blur it during a compatible publication. Geometry can update from the engine pending/committed plan without replacing the element. Native selection, undo and composition state remain in the browser; the runtime owns the corresponding text draft. Programmatic value replacement happens only at explicit reset/base-reload/lease-termination boundaries.

Lease-scoped `beforeinput`/`input` and composition events can update the matching draft during compatible measurement without a fresh presentation frame. They cannot invoke a host effect or submit. Each event is checked against lease identity and composition epoch; late composition/input from a retired lease cannot modify a reopened form. Do not truncate, trim, normalize, or move the caret inside a composing native value. Oversized/intermediate content becomes invalid for submit and remains bounded by the separate raw storage guard.

Compositionend/input ordering differs across browsers. Commit must read the engine's completed input revision, not assume compositionend already delivered the final text. A submit observed while composing is rejected/left available for a fresh explicit activation after composition completes; never queue a server mutation to run automatically on compositionend. Enter during composition does not submit; multiline Enter inserts a newline; Escape first belongs to the IME. Single-line implicit submit, if supported, retains the physical key's original frame through its native submit/default action. Fresh AT submission still requires current frame and offer checks. Pending focus guards must recognize the explicit lease rather than blanket-exempt all text inputs.

## Atomic normalization, compilation and admission

A form cannot submit by changing an existing offered command's payload, passing an application-produced action to `session.admit`, or invoking `HostEffects.changePreference`. Canonical parameterized admission is a new explicit session capability:

1. Validate the fresh runtime/frame intent and exact current form offer. Snapshot its canonical identity, actor/audience, schema/policy/base/subjects, submit authority, draft revision and completed composition epoch. Read bounded engine-owned raw values, not a renderer-provided payload.
2. On frozen allowlisted context and copied bounded draft/model, invoke the registered pure normalization/validation policy once. Return a complete normalized semantic model, complete field visibility/enabled state and bounded issues. No asynchronous callback, transport, storage, DOM or client capability is available. Reject throw, Promise, invalid output or nonconvergence; there is no unbounded normalization loop.
3. Generic validation checks the complete result, including hidden/dependent values, field/option bounds and cross-field issues. Compile exactly once into an immutable candidate for the offered operation type. The compiler cannot choose arbitrary RoomAction variants, operation lanes, actors, expected scopes or URLs.
4. Recheck canonical document/offer identity, source authority/base/subjects, draft revision and composition epoch after policy/compile return. Reentrant change, close, actor switch or edited draft aborts with no operation allocated. Policy modules are trusted bounded code; JavaScript cannot preempt a nonterminating synchronous function, so module tests and worst-case evaluation measurements are required.
5. Atomically allocate the operation ID, freeze the exact normalized input/candidate and record ownership before invoking one narrow sink. Reuse existing room command correlation, deduplication and uncertainty handling; transport must not recompile or rebase the expected scope. Fixed host submissions use a separate bounded form-operation lane, without consuming room sequence numbers or pretending to have server receipts.

During ordinary draft changes, a pure policy can reduce an engine-owned cloned semantic model (Mighty's existing `setField` mutates its argument). It cannot write runtime state directly. A dependent change that would overwrite/hide/remove a composing field must wait for explicit local composition completion or cancel that lease; an authoritative actor/privacy revocation always wins immediately. Local errors and dirty summaries update independently of server submission.

## Protocol and effect decisions

### Report

The first host sink is a fixed `submit-report` operation with bounded canonical text; host code supplies endpoint and bounded browser diagnostics. Capture room/seat context at explicit submit, never read a later actor's seat when the request resolves. Track request ID, form instance, actor/audience and operation state separately from the current UI draft.

Outcomes are `processed` (current endpoint 204), `rejected-before-processing` where the endpoint's known response proves it (empty report/rate limit), or `uncertain` (lost response/abort/transport failure after dispatch may have reached the server). A generic 5xx is not proof of nonprocessing. Keep the draft and provide explicit user recovery; never auto-retry. Closing, unmounting or aborting clears local ownership/observation but does not prove nondelivery. Late outcomes cannot write into a reopened form or another actor's status.

Current 204 also covers filesystem failure/no configured report storage; UI and docs must not say “durably saved.” The attached snapshot is processing-time data, not a transactionally frozen copy of the state visible while the user typed. If durable acknowledgement, exact submit-time replay or safe retries become requirements, extend the server endpoint with an authenticated/idempotent operation contract rather than simulate those guarantees in the engine.

### Visitor bootstrap, named Join and rename

Retain the existing native credential bootstrap/reclaim inside RoomClient. Before a new scoped Join form is executable, wait for the current socket's VisitorWelcome and matching private room command window. `status === 'open'`, a saved name, public room discovery or an earlier connection's visitor identity is insufficient. Never use native token-reclaim Join as the form's direct Join path.

The entered name belongs only to the exact scoped Join payload; do not first send Observe or substitute remembered/generated names at submit. The target subject binds the selected seat and current occupant/reservation identity; changed targets invalidate old submission/confirmation. Persist a submitted name/seat credential only after authoritative welcome/known accepted outcome, with actor/connection correlation. A rejected/uncertain Join does not store the draft as a successfully adopted name. Existing RoomClient storage behavior needs an explicit safe scoped-path audit before implementation.

Rename must have an explicit authority decision. Preferred full-parity path: add a closed scoped rename RoomAction with known actor, exact room scope, server validation, normal outcome receipt and authoritative VisitorWelcome/name publication. The server can reuse name-normalization internals without exposing visitor credentials in action data. The existing native Observe bootstrap remains separate. If native Observe is retained temporarily for user rename, label and test it as an uncorrelated transaction; a send or optimistic localStorage write is never an accepted rename. That weaker path cannot close the scoped rename gate.

### Table settings and full rules

Table turn/shuffle controls and rules are form operations with exact scoped `set_table` / `set_settings` payloads, not local preferences. Server still enforces allowed turn values, seated authority, between-hand rule changes, valid game rules and fixed seat count.

Mighty policy must preserve all current RuleEditor behavior: pinned preset base, preset/custom-set switching, changed summaries, reset field/all, nullable numbers, all flag groups, first/last-round pairs, enabled card/value rows, conditional joker-call fields, dependent deck normalization, per-field plus global issues, and a separate optional local custom-set name/save effect. Cross-field validation includes bid-range/no-trump limits, deck/hand/card availability, joker-call cardinality and allowed cards, nonempty friend mechanisms and scoring bounds (`ruleFields.ts::problems`, plus server validation).

Engine stores the cloned inert rule model and draft; Mighty supplies a pure registered reducer/projection/compiler. No Mighty-specific planner nodes or application-owned mutable rule draft. Enumerate expanded fields/options/rows in worst-case fixtures and prove they fit declared budgets. Invalid base/preset/custom storage is rejected before editor allocation. Changing presets/base while dirty is explicit reset/rebase, never a silent replacement.

Local custom-set saving and server rules application have separate outcomes. Do not eagerly call `saveCustom` and close the form while treating a later rejected server update as applied. If product behavior intentionally saves a local set even when room application fails, expose those results separately. The form foundation must support this eventual distinction, even though report is the first slice.

## Implementation gates and evidence

1. **Report vertical slice:** canonical form/schema validation, runtime private draft and editing lease, planner pending allocations, stable native modal editor, fixed HTTP admission lane and fenced results. No direct Join/rename/rules feature claim yet. Add a pure form-policy fixture with numeric intermediate/finite fields to prove the core is not coupled to report text.
2. **Named scoped Join:** current-socket visitor bootstrap; explicit typed-name payload; exact room/seat subject; one submission; server stale/rejected/uncertain outcomes; no premature saved-name update.
3. **Scoped rename and table forms:** define/propagate rename protocol authority; then table settings and complete Mighty policy including dependent controls, base conflicts and separate local-save results. Do not retain an indefinitely partial “rules editor” that only changes presets.

Required tests before accepting the first slice:

- Raw bounds, Unicode/UTF-16 differences, unknown/disabled field rejection, numeric intermediate states and reset; owned immutable normalized output; policy throw/Promise/reentrancy; changed offer/base/draft during commit; exactly one sink call and no side effect on rejection.
- Caret, selection and undo across resize/benign document updates; stable DOM/native-dialog identity; viewport narrowing before async metrics complete; scroll/clip and modal focus ownership; no scene/underlay activation while editing remains leased.
- Compositionend/input/submit order permutations, Enter/Escape ownership, stale held pointer/Space/Enter and AT submit; dependency hides/removes a composing field; late events from retired/reopened instances; immediate private text removal on audience revocation.
- HTTP processed/rejected/uncertain outcomes, 204 without durable persistence, close/reopen same schema, actor replacement while request runs, no automatic resend after remount/reconnect and an explicit repeat-submit fence.
- Manual Korean IME on the actual supported browser/OS, including candidate selection during resize and modal focus changes. Synthetic composition events and direct-click AT proxies are narrower evidence and must be labelled accordingly.

Later gates additionally require pristine/dirty base conflicts, exactly one current-window Join, stale target/actor refusals, rejected Join leaving saved name unchanged, full expanded rules fixtures, dependent normalization and server rejection. All work remains opt-in until full parity and qualification requirements are met.

## Bounded Report candidate, October 18

The opt-in connected room now offers Report from its engine-owned menu. `forms.ts` owns exact inert schemas/draft/normalized-output/compiled-record validation; the canonical session binds a runtime draft source and atomically admits a separate host operation. `reportForms.ts` supplies the fixed Report policy and one-attempt HTTP sink. The planner and DOM surface own the native modal, editor and pending allocations. No legacy ReportSheet is mounted.

The implemented first schema is deliberately smaller than the proposed full rules contract: at most 16 flat text/multiline/numeric fields, primitive compiled records, bounded raw/model size, and no generalized repeated sections or nested Rules compiler yet. Those limits must be expanded coherently with the later full rule-policy milestone; the current Report slice does not qualify full RuleEditor parity.

Same-actor compatible publication/resize and new game generations preserve the editor lease. A generation change can clear old game DOM/artwork while retaining only the native form island. Removed/replaced/revoked editors are disabled, stripped of their binding, removed from composition tracking and have current/default values erased. The current connected host intentionally clears the Report draft when a socket-close path revokes its canonical private audience and publishes a different public shell. It does not promise offline draft continuity. Preserving text across that transition would require a separate durable authenticated actor/form authority; matching a remembered viewer tuple is insufficient.

Oversized raw input blocks submission and the source port until a valid edit recovers; an ignored oversized DOM edit cannot silently submit the previous valid text. HTTP status is explicitly processed/rejected/uncertain; no storage durability or exactly-once HTTP guarantee is added. Manual Korean IME remains unverified, and failed measurement/non-fitting fallback is an explicit editing interruption, rather than compatible-pending continuity.

Current source qualification: 1,359 unit tests across 82 files passed and type checking reported zero errors/warnings. Actual connected-room browser qualification is maintained separately in `web/e2e/foundation-report-live.spec.ts`; synthetic composition and direct native-click proxies do not establish OS IME or actual screen-reader behavior.

## Typed name-command candidate, October 18

Named Join and Rename now use a typed `FormTarget<A>` discriminant: fixed host forms retain their existing HTTP lane, while command forms declare an action ID and a typed immutable command template. A registered command policy materializes and validates the final action. The canonical session records that result in the **same ordinary command journal and transport** as exact game/room commands; it does not turn a report acknowledgement into a Room receipt or add empty-name placeholders to ordinary choices. Name compilation may change only the normalized name; expected room scope, action kind, seat, device and other template fields remain exact. Compiler output is checked for inert data before copying, and final policy validation must return literal `true` synchronously.

The native editor lease is now explicitly independent from the commit port's source instance. `renew(context, formId)` updates submission authority while preserving the editor, source identity, raw draft, composition and undo state. Renewal requires unchanged actor/revocation epoch, schema, base, edit binding, field descriptors and semantic binding. A changed expected Room scope rotates an internal authority revision. A previously queued compiled command retains the former revision and cancels before handoff; already dispatched commands remain owned by their original receipt. Incompatible schema/base/subject/removal changes permanently retire the old source, even if a later document restores the earlier values. Old frame input cannot acquire renewed authority.

The connected shell projects Rename into settings and named Join into eligible seat-management dialogs. Join uses the current authenticated visitor plus current private Room window; public discovery alone is insufficient. Connected Mighty/Poker no longer offer their former automatic remembered-name Join shortcut; legacy projections retain their separate compatibility behavior. Room actions remain geometry-free application semantics.

Preferred-name completion uses payload-free recovery metadata (`adopt-name`) on the original scoped operation. RoomClient derives the adopted name from current authoritative identity only after accepted completion and coherent Room authority; neither draft text nor serialized commands enter recovery storage. Reconnecting an existing visitor performs empty-name identity lookup rather than renaming with a stale preferred name, and native seat reclaim waits for the current socket's authoritative visitor name. These are separate from user-triggered scoped Rename.

At this checkpoint, 1,397 integrated unit tests passed with clean type checking; an additional compiler-accessor regression passed separately. Actual connected-room names/reload/recovery qualification is tracked in `web/e2e/foundation-names.spec.ts`. Single-line implicit Enter remains a separate input-qualification step; current forms provide explicit keyboard-accessible submit buttons. This does not close full table/rules-editor parity or manual Korean IME acceptance.

## Typed command forms and names candidate, 2026-10-18

The connected candidate now supports `FormTarget<A>`: a fixed host effect (Report) or a typed command template with action ID. `CommandFormPolicy<A>` normalizes the owned draft, compiles an immutable candidate and synchronously validates it with literal `true`. Inertness is checked before cloning so policy output getters cannot execute. Command forms use the existing `Submission<A>` journal, transport, scoped receipt, uncertainty and reconnect path. They do not turn an HTTP processed result into a room acknowledgement.

An open editor's native lease is distinct from its commit port's authority revision. `renew` accepts only a compatible canonical actor/edit binding/schema/base and replaces the exact captured command opportunity; it never changes an already compiled operation. Incompatible/removal transitions permanently retire the old port, even if the same descriptor later returns. Renewal cancels unsent candidates from the old authority; already dispatched operations remain receipt-owned. Original frame input cannot acquire the renewed authority while held.

Names use typed Join/Rename templates with exact Room command scope, target seat/participant/device and only the normalized name substituted. Existing raw Join shortcuts were removed from the connected candidate; the engine People/seat inspector opens the native name editor. Rename is under engine Settings. Initial values come from the current socket's authenticated visitor identity, and a matching private Room window gates admission. Same-actor unrelated room updates renew submission authority while preserving the native editor, selection and draft. A genuine authoritative base-name change is a conflict; the form's own accepted outcome takes precedence over its resulting base update.

Preferred-name persistence belongs to RoomClient after accepted, matching authoritative publication. The recovery journal may carry only a closed `adopt-name` intent tag alongside operation/scope metadata; it never stores the submitted name or action. Reload queries the original operation and adopts the current authoritative name after actor, room epoch, publication version and sequence match. Rejected/unavailable outcomes never adopt. Existing visitor bootstrap sends an empty name as identity lookup, and saved-seat reclaim waits for that socket's VisitorWelcome and a still-present saved credential. This avoids replaying stale local names over an accepted server rename.

Single-line Enter routes through the current planned submit control and original physical frame; it remains consumed until keyup. IME composition/key229 and the composition-end settling boundary retain native ownership and never queue automatic submission. Multiline Enter remains text input. Browser proxy tests exercise these paths, not actual OS IME or screen-reader qualification. Grouped/toggle/finite/compound rule forms and full Mighty rule parity are still open.
