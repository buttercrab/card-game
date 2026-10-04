<script lang="ts">
  import { SUITS, trumpLabel } from './cards';
  import SuitIcon from './SuitIcon.svelte';
  import type { Action, Contract, Suit } from './types';

  let { legal, onact }: { legal: Action[]; onact: (a: Action) => void } = $props();

  const bids = $derived(legal.flatMap((a) => (typeof a === 'object' && 'Bid' in a ? [a.Bid] : [])));
  const trumps = $derived([...SUITS, null].filter((t) => bids.some((b) => b.trump === t)) as (Suit | null)[]);
  const canPass = $derived(legal.includes('Pass'));
  const canMisdeal = $derived(legal.includes('Misdeal'));

  let trump = $state<Suit | null | undefined>(undefined);
  let count = $state<number | null>(null);

  const chosenTrump = $derived(trump !== undefined && trumps.includes(trump) ? trump : (trumps[0] ?? null));
  const counts = $derived(bids.filter((b) => b.trump === chosenTrump).map((b) => b.count));
  const chosenCount = $derived(count !== null && counts.includes(count) ? count : (counts[0] ?? 0));
  const bid = $derived<Contract>({ trump: chosenTrump, count: chosenCount });
</script>

<!-- Phones: the suits and counts on one row, the buttons full width under
     them. Wider screens: one centred row. -->
<div class="bid">
  {#if bids.length > 0}
    <div class="picks">
      <div class="chips" role="radiogroup" aria-label="기루다">
        {#each trumps as t (t ?? 'nt')}
          <button
            class="chip suit-{t ?? 'nt'}"
            role="radio"
            aria-checked={t === chosenTrump}
            aria-label={t ? undefined : '노기루다'}
            onclick={() => (trump = t)}
          >
            {#if t}<SuitIcon suit={t} class="suit" />{:else}노기루다{/if}
          </button>
        {/each}
      </div>
      <div class="chips counts" role="radiogroup" aria-label="공약 수">
        {#each counts as c (c)}
          <button class="chip num" role="radio" aria-checked={c === chosenCount} onclick={() => (count = c)}>{c}</button>
        {/each}
      </div>
    </div>
  {/if}
  <div class="actions">
    {#if canMisdeal}<button onclick={() => onact('Misdeal')} title="패가 약하면 다시 돌릴 수 있어요">딜미스</button>{/if}
    {#if canPass}<button onclick={() => onact('Pass')}>패스</button>{/if}
    {#if bids.length > 0}
      <button class="primary" onclick={() => onact({ Bid: bid })}>공약 {trumpLabel(bid.trump)} {bid.count}</button>
    {/if}
  </div>
</div>

<style>
  .bid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }
  .picks {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow-x: auto;
    padding: 2px 2px 4px;
    scrollbar-width: none;
  }
  .chips {
    display: flex;
    flex: none;
    gap: 6px;
  }
  /* A hairline between the suits and the counts. */
  .counts {
    padding-left: 8px;
    border-left: 1px solid var(--line);
  }
  .chip :global(.suit) {
    width: 18px;
    height: 18px;
  }
  .suit-Heart {
    color: var(--suit-heart);
  }
  .suit-Diamond {
    color: var(--suit-diamond);
  }
  .suit-Club {
    color: var(--suit-club);
  }
  .chip[aria-checked='true'] {
    color: var(--card);
  }
  .num {
    min-width: 44px;
    font-family: var(--font-display);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions > button:not(.primary) {
    flex: none;
    min-width: 88px;
  }
  .actions .primary {
    flex: 1;
  }
  @media (min-width: 600px) {
    .bid {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 8px 16px;
      max-width: 760px;
      margin: 0 auto;
    }
    .picks {
      flex: 0 1 auto;
    }
    .counts {
      padding-left: 12px;
    }
    .actions {
      flex: none;
    }
    .actions .primary {
      flex: none;
      min-width: 180px;
    }
  }
</style>
