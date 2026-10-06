# Codebase cleanup record

Updated 2026-10-06 against `4c4b8aa`. All eight cleanup phases are merged.
This is a delivery record. Remaining work is in [FIXES.md](FIXES.md);
overall direction is [PLAN.md](PLAN.md).

## Why the cleanup happened

Eight reviews covered web architecture, styles/components, server,
engine/Mighty, research crates, Python ML, duplication, and tests/CI/deploy.
They found duplicated domain facts, oversized files, feature-specific hooks,
missing shared primitives and weak change safeguards.

The correction was to give each responsibility an explicit owner and preserve
behavior through tests. It did not restart AI or finish the product roadmap.

## Delivered phases

| Phase | Delivered outcome | Merged PRs |
| --- | --- | --- |
| 0 — correctness | Reconnect/close lifecycle, stale hints, pinned rules, scoring clamp, timers, worker handshake, deployment retry, actor failure/provenance, loop critical section, phantom cards, puzzle versions and strict bot parsing | #6–#9 |
| 1 — safeguards | PR checks, faster CI, frozen fixture rules, readable search goldens, shared/seeded helpers, web unit and play/reload tests, license, pinned toolchain/images, worker health | #12, #14 |
| 2 — domain authority | Generated TypeScript protocol/catalog, Korean error presentation, server-owned score/refusal/contract explanations, centralized bot levels | #13 |
| 3 — server | Shared config/environment, modular room actor and settle path, typed internal messages/saves, background persistence/stats, paused-time tests, change-aware session broadcast | #16 |
| 4 — engine/research | CardSet, shared trick/play rules, Declared phase data, shared rules, MisdealWindow, mighty-4, mighty-ai/PIMC core, typed bot specs, harness and lab | #18 |
| 5 — Python | Typed schema/file readers and run directories, shared model/observation loading, typed loop records/roles, curve reports, removed scaling placeholder | #11 |
| 6 — web | Shared tokens/motion and UI primitives, table view/narration/animation/regions, fake preview client, lazy tools, phone layout corrections | #17 |
| 7 — game boundary | Legality by seat, game/table/research traits, game catalog/routes, engine-ml, frontend room layer/registry; early dynamic API removed | #19 |

PR numbers refer to `buttercrab/card-game`. [ARCHITECTURE.md](ARCHITECTURE.md)
maps the resulting owners and dependencies.

## Evidence and limits

At takeover, CI for `4c4b8aa` passed formatting/lint, workspace tests on
Linux/macOS/Windows, simulation, quick eval, Python, web checks/unit tests,
browser tests and shell/deploy checks. The public version endpoint reported
the same server and connected-worker commit.

This establishes delivery of that checked revision. It does not prove every
original checklist item, backup restoration, current health indefinitely,
or the behavior of a second game.

## Residual items

- The backup script copies Seoul data to home; independent offsite storage
  and a scheduled restore test remain open.
- Site titles/sitemap, stats preset labels, rulebook/editor pages, practice
  preferences and concrete generated types remain Mighty-specific.
- Only Mighty is registered. Poker must test the shared boundary.
- Research/promotion gaps remain; code cleanup did not repair RL targets.
- Smaller files are not an acceptance criterion by themselves. Further
  splitting needs a distinct responsibility and a behavior-preservation check.

## Further cleanup rules

1. Name the duplicated decision and its canonical owner.
2. Preserve game behavior unless the task explicitly fixes it.
3. Review generated protocol/catalog/encoding changes; do not blindly re-pin.
4. Verify the affected boundary: room flow, UI, parity or paired bot results.
5. Use a branch/PR; main auto-deploys, so merging requires release authority.
