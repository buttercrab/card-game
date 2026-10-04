<script lang="ts">
  // The player's own cards: one overlapping row, or two when they would not fit.
  import { flip } from 'svelte/animate';
  import { innerHeight } from 'svelte/reactivity/window';
  import { cubicOut } from 'svelte/easing';
  import Card from './Card.svelte';
  import { sameCard, type Seal } from './cards';
  import { settings } from './settings.svelte';
  import { sound } from './sound';
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
    onplay,
    ontoggle,
    onrefuse,
    hinted = null,
    raised = $bindable(null),
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
    onplay?: (card: CardT) => void;
    ontoggle?: (card: CardT) => void;
    /** A card that cannot be played was tapped; say why. */
    onrefuse?: (card: CardT) => void;
    /** The card the 💡 hint suggests, outlined. */
    hinted?: CardT | null;
    /** The card lifted by a first tap, so the table can say what a second does. */
    raised?: CardT | null;
  } = $props();

  const buzz = (pattern: number | number[]) => settings.haptics && navigator.vibrate?.(pattern);

  /** A refused card shakes its head, clearly: ±9px easing out over 420 ms. */
  function shake(card: CardT) {
    const el = document.querySelector(`.hand [data-card='${JSON.stringify(card)}']`);
    if (!el || typeof el.animate !== 'function' || settings.speed === 'off') return;
    el.animate(
      [0, -9, 9, -7, 7, -4, 4, -1, 0].map((x) => ({ transform: `translateX(${x}px)` })),
      { duration: 420, easing: 'ease-out' },
    );
  }

  let width = $state(0);
  // Card width by screen: larger on desktops, smaller on phones held sideways.
  const WIDE = '(min-width: 1024px)';
  const SHORT = '(orientation: landscape) and (max-height: 520px)';
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

  function stepFor(count: number): number {
    if (count <= 1 || width === 0) return cardWidth + 6;
    return Math.min(cardWidth + 6, (width - cardWidth) / (count - 1));
  }

  const rows = $derived.by(() => {
    if (stepFor(cards.length) >= MIN_STEP) return [cards];
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

  function isRaised(card: CardT): boolean {
    if (mode === 'choose') return chosen.some((c) => sameCard(c, card));
    return raised !== null && sameCard(raised, card);
  }
</script>

<!-- Tapping the tray outside a card lowers the raised one. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="hand" class:deal bind:clientWidth={width} onclick={(e) => e.target === e.currentTarget && (raised = null)}>
  {#each rows as row, r (r)}
    {@const step = stepFor(row.length)}
    <div class="row" class:overlapped={step < cardWidth} style:--overlap="{step - cardWidth}px">
      {#each row as card, i (JSON.stringify(card))}
        <div class="spot" class:fresh={kitty.some((k) => sameCard(k, card))} style:--i={i} style:--rot="{((i * 37) % 7) - 3}deg" animate:flip={{ duration: settings.speed === 'off' ? 0 : 240, easing: cubicOut }}>
        <Card
          {card}
          width={cardWidth}
          id={JSON.stringify(card)}
          seal={seal(card)}
          {twoJokers}
          kitty={kitty.some((k) => sameCard(k, card))}
          raised={isRaised(card)}
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
    padding-top: 14px;
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
  .spot:has(:global(.raised)) {
    z-index: 1;
  }
  /* An overlapped card's corner glyph would peek out from under the next
     card as a stray sliver; only the last card in a row shows its own. */
  .overlapped .spot:not(:last-child) :global(.glyph) {
    visibility: hidden;
  }
  .deal .spot {
    animation: deal-in var(--dur-travel) var(--ease-settle) both;
    animation-delay: calc(var(--i) * 45ms);
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
  @media (prefers-reduced-motion: reduce) {
    .deal .spot {
      animation-name: fade-in;
    }
    @keyframes fade-in {
      from {
        opacity: 0;
      }
    }
  }
</style>
