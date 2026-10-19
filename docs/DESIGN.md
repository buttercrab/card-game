# Design system

The implemented visual language of the Mighty table, updated 2026-10-07.
This is a contributor contract: what each element means, which primitive to
use, and how to verify a change. It describes current behavior separately
from remaining gaps in [FIXES.md](FIXES.md).

## Intent

A quiet paper table for Korean Mighty with friends. Warm neutral surfaces,
near-black ink, flat figures and original cards. The cards are the brightest
objects; color, motion and sound explain the game.

- Read whose turn, contract, friend status and points at a glance.
- Keep players in stable seats throughout the hand.
- Use Korean game vocabulary; avoid decorative stamps and traditional motifs.
- Prefer nearby labels, card/seat movement and tactile sounds over overlays.
- Preserve clarity on a short phone, with dark mode and motion disabled.

Green casino felt, metallic decoration, glass panels, blurred shadows,
particles and continuous idle movement are outside this visual language.
A functional scroll fade may show that more content exists; this is not a
decorative gradient skin.

## Engine migration: preserve the approved UI

The engine rewrite is not a redesign. The user reaffirmed this on 2026-10-18;
the following decisions were checked against their original chat messages:

- 2026-10-04: show scores rather than collected point-card faces, remove the
  live previous-round panel and live recall record. The user said players
  should remember the hand themselves. Keep completed-hand review on the
  original result/replay surfaces; do not restore live history fans.
- 2026-10-08: make the existing game “smoother, better UX, but not much.”
- 2026-10-10: the engine must enforce the existing design system, including
  consistent buttons. Use the established primitives and tokens.
- 2026-10-11: selected cards retain their original stacking order. Lift a card
  without bringing it above later cards in the fan.
- 2026-10-17: the foundation proof must return to the original finished
  appearance, and card travel follows a straight path.

Use the preserved Mighty renderer as the concrete composition reference:
[Seat.svelte](../web/src/lib/games/mighty/Seat.svelte),
[Tray.svelte](../web/src/lib/games/mighty/table/Tray.svelte),
[Strip.svelte](../web/src/lib/games/mighty/table/Strip.svelte) and
[Table.svelte](../web/src/lib/games/mighty/Table.svelte). Compare equivalent
phase, role, viewport, theme, text scale and content. A foundation screenshot
rejected by the user is not an approved reference.

Reference provenance matters: `foundation=0` is not automatically an approved
golden. That retained renderer also contains later migration additions. For
example, the untracked `FinishedHands.svelte` default result matrix is absent
from tracked `6bfc032`; the tracked table uses the compact `ResultSheet` and
secondary `HandReplay`. Preserve that original composition unless a later
direct human decision changes it. Inspect the tracked baseline and the actual
user decision before adopting a feature from the dirty retained renderer.

Keep character/name/role grouping, stable peer seats, original card artwork,
fan layering, contextual Play guidance and existing single/repeat activation
preferences. The local character moves from the room's bottom center to the
hand area during play and returns to center after the game; a local turn
change must not reposition other players. The user removed the character's
ready indicator, not the multiplayer readiness mechanism.

Keep completed-hand review scoped to the current hand. The original room menu
does not expose an archive browser or a duplicate device-record browser. Home
and its StatsSheet retain the existing device statistics and clear-record flow;
previous room records remain internal. Public data alone does not authorize a
new menu entry.

Do not add visible card-back ports, count labels, permanent
confirmation rows or new panels merely to simplify engine geometry. Internal
landmarks grant no extra action authority and need no visible chrome.

Keep allocation separate from visible contents. The tracked original
`Hand.svelte` at `6bfc032` explicitly keeps one row of space even when the hand
is empty, so the table above does not move. An empty hand is not permission to
collapse its allocation, insert a visible placeholder or recover an old DOM
rectangle for animation. The current compositor must own the available space.

Original renderer defects are not required behavior: preserve the design
while correcting clipping, unreadable text, inaccessible controls and
unintended overlap through shared engine policies. Geometry or unit tests
alone cannot approve a visual change; follow [QA_PROCESS.md](QA_PROCESS.md).

