# Table UX review and implementation contract

Status: continuous-table behavior is implemented in local source (2026-10-07).
Server contract tests pass. The new browser composition and full live play path
are still a separate verification gate; this document does not claim they have
been approved in live play or deployed.

Four independent reviewers examined the room lifecycle, visual hierarchy,
comparable products, and enforceable UI rules. The recommendation is a compact,
continuous social table. Preserve the existing characters and paper cards;
simplify participation and the transition to the next hand.

## Problems observed before this pass

1. **Participation is an unfinished promise.** `RequestSeat` stores a boolean.
   It does not reserve a bot, consume a queue, or expose an acceptance/handoff
   action to a seated player. The observer must separately open the people
   sheet and find a join action. A full human table has no request-resolution
   flow.
2. **Session ceremony interrupts continuation.** Ending a session, reviewing
   final standings, and confirming a new session are table-wide actions.
   They do not solve the observer's next-hand admission. A casual hand should
   naturally lead to another hand.
3. **Scores compete in three places.** Character totals, the side scoreboard,
   and a second standings panel repeat the same information. A daily-winner
   headline after one hand adds a meaning the game has not established.
4. **Seat geometry has several owners.** Seat renders identity and feedback;
   Felt guesses a seat height and positions actions separately; Tray measures
   its name to place Join; the transparent menu target uses another rectangle.
   Local gap repairs do not establish one complete visual and interactive
   footprint.
5. **Solo play inherits multiplayer preparation.** One human with four bots
   sees a bot-heavy readiness count and presses Ready, then Start. That extra
   decision does not help the single human.

Evidence at the review: `room/lifecycle.rs`, `room/PeopleSheet.svelte`, `room/Lobby.svelte`,
`mighty/Seat.svelte`, `table/Felt.svelte`, `table/Tray.svelte`, `ResultSheet.svelte`,
`SessionResult.svelte`, and the user's waiting/spacing/result screenshots.
No competitor account sessions were entered.

## Implemented ordinary flow

**Waiting table → play a hand → compact current-hand result → next hand.**

- Keep participants, rules, seating perspective and cumulative scores on the
  same table. The existing scoreboard owns the totals.
- Show the hand's outcome, contract success/failure and personal score change.
  Give one primary continuation action. Current-hand replay can remain a
  secondary option; remove old-game browsing from the ordinary UI.
- Remove `모임 마치기` and `같은 멤버로 새 모임` from the result path. Personal
  departure is `테이블 나가기`; giving up a seat is `관전으로 전환`. An optional
  shared score reset is explicitly `점수 초기화` in the menu.
- With one human and bots, a deliberate Start/Next action prepares and starts
  that human in one gesture. With multiple humans, readiness remains useful;
  show which humans are awaited instead of emphasizing permanently ready bots.

### Observer participation

During play, offer `다음 판 참여` beside observer identity. After selecting,
show what will happen, when, and how to cancel.

| Situation | Implemented contract |
| --- | --- |
| Empty or replaceable bot seat between hands | Reserve a named target, then explicitly accept it before preparing for the next hand. |
| Bot seat during a hand | Reserve a specific bot seat for the next hand; no mid-hand private-card access. |
| Five human players | Show a waiting request. A seated person explicitly offers `다음 판 쉬기` / seat handoff. |
| Several observers waiting | FIFO requests reserve available seats; a human offer resolves the oldest unassigned request. No human is displaced by this admission flow without their offer. |
| Cancellation or disconnect | Cancel releases the reservation. The last observer connection disconnect cancels; another connected copy of the visitor keeps the request. |

Resolve admission before next-hand readiness and Start. The incoming person
confirms; the outgoing human becomes an observer and stays in the room.
Other seat coordinates stay fixed. `RequestSeat`, `OfferSeat` and `AcceptSeat`
now implement these transitions. Acceptance checks the frozen target identity;
changing a seat invalidates stale consent. A reserved seat blocks Start until
resolved; a waiting request without a seat does not interrupt current players.

### Perspective when joining

Arbitrary seat choice, no change from the observer's original viewpoint, and
the incoming person always at the bottom cannot all hold simultaneously.
Use the existing table to preview an explicitly chosen future seat at the
bottom, then lock that perspective. Joining replaces the bot/name in place;
Start only performs the approved own-character slide. If the reservation
changes, show another explicit seat choice rather than silently rotating at
the hand boundary. This is an inline table interaction, not a separate seat
picker page.

## Alternatives considered

| Direction | Assessment |
| --- | --- |
| Compact continuous social table | Recommended: least ceremony; clear continuation and social handoff. |
| Continuous table with optional score rounds | Useful if groups deliberately reset scores; keep it secondary. |
| Fixed-length match | Coherent only with a chosen hand count or score target. Do not infer this requirement from “game ends.” |
| Persistent player plaques | Clear boundaries, but adds panel furniture and a lobby/dashboard feel. Prefer the existing open table. |

