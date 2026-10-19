# Confirmed local operations from owned disclosure selections

## Mighty UI scope — 2026-10-19

The original device-record interface remains on Home/StatsSheet. The migrated room device catalog/deletion surface was unapproved and has been removed from connected composition. Standalone read/form safety utilities and their compatibility tests are not evidence that this room UI is authorized. Preserve device storage and the original Home clear-record flow.

Status: proposal for independent API challenge, not implemented. The readonly viewer and counted pickup have separate browser receipts. The existing device viewer has no deletion action.

## Invariants

- `DisclosureDocument` remains readonly data, with no operation callbacks or authority tokens.
- The core owns selection provenance, current form offers, confirmation, admission and operation status. The mounted host privately owns storage captures and fixed sinks.
- Mutation requires the fixed **new-read** native guard (`readable`, exact current native source and audience), not the more permissive retained-display guard. A fresh authenticated public checkpoint may authorize a local operation while Game command `connected` is false. Detached or stale display never does.
- Storage projection performs no IO. Selection performs the explicit read/capture. Confirmation commits that exact private basis, never a newer reread. Achievements and the bounded completion ledger survive clearing hand summaries.
- Metadata-only publication of confirmation offers cannot retire a successful selection. Actual audience/connection/read-source loss retires mutation authority; already authorized readonly display follows its existing retention rules.

## Proposed core data

```ts
interface DisclosureSelectionReceipt {
  readonly id: string; // bounded engine-minted ID
  readonly catalogId: string;
  readonly revision: string;
  readonly entryId: string;
  readonly scope: DisclosureScope;
}
interface DisclosureFormAction {
  readonly id: string;
  readonly label: string;
  readonly intent: 'primary' | 'secondary' | 'quiet' | 'danger';
  readonly selectionId: string;
  readonly catalogId: string;
  readonly catalogRevision: string;
  readonly entryId: string;
  readonly formId: string;
  readonly formInstanceId: string;
}
// TableDocument.disclosureFormActions?: readonly DisclosureFormAction[]
// DisclosureReaderSnapshot.selection?: DisclosureSelectionReceipt
// SessionOptions.disclosureSelectionChanged?:
//   (selection: DisclosureSelectionReceipt | null) => void
```

Bound the registry to at most 32 links and four per selection. Validate exact current catalog/form references, registered host-only targets, matching receipt at visibility and admission, unique IDs, and existing inert-data byte bounds. The reader emits metadata only after a successful selected snapshot commit; retirement emits null. A host callback queues publication rather than synchronously changing the source during read admission, and rechecks the receipt/native source before publication.

Device policy uses a fresh entry ID per page/open attempt and caches one private capture per entry. Reselecting that entry returns its same captured snapshot; reopening or explicit refresh makes a new entry/capture. A rejected/reentrant read therefore cannot overwrite the capture belonging to an older displayed entry. No capture or raw storage value enters the canonical record.

```ts
// FormOffer additions
readonly purpose?: 'editing' | 'confirmation';
readonly access?: {
  readonly kind: 'disclosure-selection';
  readonly selectionId: string;
};
// HostFormPolicy.access?: 'connected' | 'disclosure-selection'
```

Default remains editing/connected. Only an explicit confirmation purpose permits zero fields. Only registered host policies declaring selection access can use it; all its targets must be host operations. There is no artificial checkbox and no Game/Room action. The existing form journal records the operation before dispatch, blocks repeats, and keeps failed/conflict/uncertain outcomes distinct.

Admission rechecks exact receipt, live catalog revision, exact form/link, canonical frame/context and fixed native new-read guard before/after materialization and immediately before transport. A payload is only an opaque capture ID. The target's private authority is resolved by the fixed host, not decoded as an application callback.

## Host handoff

