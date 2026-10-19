# Card-game engine delivery report

## Current qualification — 2026-10-19

The engine repair/strict UI acceptance goal is active and incomplete. Technical qualification below records an earlier source/build; it does not approve the rejected UI or clear current visual, motion, original-design and654-case coverage gates. Use [QA_PROCESS.md](QA_PROCESS.md), [ENGINE_REPAIR_LOOP.md](ENGINE_REPAIR_LOOP.md) and the original-UI contract in [DESIGN.md](DESIGN.md#engine-migration-preserve-the-approved-ui). No deployment is authorized.

Current repair candidate: Source28 has3,547 passing and82 failing frontend tests, with zero new failure names against Source27, and a clean typecheck. Shared control measurement and assignment now budget a scrolling picker and separate visible footer, honor host minima, cover public finite caption groups and partition grouped budgets. The common scene now treats critical viewport capacity as admission rather than growing the decorated tray below the screen. Typed announcements use the same caption measurement/paint owner. All temporary terminal traces have been removed from source. Bounded checks and source reviews support these repairs; the rebuilt game still needs native replay, and full strict acceptance remains failed. Ordinary HUD collection timing, owned-endpoint animation, valid-detail essential progress, remaining geometry and all82 baseline failure cases stay open. See outside `engine-repair-loop-28` for failed first inventory, corrected second inventory, immutable copies and subsequent build/native receipts.

Previous diagnostic build: Source27 has3,536 passing and82 failing frontend tests with zero new failure names against Source26; typecheck is clean. It adds exact retained-recipe refusal tracing and bounded header-dimension/announcement typography repairs. Independent review still blocks those slices for positive overcommitted dock allocations and suit-bearing announcement paint that bypasses the measured caption recipe. These are open product findings, even where tests pass. The build is for native diagnosis only; all temporary traces must be removed before final qualification.

Previous diagnostic status: **strict acceptance failed; repair continues**. Source26 is a diagnostic repair candidate, not an accepted engine release. Its combined frontend inventory is 3,527 passes and87 failures; typecheck reports zero errors/warnings. Against Source25 there are11 newly named failures and7 removed names, including five renamed peer-feedback oracles that remain red for an original-typography mismatch. No failures are waived. Source26 includes pending-publication discard continuity, canonical responsive hand geometry, bounded control-cluster integration, public option-capacity and information-token contracts, original HUD typography, a bounded stable desktop scene envelope and a call-local producer lookup optimization. Grouped Exchange composition, valid long-detail essential progress, stock-to-own-hand motion and peer-feedback typography remain open.

Source25 native verification FAILED: the same13-card hand lost its selected discard during contract confirmation, ordinary trick HUD updates occurred early, and motion paths were refused. Source26 must recheck those exact connected transitions. Temporary aggregate console tracing is present solely to diagnose terminal collection admission and must be removed before final qualification. Bounded source review and passing geometry tests do not approve rendered UI, motion, accessibility or the654-case campaign. Frozen files, reviews, tests and local build identity are recorded outside the repository in `engine-repair-loop-26`; historical Source25 evidence remains unchanged.

The shared neutral decision core now owns composable finite/card decisions,
exact command partitioning, immutable drafts and canonical admission. The first
Mighty Exchange adapter stages authoritative contract changes alongside batch
discard; public caption domains reserve geometry without private offers. Ingress
owns decisions and modern offers before consumers, rejects accessor/scalar
forgeries, and prevents observers from executing game decision groups while
preserving root room operations. Poker and Hulla/One Card fixtures are bounded
API checks, not production coverage of every card game. Independent source
review and native qualification remain distinct gates.

Original Exchange desktop composition is still a generic vertical stack;
original control body gaps/minima, menu, responsive and persistent-feedback
findings remain open. Modern offer ownership currently clones twice; its cost
is unprofiled. No visual parity or performance improvement is claimed.

Historical Source23 native evidence contains one connected desktop hand at
1280×800/DPR2 through results and the next deal. It does not establish two
consecutive hands or responsive/device coverage. Early final HUD values,
post-End peer/outer-sidebar reflow, own fifth-card path refusals and two peer
winner sweep refusals remain open. Original source reconciliation confirms
that the inner scoreboard may naturally move when the32px turn row disappears;
that alone is not a defect. Stable peer/table/outer-rail geometry and scoreboard
ordering remain required. The campaign retains56 historical findings and654
required cases; no full acceptance or release is authorized.

Historical receipt, October18,2026: bounded local v1 technical delivery was
accepted with a delivery wrapper and checksum sidecar. That earlier independent
review is not approval of the current rendered UI or later repairs.

## Architecture and ownership

The engine is a **semantic card-table interpreter**, with pure measured composition and explicit session/runtime state machines. It is not an ECS world or a React component API. Games supply immutable authorized meaning and exact legal actions; the engine owns positions, spacing, complete footprints, responsive recipes, clipping, input and coordinated motion. DOM/Svelte renders shared design-system artwork and supplies native controls/text measurements. Logical HTML groups provide ownership and accessibility; they do not give application CSS another layout authority.

| Owner | Responsibility |
| --- | --- |
| Server actor/game/checkpoint | Rules, RNG, hidden state, scoped version admission, outcomes and durable publication |
| RoomClient/commandTransport | Coherent authorized native publications and payload-free uncertain-operation recovery |
| CardSession | Immutable authorized documents, exact command admission, revocation and local operation ownership |
| TableRuntime | Drafts, width-bound measurement/planning, committed frames, focus/input and motion |
| DomSurface | Atomic committed-frame rendering, native input forwarding and owned host resources |
| ConnectedRoom/game adapter | One shared mounted bridge; game-specific meaning/conversion through narrow single-use capabilities |

Clients synchronize authorized game facts and scoped command outcomes. Each client independently computes geometry for its viewport and text settings. Pixels/animation progress are not synchronized. Expected room/session/hand/version fences, operation IDs, duplicate receipts, authenticated reconciliation and commit-before-publication protect authoritative transitions. Animation does not submit game actions; reload does not recreate an uncertain action. Memory-only rooms have a weaker durability guarantee than synchronized checkpoints.

## Historical implementation scope — not current acceptance

The following records earlier implementation claims; current visual/motion qualification above takes precedence. Ordinary Mighty/Poker room routes mount the shared engine; explicit `foundation=0` keeps the original root for comparison. Mighty includes the original artwork/design primitives, five-seat player/observer composition, header/status/scores, exact native decisions/forms/disclosures, initial50-card deal, kitty pickup, three stock returns, neutral redeal, final-five collection, scoring and subsequent hands. Phone/tablet/desktop and enlarged-text checks preserve complete identities and a visible hand. The actual1280×720 clipped-peer/oversized-identity defect is corrected and rechecked locally.

Poker is a real three-seat raise→settlement→reload→next-hand slice with private replacement/reclaim coverage. Hulla/rummy and One Card are executable bounded pressure variants that challenge the shared API; they are not production multiplayer implementations or certification of every card game. The engine source includes the named connected host bridges and fixtures; it is not yet a separately published package.

## Accepted technical evidence

The immutable tested candidate is **v12**, captured before this report was finalized. Its836 source files, build, backend, configuration, tests and raw receipts remain unchanged. Frozen candidate docs describe their capture-time active state. This current report is authoritative for delivery status; the wrapper binds it and an explicit documentation-only delta separately. No technical receipt is relabelled or assembled from passing files across failed runs.

| Gate | Result |
| --- | --- |
| Frontend units | 2,575 passed across193 files |
| Types/build | 0 errors/warnings; production build `domSurface-CfB4MIzE.js` / `game-DR4bcNiQ.js` |
| Backend | Immutable1e50875fcfbb,257 server +17 Poker tests, strict Clippy/build/generated matching; macOS development-profile binary |
| Full functional browser inventory | All45 files:206 passes,0 failures,56 deliberate profile skips,0 unrun |
| Three quiet numeric resize p95 | 7.705 /7.754 /7.867ms against fixed8ms |
| Three quiet semantic p95 | 3.432 /3.340 /3.585ms against fixed8ms |
| Timing/resources | Worst measured sample13.223ms; worst final-metric→commit2.1ms;0 qualifying measured long tasks;0 final measurement probes/animations/kernel allocations |
| Cold/full domain | Cold300 and all six1,276-action Mighty stress cases pass; exact255-count/No-Trump dispatch and unchanged cache request counts |
| Receipt verifier | Passed;117 sealed evidence files, unique inventories, per-log totals and raw timing budgets recomputed |

The performance environment is Darwin27.2.0/arm64, Apple M4 Pro, Chromium153.0.8010.12. Numeric composition is selected; Yoga WASM/native are comparison adapters. The fixed workload uses four game fixtures, six viewport sizes, warmups and separate resize/semantic families. The8ms gate is p95, not a promise that every sample takes8ms or less.

The final optimization reads actual inline geometry values and writes only differences, including repairing same-value `!important` cases. Frame stamps, input authority, masks, native state and motion remain current. Listener setup rolls back partial failure; stale resize/font callbacks are fenced before/after sampling. Rejected persistent-probe/font/metric/metadata experiments are excluded. The engine retains no environment probes between samples. Full measured batches still use bounded cancellable scheduling and the unchanged500ms candidate deadline.

## Local review and recovery

The accepted backend/assets are running at [the five-player Mighty table](http://127.0.0.1:4534/r/vqhj4q). Native1280×720 review confirms22 peer leaves fully visible through ancestor clipping, four48px peer figures, a72px local figure, ten visible hand cards and enabled44px controls. The page reports no console errors. The temporary viewport override was reset and the tab retained.

All264 static responses match the accepted build byte-for-byte. The server intentionally renders route-specific SEO metadata in HTML; module/stylesheet references match. Saved data remains `/tmp/card-game-foundation-local-review-20261017`. The pre-refresh binary/assets and final stopped data were backed up at `/tmp/card-game-local-before-accepted-20261018T075933Z`. Existing unrelated dirty/untracked work was preserved.

## Reproduction and artifact boundary

The final delivery wrapper contains `candidate/` (unaltered v12 source/build/backend/receipts), this completed report/current docs, the documentation-only delta, local refresh/native JSON and screenshots, final independent verdict and file hashes. `candidate/verify-qualification.py` verifies technical receipts using Python's standard library without installing project dependencies. Node modules and build targets are excluded; dependency locks and build/test configuration are included. Original receipt paths/timestamps are preserved as recorded provenance.

To rerun, install the locked frontend dependencies and Playwright browser, build the frontend, and use the bundled server or build `server` from the saved Cargo workspace. From `candidate/web`, set `SERVER_BIN` to the immutable binary and `FOUNDATION_OUTPUT` to a new directory before running `node scripts/qualify-foundation.mjs`. Run the saved quiet-performance script in a fresh copied candidate with exclusive test/build CPU; it refuses to overwrite existing evidence. These commands reproduce the method, not identical future timings or bit-for-bit builds on arbitrary platforms. The bundled development binary targets this macOS host; a production/Linux release build is a separate action.

## Explicit coverage limits

Recorded Chromium emulation/native desktop evidence does not certify physical phones/tablets, direct assistive technology, OS IME, audible/haptic hardware, GPU/energy behavior or universal font/platform equivalence. Large-text layouts may intentionally scroll a declared region while keeping the hand reachable. First-probe stress windows exclude earlier bootstrap work, and first native audio initialization was outside the accepted timing workload; no whole-page stall-free or audible-hardware claim is made.

Bounded owner cleanup and server resource admission do not bound total allocator/process/TLS/kernel memory or establish starvation-free global scheduling. Exact server receipts retain32 operations per actor with permanent high-water fences; finite actor/recovery/counter limits remain explicit in the wire contract. These are supported boundaries, not claims of arbitrary-game or arbitrary-resource certification.


## Final acceptance record

Fresh independent read-only review returned **SHIP**: no concrete source, ownership, evidence or native-review blocker remains. Its raw report is retained in `independent-review.json`. The completed report/status update and explicit documentation-only delta are separate from the immutable technical candidate; final file inventory and archive verification close delivery without changing executable code or rerunning qualified tests.

[Delivery folder](/Users/jaeyong/Documents/Codex/2026-10-18/card-game-engine-completion) contains the current report, `candidate/verify-qualification.py`, `verify-delivery.py`, `delivery-manifest.json`, all file hashes and actual local screenshots. The adjacent archive and SHA256 sidecar preserve the same payload. Source/build identity and raw failed historical receipts remain explicit.
