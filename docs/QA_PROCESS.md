# Game UI acceptance process

Reusable workflow: `$strict-game-qa` (`~/.codex/skills/strict-game-qa/SKILL.md`). This document owns the card-game contract. The skill accounts for all researched sources: invoked, methodology applied as reference, justified non-applicability or blocked. It does not silently install packages or claim reading equals invocation.

## Current status

Visual acceptance is rejected. [The audit](ENGINE_VISUAL_AUDIT_2026-10-18.md) records 25 observations and unverified areas. Historical technical receipts do not clear them. Creating this process does not execute QA or fix the game.

## Run modes

| Request | Required work |
|---|---|
| Find issues / audit | Black-box rendered investigation, source diagnosis as needed, evidence and ledger; no silent product edits. |
| Fix bounded defect | Authorized repair, before/after at failing size and adjacent transitions; no full-readiness claim. |
| Finish engine/migration / ready to release | Full declared coverage, all applicable lenses, independent artifact review, no unresolved blockers. Deployment separately scoped. |

## Mighty contract

- Preserve original design-system appearance, table proportions, grouping, anchors and intentional card layering. Compare equivalent states; rejected candidate screenshots are not approved goldens.
- Own identity, four peers, hand, essential controls and phase facts must remain usable: contract, trump/기루다, declarer, friend, turn, round and score/progress where applicable. Submit visible above offscreen inputs/hand is not an acceptable compact layout.
- Keep placement engine-owned. Fix shared policies instead of per-screen application offsets. Centralization and contained rectangles do not establish good composition.
- Real connected runs cover human plus four bots, a separate observer, controlled five-client handoff and two consecutive hands through results/replay/next hand. Preserve names/identity/score. Controlled clients are not human usability participants.
- Review deal, kitty/discard, friend choice, selection, play, collection, misdeal/reveal, result and reshuffle motion. Include interruption, resize mid-motion and reduced motion. Preserve straight movement and character eye/blink behavior; avoid unrequested whole-body bobbing.

## Coverage and artifacts

[qa-profile.json](qa-profile.json) declares initial required screens at six sizes, light/dark and normal/doubled text, plus separate motion/input/continuity/human cases. Add newly discovered relevant states. Unreachable states stay blocked. Never remove cases to manufacture acceptance; record authorized scope changes.

Also exercise intermediate breakpoints, long Korean/Latin names, empty/full seats, bid/hand boundaries, menu/dialog paths, loading/errors and server rejection/reconnect. Record browser engines and physical devices; Chromium viewport emulation is not Safari/iOS/Android hardware proof. Native products require their platform lanes when applicable.

Keep run artifacts outside this checkout. Read the skill, then:

```sh
python3 ~/.codex/skills/strict-game-qa/scripts/qa_gate.py init --repo "$PWD" --profile docs/qa-profile.json --out /tmp/card-game-qa/run.json
python3 ~/.codex/skills/strict-game-qa/scripts/qa_gate.py check --repo "$PWD" --profile docs/qa-profile.json --run /tmp/card-game-qa/run.json
```

Initialization is deliberately unverified/blocked. Visual cases need inspected viewport images; behavioral/motion cases need exact actions and a recording or timestamped sequence. Preserve source/build identity, environment, hashes and review receipts.

## Acceptance blockers

Missing evidence/review, stale build, P0/P1, unapproved design drift or any blocking finding prevents acceptance. Reconcile every historical audit observation: supported refutation, verified fix, confirmed open defect or explicit user-accepted exception. It cannot disappear from the ledger. Scores, skipped/healed tests, fixture-only evidence, screenshot counts and text-only reviews cannot clear blockers.

The helper verifies ledger integrity, not pixels or truthfulness. A separate reviewer must inspect actual images/motion for the final source/build. Report remaining scope; no finite campaign proves all bugs found.
