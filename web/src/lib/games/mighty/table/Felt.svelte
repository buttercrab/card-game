<script lang="ts" module>
  import type { ComponentProps } from 'svelte';
  import type Seat from '../Seat.svelte';

  /** What a seat round the felt shows (Seat's own props, but its place). */
  export type SeatView = Omit<ComponentProps<typeof Seat>, 'place' | 'picked' | 'attach'>;

  /** The one line under the trick. */
  export interface TrickNote {
    /** 'won': who took the round; 'lead': who leads it; 'alert': a joker call. */
    kind: 'won' | 'lead' | 'alert' | 'plain';
    /** A name that gives way first when the line is long. */
    who?: string;
    text: string;
  }
</script>

<script lang="ts">
  // The felt: the four other seats in fixed bands (two on top, one each
  // side), the trick in the middle with each card between its player and
  // the centre, and the line under it. Between hands its middle holds what
  // comes next (Lobby) and every seat is one tap from its choices.
  //
  // It sizes everything from its own width and height (container units):
  // nothing scrolls and nothing collides, and nothing above or below it
  // ever moves it.
  import { onDestroy, type Snippet } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import Card from '../Card.svelte';
  import { cardKey, type Seal } from '../cards';
  import LeadTag from '../LeadTag.svelte';
  import SeatComponent, { PLACES } from '../Seat.svelte';
  import SuitText from '../../../SuitText.svelte';
  import type { Card as CardT, Lead, Played } from '../types';
  import type { Ring } from '../../../room/seats';
  import { createFrameMeasurements } from '../../../table/frameMeasurements';
  import { calculateArenaOverlays, placeMeasuredAt, arenaTextPolicy, type SeatCount } from '../../../table/layout';
  import { calculateArenaCoordinates } from '../../../table/sceneCoordinates';
  import { tableCoordinates } from '../../../table/coordinateContext';
  import EngineFlow from '../../../table/EngineFlow.svelte';
  const coordinates = tableCoordinates();
  const measurements = coordinates?.measurements ?? createFrameMeasurements(() => undefined);
  onDestroy(() => { if (!coordinates) measurements.dispose(); });
  let identityHeights=$state<Record<number,number>>({});
  function measureIdentity(seat:number):Attachment<HTMLElement>{return element=>{
    const release=attachSeat(seat)(element);
    const unmeasure=measurements.observeSize(element, ({height}) => {identityHeights={...identityHeights,[seat]:height};});
    return()=>{unmeasure();if(typeof release==='function')release();};
  };}

  let {
    ring,
    seatIds = [],
    seats,
    watching,
    onTable,
    trickKey,
    trickNo,
    lead,
    winner,
    leading,
    note,
    seal,
    twoJokers,
    attachSeat,
    attachSpot,
    attachCard,
    between,
    interactive = between,
    swapFrom,
    seatTap,
    seatActs,
    felt = $bindable(),
    ringEl = $bindable(),
    children,
    admissionHeight = 0,
  }: {
    ring: Ring;
    seatIds?: readonly string[];
    /** Each seat's view, by seat number. */
    seats: SeatView[];
    /** Nobody sits at the bottom: the felt's foot holds a seat too. */
    watching: boolean;
    /** The cards on the trick, in play order. */
    onTable: Played[];
    /** Changes with each round, so its cards are drawn afresh. */
    trickKey: string;
    trickNo: number;
    /** What a led joker named, shown on it. */
    lead: Lead | null;
    winner: number | null;
    leading: number | null;
    note: TrickNote | null;
    seal: (card: CardT) => Seal | null;
    twoJokers: boolean;
    attachSeat: (seat: number) => Attachment<HTMLElement>;
    /** Registers a seat's place, which slides when seats move. */
    attachSpot: (seat: number) => Attachment<HTMLElement>;
    attachCard: (seat: number) => Attachment<HTMLElement>;
    /** Lobby layout, with the middle holding `children`. */
    between: boolean;
    /** Seats can be managed without switching a completed hand to lobby layout. */
    interactive?: boolean;
    swapFrom: number | null;
    /** A seat's button between hands. */
    seatTap: Snippet<[number]>;
    /** What an empty seat offers, under it, between hands. */
    seatActs: Snippet<[number,(height:number)=>void]>;
    felt?: HTMLElement;
    /** The ring the seats and the trick sit in. */
    ringEl?: HTMLElement;
    /** The middle of the table: the next hand, or the hand thrown in. */
    children?: Snippet;
    admissionHeight?: number;
  } = $props();

  let metrics = $state({viewport:{width:390,height:844},region:{x:0,y:0,width:0,height:0}});
  $effect(() => {
    const element = felt;
    if (!element) return;
    return measurements.observeRegion(element, value => { metrics = value; });
  });
  const n = $derived(ring.n);
  const geometry = $derived(calculateArenaCoordinates({...metrics,seatCount:n as SeatCount,perspectiveSeat:ring.bottom,watching,players:ring.around(!watching).map(r=>({id:`seat:${ring.seatAt(r)}`,seat:ring.seatAt(r),height:identityHeights[ring.seatAt(r)]})),tableCards:onTable.map(p=>({id:cardKey(p.card),seat:p.seat}))}));
  const layout = $derived(geometry.layout);
  const overlays = $derived(calculateArenaOverlays(metrics.viewport, layout, admissionHeight));
  $effect(() => { coordinates?.bounds.replace('arena', geometry.nodes); });
  $effect(() => () => coordinates?.bounds.clear('arena'));
  const around = $derived(ring.around(!watching));
  let noteSize=$state({width:0,height:0});
  const noteMeasurement:Attachment<HTMLElement>=element=>measurements.observeSize(element,size=>{noteSize=size;});
  const notePolicy=$derived(arenaTextPolicy(layout.ring.width));
  const noteBox=$derived(placeMeasuredAt(note?.kind==='lead'?layout.leadNote:layout.note,noteSize));