Decision provenance: human-origin queued messages at 2026-10-04
06:22:44Z and 06:24:11Z in Claude session
`2997793b-229e-4507-a689-298ec4fb7262`; user messages in Codex chats
`01a11c0a-546f-7192-b8cf-21cba0471bc5` (October 8–11) and
`01a13398-d647-7ca2-bffd-5628d07d91ce` (October 17–18).

## Implementation owners

| Responsibility | Canonical source |
| --- | --- |
| CSS tokens, theme surfaces, primitive appearance, motion fallbacks | [app.css](../web/src/app.css) |
| Colors for canvas/SVG/swatches and script breakpoints | [tokens.ts](../web/src/lib/tokens.ts) |
| CSS/script palette agreement | [tokens.test.ts](../web/src/lib/tokens.test.ts) |
| Player preferences and effective motion mode | [settings.svelte.ts](../web/src/lib/settings.svelte.ts) |
| Motion helpers and non-blocking completion | [motion.ts](../web/src/lib/motion.ts) |
| Overlay dismissal order | [layers.ts](../web/src/lib/layers.ts) |
| Controls and surfaces | [ui/](../web/src/lib/ui) |
| Mighty content, cards and animation sequencing | [games/mighty/](../web/src/lib/games/mighty) |
| Lazily initialized cues / optional recorded music | [sound.ts](../web/src/lib/sound.ts), [music.svelte.ts](../web/src/lib/music.svelte.ts) |

CSS owns appearance, palette and native text/art rendering. The shared numeric
engine owns playing-screen regions and logical HUD placement. Palette mirrors
in script cover only values needed outside CSS; tests guard that duplication. This document is not another machine-readable
palette. Change tokens and their mirror together; document the semantic reason.

## Color semantics

| Tokens | Meaning and pairing |
| --- | --- |
| `--table`, `--panel`, `--line` | Quiet background, supporting surfaces and boundaries |
| `--ink`, `--ink-muted` | Main and secondary text on theme-aware surfaces |
| `--card`, `--card-edge`, `--card-warm` | Light card paper and its edge; warm stock for Mighty |
| `--card-ink`, `--card-ink-muted` | Fixed dark text on light card paper, including bubbles |
| `--accent`, `--on-accent`, `--accent-deep` | Plum, its readable text and button lip: a prompt to act |
| `--accent-on-card` | Light-theme plum when the background stays card paper |
| `--suit-*` | Spade ink, heart red, diamond orange, club blue |
| `--team-declarer`, `--on-team-declarer` | Orange declarer/friend badge and fixed ink text |
| `--team-defense`, `--on-team-defense` | Defense badge and its theme-aware text |
| `--danger` | Destructive action, refusal or negative amount with words |
| `--card-gold`, `--gold`, `--gold-text` | Card-art ochre, earned result emphasis and readable small gold text |
| `--raised`, `--raised-line`, `--field`, `--btn`, `--btn-lip`, `--off` | Surface-specific control/overlay pairings |

**Plum asks for action.** Selected choices, focus rings and the winning card's
news highlight use ink. A future accent-colored tag must have an action
meaning; an existing `tone="accent"` prop is not permission to decorate.

**Use matching foregrounds.** Theme ink turns light in dark mode; putting it
on a card-paper bubble makes the text disappear. Fixed card/team surfaces
need their fixed foregrounds. Card-art suit colors stay fixed in both themes.

**Color is a second cue.** Suits are drawn SVG shapes; teams carry role words;
jokers differ by color, label and border. The four-color deck is default;
two-color mode makes diamonds red and clubs ink. Never use emoji/font suits
as the sole rendering of a game card.

Themes follow system color scheme. `data-theme` is used for explicit preview
surfaces; the token block is redeclared there so `light-dark()` resolves in
the correct scope. Earned table tones/card backs override their own tokens;
they do not change the meaning of action, team or suit colors.

## Type, spacing and depth

Pretendard Variable is the UI face. Wanted Sans Variable is for ranks,
contracts, scores and result numbers. Both are packaged locally.

| Role | Token | Base size |
| --- | --- | --- |
| Display | `--text-display` | 32px |
| Headline | `--text-headline` | 22px |
| Title | `--text-title` | 17px |
| Body | `--text-body` | 15px |
| Label | `--text-label` | 13px |
| Caption | `--text-caption` | 12px |