```ts
interface ConnectedDisclosureOwner<G> {
  // existing policies/project/revoke/dispose
  selectionChanged?(selection: DisclosureSelectionReceipt | null): void;
  resolveFormAuthority?(selectionId: string, token: string): unknown | null;
}
// ConnectedDisclosureProjection additions
readonly forms?: readonly FormOffer<never>[]; // host targets only
readonly formActions?: readonly DisclosureFormAction[];
// Existing fixed-operation context adds isCurrent(): boolean beside resolve(token).
```

Static Mighty form policy and operation sink remain separately registered. The shared host resolves a capture only after checking current form source/operation/selection/native ownership. The private capture/commit closure never goes through `copyFormData`, payload serialization, signatures, views or inspect output. The sink passes the narrow native predicate to the privately captured store commit.

The store owner supplies `captureDeviceStatsDeletion`: validated records plus a commit closure over the exact private canonical/legacy raw basis. Commit compares that basis and checks the predicate after reads immediately before `setItem`. A write or verification that may have happened cannot be reported as definite non-delivery. No cross-tab CAS or unbounded deduplication claim is made.

## Modal and result lifecycle

Opening confirmation replaces the viewer DOM but retains its owned reader selection. One native dialog is active. Cancel restores the frozen selection. Actual authority loss retires the form and its capture rather than inheriting a new actor/source.

After confirmed `stored`, the owner advances a dedicated device catalog revision. Proposed bounded result directive:

```ts
refreshDisclosure?: {
  readonly selectionId: string;
  readonly catalogId: string;
  readonly revision: string;
}
```

Only a stored, access-bound, still-owned operation may request refresh. Runtime waits for that exact newly offered revision, closes confirmation and performs an ordinary fresh page/select. This is a read refresh, never a write retry. A missing/newly stale revision remains a truthful stored result rather than rebasing. Other outcomes remain visible; retry requires a new read/capture and confirmation.

## Required proof

Exact receipt/link/form validation; metadata-only offer publication; canceled confirmation preserving selection; double activation; source/actor/audience loss before and during callbacks; connected-false fresh checkpoint versus detached display; storage changes before confirmation; quota/read denial; postwrite interference and uncertain readback; successful empty summaries with unchanged awards/ledger; no current completed-hand resurrection after reload; no Game/Room commands during read/delete; real native modal/focus and phone bounds.

## Source ownership

Core agent: contracts, disclosures/reader/session, forms/runtime/planner/DOM, pure device presentation and directed tests.
Root: private capture store/owner, ConnectedRoom/connected adapter bridge, fixed Mighty sink, actual integrated browser proof.

## Implemented source checkpoint (2026-10-18)

Confirmation offers declare `retry: 'new-offer'`. The session marks attempted only immediately before handing off to the fixed host sink; every later source/reset for the same canonical offer/action remains blocked. A current-offer attempted record cannot be evicted to erase that fence. The host separately consumes its private capture before any attempted IO. Failed, conflict and uncertain states require a new explicit read/capture and confirmation.

The reader mints inert owned selection receipts; metadata-only form publications preserve them, while revision/audience/native-source loss or detachment retires mutation authority independently of readonly display. A fixed strict NEW-READ native guard is required even when a retained record remains visible. Fresh authenticated public checkpoint access may operate with Game commands disconnected. Cancel/Escape/back returns the frozen selected record; it does not perform a fresh read. Returning to a catalog acquires a fresh metadata page before relinquishing its selected record.

The stored outcome is recorded even if an optional read-refresh directive is malformed or stale. Only its unsafe continuation is discarded. Runtime waits for an exact future device catalog revision before making an ordinary new read; no write is retried.

Source qualification at this checkpoint: clean frontend check and 2024 unit tests / 147 files pass. Actual native/storage qualification is recorded below; these receipts close the bounded device-deletion slice, not whole-engine completion.

## Frozen actual-browser receipts (2026-10-18)

