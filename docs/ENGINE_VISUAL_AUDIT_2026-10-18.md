# Mighty engine visual audit — 2026-10-18

**Status: visual acceptance rejected; implementation is not complete.**

This is an inspection report, not a list of applied fixes. Previous functional and performance receipts do not establish visual quality. The sealed completion archive remains unchanged.

## Evidence and scope

Live local game: `http://127.0.0.1:4534/r/vqhj4q`, five occupied seats, bidding, human's turn after four passes. Fresh captures cover 320×568, 390×844, 768×1024, 844×390, 1280×720 and 1440×900. The 390/768/1440 captures were taken in the preceding audit turn. Settings and table-information dialogs were opened in this turn; no game commands or preference changes were submitted. Temporary browser viewport overrides were reset.

The historical screenshot inventory contains 127 PNG files excluding attachment copies. That is neither 127 unique states nor 127 reviewed/accepted screens. Reviewed contact sheets contain 34 selected archived images: paired waiting/bidding, paired late-play/outcome, overlay and pressure cases. Two archived images were additionally inspected at larger size. Archived observations below are explicitly distinguished from fresh reproduction.

Evidence folder: [/Users/jaeyong/Documents/Codex/2026-10-18/card-game-visual-audit](/Users/jaeyong/Documents/Codex/2026-10-18/card-game-visual-audit).

Severity: **P1** interrupts access to essential game information or actions; **P2** damages composition, readability, interaction consistency or design fidelity. “Confirmed” means the described appearance was observed, not that every related state was reproduced.

## Confirmed observations

### Essential visibility and information

| ID | Severity | Trigger and observed result | Evidence | Correction target |
|---|---|---|---|---|
| V01 | P1 | At 844×390 the bid command is visible while both selectors and the entire hand are below the viewport. Suit selector top is 392px in a 390px viewport. Reviewing cards and changing the bid requires scrolling away from the visible action. | Fresh `landscape-844x390.jpg`, DOM rectangles | Allocate the active hand and decision controls together under height pressure; do not prioritize submit above its inputs. |
| V02 | P1 | At 320×568 almost the entire local dock and the bid selectors are below the viewport. The viewport is consumed by header/status/peer reservations. | Fresh `compact-320x568.jpg` | Introduce an actually usable compact-height composition. |
| V03 | P1 | Phone play omits the score/target progress strip visible in the original, despite the adapter supplying progress presentation. | Archived `play-outcome.jpg`, late-play phone pair; source confirmation below | Render progress in the compact status path. |
| V04 | P1 | Phone play removes the original friend summary from the immediately visible status. The compact adapter requests only the round field for Play. | Archived `play-outcome.jpg`, late-play phone pair; `participantStatus.ts:83` | Define essential per-phase facts, including friend information, before choosing what moves into a dialog. |
| V05 | P2 | Desktop outcome's sidebar shows only part of the five-player scoreboard at its initial scroll position; a player's row is visibly cut at the lower boundary. The adjacent 53-card stock is also cut at that boundary. Scrolling may recover content; the screenshot does not establish lost data. | Archived large `outcome-candidate-1440-1.png`, `play-outcome.jpg` | Recompose result, scoreboard and supporting collections; make overflow explicit when unavoidable. |

### Decisions and design-system fidelity

| ID | Severity | Trigger and observed result | Evidence | Correction target |
|---|---|---|---|---|
| V06 | P2 | Normal bidding uses native dropdowns instead of the original visible suit and count choices, even on desktop. This hides alternatives and changes the established interaction. | Fresh live viewport captures; archived `original-vs-engine.jpg` | Restore the original choice presentation through shared engine primitives. |
| V07 | P2 | Submit commands appear above the fields that determine their meaning, reversing the original choice-then-submit flow. | Fresh phone, tablet and laptop captures | Preserve decision dependency order under pressure. |
| V08 | P2 | Primary bid precedes Pass, and Pass shrinks to a narrow text-width button. Original uses Pass then the prominent bid action. | Fresh `short-1280x720.jpg`; archived bidding pairs | Preserve action ordering and related-button proportions. |
| V09 | P2 | At 320px the menu alone wraps onto a second header row while the other header tools remain in the first. It consumes scarce height and separates the navigation tool. | Fresh `compact-320x568.jpg` | Compact the header as a unit rather than wrapping a single tool. |
| V10 | P2 | Play exposes a generic disabled “선택 확정” button rather than the original contextual card interaction instruction. It adds a prominent inactive block without explaining the next interaction. | Archived late-play phone pair | Use a shared card-selection presentation that explains selection and confirmation in the game's established language. |