These are base roles, not a guarantee every element uses that size. Small
cards and badges have measured local sizes. Changing numbers use tabular
figures. Korean copy uses `word-break: keep-all`; do not letter-space Hangul.
Inputs remain at least 16px to avoid focus zoom on iOS.

Spacing tokens `--space-1…6` are 4, 8, 12, 16, 24, 32px. Radius tokens are
mini 6px, card 8px, control 12px, panel 16px and pill 999px. Choose a semantic
role rather than adding a nearby arbitrary value.

Depth comes from surface tone, a border, and hard offsets:
`--shadow-card`, `--shadow-raised`, `--lip` and the button lip.
Cards remain opaque when dimmed. Do not introduce blurred elevation or make
a background panel compete with the cards.

## Choose a primitive

Imports below are relative to `web/src/lib`; adapt the path to the caller.

| Primitive | Use | Contract |
| --- | --- | --- |
| [Button](../web/src/lib/ui/Button.svelte) | Command | `variant`: primary/secondary/ghost/icon/danger; `size`: md/sm; HTML button attributes; optional `element` binding |
| [Chip](../web/src/lib/ui/Chip.svelte) | Compact choice | `checked` gives radio semantics; `pressed` gives toggle semantics; omit both for a command; md/sm |
| [Segmented](../web/src/lib/ui/Segmented.svelte) | One choice in a group | Typed `options`, `value`, `onchange`, required `label`; `stack` for long choices; arrow keys select/focus |
| [Switch](../web/src/lib/ui/Switch.svelte) | Boolean preference | Bind `checked` or supply `onchange`; visible children or accessible `label`; optional state `word` |
| [Sheet](../web/src/lib/ui/Sheet.svelte) | Focused task/dialog | Required `onclose`; title or label; small/normal/large (400/420/560px before viewport clamp); optional head/footer snippets |
| [Popover](../web/src/lib/ui/Popover.svelte) | Choices near an anchor | `anchor: () => DOMRect`, `onclose`, optional trigger, side/align/modal/role/label/autofocus/width |
| [Badge](../web/src/lib/ui/Badge.svelte) | Noninteractive role/count/status | Team or secret friend; count/outline/tag kinds; label/tone/size; never substitute for a button |
| [FeedbackDock](../web/src/lib/ui/FeedbackDock.svelte) | Player feedback | Owns priority and reserved slot geometry for reactions, events, points and bids |
| [Bubble](../web/src/lib/ui/Bubble.svelte) | Feedback appearance | Card-paper foreground, shape and entry animation inside FeedbackDock |

A bare button is reset, not a fully styled control. Use Button/Chip unless a
component truly needs its own game object. Links may use `.btn` when they
navigate. Do not make a span look clickable without button/link semantics.

Use one prominent primary action in a decision region. Secondary commands
use neutral surfaces. An icon-only command needs an accessible name;
disabled primary actions become neutral.

For migration comparisons, the original Mighty bid strip at base text scale
uses 6px gaps between chip bodies and 8px gaps between action bodies. Secondary
actions have an 88px minimum; the wide primary action has a 180px minimum,
while the phone primary fills the remaining action row. These are the bid
recipe's rules, not universal minimums for every button. Reserve focus, pulse
and lip paint around the composed strip without adding those insets again
between button bodies. Overlapping transparent paint bounds alone do not prove
an obstruction; verify actual captions, hit targets, clipping and moving art.

```svelte
<script lang="ts">
  import Button from './ui/Button.svelte';
  import Segmented from './ui/Segmented.svelte';
  import Switch from './ui/Switch.svelte';

  let limit = $state(0);
  let enabled = $state(false);
  const limits = [
    { value: 0, label: '끔' },
    { value: 20, label: '20초' },
    { value: 40, label: '40초' },
    { value: 60, label: '60초' },
  ];
  function apply() {
    // Send the chosen setting through the room client.
  }
</script>

<Segmented options={limits} value={limit} label="턴 시간"
  onchange={(value) => limit = value} />
<Switch bind:checked={enabled}>효과음</Switch>
<Button variant="primary" onclick={apply}>적용</Button>
```

