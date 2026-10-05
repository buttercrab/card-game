<script lang="ts" module>
  import type { Card } from './types';
  import type { Seal } from './cards';
  import { SUIT_NAME } from './SuitIcon.svelte';

  export type CardSize = 'hand' | 'trick' | 'mini';

  const RANK: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const SEAL_NAME: Record<Seal, string> = { mighty: '마이티', joker: '조커', call: '조커콜' };

  // Pip centres as percentages of the pip box, for ranks 2 to 10.
  const L = 0,
    C = 50,
    R = 100;
  const PIPS: Record<number, [number, number][]> = {
    2: [[C, 0], [C, 100]],
    3: [[C, 0], [C, 50], [C, 100]],
    4: [[L, 0], [R, 0], [L, 100], [R, 100]],
    5: [[L, 0], [R, 0], [C, 50], [L, 100], [R, 100]],
    6: [[L, 0], [R, 0], [L, 50], [R, 50], [L, 100], [R, 100]],
    7: [[L, 0], [R, 0], [C, 25], [L, 50], [R, 50], [L, 100], [R, 100]],
    8: [[L, 0], [R, 0], [C, 25], [L, 50], [R, 50], [C, 75], [L, 100], [R, 100]],
    9: [[L, 0], [R, 0], [L, 33.3], [R, 33.3], [C, 50], [L, 66.7], [R, 66.7], [L, 100], [R, 100]],
    10: [[L, 0], [R, 0], [C, 16.7], [L, 33.3], [R, 33.3], [L, 66.7], [R, 66.7], [C, 83.3], [L, 100], [R, 100]],
  };

  export function rankText(rank: number): string {
    return RANK[rank] ?? String(rank);
  }

  export function cardName(card: Card): string {
    if ('Joker' in card) return card.Joker === 'Black' ? '흑 조커' : '홍 조커';
    return `${SUIT_NAME[card.Normal[0]]} ${rankText(card.Normal[1])}`;
  }
</script>

<script lang="ts">
  import CardBack from './CardBack.svelte';
  import CourtArt from './CourtArt.svelte';
  import CueIcon, { type Cue } from './CueIcon.svelte';
  import SuitIcon from './SuitIcon.svelte';
  import { settings } from './settings.svelte';

  let {
    card = null,
    size = 'hand',
    seal = null,
    twoJokers = true,
    raised = false,
    hinted = false,
    unplayable = false,
    won = false,
    kitty = false,
    powerless = false,
    width,
    id,
    onclick,
  }: {
    /** null draws the back. */
    card?: Card | null;
    size?: CardSize;
    seal?: Seal | null;
    /** With one joker in the deck it needs no colour name. */
    twoJokers?: boolean;
    raised?: boolean;
    /** Suggested by the 💡 hint. */
    hinted?: boolean;
    unplayable?: boolean;
    won?: boolean;
    kitty?: boolean;
    /** Played where its special power does not apply. */
    powerless?: boolean;
    /** Overrides the size's width in pixels. */
    width?: number;
    /** Exposed as data-card so motion can find this card on screen. */
    id?: string;
    onclick?: () => void;
  } = $props();

  const suit = $derived(card && 'Normal' in card ? card.Normal[0] : null);
  const rank = $derived(card && 'Normal' in card ? card.Normal[1] : 0);
  const joker = $derived(card && 'Joker' in card ? card.Joker : null);
  const ink = $derived.by(() => {
    if (joker) return joker === 'Red' ? 'heart' : 'spade';
    if (suit === 'Heart') return 'heart';
    if (suit === 'Diamond') return settings.fourColor ? 'diamond' : 'heart';
    if (suit === 'Club') return settings.fourColor ? 'club' : 'spade';
    return 'spade';
  });
  /** The role shape shown where the figure does not fit, if any. */
  const cue = $derived.by((): Cue | null => {
    if (joker) return 'joker';
    if (seal === 'mighty') return 'mighty';
    if (seal === 'call') return 'call';
    if (rank === 13) return 'K';
    if (rank === 12) return 'Q';
    if (rank === 11) return 'J';
    return null;
  });
  const jokerLabel = $derived(twoJokers ? (joker === 'Red' ? '홍' : '흑') : '조커');
  // On a desktop, a card under the pointer leans toward it a little, like
  // a real card picked up by one corner (Balatro, kept to a few degrees).
  function tilt(e: PointerEvent) {
    if (e.pointerType !== 'mouse' || unplayable) return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--ry', `${(x * 14).toFixed(1)}deg`);
    el.style.setProperty('--rx', `${(-y * 14).toFixed(1)}deg`);
  }
  function untilt(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    el.style.removeProperty('--ry');
    el.style.removeProperty('--rx');
  }

  const label = $derived.by(() => {
    if (!card) return '뒷면';
    const parts = [cardName(card)];
    if (seal && seal !== 'joker') parts.push(SEAL_NAME[seal]);
    if (powerless) parts.push('효력 없음');
    if (kitty) parts.push('키티');
    if (unplayable) parts.push('낼 수 없음');
    return parts.join(', ');
  });