## UI/UX acceptance contract

These remain observable acceptance rules. Source now consolidates identity,
feedback and actions in the seat component and wires the continuous-table flow;
source changes and successful interaction tests do not by themselves prove that
every viewport, hover target or visual composition satisfies every rule.

| Rule | Observable check |
| --- | --- |
| 1. One owner per complete seat | A SeatFrame contains identity, reserved feedback and contextual actions in normal flow. Every control, shadow, focus ring and menu target is inside its assigned footprint. Felt/Tray place the complete frame. |
| 2. Separate identity, feedback and action lanes | Actions leave 10–12px after identity/feedback; adjacent buttons leave 8px. No control straddles a seat surface or covers a name. |
| 3. Matching visible and interactive bounds | Empty seats have explicit actions without a second transparent menu target. Effective hit areas do not intersect. Important touch targets are at least 44×44px. |
| 4. Consistent identity rendering | All five characters share a renderer, ordering and scale within a layout mode; figure sizes differ by no more than 5%. Short landscape may compact everyone together. Keep approved own-seat center-to-side motion. |
| 5. Bounded typography | Names 13–15px, bids/status 12–13px, small counts 11–12px, primary actions 16–18px. Emoji reactions alone may be larger. A suit-prefixed bid is text, not an emoji reaction. |
| 6. Stable, bounded board composition | Extra viewport height becomes outer breathing room. Join/Ready/result folding do not rotate opponents. Reserve decision space; establish a compact viewport mode before play, not as a surprise phase transition. |
| 7. Feedback preserves essential information | Readiness, current bid and turn remain understandable during reactions. Transient priority replaces transient messages, not essential state. Simultaneous feedback does not change the seat footprint. |
| 8. Participation has a completion path | A request yields an actionable reservation, waiting/handoff state or clear unavailable explanation, plus cancellation. A decorative request badge is insufficient. |
| 9. Continuation owns result hierarchy | One primary next-play action, a compact hand summary, and one cumulative scoreboard. No old-game browser or session-ending ceremony in the default path. |
| 10. Distinct action scopes | Leaving a seat, leaving the table and resetting shared scores have distinct labels and effects. One participant's departure does not end everyone's table. |
| 11. Reveal secondary management progressively | One clear empty-seat action when space is tight; invite/settings/score management remain directly discoverable in their established room controls. Do not shrink every control to fit an overloaded seat. |
| 12. Visual acceptance is its own gate | Inspect visible and hit-test bounds plus actual screenshots: empty, partial, ready, bidding, reactions, result and observing. Include hover/focus, long Korean names, normal motion and safe areas. Passing click tests alone does not approve composition. |

Viewport set: 320×568, 390×844, 730×1012, 768×1024, 1024×768,
1024×1366, 1440×900, and 568×320. Inspect one-human/bot practice and a
five-human table with an observer, including join, handoff, cancel and reconnect.

## External patterns and evidence limits

These official documents support behavior patterns, not a claim that their
entire current visual designs were playtested.