This illustrates component APIs, not a second implementation of room settings.
Production commands still go through the client and server's typed protocol.

## Overlays and navigation

Sheet mounts a native modal dialog; Escape/browser back closes it and
`onclose` must remove it from state. Use `focus="title"` for content-first
sheets. Supply the heading id when replacing the head snippet.

Popover waits for placement and field bindings before focusing, and returns
focus to the connected opener on Escape/back unless another control took it.
It portals to the body so transformed/contained ancestors do not change
its fixed-position reference. It flips/clamps within the visual viewport,
including the space left above a phone keyboard. Use its anchor/trigger APIs;
do not duplicate placement and outside-click handlers in callers.

`layers.ts` closes the topmost dialog before registered popovers. At the
table, back closes a layer or opens the menu; explicit 나가기 leaves.
The table remains visible between hands. Folding a result hides only its
details; player positions, viewer orientation, badges, scoreboard ordering,
and the action footer stay fixed. Lobby layout begins when the old hand is
cleared, not when its results are folded.

Native Sheets mount in the document layer before opening, so a newly created
modal is independent of conditional or animated game fragments.

Modal Sheet behavior does not imply that Popover provides a native modal focus
trap. Verify focus return/order for the actual caller; do not claim blanket
accessibility compliance from using a primitive.

## Finished-hand replay

The result panel fits its content, with a 400px desktop width limit. Its body
scrolls only when the available height requires it; short landscape uses the
whole table area.

Opening replay retains a snapshot of the completed hand: tricks, discards,
player names, viewer permissions, and the rules used to mark cards. A new deal
or seat shuffle on the live table must not close replay or rename its players.
Replay frames match completed deal data across copied views and proxies,
not JavaScript object identity. Only closing replay or leaving the room
dismisses it. Closing returns focus to the replay button when it still exists,
otherwise the table menu.

## Feedback and quick controls

Every player has one fixed feedback slot below their name/identity. Emoji and
text reactions, bid notes and action cues use FeedbackDock for one priority
order and reserved slot geometry, with Bubble owning their appearance;
reactions take priority while visible. Player objects and the hand keep their
height when feedback appears. The short landscape layout uses one player row
and a separate played-card row, with compact owner names and a turn prompt.

Errors, notices and illegal-card explanations use the same room toast rail
below the header. They never move to the hand or replace its turn prompt.

`R` opens/closes reactions. Arrow keys choose, Enter sends, Escape closes.
`H` asks for a hint when available. Shortcuts ignore text fields, IME,
modifiers, repeated keydown and modal UI. The server's canonical reaction list
is `crates/server/src/room/mod.rs`; regenerate the catalog after changing it.
It currently offers 12 emoji and 12 phrases. This is additive: old reaction
values remain valid and unknown values remain refused.

A newly mounted bidding panel disables all submit actions for 400ms. The
out-of-turn Deal Miss control uses the left lane, keeping it separate from
Bid; a pointer gesture that spans a phase change cannot submit the new action.

Desktop and short-landscape hand columns reserve equal space left and right,
so a single card stays centered independently of whether tools are visible.

## Entry and settings

Home shows the selected rule, Create Table and Join before the long preset list.
The rule chooser retains every preset and saved custom rule; rule reading,
comparison and editing remain available from home. Short screens omit the large
card mark to preserve room for these actions.

The header and lobby Settings buttons open one panel directly. Table settings
apply to everyone and can change only between hands by a seated player. Personal
screen and sound preferences apply to this browser. Opening Settings from the
menu replaces the menu; closing returns to the table and restores focus.

## Table layout

Phone portrait is the primary layout. The current visible experience is a
five-seat table. The room opens directly onto the table as an observer, with
no separate seat-selection page. The first available seat is previewed at the
bottom; the default 앉기 action fills that anchor without rotating the visible
table. Choosing another seat is an explicit optional seat change. Four other
players retain their anchors from room to play, for both players and observers.
The hand dock stays reserved between hands. The own character, name and badges
are centered in that dock while waiting, then slide together to its left over
350ms on desktop and short landscape; cards fade in after that slide. Results
and the next hand keep the character on the left. Returning to the waiting
room centers it again. Portrait keeps the character centered above its name
and cards throughout. Reduced motion and motion off snap directly without a
delayed card reveal. Eye motion remains; no whole-character vertical bobbing.
Explicit swaps and shuffles still move players together
with their names.

