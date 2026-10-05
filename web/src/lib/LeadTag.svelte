<script lang="ts">
  // What a led joker named: a suit, or its colour. Sits on the joker's card.
  import { leadLabel } from './cards';
  import SuitIcon from './SuitIcon.svelte';
  import type { Color, Lead, Suit } from './types';

  /** `compact` drops the colour's name, for small cards: the suits say it. */
  let { lead, compact = false }: { lead: Lead; compact?: boolean } = $props();

  const SUITS_OF: Record<Color, Suit[]> = { Red: ['Heart', 'Diamond'], Black: ['Spade', 'Club'] };
  /** The rim takes the named suit's ink, or the colour's first suit's. */
  const tone = $derived('Suit' in lead ? lead.Suit : lead.Color === 'Red' ? 'Heart' : 'Spade');
</script>

<span class="tag" class:compact style:color="var(--suit-{tone.toLowerCase()})" aria-label="조커가 부른 무늬: {leadLabel(lead)}">
  {#if 'Suit' in lead}
    <SuitIcon suit={lead.Suit} size={compact ? '12px' : '14px'} />
  {:else}
    <!-- Name the suits that follow: with four colours, diamonds look blue but count as red. -->
    {#if !compact}{leadLabel(lead)}{/if}
    {#each SUITS_OF[lead.Color] as suit (suit)}
      <SuitIcon {suit} size={compact ? '12px' : '14px'} />
    {/each}
  {/if}
</span>

<style>
  .tag {
    /* Card paper: the spade is card ink here, in both themes. */
    --spade-ink: var(--suit-spade);
    position: absolute;
    left: 50%;
    bottom: -10px;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    min-width: 28px;
    height: 24px;
    padding: 0 8px;
    border: 2px solid currentColor;
    border-radius: var(--r-pill);
    background: var(--card);
    font-size: var(--text-label);
    font-weight: 800;
    white-space: nowrap;
    z-index: 1;
  }
  .tag.compact {
    min-width: 0;
    max-width: 100%;
    height: 20px;
    padding: 0 4px;
    gap: 1px;
    border-width: 1.5px;
  }
</style>