### Player identities and contrast

| ID | Severity | Trigger and observed result | Evidence | Correction target |
|---|---|---|---|---|
| V11 | P2 | Passing dims the whole opponent, including avatar, name and hand count. The already-small identity becomes difficult to read against the dark table. | Fresh live captures; `domSurface.ts:672` | Deemphasize the pass state without dimming identifying information as a whole. |
| V12 | P2 | Pass bubbles sit beside the portrait while names and card counts form a separate row; the elements no longer read as one aligned player identity. | Fresh `live-768x1024.jpg`, `short-1280x720.jpg` | Compose portrait, name, status and count with explicit anchors and stable alignment. |
| V13 | P2 | At 320px the hand-count unit wraps to a separate line (`10` / `장`) on side players. | Fresh `compact-320x568.jpg` | Treat count and unit as one compact atom; do not word-wrap them independently. |
| V14 | P2 | The local name receives an extremely wide pink pill relative to its two characters, while nearby peer labels and badges use different proportions. | Fresh `short-1280x720.jpg`, `live-1440x900.jpg` | Size the name badge to its content and keep its anchor tied to the portrait. |
| V15 | P2 | Outcome local identity is fragmented: avatar at the left, name displaced beside/above it, team badge far away near the middle. | Archived outcome desktop pair in `play-outcome.jpg` | Use one coherent settled identity composition. |

### Table, hand and status composition

| ID | Severity | Trigger and observed result | Evidence | Correction target |
|---|---|---|---|---|
| V16 | P2 | “내 차례” is left aligned at the page edge, detached from the centered contract/minimum status and active controls. | Fresh captures at all six inspected sizes | Center or anchor the complete status group consistently. |
| V17 | P2 | Desktop simultaneously repeats contract/turn information in the header area and the sidebar, without a clear primary location. | Fresh `live-1440x900.jpg`, `short-1280x720.jpg` | Establish one primary status presentation per composition. |
| V18 | P2 | “공약 없음” is rendered as huge, wrapped display text in the status panel, dominating actual game facts. It is also repeated in the mobile information dialog. | Fresh `information-phone.jpg`, desktop captures | Separate an empty-contract message from a numeric contract's display typography. |
| V19 | P2 | Tablet local dock has a detached identity at the upper left, a large blank region, and cards clustered toward the bottom. The border encloses unused space instead of a tight hand/identity composition. | Fresh `live-768x1024.jpg` | Measure and compose the identity and fan together instead of retaining oversized independent reservations. |
| V20 | P2 | Desktop hand cards remain heavily overlapped in a small cluster despite substantial free dock width. Four-card late-play hands also retain unnecessary overlap. | Fresh laptop/desktop; archived late-play pair; `planner.ts:366` | Use available width up to natural card spacing before introducing overlap. |
| V21 | P2 | The tiny central stock/count and surrounding empty arena compete for attention with small, scattered peer identities. The original table's visual hierarchy and proportions are not preserved. | Fresh tablet/desktop; archived paired bidding | Set card-table-specific prominence, scale and spacing policies rather than merely satisfying minimum rectangle sizes. |

### Results and transient layers

