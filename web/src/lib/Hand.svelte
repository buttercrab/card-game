<script lang="ts">
  // The player's own cards: one overlapping row, or two when they would not fit.
  import Card from './Card.svelte';
  import { sameCard, type Seal } from './cards';
  import { settings } from './settings.svelte';
  import type { Card as CardT } from './types';

  let {
    cards,
    mode = 'view',
    playable = () => true,
    chosen = [],
    kitty = [],
    seal,
    twoJokers,
    onplay,
    ontoggle,
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
    onplay?: (card: CardT) => void;
    ontoggle?: (card: CardT) => void;
  } = $props();

  let width = $state(0);
  let wide = $state(typeof matchMedia === 'function' && matchMedia('(min-width: 1024px)').matches);
  $effect(() => {
    const query = matchMedia('(min-width: 1024px)');
    const update = () => (wide = query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  });

  const cardWidth = $derived(wide ? 88 : 60);
  /** Each corner index needs this much showing to stay readable. */
  const MIN_STEP = 26;

  function stepFor(count: number): number {
    if (count <= 1 || width === 0) return cardWidth + 6;
    return Math.min(cardWidth + 6, (width - cardWidth) / (count - 1));
  }

  const rows = $derived.by(() => {
    if (stepFor(cards.length) >= MIN_STEP) return [cards];
    const half = Math.ceil(cards.length / 2);
    return [cards.slice(0, half), cards.slice(half)];
  });

  let raised = $state<CardT | null>(null);
  // A raised card that left the hand or became unplayable drops back.
  $effect(() => {
    if (raised && (mode !== 'play' || !cards.some((c) => sameCard(c, raised!)) || !playable(raised))) raised = null;
  });

  function tap(card: CardT) {
    if (mode === 'choose') {
      ontoggle?.(card);
    } else if (mode === 'play') {
      if (settings.singleTap || (raised && sameCard(raised, card))) {
        raised = null;
        onplay?.(card);
      } else {
        raised = card;
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
<div class="hand" bind:clientWidth={width} onclick={(e) => e.target === e.currentTarget && (raised = null)}>
  {#each rows as row, r (r)}
    {@const step = stepFor(row.length)}
    <div class="row" style:--overlap="{step - cardWidth}px">
      {#each row as card (JSON.stringify(card))}
        <Card
          {card}
          seal={seal(card)}
          {twoJokers}
          kitty={kitty.some((k) => sameCard(k, card))}
          raised={isRaised(card)}
          unplayable={mode !== 'view' && !playable(card)}
          onclick={mode === 'view' ? undefined : () => tap(card)}
        />
      {/each}
    </div>
  {/each}
</div>

<style>
  .hand {
    display: grid;
    gap: 8px;
    padding-top: 14px;
    min-height: 98px;
  }
  .row {
    display: flex;
    justify-content: center;
  }
  .row > :global(.card:not(:first-child)) {
    margin-left: var(--overlap);
  }
  .row > :global(.card.raised) {
    z-index: 1;
  }
</style>
