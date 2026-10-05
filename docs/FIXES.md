# Fix plan (2026-10-05)

What to fix on the live site, from two sources: the owner's play-test with friends, and the eight-angle review of 2026-10-05 ([report](https://claude.ai/artifact/RgWKVRWUKARUN9WiWiC1C1)). The learned-bot work stays in [PLAN.md](PLAN.md); this file covers the product, the server and the research loop's safety.

Work goes in waves. Each wave ships on its own, after the owner's go-ahead, and each item is checked before it is ticked.

## Wave 1: a table night with friends

Everything a group of friends notices in one evening. Play-test items first.

### 1.1 Turn time limit (시간제한)
- **Setting:** a table setting, 턴 시간: 끔 / 20초 / 40초 / 60초. The default is 끔 for tables with friends; practice tables keep it off.
  - The limit is per decision.
  - The friend call and the discard get double the limit.
- **Where it runs:** the timer runs on the server, so a closed tab can't stop it.
- **What players see:** the seat whose turn it is shows a ring that empties. The last 5 seconds tick on your own turn.
- **On expiry:** the server plays 보통's move for that seat and marks the seat 자리 비움.
  - While a seat is 자리 비움, its turns get 5 seconds before the bot plays them.
  - The player's next action clears the mark.
- **Dropped phones:** the same mechanism also covers a dropped phone. A disconnected seat counts as 자리 비움 straight away, so the table never stalls (review: docs/product).

### 1.2 Faster 딜미스 (딜미스 빠르게)
- **Owner, 2026-10-05:** a 딜미스 button from the moment the cards land, for anyone whose hand qualifies, instead of waiting for your turn to bid. It replaces the seat-by-seat asking round. In presets where 딜미스 must come before any bid, the window closes at the first bid, and the first bid waits a short moment after the deal so nobody loses the chance to a fast tap.
- **Asking round:** removed; anyone may call 딜미스 out of turn while their window is open (done, encoding `mighty-3`).
- **The thrown-in hand** stays up until the next deal lands, or for at most 4 s, instead of 8 s.
- **The redeal animation** is shortened to about half.
- **Bots** call 딜미스 only on hands they wouldn't bid on. This was the biggest cause of repeated redeals: 보통 redealt about once per hand on 경기과고 (review: bots).

### 1.3 Confirm before changing the contract (공약 바꾸기 확인 버튼)
- **Today:** in the exchange, one tap on a 기루다 변경 or 공약 올리기 chip changes the contract at once.
- **Change:** the chip only selects. A plum button underneath reads the result ("♥ 16으로 바꾸기"), and tapping the chip again deselects it.

### 1.4 Shuffle seats (순서 섞기)
- **Where:** a 순서 섞기 button in the room between hands, for any seated player.
- **What it does:** it shuffles everyone at the table, people and bots, into new seats. Each player keeps their reconnect token, so a reload still finds their seat.
- **Announced** in the event line ("자리를 섞었어요").
- **Option:** 매 판 섞기, to reshuffle before every hand.

### 1.5 Back to the room (방으로 가기)
- **Where:** from the result sheet, a button returns to the room, without leaving the table.
- **What you can do there:** change rules, swap bots and levels, shuffle seats, or invite someone.
- **Next hand:** starts from the room, the same way the first one did.
- **Owner, 2026-10-05:** yes. In the room between hands you can reorder seats (shuffle, or move someone), and add or remove players and bots.
- **Owner, after trying it:** it felt like a website; there should be no back button. Rebuilt: no separate room screen. The table stays between hands: the result folds away (테이블 보기), the middle of the felt holds 다음 판 (or 시작) with 섞기 and 설정, and a tap on a seat opens its choices (a bot's level, 자리 바꾸기, 비우기 / 내보내기 / 일어나기; an empty seat's 봇 앉히기 and 초대; sitting down for a watcher). Seats slide to their new places. The header is the table's code (a tap invites) and one menu: 초대하기, 규칙 보기, 테이블 설정, 소리와 화면, 문제 신고, 나가기 (asks first mid-hand). The back gesture opens the menu or closes the sheet on top; only 나가기 leaves.

### 1.6 Spectating (관전 고치기)
1. Reproduce with a second browser first: watch a full hand, join while a hand is running, and watch with a full table.
2. Known gaps to check:
   - A watcher sees prompts meant for players.
   - A watcher can't take a seat a bot filled mid-hand once the hand ends.
   - The empty hand tray takes space.
   - There is no list of who is watching.
   - The result sheet's buttons are meant for players.
3. **Owner, 2026-10-05:** small UI problems, nothing structural.

### 1.7 Bots (review: bots)
- Misdeal only below the minimum bid (also 1.2).
- In playouts, score a redeal as 0.
- Bidding aware of scoring G:
  - from 15 up, require an estimate one point above the bid;
  - `bid_base` 6.0;
  - a smaller per-seat temper.
- Turn on `aim_joker_call`.
- Attackers don't call the joker unless the declarer has shown they lack it.
- Friend calls skip the declarer's own discards.
- 초보 bids about one point more cautiously, and its slips are cheap cards, never the mighty, jokers or calls.
- Pace by decision:
  - bids 2–3 s;
  - discard and friend call 3–4 s;
  - leads about 2 s;
  - obvious follows about 0.6 s.