</script>

<div class="felt" bind:this={felt} style:visibility={metrics.region.width > 0 && metrics.region.height > 0 ? undefined : 'hidden'}>
  <!-- The seats and the trick sit in a ring no wider than the felt is tall,
       so on a wide screen the seats stay near their cards. -->
  <div class="ring" class:watching class:between class:five={n === 5} class:compact={layout.mode !== 'regular'} class:landscape={layout.mode === 'landscape'} bind:this={ringEl}
    style:left={`${layout.ring.x}px`} style:width={`${layout.ring.width}px`} style:height={`${layout.ring.height}px`}
    style:--seat-w={`${layout.seatWidth}px`} style:--seat-h={`${layout.seatHeight}px`} style:--cy={`${layout.centerY}px`} style:--card-size={`${layout.cardWidth}px`}
    style:--arena-review-x={`${overlays.review.x}px`} style:--arena-review-y={`${overlays.review.y}px`}
    style:--arena-review-w={`${overlays.review.width}px`} style:--arena-review-h={`${overlays.review.height}px`}
    style:--arena-admission-x={`${overlays.admission.x}px`} style:--arena-admission-y={`${overlays.admission.y}px`}
    style:--arena-admission-w={`${overlays.admission.width}px`}>
    {#each around as r (seatIds[ring.seatAt(r)] ?? `empty:${ring.seatAt(r)}`)}
      {@const s = ring.seatAt(r)}
      {@const node = geometry.players.find(node=>node.id===`player:seat:${s}`)!}
      {@const place = n === 5 ? PLACES[r] : 'free'}
      <div class="spot {place}" data-seat={s} data-coordinate-id={node.id} style:left={`${node.bounds.x-geometry.ring.x}px`} style:top={`${node.bounds.y-geometry.ring.y}px`} style:width={`${node.bounds.width}px`} {@attach attachSpot(s)}>
        <div class="seat-box">
          {#snippet identityTarget()}{@render seatTap(s)}{/snippet}
          {#snippet choices(reportHeight:(height:number)=>void)}{@render seatActs(s,reportHeight)}{/snippet}
          <SeatComponent {...seats[s]} layoutViewport={metrics.viewport} layoutRegion={layout.ring} layoutWidth={node.bounds.width} compact={layout.mode!=='regular'} {place} picked={swapFrom === s} attach={measureIdentity(s)}
            target={interactive && !seats[s]?.empty ? identityTarget : undefined}
            actions={interactive && seats[s]?.empty ? choices : undefined} />
        </div>
      </div>
    {/each}

    <div class="trick" aria-label={winner !== null ? '끝난 라운드' : '이번 라운드'}>
      {#each onTable as p, i (`${trickKey}-${p.seat}`)}
        {@const bounds = geometry.cards[i].bounds}
        <div class="slot" data-slot={p.seat} style:left={`${bounds.x - geometry.ring.x}px`} style:top={`${bounds.y - geometry.ring.y}px`} style:width={`${bounds.width}px`} style:height={`${bounds.height}px`}>
          <Card
            card={p.card}
            size="fluid" width={bounds.width}
            seal={seal(p.card)}
            {twoJokers}
            powerless={!p.powered}
            won={p.seat === winner}
            leading={p.seat === leading}
            dimmed={winner !== null && p.seat !== winner}
            tilt={((p.seat * 7 + trickNo * 3) % 5) - 2}
            attach={attachCard(p.seat)}
          />
          {#if i === 0 && 'Joker' in p.card && lead}<LeadTag {lead} compact cardWidth={layout.cardWidth} cardHeight={layout.cardHeight} short={layout.mode==='landscape'} />{/if}
          <span class="card-owner" title={seats[p.seat]?.name}>{seats[p.seat]?.name}</span>
        </div>
      {/each}
    </div>

    <!-- One line right under the trick; a long name gives way first. -->
    {#if note}
      <div class="note {note.kind}" {@attach noteMeasurement} style:left={`${noteBox.x}px`} style:top={`${noteBox.y}px`} style:max-width={`${notePolicy.maxWidth}px`} style:visibility={noteSize.width>0?undefined:'hidden'}>
        <EngineFlow items={[...(note.who?[{id:'who'}]:[]),{id:'text'}]}>
          {#snippet children(id)}{#if id==='who'}<span class="who-name" style:max-width={`${notePolicy.whoMaxWidth}px`}>{note?.who}</span>{:else}<SuitText text={note?.text??''} />{/if}{/snippet}
        </EngineFlow>
      </div>
    {/if}

    {@render children?.()}
  </div>
</div>

<style>
  .felt { position:relative; min-height:0; container-type:size; }
  .ring { position:absolute; top:0; container-type:size; }
  .spot { position:absolute; }
  .seat-box { position:relative; }
  .trick { position:absolute; inset:0; pointer-events:none; }
  .slot { position:absolute; }
  .card-owner { display:none; }
  .note { position:absolute; width:max-content; margin:0; font-size:14px; color:var(--ink-muted); white-space:nowrap; pointer-events:none; }
  .note:not(.lead) { overflow:hidden; text-overflow:ellipsis; }
  .who-name { display:inline-block; max-width:7em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom; }
  .won { color:var(--ink); font-weight:700; }
  .alert { color:var(--accent); font-weight:700; }
  .landscape .note:not(.lead) { display:none; }
  .landscape .card-owner { display:block; width:32px; font-size:9px; line-height:10px; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
</style>