The screen has status, felt/seats/trick, contextual controls and a docked hand.
The result and other overlays may scroll internally; the table page should
not scroll sideways. Account for safe-area insets and landscape height.

| Boundary | Current code |
| --- | --- |
| Phone/tablet width | 600px |
| Desktop hand/own-seat layout | 1024px |
| Wide landscape side panel | 1100px |
| Short landscape hand | Landscape and height ≤520px |

Unseated viewers see all five seats in one ordered row on short landscape.
Seated players use the same four opponent slots and bottom hand dock in room
and play, with lobby actions in the decision column. In portrait, Start/Next Hand and the two secondary actions share
the same outer edges; short landscape uses one horizontal action row. Portrait decision panels reserve their measured height;
on a short felt the four other players use a compact row above the controls.
Reactions and bid notes stay near their own player without covering neighbours.
Phone between-hand reaction tools use the status row so they cannot cover
empty-seat controls.

Playing-screen breakpoints and placement are resolved by `table/frameLayout.ts`,
`dockLayout.ts`, `layout.ts` and `hudLayout.ts`. CSS may change typography and
art styling at those profiles, but must not introduce competing region positions.
Native text/identity measurements are batched by one frame-local scheduler.

`table/handLayout.ts` owns the numeric fan algorithm; Hand renders its boxes:
normal phone cards are 60–76px wide, large hands can shrink to 56px before
falling back to two rows, desktop cards are 88–124px according to height,
and short landscape uses 46px. Cards have 5:7 proportions. Do not describe
every exchange as two rows or hardcode one card count into layout.

Keep corner indices visible. A chosen discard lifts without gaining a forward
z-index that hides neighboring cards. Playing defaults to tap once to raise,
again to play; a single-tap setting is available. Swipe-to-play is not
implemented by the current hand component.

Unavailable cards use the same neutral card ink for every suit; lowering saturation alone leaves spades looking active. Card paper remains opaque. The full one-joker corner label stacks vertically inside its index column.

Unplayable state comes from the server's legal view/refusal data. Do not copy
Mighty legality or payoff arithmetic into visual components. During a hand,
memory is part of play: transient narration is not a live move-log browser.
Finished-hand replay is available after scoring.

## Continuous table and participation

The table remains one place before, during and after a hand. The header's
관전자 control opens the named roster directly; wide tables also list observers
beside the scores. Guest identities deduplicate tabs, and names are editable
without leaving. Observer feedback belongs beside that observer's identity.

Empty seats expose their actions in normal layout flow below the name. The
identity's menu target never includes the action row. Use one Seat renderer
for your character and opponents; center the identity inside its reserved
frame. Keep character movement intentional and preserve eye animation without
idle bobbing. Waiting identities stay centered; wide layouts slide only your
identity beside the dealt hand and wait 350ms before revealing cards. Feedback
has a separate reserved row, and readiness remains
visible when someone reacts. Suit-prefixed bids are text, not large emoji.

Observers can request the next hand directly. A bot or empty seat is reserved
until the observer explicitly accepts between hands. Reservations block Start;
they never expose cards from the current hand. With five humans, requests wait
in order until a seated human offers their own seat. Offers and requests can
be canceled. A different target first previews the new bottom perspective;
canceling restores it. The already-previewed default target needs no extra
confirmation. Changing perspective must never silently evict a human.

A solo human with bots uses one Start or Next hand action. With multiple humans,
each prepares; the table names the humans still needed instead of counting
bots as readiness progress. Becoming Start or Next hand waits 400ms before
accepting a new click, including when motion is disabled. Newly mounted
results also wait 400ms before enabling continuation, so the last card click
cannot start another hand. Seat admission is
separate from readiness. Replacement clears preparation and applies only at
the between-hand boundary.

