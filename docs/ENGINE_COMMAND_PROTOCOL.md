# Scoped command and receipt protocol

Implementation contract for the multiplayer gate in [ENGINE_COMPLETION.md](ENGINE_COMPLETION.md). This is an additive wire change; the old `act` endpoint remains temporarily for the old root and cannot claim these guarantees.

## Implementation status

Server admission, bounded receipts, private queries, restoration and generated wire types are implemented. Persistent room turns checkpoint before publishing receipts, snapshots, queued messages or statistics. Their receipts declare `persisted`; rooms without storage declare `memory`. Bots, off-turn planning and turn clocks start after successful publication. Background hints return through the room actor and recheck version, connection seat and actor identity before delivery.

A failed checkpoint holds the same candidate and outbox. Play and new connections are refused, outcome queries report `persistence_failed`, and reports/previews cannot expose the candidate. Disconnect cleanup still clears readiness and reconciles admissions; its changes join the retried checkpoint. A successful retry publishes once. Shutdown reports a failed flush rather than counting it saved; it retains the last checkpoint. Room-file removal also synchronizes its parent directory and reports failure.

The connected foundation Mighty root now sends game moves through scoped `submit`, with no fallback to legacy `act`. Its session resolves explicit server receipts. Socket callbacks and command windows are fenced to the current connection, and a new private state is required after reconnect. The old root still uses legacy `act`. Foundation join, bot, readiness and start controls now use scoped room submissions through the same actor ledger. The closed room-action protocol also supports the remaining lifecycle/settings/seating operations. The old root and credential authentication/reclaim requests remain native; default-root cutover remains open.

## Identity and authority

The server advertises domain-scoped private command windows containing room ID, persisted random room epoch, lifecycle session ID, hand number, domain version, optional seat, actor ID and the actor's next command sequence. The Game domain version is the monotonic hand counter. The Room domain version is the monotonic room publication counter. An authenticated observer can use a Room window with no seat to join; a Game window requires an active authorized seat. Equal numeric versions from different domains are never interchangeable. Actor identity comes from the authenticated connection/seat credential, never from a claimed request field. Public actor IDs are not credentials.

A submission carries that expected scope, sequence, operation ID and exact action. The identity of an operation is the room epoch plus authenticated actor plus sequence. Its wire operation ID must be `<sequence>:<nonce>` with a canonical decimal prefix matching the sequence. The same operation ID therefore cannot be renumbered after pruning; the request digest detects conflicting reuse at the original sequence. JavaScript-facing versions and sequences must remain safe integers. Server rules remain authoritative.

## Admission order

1. Validate bounded IDs, numeric fields and authenticated actor identity.
2. Look up the actor's sequence. An exact duplicate returns its saved outcome even if the game has advanced. Conflicting reuse returns a conflict without executing. A pruned old sequence returns unavailable and never executes. A sequence above the next advertised value is a gap and never executes.
3. For the next sequence, compare every scope field to the current server window. A stale scope is a recorded rejection, not an opportunity to reinterpret the action against a newer state.
4. Apply the action through existing rule/turn/grace validation. Record either acceptance or the bounded rule rejection and advance the actor's sequence exactly once.
5. Settle the room, then checkpoint game state and operation records in one atomic snapshot. In persistent rooms, send the outcome only after a successful flush. Persistence failure produces an unavailable result; it must not acknowledge persisted success. Memory-only rooms identify their weaker durability explicitly.

`submit_room` carries a closed `RoomAction`, rather than nesting arbitrary client messages. Room operations reuse existing business validations, but capture the authenticated actor before dispatch so joining/leaving/seating changes cannot change receipt ownership. The central actor increments the room counter once for every changed/saved turn, before checkpoint serialization and publication. Rejections that consume a ledger sequence also cause a committed publication; exact duplicates and receipt reads do not manufacture a state change. Receipt queries no longer clear away status.

