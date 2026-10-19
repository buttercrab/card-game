<script lang="ts">
  // The point cards as twenty ticks: 여당 fills from the left, 야당 from the
  // right, and a tall ink line marks the contract. (Where 야당 would break
  // it is always the tick just before, so it needs no mark of its own.)
  // Ticks that just filled hop once, in the order the cards came in.
  import type { Tally } from './view';
  import { onDestroy } from 'svelte';
  import { innerWidth } from 'svelte/reactivity/window';
  import { tableCoordinates } from '../../../table/coordinateContext';
  import { createFrameMeasurements } from '../../../table/frameMeasurements';

  let { tally, goal, wide = false }: { tally: Tally; goal: number; wide?: boolean } = $props();

  const TICKS = Array.from({ length: 20 }, (_, i) => i);
  // What the tally showed last, so the ticks that just filled hop in turn.
  let from = $state({ decl: 0, def: 0 });
  $effect(() => {
    from = { decl: tally.decl, def: tally.def };
  });
  let host: HTMLSpanElement;
  const shared = tableCoordinates();
  const measurements = shared?.measurements ?? createFrameMeasurements(() => host);
  let width = $state(0);
  $effect(() => host && measurements.observeSize(host, size => { width = size.width; }));
  const intrinsicWidth = $derived(Math.min(320, Math.max(160, (innerWidth.current ?? 390) * 0.4)));
  const tickWidth = $derived(Math.max(0, (width - 38) / 20));
  const goalX = $derived((tickWidth + 2) * goal - 2);
  onDestroy(() => { if (!shared) measurements.dispose(); });
  /** Ticks hop only for points taken after the tally appeared. */
  let live = $state(false);
  $effect(() => {
    const id = requestAnimationFrame(() => (live = true));
    return () => cancelAnimationFrame(id);
  });
</script>

<span class="tally" bind:this={host} style:width={wide ? '100%' : `${intrinsicWidth}px`} class:live role="img" aria-label="점수 카드 20장 중 여당 {tally.decl}장, 야당 {tally.def}장">
  {#each TICKS as i (i)}
    {@const side = i < tally.decl ? 'decl' : i >= 20 - tally.def ? 'def' : ''}
    <span
      class="tick {side}"
      style:left={`${i * (tickWidth + 2)}px`} style:width={`${tickWidth}px`}
      style:--d="{Math.max(0, side === 'decl' ? i - from.decl : side === 'def' ? 19 - i - from.def : 0) * 40}ms"
    ></span>
  {/each}
  <span class="goal" style:left={`${goalX}px`}></span>
</span>

<style>
  .tally {
    position: relative;
    display: block;
    height: 10px;
  }
  .tick {
    position: absolute; top: 0; height: 10px;
    border-radius: 2px;
    background: var(--line);
    transition: background-color var(--dur-quick) var(--ease-standard);
  }
  .tick.decl {
    background: var(--team-declarer);
  }
  .tick.def {
    background: var(--team-defense);
  }
  .live .tick.decl,
  .live .tick.def {
    animation: tick-hop 280ms var(--ease-settle) var(--d, 0ms) both;
  }
  @keyframes tick-hop {
    45% {
      translate: 0 -4px;
    }
  }
  :global(:root[data-motion='reduced']) .tick {
    animation: none;
  }
  /* The contract: a tall ink line. */
  .goal {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
    border-radius: 1px;
    background: var(--ink);
  }
</style>