</script>

{#snippet index()}
  {#if joker}
    <SuitIcon suit="Star" class="index-suit" />
    <span class="index-joker">{jokerLabel}</span>
  {:else if suit}
    <span class="index-rank" class:ten={rank === 10}>{rankText(rank)}</span>
    <SuitIcon {suit} class="index-suit" />
  {/if}
{/snippet}

{#snippet face()}
  {#if card}
    <span class="corner top">{@render index()}{#if cue}<CueIcon {cue} suit={suit ?? 'Spade'} class="index-cue" />{/if}</span>
    <span class="corner bottom">{@render index()}</span>
    {#if joker}
      <span class="centre art"><CourtArt figure="joker" /></span>
    {:else if suit && rank >= 11 && rank <= 13}
      <span class="centre art"><CourtArt figure={rank === 13 ? 'K' : rank === 12 ? 'Q' : 'J'} {suit} /></span>
    {:else if suit && rank === 14 && seal === 'mighty'}
      <span class="centre art mighty-art"><CourtArt figure="mighty" {suit} /></span>
    {:else if suit && rank === 14}
      <span class="centre ace"><SuitIcon {suit} /></span>
    {:else if suit}
      <span class="pips">
        {#each PIPS[rank] ?? [] as [x, y], i (i)}
          <span class="pip" class:flip={y > 50} style:left="{x}%" style:top="{y}%"><SuitIcon {suit} /></span>
        {/each}
      </span>
    {/if}
    <span class="glyph">{#if cue}<CueIcon {cue} suit={suit ?? 'Spade'} />{:else if suit}<SuitIcon {suit} />{/if}</span>
    {#if kitty}<span class="kitty" aria-hidden="true">키티</span>{/if}
  {:else}
    <CardBack />
  {/if}
{/snippet}

{#if onclick}
  <button
    class="card {size} ink-{ink}"
    class:back={!card}
    class:frame-mighty={seal === 'mighty'}
    class:frame-joker={!!joker}
    class:red={joker === 'Red'}
    class:raised
    class:hinted
    class:unplayable
    class:won
    class:powerless
    style:--w={width ? `${width}px` : undefined}
    data-card={id}
    draggable="false"
    aria-label={label}
    aria-pressed={raised}
    aria-disabled={unplayable}
    {onclick}
    onpointermove={tilt}
    onpointerleave={untilt}
  >
    {@render face()}
  </button>
{:else}
  <div
    class="card {size} ink-{ink}"
    class:back={!card}
    class:frame-mighty={seal === 'mighty'}
    class:frame-joker={!!joker}
    class:red={joker === 'Red'}
    class:raised
    class:unplayable
    class:won
    class:powerless
    style:--w={width ? `${width}px` : undefined}
    data-card={id}
    draggable="false"
    role="img"
    aria-label={label}
  >
    {@render face()}
  </div>
{/if}

<style>
  .card {
    --w: 60px;
    position: relative;
    display: block;
    flex: none;
    width: var(--w);
    height: calc(var(--w) * 1.4);
    min-height: 0;
    padding: 0;
    container-type: inline-size;
    border: 1px solid var(--card-edge);
    border-radius: 8px;
    background: var(--card);
    color: var(--ink-on-card);
    /* Every suit drawn on the card takes the card's ink, which follows the
       four-colour setting. */
    --suit-tone: currentColor;
    box-shadow: var(--shadow-card);
    font-family: var(--font-display);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    transition:
      transform var(--dur-quick) var(--ease-standard),
      translate 220ms var(--ease-settle),
      scale 160ms var(--ease-settle),
      filter var(--dur-quick) var(--ease-standard),
      box-shadow var(--dur-quick) var(--ease-standard),
      opacity var(--dur-quick) var(--ease-standard);
  }

  .hand {
    --w: 60px;
  }
  .trick {
    --w: 48px;
  }
  .mini {
    --w: 40px;
    border-radius: 6px;
  }
  @media (min-width: 1024px) {
    .hand {
      --w: 88px;
    }
    .trick {
      --w: 72px;
    }
    .mini {
      --w: 56px;
    }
  }

  .ink-spade {
    --ink-on-card: var(--suit-spade);
  }
  .ink-heart {
    --ink-on-card: var(--suit-heart);
  }
  .ink-diamond {
    --ink-on-card: var(--suit-diamond);
  }
  .ink-club {
    --ink-on-card: var(--suit-club);
  }

  /* Corner index: what shows in an overlapping hand. */
  .corner {
    position: absolute;
    top: 4cqw;
    left: 5cqw;
    width: 26cqw;
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1;
  }
  .corner.bottom {
    top: auto;
    left: auto;
    right: 5cqw;
    bottom: 4cqw;
    transform: rotate(180deg);
    display: none;
  }
  .index-rank {
    font-size: 32cqw;
    font-weight: 800;
    letter-spacing: -0.02em;
  }
  /* Two digits in a one-digit column: condense them instead of letting
     them spill into the pips or off the edge. */
  .index-rank.ten {
    display: inline-block;
    letter-spacing: -0.06em;
    transform: scaleX(0.74);
  }
  .corner :global(.index-suit) {
    width: 20cqw;
    height: 20cqw;
    margin-top: 2cqw;
  }
  .corner :global(.index-suit:first-child) {
    width: 24cqw;
    height: 24cqw;
    margin-top: 0;
  }
  .index-joker {
    margin-top: 2cqw;
    font-family: var(--font);
    font-size: 22cqw;
    font-weight: 800;
    white-space: nowrap;
  }

  /* Small cards: one large glyph instead of pips. */
  .glyph {
    position: absolute;
    right: 7cqw;
    bottom: 7cqw;
    width: 44cqw;
    height: 44cqw;
  }
  /* Keep the rank at least 16px tall on the smallest cards. */
  .trick .index-rank {
    font-size: 34cqw;
  }
  .mini .index-rank {
    font-size: 40cqw;
  }
  .mini .corner {
    width: 32cqw;
  }
  .mini .corner :global(.index-suit) {
    width: 24cqw;
    height: 24cqw;
  }
  .mini .glyph {
    width: 40cqw;
    height: 40cqw;
  }
  .centre,
  .pips {
    display: none;
  }

  @container (min-width: 80px) {
    .corner.bottom,
    .centre {
      display: flex;
    }
    .pips {
      display: block;
    }
    .glyph {
      display: none;
    }
    .corner {
      top: 5cqw;
      left: 4cqw;
      width: 18cqw;
    }
    .corner.bottom {
      right: 4cqw;
      bottom: 5cqw;
    }
    .index-rank {
      font-size: 22cqw;
    }
    .corner :global(.index-suit) {
      width: 13cqw;
      height: 13cqw;
    }
    .corner :global(.index-suit:first-child) {
      width: 17cqw;
      height: 17cqw;
    }
    .index-joker {
      font-size: 15cqw;
    }
    /* Trick and mini cards drawn this large use the full layout too. */
    .trick .index-rank,
    .mini .index-rank {
      font-size: 22cqw;
    }
    .mini .corner {
      width: 18cqw;
    }
    .mini .corner :global(.index-suit) {
      width: 13cqw;
      height: 13cqw;
    }
  }

  .centre {
    position: absolute;
    inset: 22cqw 24cqw;
    align-items: center;
    justify-content: center;
  }
  .ace :global(svg) {
    width: 48cqw;
    height: 48cqw;
  }
  /* Court figures, jokers and the 마이티: a figure filling the middle of the
     card, clear of the corner indexes. */
  .centre.art {
    inset: 15cqw 14cqw 13cqw;
  }
  /* Special cards are told by their frame, never a stamp: the 마이티 is
     on warmer stock inside a gold rule, the jokers inside an ink rule,
     solid for 흑 and dashed for 홍. Both show in an overlapped hand. */
  .frame-mighty,
  .frame-joker {
    --frame: color-mix(in srgb, currentColor 45%, transparent);
  }
  .frame-mighty {
    --frame: var(--card-gold);
    background: var(--card-warm);
  }
  .frame-mighty::before,
  .frame-joker::before {
    content: '';
    position: absolute;
    inset: 2cqw;
    border: 1.5px solid var(--frame);
    border-radius: 5px;
    pointer-events: none;
  }
  .frame-joker.red::before {
    border: 2px dashed var(--frame);
  }
  .corner :global(.index-cue) {
    width: 22cqw;
    height: 22cqw;
    margin-top: 5cqw;
  }
  @container (min-width: 80px) {
    .corner :global(.index-cue) {
      width: 14cqw;
      height: 14cqw;
      margin-top: 3cqw;
    }
  }
  .glyph :global(.cue) {
    width: 100%;
    height: 100%;
  }

  .pips {
    position: absolute;
    inset: 20% 37%;
  }
  .pip {
    position: absolute;
    width: 14cqw;
    height: 14cqw;
    transform: translate(-50%, -50%);
  }
  .pip.flip {
    transform: translate(-50%, -50%) rotate(180deg);
  }

  /* Set upright down the left edge, under the index: the strip of a card
     that still shows in an overlapped hand. */
  .kitty {
    position: absolute;
    left: 5cqw;
    bottom: 5cqw;
    padding: 5px 1px;
    border-radius: var(--r-pill);
    background: var(--card-ink-muted);
    color: var(--card);
    font-family: var(--font);
    font-size: 11px;
    font-weight: 700;
    line-height: 1.2;
    writing-mode: vertical-rl;
    text-orientation: upright;
    white-space: nowrap;
  }

  /* The back is drawn by CardBack; the box only matches its ground. */
  .back {
    background: var(--card-back);
    border-color: var(--card-back);
  }

  /* States. Lifts use the separate translate and scale properties, so a
     tilt (transform) and the motion helpers can combine with them. */
  .raised {
    translate: 0 calc(var(--w) * -0.36);
    box-shadow: var(--shadow-raised);
  }
  /* Cards that cannot be played sink back and lose some colour, rather
     than greying out; they stay solid paper (never see-through, which
     showed the next card's edge and went muddy in dark mode) and still
     answer a tap with the reason. */
  .unplayable {
    translate: 0 4px;
    filter: saturate(0.4) brightness(0.9);
  }
  .hinted {
    outline: 2px dashed var(--accent);
    outline-offset: 3px;
  }
  .won {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .powerless::after {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(-45deg, transparent 0 6px, color-mix(in srgb, var(--card-ink) 8%, transparent) 6px 8px);
  }

  button.card {
    cursor: pointer;
    transform: perspective(600px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
  }
  button.card:hover {
    border-color: var(--card-edge);
  }
  /* Touching a card previews the lift. */
  button.card:active:not(.unplayable):not(.raised) {
    translate: 0 -6px;
    box-shadow: var(--shadow-card);
  }
  button.card:active {
    transform: perspective(600px) rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg));
  }
  button.card.raised:active {
    box-shadow: var(--shadow-raised);
  }
  button.card.unplayable {
    cursor: default;
  }
  button.card:focus-visible {
    outline: 3px solid var(--ink);
    outline-offset: 2px;
  }
  @media (hover: hover) {
    button.card:hover:not(.unplayable):not(.raised) {
      translate: 0 -6px;
    }
  }
  /* Reduced: no tilt toward the pointer. */
  :global(:root[data-motion='reduced']) button.card {
    transform: none;
  }
</style>