- [Trickster updated features](https://www.trickstercards.com/home/help/update-history.html):
  documents waiting until the next hand when joining, changing that waiting
  choice, watching during event waits, and next-round alerts. Event completion
  is a club-admin action under event standings.
- [Trickster new-user guide](https://www.trickstercards.com/home/help/play-practice-join.html):
  explicit private-game Start; bots allow play while friends arrive.
- [Trickster Pitch options](https://www.trickstercards.com/home/help/pitch-rules.html):
  last-deal review is optional; game-ending score/hand rules are explicit.
- [PlayingCards.io player seats](https://playingcards.io/docs/player-seats):
  default empty-seat assignment and persistent visible seat identity after
  disconnect; empty-seat widgets can hide irrelevant controls.
- [Tabletopia user roles](https://help.tabletopia.com/knowledge-base/user-roles/):
  spectator-to-player transition is taking a seat; watching and player control
  are distinct roles.
- [BGA game metadata](https://en.doc.boardgamearena.com/Game_meta-information:_gameinfos.jsonc):
  rematch starting-player rotation and result semantics are explicit options.
  This does not imply that our visible characters should rotate.

## Implementation and verification status

| Area | Current evidence | Remaining acceptance |
| --- | --- | --- |
| Ordered participation and consent | Rust lifecycle tests cover FIFO/cancel, bot reservations, human offer/withdraw/accept, unrelated authority refusal and stale target changes. A real WebSocket integration test covers duplicate observer connections, last-disconnect cancellation and explicit seating. | Verified in real browser rooms: bot reservation/cancel/admission, five-human offer/withdraw/accept, different-seat preview/cancel, and incoming/outgoing reconnect. |
| Hidden cards and Start | Tests refuse live-hand acceptance/newcomer Join, verify spectator empty hands/legal actions, block reserved admissions, and require each human's readiness. Solo Start prepares in the same actor action. | Verified a normal-paced human-plus-four-bot hand through all ten tricks, replay and next deal; browser tests cover two-human readiness and the 400ms input guard. |
| Score reset/current replay | Tests preserve the frozen finished record, archive departed scores, reset current totals/readiness, retain booked state and restore after rules change. Dealer rotation and the previous friend/declarer survive score reset. | Verified replay through ten tricks after replacement/reset/reload, newcomer payoff exclusion, and current-only replay availability. |
| Legacy snapshots | Defaults preserve old scores; restore clears pending requests/readiness and normalizes legacy ended tables without score reset. Generated protocol parity and server integration checks pass. | A fresh client reconnecting to representative old persisted local rooms. |
| Browser composition | Current source uses one seat identity/action frame, one cumulative scoreboard, compact current-hand continuation, an observer participation lane and menu score reset. Session-result and old-game browsing controls are removed from the ordinary path. | 650 browser checks pass across the configured viewport/theme matrix. Extra 320px header and 568/800px landscape name-bound tests pass; the user's play review remains. |

The server verification receipt is `cargo test -p server`: 117 tests passed
(70 library, 1 generated parity, 6 limits, 7 phase checks, 26 room integration,
7 site tests). Clippy and formatting checks pass. Those checks do not establish
live browser visual approval, normal-motion game acceptance or deployment.

The current finished replay is `SessionMsg.current_hand`: immutable public view,
rules, names, IDs and payoffs. The UI can distinguish a newly admitted person
from the previous occupant rather than assigning the old payoff to their seat.
`점수 초기화` preserves that replay and the completed hand while clearing the
score epoch. Old epochs remain stored internally for compatibility; the product
keeps only the just-finished hand's optional replay in its ordinary flow.

Personal `관전으로 전환` is offered between hands. The UI does not promise a
scheduled personal departure without an incoming request. The explicit next-hand
human offer has its own acceptance/withdrawal path. Leaving the table does not
end the table for everyone else.

The local preview at `http://127.0.0.1:4520/` uses the new build with normal
pacing and the existing saved-room directory. The final browser receipt has
650 passing checks and 182 deliberate viewport-specific skips; frontend unit
tests have 614 passes and the Rust workspace has 350 passes (9 ignored).
Generated protocol parity, Svelte diagnostics and workspace Clippy pass.

A fresh normal-paced hand completed all ten tricks, replayed through 10/10 and
continued into ten newly dealt cards without browser errors. Very short screens
scroll vertically to retain full characters and usable controls. This is local
verification, not production deployment or final user design approval.


## Whole-screen composition correction

The initial spacing correction only moved unused height from below the hand
into a 220px command band. Passing overlap checks did not establish good
composition. A rendered desktop review rejected that result.

The corrected desktop layout groups the trick near the hand, uses intentional
80-96px trick cards, keeps the round caption 16-32px from the lower cards, and
uses a compact 56px shelf with a clear arena foot for routine commands. Contract
options and confirmation occupy 104px; friend shortcuts occupy 108px. The full
friend picker uses the existing bounded Sheet and preserves explicit action
confirmation. The compact desktop result is 140px high in the inspected case,
with its complete footer visible.

The public production `/version` endpoint reported commit
`9cd1c04443e4ec5788a51e035e3eecb3f3c8accb`. Source and rendered comparison at
1561x1071 verified the shared role/points row before the name, 80px figure,
-11.2px row offset, 11px badge font, 0px 6px padding, solid gold public roles,
2px table-colour ring, and 16px name font. These properties match the local
restoration; this is a specific badge-reference comparison, not a claim that
the entire application is pixel-identical to production.

Independent review accepted the inspected desktop composition. Responsive
checks, the complete five-card cluster, private friend status, disclosure
confirmation/cancellation, a full live hand, reload, replay and next-hand
transition are covered by the passing browser run. User play review remains
the final judgement of feel.


## Current disposition: restore production proportions

The user rejected the custom composition and explicitly chose production
layout on 2026-10-07. That decision supersedes the preceding custom-layout
acceptance and its fixed-arena/command-band requirements. Production commit
`9cd1c04443e4ec5788a51e035e3eecb3f3c8accb` owns the active-play grid, ring,
card bands and responsive own-player dock. An independent rendered comparison
confirmed matching bounds at 968x1083 and 1561x1071.

Observer participation, current replay, compact results, cumulative scores,
readiness, score-reset sequencing and input guards remain. New participation
content is outside the fixed production table; narrow compact results likewise
use page flow to avoid concealing players. Readiness uses the reserved feedback
slot instead of increasing character-frame height. Empty actions retain their
separate, spaced hit targets. No production deployment was performed.

Final phone clearance review includes 320x568, 375x667 and 390x844. Short
portrait phones use an inline result after the table; taller phones keep the
overlay below player feedback. This changes completed-hand presentation only.
The restored source passed 650 browser checks with 182 profile-specific skips,
614 frontend unit tests, and Svelte checking with no errors or warnings. The
final result-position adjustment passed 36 focused replay and layout-boundary
checks (28 profile-specific skips) and independent rendered inspection.

## Modest continuation polish — 2026-10-10

The user approved a small refinement of the existing table, including an
explicit opening movement from bottom-center to the desktop card-side dock.
The identity moves together over 300ms before dealing; opponents keep their
anchors. Results and subsequent deals retain the dock, including after shared
score reset and an explicit seat swap. The current-hand record restores that
continuity on reconnect. Portrait phones retain the compact production layout.

The ordinary `섞기` button now controls persistent `table.shuffle`, with a
stable pressed state. It clears a pending legacy one-shot flag when toggled;
the server's compatibility support remains. Two completed hands followed by
an unshuffled third start verify persistence and disabling.

Both observer entry points use the same reservation-aware target rule. Human
offers select the oldest unassigned request. Named participation notices are
quiet on initial/reconnecting snapshots. The header marks pending requests,
so phone players can reach the roster and offer/withdraw during a live hand.
Only actual participation buttons intercept clicks over the empty table.

Reaction bubbles use a 200ms scale-and-settle, 20px emoji and 13px phrases in
the existing feedback slots. Reduced motion fades and off is immediate. Bids
and readiness remain visible. Repeated observer reactions replay their
entrance, and phones show one named observer reaction in a reserved rail.

Fresh local validation: 622 frontend unit tests, 117 server tests, clean
Svelte diagnostics and builds. The selected browser matrix passed 91 checks
with 109 explicit profile-specific skips; a subsequent focused dock check
passed after reconnect handling was added. It includes full hands, observer
reservations and human handoffs, full/reduced/off reactions, responsive bounds,
and consecutive shuffles. A separate normal-paced (1000ms bot delay unit,
20ms local thinking cap) run completed ten tricks and continued after score,
rule and seat changes. A second normal-paced run completed observer reservation,
admission without inherited payoff, replay through 10/10, reload and the next
deal. This is local validation; no deployment was performed.

## Shared table and fixed identities — 2026-10-10 follow-up

The user's follow-up requested a single continuous layout that future card
games can reuse. `ui/TableFrame.svelte` now owns the viewport budget and region
tracks without importing Mighty rules or room protocol. Mighty supplies the
arena, identities, cards and decision content. Phase, turn and panel height no
longer choose another table grid or move the opponent anchors. A universal
seat/rules engine has not been introduced.

The own-player dock uses the same `Seat` renderer before and during play at
every viewport. Automatic whole-seat/table motion on turn cues, collection
and friend reveal is removed; explicit shuffle, seating and the first desktop
center-to-dock slide remain. Cards, bubbles, badges and highlighting still
provide feedback. Decision captions clear the own identity.

Observer/request content and short-screen results occupy bounded regions in
the frame instead of extending the page. Character readiness labels are
removed while multiplayer readiness remains. Empty seats use compact outlined
bot actions. A visible name field precedes seating; settings can rename a seated
human while preserving their identity, seat, score and credentials. Reclaim
uses the canonical server name, including when another tab has stale storage.

The shuffled-start browser gate compares opponent figure bounds before start,
during bidding/exchange/friend/play, and on every animation frame through the
first trick: each coordinate and dimension stays within 1px. It also checks
decision clearance and page overflow. The actual user-sized 824x1034 viewport
passed the geometry and both name-entry/rename checks; screenshots were
inspected after the final caption correction. Frontend unit tests passed 622
checks and server tests passed 118. Svelte checking/builds and diff whitespace
checks passed. The existing room on port 4530 was preserved; the new backend
preview runs separately on port 4534. No deployment was performed.

The final selected responsive browser matrix passed 206 checks with 130
explicit profile-specific skips. A normal-paced desktop run completed a hand,
score/rule/seat changes and the next deal in 56 seconds. One earlier 5-second
bid wait expired after a bot-requested deal miss; the helper now allows the
replacement deal and rotated bot bids to finish, using the same 15-second
turn wait as card play. Three separate small-screen full-hand runs also passed.
