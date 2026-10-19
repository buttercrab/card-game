<script lang="ts">
  import Card from './Card.svelte';
  import { onDestroy } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import EngineFlow from '../../table/EngineFlow.svelte';
  import { tableCoordinates } from '../../table/coordinateContext';
  import { createFrameMeasurements } from '../../table/frameMeasurements';
  import { finishedLayout } from '../../table/finishedLayout';
  import Badge from '../../ui/Badge.svelte';
  import type { Seal } from './cards';
  import type { Card as CardT, Trick } from './types';

  let { tricks, declarer, friend, seatName, seal, twoJokers, compact = false }: {
    tricks: Trick[];
    declarer: number;
    friend: number | null;
    seatName: (seat: number) => string;
    seal: (card: CardT) => Seal | null;
    twoJokers: boolean;
    compact?: boolean;
  } = $props();

  const seats = $derived([...new Set(tricks.flatMap(t => t.plays.map(p => p.seat)))].sort((a, b) => a - b));
  // Keep every seat's cards in the same trick columns, including a blank
  // cell for incomplete legacy records. Suit sorting would lose the round.
  const playsOf = (seat: number) => tricks.map(t => t.plays.find(p => p.seat === seat));
  const team = (seat: number) => seat === declarer ? 'declarer' : seat === friend ? 'friend' : 'defense';
  let host: HTMLElement;
  const shared = tableCoordinates();
  const measurements = shared?.measurements ?? createFrameMeasurements(() => host);
  let width = $state(0);
  let heights = $state<Record<number, number>>({});
  $effect(() => host && measurements.observeRegion(host, ({region}) => { width = region.width; }));
  const attachments = new Map<number, Attachment<HTMLElement>>();
  function measure(seat: number): Attachment<HTMLElement> {
    if (!attachments.has(seat)) attachments.set(seat, element => measurements.observeSize(element, size => { heights = {...heights, [seat]: size.height}; }));
    return attachments.get(seat)!;
  }
  const geometry = $derived(finishedLayout(width, tricks.length, seats.map(seat => heights[seat] ?? 16), compact));
  onDestroy(() => { attachments.clear(); if (!shared) measurements.dispose(); });
</script>

<section class="finished-hands" class:compact class:tiny={geometry.tiny} aria-label="전체 라운드" bind:this={host} style:height={`${geometry.height}px`} data-engine-layout="finished-rounds">
  <div class="round-head" style:height={`${geometry.headerHeight}px`}>
    {#if !geometry.tiny}<span class="round-label" style:left="0px" style:top={`${geometry.labelY}px`} style:width={`${geometry.identityWidth}px`}>라운드</span>{/if}
    {#each tricks as _, i}<span class="column" style:left={`${geometry.columnX(i)}px`} style:top={`${geometry.columnsY}px`} style:width={`${geometry.columnWidth}px`} aria-label={`${i + 1}라운드`}>{i + 1}</span>{/each}
  </div>
  <ul class="hands">
    {#each seats as seat, index (seat)}
      {@const plays = playsOf(seat)}
      {@const row = geometry.rows[index]}
      <li data-hand-seat={seat} style:top={`${row.y}px`} style:height={`${row.height}px`}>
        <div class="who" {@attach measure(seat)} style:top={`${row.identityY}px`} style:width={`${geometry.identityWidth}px`}>
          <EngineFlow fill items={[{id:'name',width:'fill'}, {id:'team'}]} direction={geometry.side ? 'column' : 'row'} justify="start" align="start" gap={geometry.side ? 2 : 6} rowGap={2}>
            {#snippet children(id)}{#if id === 'name'}<span class="name" title={seatName(seat)}>{seatName(seat)}</span>{:else}<Badge team={team(seat)} size="sm" />{/if}{/snippet}
          </EngineFlow>
        </div>
        <div class="row" style:left={`${geometry.cardsX}px`} style:top={`${row.cardsY}px`}>
          {#each plays as play, i (i)}
            <span class="round-card" style:left={`${geometry.cardX(i)}px`} style:width={`${geometry.cardWidth}px`} style:height={`${geometry.cardHeight}px`} data-round={i + 1} data-winner={tricks[i].winner === seat ? 'true' : undefined} title={`${i + 1}라운드${tricks[i].winner === seat ? ' · 가져감' : ''}`}>
              {#if play}<Card card={play.card} width={geometry.cardWidth} size="fluid" seal={seal(play.card)} {twoJokers} powerless={!play.powered} won={tricks[i].winner === seat} />{/if}
            </span>
          {/each}
        </div>
      </li>
    {/each}
  </ul>
</section>
<style>
  .finished-hands { position:relative; min-width:0; width:100%; }
  .round-head { position:absolute; width:100%; font-size:10px; line-height:14px; color:var(--ink-muted); }
  .round-label,.column { position:absolute; }
  .column { text-align:center; }
  .hands { list-style:none; padding:0; margin:0; }
  li { position:absolute; width:100%; min-width:0; }
  .who,.row,.round-card { position:absolute; }
  .who { font-size:12px; font-weight:600; line-height:16px; }
  .name { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .who :global(.team) { font-size:10px; line-height:14px; padding:0 4px; }
  .tiny .who { font-size:11px; line-height:12px; }
  .tiny .who :global(.team) { font-size:9px; line-height:12px; }
  .round-card :global(.card.won) { outline:1.5px solid var(--ink); outline-offset:0; }
</style>
