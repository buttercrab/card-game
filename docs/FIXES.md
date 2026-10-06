# Remaining work and regression contracts

Updated 2026-10-06 against `4c4b8aa`. This owns unresolved cleanup and
acceptance gaps. [PLAN.md](PLAN.md) owns direction and the AI pause;
[REFACTOR.md](REFACTOR.md) records the completed cleanup.

## Open work

| Priority | Item | Evidence | Completion check |
| --- | --- | --- | --- |
| Before AI resumes | Redeal targets and exploring-start reset | Trainer retains decisions until hand completion; v2 assessment found later-deal rewards on discarded deals | Deterministic examples prove intended targets by deal/seat and no cross-deal reward inheritance |
| Before strength claims | Frozen-rule suite/current baseline | v1 resolves preset names; baseline predates scoring G and later bot changes | Explicit versioned rules, current opponents/baseline, fresh-deal confirmation; preserve historical results |
| Before promotion | Measured versus served 고수 | Eval hard uses fixed samples; table bots use a clock | Evaluate intended served spec, time budget and rule coverage; document clock dependence |
| Before unattended research | Compatible queue and approved budget | Queue references older encodings/runs; no qualifying batch/report series | Compatible artifacts, approved caps, single GPU job, home worker responsive, ≥10 unattended experiments with reports |
| Operations | Offsite backup and restore test | Script copies Seoul data to home; archive listing is not restoration | Approved independent destination and isolated restore of usable tables/reports; record revision/date |
| Before second-game completion | Residual Mighty assumptions | Titles/sitemap, stats labels, rulebook/editor, practice preferences and concrete codegen types | Play Texas hold'em through shared rooms with correct pages/types and no shared-driver rewrite |
| Design | Touch-target/accessibility audit | Segmented choices are now 44px; seat entry/menu focus and partial-lobby overlaps have local regression coverage | Broaden actual-device/assistive-technology checks; preserve the Chromium hit-target and keyboard regression coverage |
| Research follow-up | Scoring-G cells/headroom | Report records missing and partial cells | Complete at recorded revision, or explicitly supersede with a new scoped study; never mix revisions |

These are prerequisites, not authorization to train, spend, change production
or build poker. Agree the next bounded outcome first.

## Product contracts to preserve

Features below are implemented with source/test evidence. This table is not
a fresh manual acceptance receipt for every device or live game.

| Feature | Current contract | Owner / evidence |
| --- | --- | --- |
| Turn limit | Off / 20 / 40 / 60 seconds; server deadlines and away-seat fallback | Room clock/bots/tests; TurnRing |
| Immediate 딜미스 | A qualifying seat may act during its rule window; no separate asking round | Seat-addressed legality, MisdealWindow, snapshot/hand tests |
| Contract confirmation | Chip selects a proposal; confirmation applies the server-described contract | ExchangePanel and generated view |
| Shuffle | Marks next hand; start performs it. Identity follows players/bots | Seating/session tests and browser shuffle flow |
| Between hands | Stay at the table; fold away results and use seat/settings/next-hand controls | Room, Lobby, SeatMenu |
| Spectating | Public view and appropriate controls; no hidden-hand exposure | View invariants, seating, table view |
| Reconnect/leave | Token reclaims seat; an explicitly closed client stops reconnecting | Room client tests and play/reload flow |
| Phone layout | No sideways scroll; corner indices and controls reachable | Light/dark browser matrix, including 320×568 |
| Rules/scoring | Table rules stay pinned; payoffs/explanations come from engine/server | Snapshot/generated protocol/payoff tests |
| Motion/background | Reduced/off retains information; hidden tabs cannot stall animations | Settings, motion, animator and worker clock |

## Local player-control cleanup (2026-10-06)

Verified locally before release: segmented targets/focus, name-field
autofocus after placement, popover focus return, narrow-phone partial-lobby
spacing/hit targets, and short-landscape between-hand seating.
[controls.spec.ts](../web/e2e/controls.spec.ts) covers table filling, keyboard
entry, server-confirmed bot choices, landscape start and an independent watcher.
The existing suite covers play/reload, disconnect/leave and shuffle identity.

Actual iOS/Android devices and screen readers were not tested by this pass.

## Bot fixes delivered

[Paired measurements](../research/experiments/2026-10-05-bot-fixes) cover
misdeal policy, scoring-aware bids, joker/friend calls, temperament and
초보 mistakes. Simple-bot changes were neutral or better; search changes
remained within uncertainty. Always-on switches were subsequently removed:
reproduce old switch commands at the recorded experiment revision.

The declarer's discards now count as known; its follow-up measurement is
in that experiment. Presentation pacing is not evidence of stronger play.

## Closed owner decisions

- Home uses 기본 or the last selected preset; no approval remains pending.
- GitHub PR checks, pinned actions and read-only workflow tokens were adopted.
- 고수 is the default bot; ratings remain internal.
- Shuffle runs at next-hand start, not when the toggle is pressed.
- Keep the table between hands; no separate back-to-room screen.
- 경기과고 permits a first-trick led joker to name trump and trump lead
  with nine trumps plus Mighty, as specified in its rules.
- Players may call a held joker as a bluff; bot policy must not narrow legality.
- Training is paused. Teacher use and unattended research remain separate decisions.

## Candidate cleanup, not selected work

Prefer a demonstrated failure over another abstraction. Small candidates are
game-specific preferences/page metadata, measured touch-target corrections,
and an explicit research-runner pause guard. The latter is a proposal, not
a claim that PLAN's pause is automatically enforced by the runner.

Shareable house-rule links and more exposed player-count options are product
ideas, not cleanup defects. The engine supports multiple counts; the
player-facing experience needs its own scope.
