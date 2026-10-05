<script lang="ts">
  // The point cards as twenty ticks: 여당 fills from the left, 야당 from the
  // right, and a tall ink line marks the contract. (Where 야당 would break
  // it is always the tick just before, so it needs no mark of its own.)
  // Ticks that just filled hop once, in the order the cards came in.
  import type { Tally } from './view';

  let { tally, goal, wide = false }: { tally: Tally; goal: number; wide?: boolean } = $props();

  const TICKS = Array.from({ length: 20 }, (_, i) => i);
  // What the tally showed last, so the ticks that just filled hop in turn.
  let from = $state({ decl: 0, def: 0 });
  $effect(() => {
    from = { decl: tally.decl, def: tally.def };
  });
  /** Where the line after tick `k` sits in a 20-column grid with 2px gaps. */
  const edge = (k: number) => `calc((100% - 38px) * ${k / 20} + ${2 * k - 2}px)`;
  /** Ticks hop only for points taken after the tally appeared. */
  let live = $state(false);
  $effect(() => {
    const id = requestAnimationFrame(() => (live = true));
    return () => cancelAnimationFrame(id);
  });
</script>

<span class="tally" class:wide class:live role="img" aria-label="점수 카드 20장 중 여당 {tally.decl}장, 야당 {tally.def}장">
  {#each TICKS as i (i)}
    {@const side = i < tally.decl ? 'decl' : i >= 20 - tally.def ? 'def' : ''}
    <span
      class="tick {side}"
      style:--d="{Math.max(0, side === 'decl' ? i - from.decl : side === 'def' ? 19 - i - from.def : 0) * 40}ms"
    ></span>
  {/each}
  <span class="goal" style:left={edge(goal)}></span>
</span>

<style>
  .tally {
    position: relative;
    display: grid;
    grid-template-columns: repeat(20, 1fr);
    gap: 2px;
    width: clamp(160px, 40vw, 320px);
    height: 10px;
  }
  .wide {
    width: 100%;
  }
  /* On phones the tally takes its own row, as wide as the row allows. */
  @media (max-width: 599px) {
    .tally:not(.wide) {
      flex: 1 1 auto;
      width: auto;
      min-width: 160px;
      max-width: 320px;
    }
  }
  .tick {
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