| ID | Severity | Trigger and observed result | Evidence | Correction target |
|---|---|---|---|---|
| V22 | P2 | Result history cards are fixed at 16/24px widths and are too small to read comfortably, including on a wide desktop where columns have abundant free space. | Archived outcome pairs; `outcomeOverviewLayout.ts:23` | Choose readable card density from actual available space and provide deliberate overflow or a detail mode. |
| V23 | P2 | Winner/powered highlight decorates the entire expanded matrix cell. This produces wide pill-shaped colored backgrounds with a tiny card in the middle instead of highlighting the card itself. | Archived large `outcome-candidate-1440-1.png`; `outcomeOverviewLayout.ts:46` | Separate a card's highlight bounds from its grid allocation bounds. |
| V24 | P2 | Result summary, contract/score, next-round action and local identity are scattered into separate uncontained regions instead of the original compact result group. | Archived outcome pairs | Compose a cohesive result summary and action group. |
| V25 | P2 | A full-width misdeal reveal covers upper player content and the upper part of the desktop status sidebar. This is an observed transient overlap; whether every occlusion is intended needs a motion review. | Archived `public-misdeal.png`, pressure contact sheet | Define the reveal's occlusion policy and coordinate its bounds with arena/sidebar layers. |

## Source-level causes established

1. `planner.ts:558–567`: `activeStatus` consumes primary/fieldIds/summary but never consumes `reference.progress`. The adapter does set `progress:true`. This is a real contract-to-rendering omission, not merely a screenshot preference.
2. `games/mighty/participantStatus.ts:83`: compact Play status asks for `round` only. The friend field is not included. Essential information selection needs a product-level contract, not incidental field omission.
3. `planner.ts:366`: peer-table hand spacing is capped at `TARGET` (44px), which is a hit-target constant, not a card-spacing policy. Available width cannot restore natural spacing.
4. `planner.ts:408–442`: footer pressure converts finite choices to native selects, sorts primary commands first, and places command rows before field rows. One pressure fallback changes interaction type, order and appearance together.
5. `planner.ts:817,848–849`: primary text and primary numbers both receive display typography inside a narrow contract allocation. This produces the oversized wrapped empty-state message.
6. `domSurface.ts:672`: deemphasis applies `.55` opacity to a complete group. Participant identity inherits the pass-state treatment.
7. `outcomeOverviewLayout.ts:23,46`: result cards keep fixed tiny sizes while matrix allocations expand; callout decoration belongs to those expanded allocations. Geometry fits but visual shape and density do not.

Central ownership exists, but it does not by itself enforce a good composition. The engine currently lacks sufficient semantic presentation constraints: essential visibility, natural versus minimum card spacing, stable player anchors, text-type-specific prominence, highlight bounds, and pressure fallbacks that preserve interaction order.

## Unverified — not counted as confirmed defects

| Area | Missing inspection |
|---|---|
| Motion | Fresh end-to-end review of deal, kitty transfer, play, trick collection, misdeal, interruption and resize while moving. The user's flickering/clipping reports remain open; still images cannot establish their cause or absence. |
| Game phases | Fresh connected Exchange, friend selection, early/mid Play, observer and reconnect paths at the six inspected viewport sizes. |
| Interaction | Touch selection/drag, keyboard focus order, native selector behavior, screen-reader flow, and scroll recovery under every pressure state. |
| Extended content | Long names, different rule sets, maximum hand sizes, doubled text and every overlay at each viewport. Archived stress captures exist but are not exhaustive fresh acceptance. |
| Other games | Poker, Hulla and One Card need their own visual acceptance; a Mighty layout audit does not establish general engine readiness. |

## Fix order and acceptance

Fix essential visibility and missing information first; then shared identity/hand/decision policies; then result layout and transient layers. Preserve the original Mighty design while keeping placement engine-owned. Do not replace these issues with per-screen offsets.

For each finding, require a before/after image at the failing size, a source-level correction, and a regression check that tests the actual requirement. Review the image directly. Motion findings require recorded or sampled transition review in addition to settled screenshots. Do not call the engine finished while these findings or the motion/phase coverage remain open.

This audit identified 25 concrete observations in the inspected scope. It does **not** claim to have found every remaining defect.
