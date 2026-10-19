<script lang="ts">
  // The player's own cards: one overlapping row, or two when they would not fit.
  import type { Attachment } from 'svelte/attachments';
  import { onDestroy } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import Card from './Card.svelte';
  import { sameCard, type Seal } from './cards';
  import { motion, settings } from '../../settings.svelte';
  import { sound } from '../../sound';
  import { cardKey, Registry } from './table/registry';
  import { createFrameMeasurements } from '../../table/frameMeasurements';
  import { calculateHandCoordinates } from '../../table/sceneCoordinates';
  import { tableCoordinates } from '../../table/coordinateContext';
  import SceneNode from '../../table/SceneNode.svelte';
  import { handInteractionOffset } from '../../table/cardGeometry';
  const coordinates = tableCoordinates();
  const measurements = coordinates?.measurements ?? createFrameMeasurements(() => undefined);
  onDestroy(() => { if (!coordinates) measurements.dispose(); });
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
  const settledKitty = new SvelteSet<string>();
  $effect(() => { if (!kitty.length) settledKitty.clear(); });
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

  let element: HTMLDivElement;
  let metrics = $state({viewport:{width:390,height:844},region:{x:0,y:0,width:0,height:0}});
  $effect(() => {
    const node=element;if(!node)return;
    return measurements.observeRegion(node, value => {metrics=value;});
  });
  const geometry=$derived(calculateHandCoordinates({...metrics,cardIds:cards.map(cardKey)}));
  const layout=$derived(geometry.layout);
  const rows=$derived(layout.rows);
  $effect(()=>{
    coordinates?.bounds.replace('hand',geometry.cards);
  });
  $effect(()=>()=>coordinates?.bounds.clear('hand'));

  // A raised card that left the hand or became unplayable drops back.
  $effect(() => {
    if (raised && (mode !== 'play' || !cards.some((c) => sameCard(c, raised!)) || !playable(raised))) raised = null;
  });

  function tap(card: CardT) {
    // Inspection/selection takes priority over a translucent arrival. Keep
    // it settled on deselection too, rather than replaying the kitty flight.
    if (kitty.some(k => sameCard(k, card))) settledKitty.add(cardKey(card));
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
  style:--deal-speed={settings.speed === 'fast' ? 0.5 : 1}
  style:height={`${geometry.containerHeight}px`}
  style:translate={`0 ${handInteractionOffset(lifted)}px`}
  bind:this={element}
  onclick={(e) => e.target === e.currentTarget && (raised = null)}
>
  {#each cards as card, index (cardKey(card))}
    {@const node=geometry.cards[index]}
    {@const row=layout.rows.find(row=>index>=row.start&&index<row.end)!}
    {@const i=index-row.start}
    <SceneNode id={node.id} bounds={{...node.bounds,x:node.bounds.x-metrics.region.x,y:node.bounds.y-metrics.region.y}} z={node.z} duration={240} enabled={motion.level==='full'&&!deal}>
      <div class="spot" class:fresh={kitty.some(k=>sameCard(k,card))&&!settledKitty.has(cardKey(card))} style:--i={i} style:--rot={`${((i*37)%7)-3}deg`}>
        <Card {card} width={layout.drawWidth} id={cardKey(card)} attach={register(cardKey(card))}
          seal={seal(card)} {twoJokers} kitty={kitty.some(k=>sameCard(k,card))}
          raised={isRaised(card)} picked={isPicked(card)}
          overlapped={row.step<layout.drawWidth&&index<row.end-1}
          hinted={hinted!==null&&sameCard(hinted,card)} unplayable={mode!=='view'&&!playable(card)}
          onclick={mode==='view'?undefined:()=>tap(card)} />
      </div>
    </SceneNode>
  {/each}
</div>

<style>
  .hand {
    position: relative;
    /* Fan ordering is local; raised cards never outrank portaled menus. */
    isolation: isolate;
    display: block;
    box-sizing: border-box;
  }
  .spot { position:relative; }
  /* Your turn: the hand rises a touch to meet you. */
  .hand {
    transition: translate 420ms var(--ease-settle);
  }
  .deal .spot {
    animation: deal-in var(--dur-travel) var(--ease-settle) both;
    animation-delay: calc(var(--i) * 45ms * var(--deal-speed));
  }
  .deal.quick .spot {
    animation-duration: calc(var(--dur-travel) / 2);
    animation-delay: calc(var(--i) * 22ms * var(--deal-speed));
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
