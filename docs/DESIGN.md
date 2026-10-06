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
  suit-heart: "#A3271F"
  suit-diamond: "#C2620A"
  suit-club: "#1D5FB0"
  team-declarer: "#E69F00"
  team-defense: "#3B4A6B"
  card-gold: "#A77A12"
  card-warm: "#FBF4E6"
  gold: "#A77A12"
  gold-text: "#7D5A09"
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
  card-warm-dark: "#EFE6D3"
  gold-dark: "#D9B04F"
  danger-dark: "#EF6B62"
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
  caption:
    fontFamily: "Pretendard Variable, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
  card-rank:
    fontFamily: "Wanted Sans Variable, Pretendard Variable, sans-serif"
    fontSize: "0.32em"
    fontWeight: 800
    lineHeight: 1
    fontFeature: "'tnum'"
rounded:
  mini: "6px"
  card: "8px"
  control: "12px"
  panel: "16px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "24px"
  "6": "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 16px"
    height: "44px"
  button-small:
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
    height: "36px"
    target: "44px"
  button-icon:
    rounded: "{rounded.pill}"
    size: "44px"
  chip:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
    height: "40px"
    target: "48px"
  chip-small:
    rounded: "{rounded.pill}"
    padding: "4px 12px"
    height: "34px"
    target: "44px"
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
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
  role-badge-defense:
    backgroundColor: "{colors.team-defense}"
    textColor: "{colors.on-accent}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
  sheet:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    width: "420px (menu 400px, rules and replay 560px)"
  popover:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    width: "content, at most 300px (a seat's choices 240px)"
---

# Design System: Mighty