The short real-room case passes in Chromium 390×844/light, mobile emulation and DPR2. It cancels confirmation without changing storage, forces one quota-failed write attempt, verifies the disabled action cannot resend via direct native click, then closes/reopens the singleton device view to capture a fresh basis and delete successfully. The resulting record contains the exact original completion ledger and a nonempty `first-win` achievement, with only hand summaries emptied. It observes zero Game/Room mutations and no page errors. Its archive is `/tmp/foundation-device-delete-20261018/short-pass/`. The first short attempt failed only because the test expected the bare error text instead of the actual labelled action status; the selector was corrected without a product change. That failure context remains in `first-attempt/`.

The separate full actual two-hand lifecycle passes in 1.8 minutes at the same phone profile. It includes the established storage failure/recovery/reset/read-view checks, then reloads with native Game State withheld. At the fresh authenticated public checkpoint (`connected:false` for Game command admission), deletion Cancel preserves the selected view/store; two direct activations produce one deletion; the exact completion ledger and achievement map are preserved. The future device-only catalog revision triggers an ordinary fresh read of empty summaries. Another held-State reload and subsequent State release do not resurrect summaries or issue extra Game/Room commands. First/recovered earned-title arrays were empty in this run: nonempty award preservation is established by the short seeded case, not inferred from this full run.

Full-flow archive: `/tmp/foundation-device-delete-20261018/full-pass/`, including exact frontend/e2e/assets, results, log, manifest and compressed tested backend. Frontend assets are `domSurface-BEIU9lbi.js` / `game-CoGOP34b.js`; tested backend SHA256 is `99479b9dde295f000c5317a300fe915cc3dbe1c36e0ab6c926586eeb680b1197`. This qualifies that frozen source/binary combination. Later numeric-protocol/resource changes require their own integrated run.

## Remaining engine acceptance beyond this feature

1. **Connected text sizing and matched visual parity.** `setTextScale` currently has callers only in FoundationPreview; connected 2× engine text has no equivalent user path. Implement one semantic host preference/environment bridge, then inspect all primary controls, forms, readonly tabs/matrix and settled/active motion at actual common phone/tablet sizes. Root-CSS font enlargement is not a substitute. Compare original and candidate in matching states; the shared planner still emits the English empty-hand `No cards` label, and vacancy/empty-hand wording and default composition need a deliberate semantic audit. Preserve readable self/opponent art and44px targets.
2. **Direct accessibility and native input.** Existing direct `HTMLElement.click()`/synthetic composition/keyboard tests are proxies. Real screen-reader activation, OS Korean IME, native select operation and browser zoom/text-size behavior still need direct evidence. Keep stale held-pointer/Space/Enter, modal underlay and source-revocation fences intact. Native Tab entering browser chrome is documented browser behavior, not proof of a custom focus trap.
3. **Current full regression and resource lifecycle.** Refresh the combined actual Mighty/Poker/recovery/motion/forms/settings/room operations/assistance/history/native-dialog suite after the newest protocol/resource sources settle. Repeat owner/modal/editor/read-selection mount/resize/revoke cycles and heap/listener/timer/animation/audio accounting with the newly integrated captures and confirmation flow. The short deletion test does not substitute for this whole-engine gate.
4. **Frozen performance.** Re-run the unchanged declared comparison and cold finite-domain workloads on the final feature set with exact hardware/browser/source/binary hashes, then inspect real phone/tablet initial preparation, active/settled transitions and retained readonly editing. Earlier numeric8ms receipts and long-task results qualify their own older workload/source; current all-feature frame cost, physical-mobile behavior, audible startup and hardware haptic delivery are not inferred.
5. **Final API/ownership and cutover review.** Independently inspect the final exported semantic contracts, registered policy/host-effect boundaries, ordinary command versus local IO outcomes, readonly retention versus new-read authority, cross-game pressure use, bounded working sets and legacy-owner retirement. Review real misdeal public-hand4s disclosure and cue interruption, not only projector/coordinator tests. Produce one current completion report and locally reviewable build. Default-root switch remains a separate unperformed acceptance step; deployment/publication is not authorized by these receipts.
