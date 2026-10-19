<script lang="ts">
  // Your place at the table: the hand, your role and points over it, and
  // on desktops your own seat at the tray's left. It rings plum on your
  // turn. Between hands your seat sits on the empty tray, one tap from its
  // choices.
  import { onDestroy, type ComponentProps, type Snippet } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import Hand from '../Hand.svelte';
  import Seat, { type Gain } from '../Seat.svelte';
  import type { Card } from '../types';
  import type { Cue } from './animator.svelte';
  import { createFrameMeasurements } from '../../../table/frameMeasurements';
  import { calculateDockCoordinates } from '../../../table/sceneCoordinates';
  import { calculateOwnDock } from '../../../table/layout';
  import { calculateDockLayout } from '../../../table/dockLayout';
  import { boundsStyle, calculateSeatIdentity } from '../../../table/seatIdentityLayout';
  import { tableCoordinates } from '../../../table/coordinateContext';
  const coordinates=tableCoordinates();
  const measurements = coordinates?.measurements ?? createFrameMeasurements(() => undefined);
  onDestroy(() => { if (!coordinates) measurements.dispose(); });

  let {
    seat,
    coordinatePlayerId = 'local-player',
    mine,
    between,
    centered = between,
    reserveHand = false,
    interactive = between,
    picked,
    reaction,
    cue,
    secsLeft,
    seatTap,
    attachSeat,
    attachSpot,
    tray = $bindable(),
    mobileSeat = $bindable(),
    raised = $bindable(null),
    hand,
  }: {
    coordinatePlayerId?: string;
    /** Your seat as Seat draws it. */
    seat: Omit<ComponentProps<typeof Seat>, 'place' | 'attach' | 'picked'>;
    /** Your turn: the tray rings plum and the hand rises to meet you. */
    mine: boolean;
    between: boolean;
    /** Center between hands after any remaining card animation finishes. */
    centered?: boolean;
    /** Kept for the live hand contract; production always reserves its card row. */
    reserveHand?: boolean;
    interactive?: boolean;
    /** Your seat is the first picked in a swap. */
    picked: boolean;
    reaction: { text: string; id: number } | null;
    cue: Cue | null;
    /** The last seconds of your turn, before a bot plays it for you. */
    secsLeft: number | null;
    /** Your seat's button, between hands. */
    seatTap: Snippet;
    attachSeat: Attachment<HTMLElement>;
    /** Registers your seat's place, which slides when seats move. */
    attachSpot: Attachment<HTMLElement>;
    tray?: HTMLElement;
    mobileSeat?: HTMLElement;
    raised?: Card | null;
    /** The hand as Hand draws it. */
    hand: Omit<ComponentProps<typeof Hand>, 'raised' | 'lifted'>;
  } = $props();
  let gained = $state<Gain | null>(null);
  // The dock and Seat consume the same pure identity policy. Intrinsic text
  // measurement changes the pill width, never delays its vertical reservation.
  const identityAttachment:Attachment<HTMLElement>=element=>attachSeat(element);
  let metrics = $state({viewport:{width:390,height:844},region:{x:0,y:0,width:0,height:0}});
  $effect(() => {
    const element = tray;
    if (!element) return;
    return measurements.observeRegion(element, value => { metrics = value; });
  });
  const ownDock=$derived(calculateOwnDock({...metrics,centered}));
  const identityGeometry=$derived(calculateSeatIdentity({viewport:metrics.viewport,region:metrics.region,width:ownDock.width,local:true,waiting:centered,empty:seat.empty,
    hasMeta:!!(seat.team||seat.secretFriend||(seat.points??0)>0||seat.score!==null&&seat.score!==undefined)}));
  const geometry=$derived(calculateDockCoordinates({...metrics,centered,player:{id:coordinatePlayerId,height:identityGeometry.height}}));
  const dock=$derived(geometry.layout);
  let handHeight=$state(0);
  const handMeasurement:Attachment<HTMLElement>=element=>{
    const content=element.querySelector<HTMLElement>('.hand');
    if (!content) return;
    return measurements.observeSize(content, ({height}) => { handHeight=height; });
  };
  const innerDock=$derived(calculateDockLayout({viewport:metrics.viewport,region:metrics.region,handHeight,identityHeight:identityGeometry.height}));
  // Intrinsic-height changes can move the hand without resizing its DOM box.
  $effect(() => { innerDock.hand; measurements.invalidate(); });
  $effect(()=>{coordinates?.bounds.replace('dock',[geometry.node]);});
  $effect(()=>()=>coordinates?.bounds.clear('dock'));
</script>

<div class="tray" class:mine class:between class:centered bind:this={tray}>
  <!-- Desktop: your own seat at the tray's left; between hands, in its middle. -->
  <div class="me-seat" {@attach attachSpot} bind:this={mobileSeat}
    data-coordinate-id={geometry.node.id}
    style:left={`${geometry.node.bounds.x-metrics.region.x}px`} style:top={`${geometry.node.bounds.y-metrics.region.y}px`} style:width={`${geometry.node.bounds.width}px`}>
    <Seat {...seat} local waiting={centered} layoutViewport={metrics.viewport} layoutRegion={metrics.region} layoutWidth={geometry.node.bounds.width} bind:gained {reaction} {cue} {picked} place="bottom" attach={identityAttachment}
      target={interactive && !seat.empty ? seatTap : undefined} />
  </div>
  {#if secsLeft !== null}
    <!-- The last seconds of your turn, then a bot plays it for you. -->
    <span class="countdown" style={boundsStyle(innerDock.countdown)} style:line-height={`${innerDock.countdown.height}px`} role="timer" aria-live="polite" aria-label="{secsLeft}초 남음">{#key secsLeft}<span class="pop">{secsLeft}</span>{/key}</span>
  {/if}
  <!-- Always drawn, even empty, so the tray keeps its height. -->
  <div class="hand-slot" {@attach handMeasurement}
    style:left={`${innerDock.hand.x}px`} style:top={`${innerDock.hand.y}px`}
    style:width={`${innerDock.hand.width}px`} style:height={`${innerDock.hand.height}px`}>
    <Hand {...hand} bind:raised lifted={mine} />
  </div>
</div>

<style>
  .tray {
    position: relative;
    border-radius: var(--r-panel);
    outline: 3px solid transparent;
    outline-offset: -3px;
    transition: outline-color var(--dur-quick) var(--ease-standard);
  }
  .mine {
    outline-color: var(--accent);
  }
  /* Your last seconds: an ink disc on the tray's rim, by the turn ring. */
  .countdown {
    position: absolute;
    z-index: var(--z-controls);
    text-align:center;
    border-radius: 50%;
    background: var(--ink);
    color: var(--table);
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    pointer-events: none;
  }
  .me-seat { position:absolute; }
  .hand-slot { position:absolute; min-width:0; }
</style>