Decision controls, participation and results consume engine-owned regions.
Shared HUD components resolve logical item/row positions from native leaf sizes. They never take space from a neighboring seat. Very short
viewports may scroll vertically; never hide a header control or overlap a
character to manufacture a no-scroll layout. Bound long names to their actual
seat slots, retaining the full name in the accessible identity.

The user chose to restore the deployed production table layout on 2026-10-07.
Use production commit `9cd1c04443e4ec5788a51e035e3eecb3f3c8accb` as the
rendering reference for the viewport grid, ring, card bands and hand dock.
Portrait play uses the compact own identity strip; desktop uses 170px side
columns. Do not reintroduce the experimental fixed arena, 220px command
reservation, equal-sized own figure on every viewport, compact trick cluster
or custom 350ms center-to-side transition.

Role and point badges retain the production shared metadata row, overlapping
the lower character edge by 14 percent of figure width, with the centered name
underneath. Readiness uses the existing feedback slot. Observer participation
stays in natural page flow after the fixed-height table, so it cannot compress
the arena. At 360px or less, and on short portrait phones up to 700px tall,
compact results also use page flow rather than covering seated players.
Taller phones keep the result below the reserved reaction slots. These are bounded accommodations for the retained
functional additions; active gameplay proportions remain the production base.

The current hand's outcome is compact: winner, contract, earned points and your
own delta if you actually participated. Keep one cumulative scoreboard. Folding
the result must leave seats and table geometry unchanged. A newcomer never
inherits a replaced bot's role, payoff or achievement. Continuation is the
primary action; current-hand replay is secondary and available between hands.
There is no old-game archive browser or session-end/rematch ceremony in the UI.

The menu offers an explicitly confirmed score reset between hands. It preserves
people, seating, rules and the just-completed replay; prior records remain
internal. Replay uses frozen participant identities, names, rules and completed
public state, so seat replacement or score reset cannot relabel a past player
or reveal private discards. Starting the next hand removes the replay entry;
an already-open replay retains its frozen hand until explicitly closed.

## Cards and figures

[PlayingCard.svelte](../web/src/lib/ui/cards/PlayingCard.svelte) owns shared
card rendering and artwork. [Mighty Card](../web/src/lib/games/mighty/Card.svelte)
is the adapter for game-specific emphasis and labels.
[CardView](../web/src/lib/ui/cards/CardView.svelte) renders normalized read-only
card descriptors; face-down cards show shared backs and expose only the
`비공개 카드` accessibility label, with no rank/suit face markup.
Its role/legality inputs come from game state, not guesses from the artwork.

- Corner indices remain readable when overlapped; full pips/court art appear
  when size allows. Reuse SuitIcon/SuitText for suits in controls and copy.
- J/Q/K are flat figures with distinct silhouettes/props; Mighty uses warm
  paper and a ring/crown; joker-call cards use a bell cue.
- Two jokers differ by ink, 흑/홍 label and solid/dashed border. With one
  joker, omit an unnecessary color name.
- `raised` means first-tap intent; `picked` means chosen discard; `hinted`
  means suggestion; `leading` is the current winning card; `won` is resolved
  news; `powerless` means its special power does not apply.
- Team Badge words remain visible. Secret friend is privately outlined until
  public information reveals the role. No-friend UI follows the server view.

Player figures stay fixed when turns change. Keep blinking and eye glances;
do not bob the whole character up and down.

Art should look cut from paper: simple geometry, a few flat tones, no texture
required for legibility. Cosmetic unlocks must not encode extra game knowledge.

## Motion and event hierarchy

`settings.svelte.ts` owns effective motion in script and `data-motion` in CSS.

| Mode | Behavior |
| --- | --- |
| full | State-explaining movement; normal/fast multiplier 1/0.5 |
| reduced | System reduced motion: keep fades/color/status, drop movement |
| off | In-game setting: immediate state changes, no transitions |

Base CSS durations: quick 120ms, move 220ms, travel 320ms, sweep 400ms,
reveal 600ms, stagger 40ms. Use standard/settle easing tokens. Local animator
holds can differ; these values are not a promise of every event's exact length.