Each change is checked with a paired `sim --baseline` run before it ships.

### 1.8 Phones (review: UX)
- During the exchange, at 360 px or less, the hand tray grows by a row so no card hides under the controls.
- Trick spots, tool buttons and reaction bubbles keep clear of the seats on short phones (iPhone SE, 320×568).
- Bid counts go on their own row.
- The replay sheet shrinks long names.
- The suit chips get names for screen readers.

### 1.9 Wrong words
- The tutorial's scoring line.
- RULES.md on 대전동신.
- The privacy page's two inaccurate lines.
- Spell 딜미스 and 조커콜 the same way everywhere.

### 1.0 First: web smoke tests
- Playwright over every `/preview` state at 320×568, 375×667, 390×844 and 1440.
- Checks:
  - no sideways scroll;
  - no seat label covered;
  - every hand card's corner visible.
- They run in CI. They come before 1.8, so the layout fixes are measured and stay fixed.

## Wave 2: security, before the research loop runs alone

- The loop's rsync `--delete` takes a crafted path: validate experiment names and sync only inside a fixed root.
- The researcher sandbox:
  - read and write only its own folders;
  - exact command allow-lists;
  - a daily spend cap.
- GitHub, with the owner's OK:
  - read-only workflow tokens;
  - a protected `main`;
  - actions pinned by commit.
- Server limits:
  - hints: CPU cap and rate limit;
  - a cap on open rooms;
  - report body size;
  - WebSocket message size and rate.

## Wave 3: operations

- Deploy only a commit whose CI is green. Keep the previous image, with a one-command rollback.
- Graceful restart:
  - the server snapshots its rooms on SIGTERM and restores them;
  - players see "잠깐 다시 연결하는 중" instead of "missing table".
  - Friends noticed this during deploys.
- A room keeps its rules for its whole life, even when a preset changes underneath it.
- A worker heartbeat, with an alert when the table falls back to in-process bots.
- Backups of the stats database, image pruning, container memory limits and an uptime check.

## Wave 4: research rigour, before the loop

- The DMC run (`dmc-v1`, `mighty-1`, old scoring) is a shakedown. Rebase it and retrain on `mighty-2` with scoring G.
- Suite v2 with frozen rules. Re-baseline 고수 on it.
- Redo PLAN's "no headroom in bidding and exchange" under G.
- The table's 고수 = the measured 고수:
  - pin a sample count (about 2,000);
  - time is only a cap;
  - evaluate that exact spec.
- Statistics:
  - pair games on the same deals;
  - budget by hands, not wall clock;
  - repeat wins on fresh seeds;
  - drop the random rung from the primary metric.
- 고수's override test: a z that grows with the number of candidates. A/B it.
- Finish the scoring G measurement: the 초보 cells, and 보통 deals 341–399 (commands in `research/experiments/2026-10-05-scoring-g/config.toml`).

## Wave 5: design (DESIGN.md)

- Plum only for "act now". Focus rings, the round-won outline, `+N`, 공약 확정, 가져감 and other players' 조커콜 alert go to ink.
- Remove:
  - the particle burst on a win;
  - blurred shadows;
  - the gold-on-black achievement block.
- Suits drawn as SVG in buttons and copy, never as font glyphs.
- Friend picker:
  - a scroll fade on the shortcuts;
  - 다른 카드… as a button;
  - the own-card section reachable;
  - one clear selection.
- The result ledger:
  - sent by the server, so it always matches the payoffs;
  - named terms;
  - a "주공 ×2 · 프렌드 ×1" line.
- Home:
  - preselect 기본 (or the last preset used);
  - collapse the preset list so 테이블 만들기 is above the fold;
  - fix the "처음이에요" card alignment.
- Lobby bot-level chips 44 px high.
- An offline seat shows the word 끊김, not only a red dot.
- Small items: drawn ⚙ ✕ ← icons, 44 px close buttons, 런 찬스 contrast, the landscape result, settings alignment, compare-against-itself, and a confirmation before leaving mid-hand.

## Wave 6: code health, alongside

- One table each for bot levels and preset names.
- Split `Table.svelte` into the strip, the result sheet and the seats layer.
- Merge the overlapping game traits before a second game (P6).

## Later product ideas

- Tables for 4 and 6 players.
- A share sheet for the table link.
- Shareable house-rule links.

## Decided (owner, 2026-10-05)

- 경기과고: a joker led on trick 1 may name trump. Keep as coded and say so in RULES.md.
- 경기과고: 9 trumps plus the mighty may lead trump on trick 1. Keep as coded and say so in RULES.md.
- A leader may call for a joker they hold themselves (a bluff). Keep it legal; bots stop doing it by accident (`aim_joker_call`).
- 시간제한: 끔 / 20초 / 40초 / 60초, off by default.

## Waiting on the owner

1. Home default preset 기본 instead of 경기과고?
2. GitHub settings for wave 2.