The brief for every change to the web table. The values live in `web/src/app.css` (custom properties, each colour written once as `light-dark()`) and `web/src/lib/tokens.ts` (the same values for canvases, SVG fills and media queries in script; `tokens.test.ts` keeps the two in step). The primitives that use them are in `web/src/lib/ui/`. Research and decisions behind it: [Design References](https://claude.ai/code/artifact/d3f60eeb-449e-4306-a61d-58006d90ac72). Tokens, components and card art as a browsable system: [마이티 Design System](https://claude.ai/artifact/RZQ4Jsz4xRrLb4LwQsVBoF).

## Overview

**Creative North Star: "The Hanji Table"**

A game of Mighty played on warm paper. The table is a quiet off-white surface like hanji (한지); ink is near-black; the only bright objects are the cards, and the only loud moments are the ones the game earns: a card landing, a trick swept to its winner, the friend revealed, the hand scored. Korean in the words, not the ornaments: the game speaks Mighty's own vocabulary, and the look is cut paper, flat figures and jaju (자주) plum as the one accent. No stamps, seals or traditional patterns.

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
- **Jaju Plum** (#8E2F6B; dark #D27BB0): the accent. It marks exactly one thing: the player can act now. The name tag of the seat on turn, the ring on your tray on your turn, the primary button in the action strip. Focus rings, checkboxes and selection rings are ink, not plum. Its deep shade #6B2251 (dark #A2558A) is only the button lip.

### Neutral
- **Hanji** (#EFEBE3; dark #17191C): the table. Everything sits on it.
- **Panel** (#E6E1D6; dark #202327): the hand tray, sheets, the side panel. Recedes behind cards.
- **Line** (#D6CFC1; dark #2F343A): hairline dividers and input borders.
- **Ink** (#1C1915; dark #ECE7DD): text, and the spade suit.
- **Ink Muted** (#645D53; dark #9A958B): secondary text, seats not on turn. Passes 4.5:1 on Hanji and Panel.
- **Card** (#FBF8F2; dark #ECE6DA): card faces only. Brighter than any surface. In dark mode it is dimmed slightly so it does not glare.
- **Card Edge** (#D9D1C2; dark #CFC8BA): the 1px card border. On the light table the card is only 1.12:1 against Hanji, so the edge and contact shadow are what separate it, never omit them.

### Suits (card faces and trump markers only)
The four-colour deck is on by default; a setting switches diamonds and clubs back to red and ink.
- **Spade** (#1C1915), **Heart** (#A3271F), **Diamond** (#C2620A, orange: still reads as a red suit), **Club** (#1D5FB0, blue). Diamond passes 3.9:1 on Card (enough for the bold index), the others 4.5:1 or more. The heart is kept darker than the diamond (1.76:1 between them) so the two reds part by lightness, not only hue, for red-green colour-blind players. The suit glyph is always drawn, so colour is never the only cue.

### Teams (seat badges, result sheet)
Following the convention Korean Mighty players already know from MightyKorea:
- **Declarer side** (#E69F00): 주공 and 프렌드, once known. Ink text on it.
- **Defense** (#3B4A6B; dark #8FA3C9): 야당.
Badges always carry the word (주공, 프렌드, 야당); the colour is the second cue.

### Card gold
- **Card Gold** (#A77A12) and **Card Warm** (#FBF4E6; dark #EFE6D3): crowns, props and the 마이티's rule and warmer stock. Flat ochre, never metallic; it does not flip in dark mode because cards stay light.
- **Gold** (#A77A12; dark #D9B04F): the hand's one huge moment (the 런 word, earned awards). As small text on the paper (the 런 찬스 tag) it is **Gold Text** (#7D5A09), which reads at 4.5:1.

### On fixed surfaces
Card paper, the team colours and the reaction bubbles look the same in both themes, so what is written on them has fixed colours too: **Card Ink** (#1C1915) and **Card Ink Muted** (#645D53) on card paper, **On Team Declarer** (#1C1915) on the orange badge, and **Accent On Card** (#8E2F6B) for the plum word in the turn pill. A spade drawn on paper uses Card Ink; on the table it uses Ink.

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
- **Title** (600, 17px, 1.3): the contract on the top line, sub-headings.
- **Body** (400, 15px, 1.5; 600 on buttons and seat names): messages, settings, buttons, seat names.
- **Label** (600, 13px, 1.3, tabular): counters, notes, the event line on phones.
- **Caption** (600, 12px, 1.3): badges, small table headers.

Tokens: `--text-display`, `--text-headline`, `--text-title`, `--text-body`, `--text-label`, `--text-caption`.
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
- **Breakpoints.** Phone below 600px; tablet 600–1023px; desktop 1024px and up keeps the same stacked seat figures, larger (up to 80px), and puts your own seat at the tray's left and your tools at its right; from 1100px wide in landscape a 260–300px column with 상황판 and 점수판 replaces the top line.
- **Players remember, the table does not.** Seats show how many points each player has, never which cards; there is no log of the hand and no look back at the last round. Remembering what was played is part of the game.
- **Spacing.** A 4px base: 4, 8, 12, 16, 24, 32 (`--space-1` to `--space-6`). Page gutter 16px on phones.
- **Touch targets.** At least 44×44px. A control drawn smaller (a 36px small button, a 34px small chip, a 28px rule tag, a rules chip, the thrown-in hand's close) keeps a 44px target around it. Hand cards on phones are at least 56px wide: the exchange's fourteen cards on a 320px phone are drawn at 56–57px so they fit one row.
- **Short phones.** On a felt under 260px tall (an iPhone SE), the side seats step up under the top ones while bids or the exchange rise over the felt's foot; on every phone your tools move to the end of the top line while those controls are out.
- **Breakpoints in code.** `tokens.ts` (`BREAKPOINT`, `MEDIA`): 600, 1024 and 1100; stylesheets write the same numbers.
- **Layers.** `--z-felt` 0, `--z-seat` 2, `--z-seat-over` 5 (bubbles, callouts), `--z-controls` 7, `--z-status` 8, `--z-result` 9, `--z-banner` 15, `--z-menu` 30, `--z-popover` 40, `--z-toast` 50.

| Card size | Phone | Desktop |
| --- | --- | --- |
| Hand | 60–76px wide, as the screen allows a row of ten (56px for fourteen at 320px) | 88–124px (12% of the window's height) |
| Trick | 40–92px, from the room between the seats (100px on tablets) | up to 1.2 × the hand's |
| Mini (exchange, review) | 40 × 56px | 56 × 78px |

All cards are 5:7.

## Elevation & Depth

Flat. There are no blurred drop shadows. Depth comes from five devices only, and nothing else may be added:

1. **Tone.** Panel is one step darker than Hanji; Card is brighter than both.
2. **Contact shadow.** A hard, faint offset under cards: it says "object on a table".
3. **The lip.** A hard same-hue offset under pressable buttons and chips; pressing moves the button down onto it.
4. **Fade.** What is not in focus fades instead of gaining outlines: unplayable cards dim and sink 4px (desaturated, still opaque, so the hand never shows the table through it); seats not on turn use Ink Muted.
5. **Paper over the table.** A reaction bubble, the turn pill, a popover, the hint's answer: a 1px line and the hard lip (`--lip`, `0 3px 0` at 12% ink; 40% black in dark).

### Shadow Vocabulary
- **Card at rest** (`--shadow-card`: `0 2px 0 rgb(28 25 21 / 0.10)`; dark `0 2px 0 rgb(0 0 0 / 0.35)`): every card face and back.
- **Card raised** (`transform: translateY(-12px)`, `box-shadow: 0 6px 0 rgb(28 25 21 / 0.07)`): the first tap of tap-twice; hover on desktop lifts -6px.
- **Button lip** (`box-shadow: 0 3px 0 var(--accent-deep)`; secondary `0 3px 0 var(--line)`): pressed state `transform: translateY(3px); box-shadow: none`.
- **Turn ring** (`outline: 3px solid var(--accent); outline-offset: 3px`): your tray on your turn. Seats show the turn as a plum name tag instead.

### Named Rules
**The Flat-By-Default Rule.** Nothing floats. A shadow is always hard-edged and always means "object" or "pressable".

## Shapes

Rounded, friendly UI; crisp card faces.

- **Cards:** 8px radius (6px for mini cards), 1px Card Edge border (`--r-card`, `--r-mini`).
- **Buttons and inputs:** 12px radius (`--r-control`).
- **Chips and badges:** full pill (`--r-pill`).
- **Panels and sheets:** 16px on exposed corners (`--r-panel`).
- **Suit glyphs:** drawn as SVG paths, never emoji or font glyphs, so they look identical on every device. `SuitIcon` colours itself with its suit's ink; `SuitText` draws the suits in running text (공약 ♠ 15, "♣를 따라 내야 해요") the same way, and names them for screen readers.

## Components

### Primitives
`web/src/lib/ui/`: **Button** (primary, secondary, ghost, icon, danger; 44px, small 36px), **Chip** (a radio or a toggle; ink when chosen), **Segmented** (one strip of choices in a well, ink when chosen), **Switch** (a track that fills with ink, its words part of the target), **Sheet** (the native modal dialog: title, a scrolling body, a footer at the foot; 400, 420 or 560px), **Popover** (hung from its anchor, flipped and kept inside the visual viewport, closed by Escape, a tap outside or the back gesture), **Badge** (team, secret friend, count, outline, tag) and **Bubble** (a reaction). A bare `<button>` is unstyled; the looks are the `.btn` and `.chip` classes, so a link can wear them too.

### Card
- **Face.** Corner index top-left (rank above suit glyph), mirrored bottom-right. Pips, figures and the bottom index appear from 80px wide; below that a card shows its index and one large glyph.
- **Role cue.** Under the corner index, a small shape names the card's role (`CueIcon.svelte`): a crown for K, a tiara for Q, a cap and feather for J, a jester's hat for jokers, the ringed suit for the 마이티, a bell for the joker-call card. It is what you read in an overlapped hand, and small cards use it as their glyph. Number cards have none, so the specials stand out by shape.
- **Court figures.** J, Q and K are flat figures built from circles and triangles (`CourtArt.svelte`), robed in the suit colour; each suit has its own crown, tiara and hat, and the suit sits on the chest. Each rank has its own outline and prop: the king wide with a sceptre, the queen a bell holding a flower, the jack tall with a halberd; the king glances left, the jack right.
- **The 마이티.** Its suit inside a gold ring of rays under a small crown, on warmer stock (Card Warm) inside a thin gold rule.
- **Jokers.** Jesters with three bells, inside an ink rule. The two must differ three ways at once: ink colour (흑 ink / 홍 red), corner label (`흑` / `홍` under a star), and the rule (solid for 흑, dashed for 홍). Never rely on colour alone.
- **Back.** One geometric idea per back (`CardBack.svelte`), the same either way up, in one lighter tone over the ground inside a 3.5px inset rule: 숯 the spade both ways tip to tip, 자두 frames within frames (첫 승리), 쪽빛 a wall (철벽 야당), 금 twenty dots round a ring, one per point card (큰 그림), 먹 one corner-to-corner sweep (런), 옥 rings from two corners (마이티 중독). Neutral on purpose: plum is reserved for "act now".
- **States.** Rest; raised (first tap); playable vs unplayable (dimmed and sunk 4px, not tappable); won-trick highlight (accent outline for one beat); kitty tag (`키티` pill) during the exchange.

### Hand
Tap once to raise a card; tap it again, or swipe up, to play. Tapping elsewhere lowers it. A setting switches to single tap. Only the server's legal cards are tappable.

### Seat
Name (Title), a bot mark, a connection dot, the team badge once known, points won (Label, tabular), and a short reaction bubble. The seat to act gets a plum name tag (Plum ground, On Accent text); others use Ink Muted. Seats sit in the same place in every phase.

### Top display (상황판)
One line of Label/Title text on Hanji with no panel behind it. The contract number uses Display at phone size 22px.

### Action strip
No panel behind it, 64px tall in every phase so nothing above it moves; content by phase. The primary action is always a plum button with a lip at the right end; at most one plum button is visible at any time.

### Bid chips
A row of number chips (13–20, respecting the preset's minimum) and a row of suit chips (♠ ♦ ♥ ♣ 노기루다). Selected chips invert to Ink. The 패스 button is secondary.

### Result sheet
Headline (`여당 승리` / `야당 승리`), `여당 18 / 공약 15`, a table of player, role, points won, change and running total, then each multiplier on its own line. Buttons: 다음 판 (primary), 나가기.

### Event line
One transient line under the top display for what just happened (`철수 · 패스`, `영희 가져감 · 3점`); it is replaced by the next event and never kept as a log.

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
3. **Friend reveal.** The friend card pops, the seat turns over once, and the 프렌드 badge slides in; team badges appear on every seat.
4. **Hand result.** The headline rises in, numbers count up over 0.3–0.8s.

Everything else (deal, kitty pickup, discards, hand re-sort) is quick and plain.

### Rules
- One source: `data-motion` on the root (`full`, `reduced` or `off`), set from the speed setting and the system's reduced motion (`settings.svelte.ts`); script reads the same `motion.level`. Components write their reduced fallbacks against the attribute, never the media query.
- Animations play from a queue derived from successive server states (`table/animator.svelte.ts`); if the queue falls more than three steps behind, jump straight to the latest state.
- No animation on connect or reconnect.
- `prefers-reduced-motion` and the in-game speed setting (보통 / 빠르게 / 끄기, multipliers 1, 0.5, 0) are both honoured. Reduced motion keeps fades and highlights and drops movement: entrances fade in place, swells stop, and transitions keep only colour and opacity.
- Keyframes move `translate`, `scale` and `opacity` (never layout, never `transform` where it would fight a positioning one). A changed value swells with the one `pulse` keyframe (`--pulse` sets how far).
- No screen shake, no particles, no idle wobble.

## Moments

Every event has one of four tiers, so loudness always means the same thing. The research behind this is in the [마이티 Moments](https://claude.ai/artifact/CJB4D1raoYrYSzLXygrF1p) page.

| Tier | Events | Treatment |
| --- | --- | --- |
| 0 · routine | Card played, pass | Card motion and a paper sound. |
| 1 · notable | Bid raised, points taken, trump cuts a round, tags (공약 확정·불가, 런 찬스, 마지막 라운드) | A label or tag, a rising note; trump cuts land with a thump. |
| 2 · big | 주공, 프렌드 revealed, 마이티, 조커, 조커콜, 딜미스 | The seat wiggles (squash and fading wobble, 0.4 s) and a short ink label pops in under it for 1.5 s, with its own motif; no label where a badge already says it (주공, 프렌드); the friend's plate turns over; the 마이티 and jokers land heavy with a 110 ms hold and a fading outline. |
| 3 · huge | The result; 런 | The result is counted out step by step; 런 turns the headline into one large gold word with a 2 px table nudge. At most once per hand. |

- **Never block play.** Labels, tags and holds run over the table; a tap skips the counted result.
- **At the seat.** Calls appear where they were made, so everyone sees who.
- **Ink, not particles.** No screen shake below tier 3; no voice lines.
- **Motion off or reduced** shows the same labels and results without movement.

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

## Art rules

Every drawing in the game, from court figures to icons and card backs, follows these.

1. **The paper test.** It could be cut from flat coloured paper: no gradients, glows, bevels, metallic sheen, particles or blur.
2. **Shapes.** Circles, triangles, bells, rounded rectangles and soft curves. A figure is at most two shapes for the head and hat and three for the body, plus one prop.
3. **Tones.** At most four per figure: the suit ink (currentColor), Card Gold, skin #F3E3CF and the card paper. Seat figures wear their team colour in place of the suit ink.
4. **Eyes.** Always two dots, r 2.3 on a head of r 18–20, 14 apart (seat figures, drawn far smaller, use r 3 in a fixed dark ink so they still read). Expression comes only from where they look, a lid (a squash) and at most one mouth arc. No pupils, brows or blush.
5. **Stroke.** Shapes are fills; only round heads are outlined (3 units at 120×160). Thin things that are lines in life (a sceptre, a halberd's shaft, a stem, the 마이티's rays and ring) may be drawn as round-capped strokes.
6. **Status by form.** A special card or role is shown by its frame, edge or shape, never by a stamp or a Hangul character in a box.
7. **Backs** carry one geometric idea, read the same either way up, use one tone over the ground and keep the inset rule.
8. **Motion.** Transform and opacity only; figures live by blinking, glancing and hopping. Everything respects reduced motion.
9. **No emoji in the interface chrome.** Icons are drawn in the same language.
10. **The squint test.** At 40px and blurred, rank and suit can still be named.
11. **Restraint.** Before adding something, remove something.

## Do's and Don'ts

**Do**
- Use the Korean Mighty terms: 주공 (the declarer), 여당 (declarer and friend), 프렌드, 야당, 기루다, 노기루다, 공약, 라운드 (not 트릭), 첫/마지막 라운드, 마이티, 조커, 조커콜.
- Keep the cards the brightest objects, in both themes.
- Pair every colour with a glyph, a word or a shape.
- Check every change on a 375px phone and a desktop, in light and dark mode, and lay the phase screenshots side by side.
- Ask "can this be simpler?" before adding any element to the table.

**Don't**
- Use green felt, gold-on-black, wood, leather, gradients, glass, or blurred shadows.
- Use stamps, seals, traditional Korean patterns, foil or holo sheens: the casino and "Korean game" look.
- Use plum for anything except "you can act now".
- Show more than one primary button at a time.
- Use dropdowns or modal dialogs for bids, exchange or friend calls.
- Mix English into the interface.
- Animate layout properties, or animate anything that the game state did not change.