Room and State packets carry the committed room version. Private Room command windows follow the per-viewer State packet. Session packets carry the version at which their scores/history changed; unchanged Session contents remain valid at later room versions. The shared browser connection owns publication readiness: Room/State (when showing)/Room-window markers must agree, and a Session marker cannot be ahead of the Room packet. A new socket must supply fresh private state. Game adapters hold their old canonical frame while the next coherent publication is incomplete.

The server processes room commands sequentially. Two tabs racing for one actor's next sequence cannot both execute; the loser receives a conflict and must consume a fresh window for a new explicit user intent.

## Recovery and bounded retention

Keep a monotonic high-water mark and the most recent 32 exact receipts per actor, with at most 1024 actor ledgers per room. Pruning a receipt never removes its high-water fence. Older outcomes can become unavailable; this never authorizes a resend under a new operation identity. A status query is read-only, authorized by the current connection identity and discloses only that actor's matching operation outcome. Reconnect/seat loss may query outcomes but may not submit while unseated.

Room epoch, both domain counters, high-water marks and receipts persist with the game log. Rematch preserves the monotonic hand counter, so historical accepted receipts remain restorable across session changes. Start prepares the prospective shuffle/options with a cloned RNG and constructs the game before committing seats, shuffle flags, score projections or auto-readiness; a constructor rejection leaves business state unchanged. Old scopes default to Game with numeric seats read as present seats. Digest scheme metadata preserves the original serialized field ordering for old receipts; newly stored digests include the domain. Older snapshots without this metadata receive a fresh epoch. Administrative reports omit the operation ledger. Failed or missing storage cannot be described as durable acceptance. Atomic writes synchronize the file and parent directory and report failures to flush waiters.

## Cancellation without action retention

`cancel_operation` carries the original operation ID, sequence and expected scope, with no action. It authenticates the same actor and current room epoch. A cached matching operation returns its original outcome. If the sequence has not been consumed, cancellation durably records an explicit `cancelled` tombstone whose digest is absent. Every later submission of that operation returns cancelled and cannot execute. Conflicting IDs, gaps and capacity refusals do not consume a sequence; pruned outcomes stay unavailable. Authenticated unseated actors may recover/cancel their own operations without obtaining gameplay authority. Cancellation preflight refusals with `scope: null` do not establish the original action's outcome.

The first serialized submit/cancel wins. Cancellation is never a fabricated action or a resend with a new identity. Existing snapshot digest strings deserialize as present digests; cancelled entries require no digest, and malformed combinations fail validation.

## Client responsibilities

The session owns operation identity and state; the transport maps an admitted operation to one advertised sequence/window and retains that mapping across reconnect. A sent operation is uncertain until an explicit server receipt resolves it. Reconnect queries existing operations; it does not automatically create replacement actions. A stale/foreign audience cannot inspect or retry another actor's operation. Private submission payloads are cleared after synchronous transport handoff, including uncertain throws and pre-handoff revocation. The current authorized document may retain its own legal actions until revoked; the recovery journal does not. Before sending, a per-tab `sessionStorage` journal saves only room/epoch/actor/scope/sequence/operation ID. It survives reload, but does not promise recovery after browser-session storage is discarded. A storage failure or corrupt/over-cap journal blocks new scoped admission.

One unresolved operation per actor blocks further game admission. A 1.5-second recovery timer starts immediately after send, including a silent connection, and stops on resolution/disposal/disconnect. Recovery queries the original ID. An unknown outcome is resolved by cancelling that original identity; it never retransmits the action. Explicit pruned outcomes are recorded locally as `unavailable`, because a permanent sequence fence does not disclose historical acceptance. An accepted or recorded rejected receipt installs a short-lived sequence floor until a fresh window surpasses it. A known-not-sent rejection installs no floor. Epoch replacement can fence old uncertainty without inventing its outcome.

The 128-entry engine UI journal reclaims older terminal entries while preserving unresolved evidence and the current offer's accepted/unavailable fence. It is distinct from the server's authoritative deduplication ledger. Actor changes hide former tracking and queries are limited to the authenticated current actor.

## Required evidence

