<script lang="ts">
  // The player's own cards: one overlapping row, or two when they would not fit.
  import { flip } from 'svelte/animate';
  import type { Attachment } from 'svelte/attachments';
  import { innerHeight } from 'svelte/reactivity/window';
  import { cubicOut } from 'svelte/easing';
  import Card from './Card.svelte';
  import { sameCard, type Seal } from './cards';
  import { motion, settings } from '../../settings.svelte';
  import { sound } from '../../sound';
  import { cardKey, Registry } from './table/registry';
  import { MEDIA } from '../../tokens';
  import type { Card as CardT } from './types';

  let {
    cards,
    mode = 'view',
    playable = () => true,
    chosen = [],
    kitty = [],
    seal,
    twoJokers,
    deal = false,
    quickDeal = false,
    onplay,
    ontoggle,
    onrefuse,
    hinted = null,
    raised = $bindable(null),
    attachCard,
    lifted = false,
  }: {
    cards: CardT[];
    /** 'play' raises then plays one card; 'choose' toggles several, as when discarding. */
    mode?: 'view' | 'play' | 'choose';
    playable?: (card: CardT) => boolean;
    chosen?: CardT[];
    /** Cards that just came from the kitty. */
    kitty?: CardT[];
    seal: (card: CardT) => Seal | null;
    twoJokers: boolean;
    /** Play the dealing-in animation. */
    deal?: boolean;
    /** Deal in half the time (a redeal). */
    quickDeal?: boolean;
    onplay?: (card: CardT) => void;
    ontoggle?: (card: CardT) => void;
    /** A card that cannot be played was tapped; say why. */
    onrefuse?: (card: CardT) => void;
    /** The card the 💡 hint suggests, outlined. */
    hinted?: CardT | null;
    /** The card lifted by a first tap, so the table can say what a second does. */
    raised?: CardT | null;
    /** Registers each card's element with the table, by `cardKey`. */
    attachCard?: (key: string) => Attachment<HTMLElement>;
    /** Your turn: the whole hand rises a touch to meet you. */
    lifted?: boolean;
  } = $props();

  const cardEls = new Registry<string>();
  /** Registers a card here (for its shake) and with the table. */
  function register(key: string): Attachment<HTMLElement> {
    const mine = cardEls.at(key);
    const theirs = attachCard?.(key);
    return (el) => {
      const a = mine(el);
      const b = theirs?.(el);
      return () => {
        if (typeof a === 'function') a();
        if (typeof b === 'function') b();
      };
    };
  }

  const buzz = (pattern: number | number[]) => settings.haptics && navigator.vibrate?.(pattern);

  /** A refused card shakes its head, clearly: ±9px easing out over 420 ms. */
  function shake(card: CardT) {
    const el = cardEls.get(cardKey(card));
    if (!el || typeof el.animate !== 'function' || motion.level !== 'full') return;
    el.animate(
      [0, -9, 9, -7, 7, -4, 4, -1, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 420, easing: 'ease-out' },
    );
  }

  let width = $state(0);
  // Card width by screen: larger on desktops, smaller on phones held sideways.
  const WIDE = MEDIA.desktop;
  const SHORT = MEDIA.short;
  const matches = (q: string) => typeof matchMedia === 'function' && matchMedia(q).matches;
  let wide = $state(matches(WIDE));
  let short = $state(matches(SHORT));
  $effect(() => {
    const queries = [WIDE, SHORT].map((q) => matchMedia(q));
    const update = () => {
      wide = queries[0].matches;
      short = queries[1].matches;
    };
    for (const q of queries) q.addEventListener('change', update);
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  });

  /** Each corner index needs this much showing to stay readable. */
  const MIN_STEP = 26;
  const cardWidth = $derived.by(() => {
    if (short) return 46;
    // Desktops grow the hand with the window's height, which is what runs out.
    if (wide) return Math.round(Math.min(124, Math.max(88, (innerHeight.current ?? 0) * 0.12)));
    // Phones take bigger cards while a full hand of ten still fits one row.
    const big = Math.round(Math.min(76, Math.max(60, width / 5.2)));
    return (width - big) / 9 >= MIN_STEP ? big : 60;
  });

  /** Room enough for the index alone (its column is about 31% of the card):
   * a 13- or 14-card hand still fits one row at this step. */
  const minStep = $derived(Math.max(20, Math.ceil(cardWidth * 0.31)));
  /** The least a phone's hand card is drawn (docs/DESIGN.md). */
  const MIN_CARD = 56;

  function stepFor(count: number, cw: number): number {
    if (count <= 1 || width === 0) return cw + 6;
    return Math.min(cw + 6, (width - cw) / (count - 1));
  }

  /** The width the cards are drawn at: a big hand (the exchange's fourteen
   * on a narrow phone) is drawn a little smaller, down to MIN_CARD, rather
   * than in two rows, whose first would rise over the tray's rim and under
   * the exchange's controls. The tray keeps its height either way. */
  const drawWidth = $derived.by(() => {
    if (wide || short || stepFor(cards.length, cardWidth) >= minStep) return cardWidth;
    const fit = Math.floor(width / (1 + (cards.length - 1) * 0.31));
    return fit >= MIN_CARD && fit < cardWidth && stepFor(cards.length, fit) >= fit * 0.31 ? fit : cardWidth;
  });

  const rows = $derived.by(() => {
    const need = drawWidth === cardWidth ? minStep : drawWidth * 0.31;
    if (stepFor(cards.length, drawWidth) >= need) return [cards];
    const half = Math.ceil(cards.length / 2);
    return [cards.slice(0, half), cards.slice(half)];
  });

  // A raised card that left the hand or became unplayable drops back.
  $effect(() => {
    if (raised && (mode !== 'play' || !cards.some((c) => sameCard(c, raised!)) || !playable(raised))) raised = null;
  });

  function tap(card: CardT) {
    if (mode !== 'view' && !playable(card)) {
      shake(card);
      buzz([30, 40, 30]);
      onrefuse?.(card);
      return;
    }
    if (mode === 'choose') {
      sound.raise();
      ontoggle?.(card);
    } else if (mode === 'play') {
      if (settings.singleTap || (raised && sameCard(raised, card))) {
        raised = null;
        buzz(12);
        onplay?.(card);
      } else {
        raised = card;
        buzz(8);
        sound.raise();
      }
    }
  }

  const isRaised = (card: CardT) => mode !== 'choose' && raised !== null && sameCard(raised, card);
  const isPicked = (card: CardT) => mode === 'choose' && chosen.some((c) => sameCard(c, card));
