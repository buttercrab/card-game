---
name: Mighty
description: A quiet paper table for Korean Mighty with friends; cards are the brightest thing on screen.
colors:
  table: "#EFEBE3"
  panel: "#E6E1D6"
  line: "#D6CFC1"
  ink: "#1C1915"
  ink-muted: "#645D53"
  card: "#FBF8F2"
  card-edge: "#D9D1C2"
  accent: "#8E2F6B"
  accent-deep: "#6B2251"
  on-accent: "#FFFFFF"
  suit-spade: "#1C1915"
  suit-heart: "#B8342A"
  suit-diamond: "#C2620A"
  suit-club: "#1D5FB0"
  team-declarer: "#E69F00"
  team-defense: "#3B4A6B"
  seal: "#C23B22"
  danger: "#B3261E"
  table-dark: "#17191C"
  panel-dark: "#202327"
  line-dark: "#2F343A"
  ink-dark: "#ECE7DD"
  ink-muted-dark: "#9A958B"
  card-dark: "#ECE6DA"
  card-edge-dark: "#CFC8BA"
  accent-dark: "#D27BB0"
  accent-deep-dark: "#A2558A"
  on-accent-dark: "#17191C"
  team-defense-dark: "#8FA3C9"
typography:
  display:
    fontFamily: "Wanted Sans Variable, Pretendard Variable, sans-serif"
    fontSize: "32px"
    fontWeight: 800
    lineHeight: 1.1
    fontFeature: "'tnum'"
  headline:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.25
  title:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.3
    fontFeature: "'tnum'"
  card-rank:
    fontFamily: "Wanted Sans Variable, Pretendard Variable, sans-serif"
    fontSize: "0.32em"
    fontWeight: 800
    lineHeight: 1
    fontFeature: "'tnum'"
rounded:
  seal: "2px"
  card: "8px"
  control: "12px"
  panel: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.title}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.control}"
    padding: "12px 20px"
    height: "48px"
  chip:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
    height: "40px"
  chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.card}"
    rounded: "{rounded.pill}"
  card-face:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
  action-strip:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    padding: "8px 12px"
    height: "64px"
  role-badge-declarer:
    backgroundColor: "{colors.team-declarer}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
  role-badge-defense:
    backgroundColor: "{colors.team-defense}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
---

# Design System: Mighty

