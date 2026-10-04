<script lang="ts" module>
  import type { Card, Suit } from './types';
  import type { Seal } from './cards';

  export type CardSize = 'hand' | 'trick' | 'mini';

  const SUIT_NAME: Record<Suit, string> = { Spade: '스페이드', Diamond: '다이아몬드', Heart: '하트', Club: '클로버' };
  const RANK: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const SEAL_CHAR: Record<Seal, string> = { mighty: '마', joker: '조', call: '콜' };
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
  import SuitIcon from './SuitIcon.svelte';
  import { settings } from './settings.svelte';

  let {
    card = null,
    size = 'hand',
    seal = null,
    twoJokers = true,
    raised = false,
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
    <span class="corner top">{@render index()}</span>
    <span class="corner bottom">{@render index()}</span>
    {#if joker}
      <span class="centre joker-motif" class:ring={joker === 'Red'}><SuitIcon suit="Star" /></span>
    {:else if suit && rank >= 11 && rank <= 13}
      <span class="centre court"><span class="court-letter">{rankText(rank)}</span><SuitIcon {suit} class="court-suit" /></span>
    {:else if suit && rank === 14}
      <span class="centre ace"><SuitIcon {suit} /></span>
    {:else if suit}
      <span class="pips">
        {#each PIPS[rank] ?? [] as [x, y], i (i)}
          <span class="pip" class:flip={y > 50} style:left="{x}%" style:top="{y}%"><SuitIcon {suit} /></span>
        {/each}
      </span>
    {/if}
    <span class="glyph" class:ring={joker === 'Red'}>{#if joker}<SuitIcon suit="Star" />{:else if suit}<SuitIcon {suit} />{/if}</span>
    {#if seal}<span class="seal" aria-hidden="true">{SEAL_CHAR[seal]}</span>{/if}
    {#if kitty}<span class="kitty" aria-hidden="true">키티</span>{/if}
  {/if}
{/snippet}

{#if onclick}
  <button
    class="card {size} ink-{ink}"
    class:back={!card}
    class:raised
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
  .index-rank.ten {
    letter-spacing: -0.1em;
    margin-left: -0.08em;
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
  .glyph.ring {
    padding: 7cqw;
    border: 2.5cqw solid currentColor;
    border-radius: 50%;
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
  .court {
    flex-direction: column;
    gap: 4cqw;
    border: 1.5px solid currentColor;
    border-radius: 4px;
    opacity: 0.95;
  }
  .court-letter {
    font-size: 34cqw;
    font-weight: 800;
    line-height: 1;
  }
  .court :global(.court-suit) {
    width: 16cqw;
    height: 16cqw;
  }
  .joker-motif :global(svg) {
    width: 46cqw;
    height: 46cqw;
  }
  .joker-motif.ring {
    border: 3cqw solid currentColor;
    border-radius: 50%;
    inset: auto;
    left: 50%;
    top: 50%;
    width: 64cqw;
    height: 64cqw;
    transform: translate(-50%, -50%);
  }
  .joker-motif.ring :global(svg) {
    width: 40cqw;
    height: 40cqw;
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

  /* Seal stamp on the mighty, the jokers and the joker-call cards. */
  .seal {
    position: absolute;
    top: 5cqw;
    right: 5cqw;
    display: grid;
    place-items: center;
    width: 24cqw;
    height: 24cqw;
    border-radius: 2px;
    background: var(--seal);
    color: #fff;
    font-family: var(--font);
    font-size: 15cqw;
    font-weight: 800;
    line-height: 1;
    transform: rotate(-6deg);
  }
  @container (min-width: 80px) {
    .seal {
      width: 18cqw;
      height: 18cqw;
      font-size: 11cqw;
    }
  }

  .kitty {
    position: absolute;
    left: 5cqw;
    bottom: 5cqw;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--ink-muted);
    color: var(--card);
    font-family: var(--font);
    font-size: 11px;
    font-weight: 700;
    line-height: 1.4;
    white-space: nowrap;
  }

  /* The back: charcoal with a chilbo (interlocking circles) pattern. */
  .back {
    --chilbo: color-mix(in srgb, var(--card-edge) 55%, transparent);
    background-color: var(--card-back);
    background-image:
      radial-gradient(circle, transparent 7.2px, var(--chilbo) 7.6px, var(--chilbo) 8.4px, transparent 8.8px),
      radial-gradient(circle, transparent 7.2px, var(--chilbo) 7.6px, var(--chilbo) 8.4px, transparent 8.8px);
    background-size: 16px 16px;
    background-position:
      0 0,
      8px 8px;
    border-color: var(--card-back);
  }
  .back::after {
    content: '';
    position: absolute;
    inset: 3px;
    border: 1px solid var(--chilbo);
    border-radius: 5px;
  }

  /* States. Lifts use the separate translate and scale properties, so a
     tilt (transform) and the motion helpers can combine with them. */
  .raised {
    translate: 0 calc(var(--w) * -0.26);
    scale: 1.04;
    box-shadow: var(--shadow-raised);
  }
  /* Cards that cannot be played sink back and lose some colour, rather
     than greying out; they still answer a tap with the reason. */
  .unplayable {
    translate: 0 4px;
    opacity: 0.62;
    filter: saturate(0.45);
  }
  .won {
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  .powerless::after {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(-45deg, transparent 0 6px, rgb(28 25 21 / 0.08) 6px 8px);
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
    scale: 1.04;
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
    outline: 3px solid var(--accent);
    outline-offset: 2px;
  }
  @media (hover: hover) {
    button.card:hover:not(.unplayable):not(.raised) {
      translate: 0 -6px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .card {
      transition: none;
    }
    button.card {
      transform: none;
    }
  }
</style>