The browser transport's `RecoverySnapshot.pending` counts all unresolved owned requests and continues to fence admission. `recovering` counts only requests requiring reconciliation: restored records, queries, cancellations, or requests whose fresh submission window has elapsed. An ordinary fresh local submission is pending without being a recovered request. The silence timer notifies subscribers when it enters recovery; this does not resend the action or change receipt authority. The shared room shell uses `recovering` for its recovery notice, while legacy metadata without that field conservatively falls back to `pending`. Storage errors and capacity warnings remain independent.

- Fresh acceptance, stale version/session/hand/seat/epoch rejection and no mutation on rejection.
- Exact duplicate, conflicting payload/ID, concurrent same-sequence requests, gap and pruned-receipt behavior.
- No cross-actor receipt disclosure, including an unseated observer using another player's IDs.
- Snapshot restore preserves accepted/rejected deduplication and version; old snapshots rotate epoch.
- Checkpoint write/rename/flush failure cannot acknowledge durable success.
- Generated codecs, real WebSocket clients, dropped acknowledgement, reconnect and fresh-load recovery.
- Old clients remain functional during the additive transition; the new engine never silently downgrades to legacy action admission.

## Verification boundary

Deterministic filesystem-failure tests obstruct the temporary-file path while retaining the previous checkpoint. They verify withheld acceptance/state/statistics, refused follow-up play, unavailable queries/previews, readiness cleanup, retry without replay, a full newly visible turn clock and honest failed shutdown. Real WebSocket coverage submits a move without reading its receipt, observes another client's committed publication, restarts the server, recovers the persisted outcome and retries the identical envelope without another move.

The implementation uses file and directory `sync_all`; these tests do not simulate hardware power loss or assert storage-device guarantees. Browser-level receipt/reload recovery now passes against the real local server: an unread acknowledgement is recovered after reload with one original Submit and no legacy Act; an intentionally swallowed Submit is queried/cancelled, and its later identical delivery remains cancelled without changing game version. The bot-table lifecycle reaches scoring and another hand through reload/reconnect. Separate motion checks cover own play, anonymous opponent reveal, public trick collection and the following hand's back-only deal.

Current server/unit receipt: 149 server tests and 1,087 web unit tests pass, with zero web type-check errors/warnings and a successful production build. Seven distinct real browser scenarios pass in the final lifecycle/recovery/motion run (seven duplicates are intentionally skipped across the two configured projects). Independent source review found and prompted fixes for the initial silent-send timer, payload redaction, sequence-floor lifecycle and known-not-sent recovery. Correlated lobby recovery tests also pass: an unread join outcome survives the observer-to-player transition and reload, and a cancelled never-arrived bot addition cannot execute when delivered later. The final next-hand motion rerun passes after discovering that conditional recovery messages resized the table host; room chrome now reserves a stable notice allocation. The test verifies fifty back-only flight elements and a constant host-height trace while keeping resize cancellation strict. Canonical view/admission flags can be received atomically in one session publication.

Whole-engine resource/performance qualification and final cross-game/Mighty parity gates remain open.

## Scoped name changes (2026-10-18)

`RoomAction::Rename { name }` is admitted only inside `submit_room` with the exact current Room command scope, caller actor and operation/sequence identity. There is no unscoped `ClientMsg::Rename` and no conversion to the `Observe` credential bootstrap. An existing authenticated observer or player may rename their own identity; the server trims and truncates to 24 Unicode scalar values and rejects an empty result.

The mutation preserves participant IDs, visitor/seat credentials, seat assignment, readiness, game version and scores. Current roster/standings labels update; frozen hand participants and archived hand names remain historical. Matching credential peers receive private VisitorWelcome, followed by ordinary correlated receipt/coherent room publication. A client must use the accepted receipt and publication window, rather than treating VisitorWelcome alone as the command result. Duplicate operations replay the original receipt even after a later rename and after checkpoint restoration.

Source verification: eleven focused actor tests include five rename scenarios, one actual WebSocket integration test exercises wire decoding, shared-identity private/public publication, stale and duplicate handling, and raw unscoped rejection. Generated protocol freshness and strict server Clippy pass. The full server suite passes 158 tests. Native form integration for rename is a subsequent gate; defining the server action does not yet restore that UI.