The brief for every change to the web table. Research and decisions behind it: [Design References](https://claude.ai/code/artifact/d3f60eeb-449e-4306-a61d-58006d90ac72).

## Overview

**Creative North Star: "The Hanji Table"**

A game of Mighty played on warm paper. The table is a quiet off-white surface like hanji (한지); ink is near-black; the only bright objects are the cards, and the only loud moments are the ones the game earns: a card landing, a trick swept to its winner, the friend revealed, the hand scored. Korean flavour arrives as small, exact details, not as a theme: a seal stamp (낙관) on the special cards, a chilbo (칠보) pattern on the card back, jaju (자주) plum as the one accent.

The table is a tool first. Five friends glance at a phone between jokes; everything they need (whose turn, what the contract is, who the friend might be, how many points the declarer has) must read in under a second. Premium comes from removing things, then letting motion and sound do the work that detail would have done.

**Key characteristics:**
- Flat surfaces in a few tones; depth only from hard, faint offset shadows.
- Cards are the brightest, highest-contrast objects on screen, in both themes.
- One accent colour with one meaning: "you can act now".
- Every colour means one thing, and always comes with a shape or a label.
- Motion is calm by default and generous at four moments.
- Korean only, in the words Mighty players use.

**Rejected:** green felt, casino gold, skeuomorphic wood and leather, full hanok or dancheong skins, purple gradients, glassmorphism, neumorphism, glow on everything.

## Colors

A warm paper neutral, near-black ink, four suit inks, two team colours, and a single plum accent.

### Primary
- **Jaju Plum** (#8E2F6B; dark #D27BB0): the accent. It marks exactly one thing: the player can act now. The "your turn" ring on your seat and tray, the primary button in the action strip, the focus ring. Its deep shade #6B2251 (dark #A2558A) is only the button lip.

### Neutral
- **Hanji** (#EFEBE3; dark #17191C): the table. Everything sits on it.
- **Panel** (#E6E1D6; dark #202327): the hand tray, the action strip, sheets. Recedes behind cards.
- **Line** (#D6CFC1; dark #2F343A): hairline dividers and input borders.
- **Ink** (#1C1915; dark #ECE7DD): text, and the spade suit.
- **Ink Muted** (#645D53; dark #9A958B): secondary text, seats not on turn. Passes 4.5:1 on Hanji and Panel.
- **Card** (#FBF8F2; dark #ECE6DA): card faces only. Brighter than any surface. In dark mode it is dimmed slightly so it does not glare.
- **Card Edge** (#D9D1C2; dark #CFC8BA): the 1px card border. On the light table the card is only 1.12:1 against Hanji, so the edge and contact shadow are what separate it, never omit them.

### Suits (card faces and trump markers only)
The four-colour deck is on by default; a setting switches diamonds and clubs back to red and ink.
- **Spade** (#1C1915), **Heart** (#B8342A), **Diamond** (#C2620A, orange: still reads as a red suit), **Club** (#1D5FB0, blue). Diamond passes 3.9:1 on Card (enough for the bold index), the others 4.5:1 or more. The suit glyph is always drawn, so colour is never the only cue.

### Teams (seat badges, result sheet)
Following the convention Korean Mighty players already know from MightyKorea:
- **Declarer side** (#E69F00): 주공 and 프렌드, once known. Ink text on it.
- **Defense** (#3B4A6B; dark #8FA3C9): 야당.
Badges always carry the word (주공, 프렌드, 야당); the colour is the second cue.

### Seal
- **Seal Red** (#C23B22): the stamp on the mighty, the jokers and the joker-call cards. It is always a small square with a Hangul character inside, which keeps it distinct from the heart suit.

### Named Rules
**The One Meaning Rule.** Each colour means one thing. Plum means "act now"; suit inks mean suits; team colours mean teams. No colour is ever used for decoration.

**The Brightest Card Rule.** No surface may be lighter than Card, in either theme. If a panel competes with the cards, darken the panel.

## Typography

**Body font:** Pretendard Variable (dynamic subset, self-hosted from the `pretendard` npm package), falling back to `Apple SD Gothic Neo, Noto Sans KR, sans-serif`.
**Display font:** Wanted Sans Variable (`wanted-sans` npm package), for card ranks, bids, scores and result headlines only.

**Character:** Pretendard is the familiar, neutral Korean UI voice; Wanted Sans, heavy and tabular, gives numbers and ranks a confident, game-like presence.

### Hierarchy
- **Display** (800, 32px, 1.1, tabular): result headline (주공 승리), the big contract number.
- **Headline** (700, 22px, 1.25): sheet titles.
- **Title** (600, 17px, 1.3): buttons, seat names, top-display values.
- **Body** (400, 15px, 1.5): messages, settings, the event log.
- **Label** (600, 13px, 1.3, tabular): badges, counters, captions.
- **Card rank** (Wanted Sans 800, 32% of card width, tabular): the card index. Never below 16px. "10" uses tightened tracking so it is no wider than other ranks.

### Named Rules
**The Korean Line Rule.** Set `word-break: keep-all` on all Korean text; never letter-space Hangul; no uppercase styling anywhere.

**The Tabular Numbers Rule.** Every number that changes during play (points, bids, trick count, scores) uses tabular figures so it never jitters.

## Layout

Phone portrait is the primary layout; desktop is the same table with more room.

- **Seats.** You sit at the bottom. The four others sit at top-left, top-right, mid-left and mid-right, the positions Korean Mighty players know. Each played card lands between its owner and the centre, not in a shared pile.
- **Top display (상황판).** Top centre, one line: `공약 15 ♠` · `프렌드 ♠A` or `?` · `라운드 4/10` · `여당 10/15`.
- **Action strip.** One fixed 64px slot between the table and the hand. Its content changes by phase: bid chips and 패스; the exchange counter `3장 선택` with 기루다 변경; friend shortcuts; `내 차례` hints during play. No dropdowns, no modals except the result sheet and settings.
- **Hand tray.** Docked at the bottom, about 30% of the viewport height on phones including the strip. One flat row of 10 cards, overlapping so each corner index stays visible; the declarer's 13 cards wrap to two rows. Sorted by suit with trump first.
- **Breakpoints.** Phone below 600px; tablet 600–1023px; desktop 1024px and up adds a 300px side column for the event log, spectators and running scores.
- **Spacing.** A 4px base: 4, 8, 12, 16, 24, 32. Page gutter 16px on phones.
- **Touch targets.** At least 44×44px; hand cards on phones are at least 56px wide.

| Card size | Phone | Desktop |
| --- | --- | --- |
| Hand | 60 × 84px | 88 × 123px |
| Trick | 48 × 67px | 72 × 101px |
| Mini (exchange, review) | 40 × 56px | 56 × 78px |

All cards are 5:7.

## Elevation & Depth

Flat. There are no blurred drop shadows. Depth comes from four devices only, and nothing else may be added:

1. **Tone.** Panel is one step darker than Hanji; Card is brighter than both.
2. **Contact shadow.** A hard, faint offset under cards: it says "object on a table".
3. **The lip.** A hard same-hue offset under pressable buttons and chips; pressing moves the button down onto it.
4. **Fade.** What is not in focus fades instead of gaining outlines: unplayable cards drop to 40% opacity; seats not on turn use Ink Muted.

### Shadow Vocabulary
- **Card at rest** (`box-shadow: 0 2px 0 rgb(28 25 21 / 0.10)`; dark `0 2px 0 rgb(0 0 0 / 0.35)`): every card face and back.
- **Card raised** (`transform: translateY(-12px)`, `box-shadow: 0 6px 0 rgb(28 25 21 / 0.07)`): the first tap of tap-twice; hover on desktop lifts -6px.
- **Button lip** (`box-shadow: 0 3px 0 var(--accent-deep)`; secondary `0 3px 0 var(--line)`): pressed state `transform: translateY(3px); box-shadow: none`.
- **Turn ring** (`outline: 3px solid var(--accent); outline-offset: 3px`): your seat and tray on your turn.

### Named Rules
**The Flat-By-Default Rule.** Nothing floats. A shadow is always hard-edged and always means "object" or "pressable".

## Shapes

Rounded, friendly UI; crisp card faces.

- **Cards:** 8px radius (6px for mini cards), 1px Card Edge border.
- **Buttons and inputs:** 12px radius.
- **Chips and badges:** full pill.
- **Panels and sheets:** 16px on exposed corners.
- **Seal stamps:** square, 2px radius, the only sharp shape.
- **Suit glyphs:** drawn as SVG paths, never emoji or font glyphs, so they look identical on every device.

## Components

### Card
- **Face.** Corner index top-left (rank above suit glyph), mirrored bottom-right. Number cards show pips only at desktop hand size and above; J, Q, K show a large letter and no portrait. At phone sizes only the index is drawn.
- **Jokers.** Two must differ three ways at once: ink colour (흑 ink / 홍 red), corner label (`흑` / `홍` under a star), and centre motif. Never rely on colour alone.
- **Seal stamps.** Top-right square seal: `마` on the mighty, `조` on each joker, `콜` on the joker-call cards, for the current rules and trump.
- **Back.** Charcoal ink (#2A2622) with a fine chilbo (interlocking circles) pattern in Card Edge lines, drawn in CSS or a small SVG. Neutral on purpose: plum is reserved for "act now".
- **States.** Rest; raised (first tap); playable vs unplayable (40% opacity, not tappable); won-trick highlight (accent outline for one beat); kitty tag (`키티` pill) during the exchange.

### Hand
Tap once to raise a card; tap it again, or swipe up, to play. Tapping elsewhere lowers it. A setting switches to single tap. Only the server's legal cards are tappable.

### Seat
Name (Title), a bot mark, a connection dot, the team badge once known, points won (Label, tabular), and a short reaction bubble. The player to act gets the turn ring; others use Ink Muted.

### Top display (상황판)
One line of Label/Title text on Hanji with no panel behind it. The contract number uses Display at phone size 22px.

### Action strip
Panel background, 64px tall, content by phase. The primary action is always a plum button with a lip at the right end; at most one plum button is visible at any time.

### Bid chips
A row of number chips (13–20, respecting the preset's minimum) and a row of suit chips (♠ ♦ ♥ ♣ 노기루다). Selected chips invert to Ink. The 패스 button is secondary.

### Result sheet
Headline (`여당 승리` / `야당 승리`), `여당 18 / 공약 15`, a table of player, role, points won, change and running total, then each multiplier on its own line. Buttons: 다음 판 (primary), 나가기.

### Event log
Desktop side column, or a two-line ticker under the top display on phones: `철수 · 패스`, `영희 · 공약 ♠ 14`.

## Motion

Motion explains what happened; it is never decoration. All movement is `transform` and `opacity` only.

### Tokens
| Token | Value | Use |
| --- | --- | --- |
| `--dur-quick` | 120ms | hover, press, raise |
| `--dur-move` | 220ms | your card to the trick |
| `--dur-travel` | 320ms | another seat's card to the trick |
| `--dur-sweep` | 400ms | trick to winner, kitty to hand |
| `--dur-reveal` | 600ms | friend reveal, result headline |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | most moves |
| `--ease-settle` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | a card landing |
| `--stagger` | 40ms | groups of cards |

### The four moments
1. **Card play.** Your card starts on tap (within 100ms), flies to its slot and settles with a small overshoot and a resting angle of ±3°. Others' cards fly from their seat and turn face-up mid-flight.
2. **Trick sweep** (the hero moment). A 150ms pause, a short pop on the winning card, then the five cards slide to the winner's seat with a stagger while the points counter ticks up. About 800ms in total.
3. **Friend reveal.** The friend card pops, a plum ring pulses once on the seat, and the 프렌드 badge slides in; team badges appear on every seat.
4. **Hand result.** The headline rises in, numbers count up over 0.3–0.8s.

Everything else (deal, kitty pickup, discards, hand re-sort) is quick and plain.

### Rules
- Animations play from a queue derived from successive server states; if the queue falls more than three steps behind, or the tab was hidden, jump straight to the latest state.
- No animation on connect or reconnect.
- `prefers-reduced-motion` and the in-game speed setting (보통 / 빠르게 / 끄기, multipliers 1, 0.5, 0) are both honoured. Reduced motion keeps fades and highlights and drops movement.
- No screen shake, no particles, no idle wobble.

## Moments

Every event has one of four tiers, so loudness always means the same thing. The research behind this is in the [마이티 Moments](https://claude.ai/artifact/CJB4D1raoYrYSzLXygrF1p) page.

| Tier | Events | Treatment |
| --- | --- | --- |
| 0 · routine | Card played, pass | Card motion and a paper sound. |
| 1 · notable | Bid raised, points taken, trump cuts a round, tags (공약 확정·불가, 런 찬스, 마지막 라운드) | A label or tag, a rising note; trump cuts land with a thump. |
| 2 · big | 주공, 프렌드 revealed, 마이티, 조커, 조커콜, 딜미스 | A red ink seal (도장) stamped at the seat for 1.5 s, with its own motif; the 마이티 and jokers also land heavy with a 110 ms hold. |
| 3 · huge | The result; 런 | The result is counted out step by step; 런 gets the gold seal and a 2 px table nudge. At most once per hand. |

- **Never block play.** Seals, tags and holds run over the table; a tap skips the counted result.
- **At the seat.** Calls appear where they were made, so everyone sees who.
- **Ink, not particles.** No screen shake below tier 3; no voice lines.
- **Motion off or reduced** shows the same seals and results without movement.

## Sound

Sound supplies the tactile feel that flat visuals lack. On by default at 70% volume, with a mute toggle always one tap away. Web Audio, one context unlocked on the first tap; on iOS the silent switch mutes it, which is accepted.

| Cue | When | Character |
| --- | --- | --- |
| Card tick | any card lands in the trick | short paper snap, pitch varies slightly per card |
| Point notes | each point card in a swept trick | soft rising notes, one per point card |
| Sweep | trick slides to the winner | card slide |
| Your turn | your turn begins | gentle two-note chime, never repeated |
| Friend | friend revealed | short flourish, the loudest cue |
| Bid | a bid or pass is made | soft click |
| Result | hand ends | win and lose variants, under 1.5s |

The first pass synthesises every cue with Web Audio (`web/src/lib/sound.ts`): filtered noise for paper sounds, a major pentatonic scale for notes. Nothing to download or license. Recorded CC0 packs (Kenney Casino Audio and Interface Sounds, BMacZero playing-card sounds) can replace individual cues later within a 200KB budget.

## Do's and Don'ts

**Do**
- Use the Korean Mighty terms: 주공 (the declarer), 여당 (declarer and friend), 프렌드, 야당, 기루다, 노기루다, 공약, 라운드 (not 트릭), 첫/마지막 라운드, 마이티, 조커, 조커콜.
- Keep the cards the brightest objects, in both themes.
- Pair every colour with a glyph, a word or a shape.
- Check every change on a 375px phone and a desktop, in light and dark mode, and lay the phase screenshots side by side.
- Ask "can this be simpler?" before adding any element to the table.

**Don't**
- Use green felt, gold-on-black, wood, leather, gradients, glass, or blurred shadows.
- Use plum for anything except "you can act now".
- Show more than one primary button at a time.
- Use dropdowns or modal dialogs for bids, exchange or friend calls.
- Mix English into the interface.
- Animate layout properties, or animate anything that the game state did not change.