</script>

<!-- Tapping the tray outside a card lowers the raised one. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<!-- The hand is always one row tall, whatever it holds (even nothing), so the
     table above never moves; a hand too big for one row lifts its first row
     over the rim instead. -->
<div
  class="hand"
  class:deal
  class:quick={quickDeal}
  class:two={rows.length > 1}
  class:lifted
  style:--row-h="{Math.round(cardWidth * 1.4)}px"
  bind:clientWidth={width}
  onclick={(e) => e.target === e.currentTarget && (raised = null)}
>
  {#each rows as row, r (r)}
    {@const step = stepFor(row.length, drawWidth)}
    <div class="row" style:--overlap="{step - drawWidth}px">
      {#each row as card, i (JSON.stringify(card))}
        <div class="spot" class:fresh={kitty.some((k) => sameCard(k, card))} style:--i={i} style:--rot="{((i * 37) % 7) - 3}deg" animate:flip={{ duration: motion.level === 'full' ? 240 : 0, easing: cubicOut }}>
        <Card
          {card}
          width={drawWidth}
          id={cardKey(card)}
          attach={register(cardKey(card))}
          seal={seal(card)}
          {twoJokers}
          kitty={kitty.some((k) => sameCard(k, card))}
          raised={isRaised(card)}
          picked={isPicked(card)}
          overlapped={step < drawWidth && i < row.length - 1}
          hinted={hinted !== null && sameCard(hinted, card)}
          unplayable={mode !== 'view' && !playable(card)}
          onclick={mode === 'view' ? undefined : () => tap(card)}
        />
        </div>
      {/each}
    </div>
  {/each}
</div>

<style>
  .hand {
    display: grid;
    gap: 8px;
    height: calc(14px + var(--row-h));
    padding-top: 14px;
    box-sizing: border-box;
  }
  .hand.two > .row:first-child {
    margin-top: calc(-8px - var(--row-h));
  }
  .row {
    display: flex;
    justify-content: center;
  }
  .spot {
    position: relative;
  }
  .spot:not(:first-child) {
    margin-left: var(--overlap);
  }
  /* Your turn: the hand rises a touch to meet you. */
  .hand {
    transition: translate 420ms var(--ease-settle);
  }
  .lifted {
    translate: 0 -4px;
  }
  .deal .spot {
    animation: deal-in var(--dur-travel) var(--ease-settle) both;
    animation-delay: calc(var(--i) * 45ms);
  }
  .deal.quick .spot {
    animation-duration: calc(var(--dur-travel) / 2);
    animation-delay: calc(var(--i) * 22ms);
  }
  /* Dealt cards land a little crooked and straighten, as on a real table. */
  /* Cards from the kitty drop into the hand once. */
  .fresh {
    animation: kitty-in 460ms var(--ease-settle) both;
    animation-delay: calc(var(--i) * 30ms);
  }
  @keyframes kitty-in {
    from {
      opacity: 0;
      transform: translateY(-28px) rotate(var(--rot));
    }
  }
  @keyframes deal-in {
    from {
      opacity: 0;
      transform: translateY(-40px) scale(0.85) rotate(var(--rot));
    }
    70% {
      transform: rotate(calc(var(--rot) * -0.3));
    }
  }
  :global(:root[data-motion='reduced']) :is(.deal .spot, .fresh) {
    animation-name: fade;
  }
</style>