### Payload-free name completion recovery

The browser recovery record can carry the closed local `completion: "adopt-name"` tag for explicit scoped Join/Rename form submissions. It is not sent on the wire and contains no requested name/action. A known accepted receipt plus a coherent later authoritative actor/Room publication permits adopting the current server name as a local preference. Other outcomes, actor replacement or a new room epoch do not. The same path handles live and recovered receipts, and never retransmits a rename. Existing visitor reconnect authenticates with an empty Observe name, then reclaims a still-owned seat after the current VisitorWelcome; stale local preferred/seat names cannot overwrite the server's accepted name.

Command transport rechecks actor, connection, exact window and sequence after subscriber notification immediately before handing off a payload. If ownership changes or disposal occurs before handoff, it removes only that definitely-unsent recovery record without consuming a sequence floor; genuine earlier uncertainty remains recoverable.

## Coherent public settled restore, 2026-10-18

A finished public `current_hand` can be rendered before this socket's audience-specific State arrives, but it grants no game or Room command admission. `RoomClient.roomPublicationReady` is a separate, conservative gate: authenticated current actor/seat Room window; Session received on this connection; matching session ID; and exact Session/Room/window publication revision. Ordinary `publicationReady` and command recovery remain independent and retain the current State requirement. Mixed revisions and a retained pre-reconnect Session cannot satisfy the public fallback. The shared host forces game=null, suppresses advice/feedback/private State caches and passes connected:false to the canonical session until normal readiness returns.

The actual held-State browser test exposed a producer defect: Room/window revision85 versus Session82 after authentication. `greet` had serialized Session before the committed presence/authentication version, and ordinary Session suppression correctly avoided resending unchanged history. The server now queues a connection-local `PublicSessionCheckpoint` effect for greet and VisitorWelcome/reclaim. It stores only the recipient, deduplicates within the turn, and materializes the existing spectator-only Session producer after persistence succeeds and the final room version is known. Dropped recipients are ignored; normal gameplay retains revision-based Session suppression rather than resending archives each turn.

All162 server tests and strict all-target Clippy pass, including checkpoint/reclaim, failed-write hold with a disconnect version change, deduplication and recipient-isolation regressions. Independent source review found no remaining blocker. The corrected real-game held-State reload passes: a public result appears, continuation stays disabled, no game/Room mutations are sent, and releasing State resumes normal admission without historical transfer replay. The last-card Enter remains held through result publication and does not activate the new continuation. The full outcome candidate still has a separate next-deal `path-obstructed` motion failure, so this public-checkpoint receipt is not whole-engine qualification.

## Atomic same-seat command batches

`submit_batch` carries the same operation ID, sequence and expected Game scope as `submit`, plus 1–32 native game actions. The generated `MAX_COMMAND_BATCH` constant owns the client/server bound. The batch is one operation and one committed transaction revision; its individual actions remain ordinary replay-log entries. Game rules and action enums are unchanged.

The server decodes the complete bounded list, then checks turn ownership, grace and native rule legality at each step on a staged hand. A batch cannot continue across another player's turn or an intervening chance step. Any failure discards the staged hand/log and RNG. Only the final candidate enters the existing resource reservation, advance, checkpoint and publication path. No intermediate private or public state is emitted. Chance/finish handling after the final action follows the normal transaction path.

Batch payload identity uses a distinct three-member digest input and checkpoint digest version 2. Existing single-command digest versions 0/1 remain readable; a batch cannot be reinterpreted as one game action, even when a game's action type is an array. Repeated requests return the original receipt. Cancellation, authenticated actor/sequence fencing, storage refusals and persisted acknowledgement use the same journal machinery as other commands. Browser recovery stores metadata only and queries/cancels an uncertain operation; it never replays an action list automatically.

The engine compiles count-constrained card decisions from original enabled offer bindings and submits their canonical order through `batchTransport`. Individual bindings cannot bypass the decision's cardinality through ordinary admission. The connected host translates one captured set and calls native `submitBatch` once, after rechecking the document and command window. The game adapter does not own the selection draft or perform a send loop.
