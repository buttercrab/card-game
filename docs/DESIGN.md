# Design system

The implemented visual language of the Mighty table, updated 2026-10-06.
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
| Mighty table regions, cards and animation state | [games/mighty/](../web/src/lib/games/mighty) |
| Synthesized cues / optional recorded music | [sound.ts](../web/src/lib/sound.ts), [music.svelte.ts](../web/src/lib/music.svelte.ts) |

CSS is the rendering authority. Script mirrors only values needed outside CSS;
its tests guard that duplication. This document is not another machine-readable
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

The result panel fits its content, with a 520px desktop width limit. Its body
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
five-seat table. Between hands all five seats use the public orientation,
with seat 0 at the bottom. Joining or standing does not rotate or resize the
lobby. A dealt hand uses the player's own seat at the bottom and docks their
cards below the felt. Explicit swaps and shuffles still move players together
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

Between hands at five seats on short landscape screens, all five seats form one
ordered row, with compact figures and no empty metadata spacer. Lobby actions
have a separate row below. In portrait, Start/Next Hand and the two secondary actions share
the same outer edges; short landscape uses one horizontal action row. Portrait decision panels reserve their measured height;
on a short felt the four other players use a compact row above the controls.
Reactions and bid notes stay near their own player without covering neighbours.
Phone between-hand reaction tools use the status row so they cannot cover
empty-seat controls.

Script queries come from `BREAKPOINT`/`MEDIA` in tokens.ts. CSS writes numeric
queries explicitly; palette tests do not prove breakpoint parity.

[Hand.svelte](../web/src/lib/games/mighty/Hand.svelte) owns the fan algorithm:
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

## Cards and figures

[Card.svelte](../web/src/lib/games/mighty/Card.svelte) owns card rendering.
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
A declarer wears a crown;
a publicly revealed friend wears a linked-ring clasp. Keep role words visible
and use gold for the current winning card. During collection, clear turn
emphasis until the next actor is visible.

Preserve the last card/trick long enough to understand it. Normal mode holds
the resolved trick for 1050ms after winner emphasis. Points feedback occupies
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