The [animator](../web/src/lib/games/mighty/table/animator.svelte.ts) queues
successive server states. Normal speed stays normal when your turn arrives;
Fast is an explicit preference. Skip and backlog catch-up remain available.
Animate from registered elements/anchors, not new global DOM lookups. Prefer
transform and opacity. Existing transient outline emphasis is a bounded
exception, not a general blurred-shadow animation style.

| Event | Treatment |
| --- | --- |
| Routine play/pass | Card travel or short narration, quiet paper/click sound |
| Contract/points | Nearby words, tally update, concise notes |
| Mighty/joker/call/misdeal/friend | Local card/seat emphasis and role/call cue |
| Hand result/run | Counted result and earned emphasis; skippable |

The name stays centered below its character, including during bot thinking.
The turn uses a filled name pill and head backdrop, with no leading dot.
A declarer wears a crown and a solid gold role badge; a publicly revealed
friend wears a linked-ring clasp and the production solid gold badge. Private friend
status keeps its existing private outline until revealed. Keep role words
visible and use a gold outline for the current winning card, without a
floating text label. Short landscape keeps its compact owner row
and emphasizes that name with the same winning color. TurnCue presents the
current actor and decision consistently in the phone header and desktop
panel. During collection, clear turn emphasis until the next actor is visible.

Preserve the last card/trick long enough to understand it. Normal mode holds
the resolved trick for 450ms after a 220ms winner emphasis (550ms with reduced
motion). Normal card travel is 160ms for your card and 220ms for another
player's; collection takes 240ms with a 25ms stagger. Points appear only after
collection. Bot waiting remains independent of these visual timings. Points feedback occupies
the same reserved seat slot as reactions and appears after collection. Loading
an existing score never announces it as new credit. The
score chime follows card arrival, and the result opens after the final sweep.
Do not block input behind decorative sequencing. New entry can animate a fresh deal; reconnect
must not replay stale historical moves. Hidden-tab animation completion has a
time fallback; timer state is measured from time, not CSS animation progress.

## Sound and preferences

Effects default on at volume 0.7. Music defaults off at volume 0.5. Hints default
on, tips off, four-color on, single-tap off. These are per-browser preferences;
room rules and deadlines are server-owned.

Web Audio unlocks after interaction. Synthesized paper/noise and musical cues
are in sound.ts. Optional CC0 jazz tracks load when enabled, crossfade and use
phase-specific filtering/level. Keep music and effects independently controllable.
All essential information remains visible with sound off.

Background tabs use the same game/music policy; actual audio suspension depends
on browser/device behavior and needs device testing. Do not promise universal
background audio or silent-switch behavior from source alone.

Shared action controls derive their visual intent and availability from the
current offer. Game panels compose choices using approved Button and Chip
components, without private control styling. Old controls cannot submit after an
observed offer transition or removal. Friend-picker selection uses the shared
stationary selected-card state so hover and selection do not lift picker cards.

## Accessibility and verification

The design target is 44×44px for important touch controls, including invisible
hit area when a control is drawn smaller. Button small/Chip expand hit regions;
Segmented choices now have a 44px minimum height. Their keyboard focus moves
from the focused choice while a server confirmation is pending. These checks
do not claim that every control on every device already passes. Never overlap expanded hit boxes so
the wrong action wins.

Before accepting a visual change:

1. Run web check, unit tests and build; use `/deck` for faces/states and
   `/preview` for phases/overlays. Preview readiness is `html[data-ready]`.
2. Run browser tests at 320×568, 375×667, 390×844 and 1440×900, light/dark.
   They default to reduced motion; also inspect normal/fast/off manually.
3. Check exchange corner visibility, selected-card lift, small-phone seat
   labels, long names, landscape, popovers and keyboard-covered viewport.
4. Check keyboard/focus/accessible names, suit/team shapes and words, theme
   foreground pairing, two-color deck, and sound-off understanding.
5. Play the affected flow with bots and a watcher; reconnect/reload if lifecycle
   or animation changed. Record tested devices and any untested behavior.

Use [DEVELOPMENT.md](DEVELOPMENT.md) for commands. Contrast claims require
measurement on actual foreground/background combinations. Token parity is
not an accessibility or visual-quality test.
