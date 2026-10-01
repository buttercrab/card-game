<script lang="ts">
  import { SUITS, trumpLabel } from './cards';
  import type { Action, Contract, Suit } from './types';

  let { legal, onact }: { legal: Action[]; onact: (a: Action) => void } = $props();

  const bids = $derived(legal.flatMap((a) => (typeof a === 'object' && 'Bid' in a ? [a.Bid] : [])));
  const trumps = $derived([...SUITS, null].filter((t) => bids.some((b) => b.trump === t)) as (Suit | null)[]);
  const canPass = $derived(legal.includes('Pass'));
  const canMisdeal = $derived(legal.includes('Misdeal'));

  let trump = $state<Suit | null | undefined>(undefined);
  let count = $state(0);

  const chosenTrump = $derived(trump !== undefined && trumps.includes(trump) ? trump : (trumps[0] ?? null));
  const counts = $derived(bids.filter((b) => b.trump === chosenTrump).map((b) => b.count));
  const low = $derived(Math.min(...counts));
  const high = $derived(Math.max(...counts));
  const chosenCount = $derived(Math.min(Math.max(count, low), high));
  const bid = $derived<Contract>({ trump: chosenTrump, count: chosenCount });
</script>

<div class="panel">
  {#if bids.length > 0}
    <div class="trumps" role="radiogroup" aria-label="Trump">
      {#each trumps as t (t ?? 'nt')}
        <button
          role="radio"
          aria-checked={t === chosenTrump}
          class:on={t === chosenTrump}
          class:red={t === 'Diamond' || t === 'Heart'}
          onclick={() => (trump = t)}
        >
          {trumpLabel(t)}
        </button>
      {/each}
    </div>
    <div class="count">
      <button aria-label="Lower" disabled={chosenCount <= low} onclick={() => (count = chosenCount - 1)}>−</button>
      <output aria-live="polite">{chosenCount}</output>
      <button aria-label="Higher" disabled={chosenCount >= high} onclick={() => (count = chosenCount + 1)}>+</button>
    </div>
  {/if}
  <div class="actions">
    {#if bids.length > 0}
      <button class="primary" onclick={() => onact({ Bid: bid })}>Bid {trumpLabel(bid.trump)} {bid.count}</button>
    {/if}
    {#if canPass}<button onclick={() => onact('Pass')}>Pass</button>{/if}
    {#if canMisdeal}<button onclick={() => onact('Misdeal')} title="Your hand is weak enough to ask for a redeal">Misdeal</button>{/if}
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 10px 16px;
  }

  .trumps {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .trumps button {
    border: none;
    border-radius: 0;
    min-width: 44px;
    font-size: 18px;
    padding: 6px 10px;
  }

  .trumps button + button {
    border-left: 1px solid var(--border);
  }

  .trumps button.red {
    color: var(--card-red);
  }

  .trumps button:last-child:not(.red) {
    font-size: 14px;
  }

  .trumps button.on {
    background: var(--accent-soft);
    font-weight: 700;
    box-shadow: inset 0 -3px 0 var(--accent);
  }

  .count {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .count button {
    width: 40px;
    padding: 0;
    font-size: 20px;
  }

  output {
    min-width: 2.2ch;
    text-align: center;
    font-size: 22px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .actions {
    display: flex;
    gap: 8px;
  }
</style>
