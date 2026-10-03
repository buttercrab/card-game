<script lang="ts">
  // What a led joker named: a suit, or its colour. Sits on the joker's card.
  import { leadLabel } from './cards';
  import SuitIcon from './SuitIcon.svelte';
  import type { Lead } from './types';

  let { lead }: { lead: Lead } = $props();

  const tone = $derived('Suit' in lead ? lead.Suit : lead.Color === 'Red' ? 'Heart' : 'Spade');
</script>

<span class="tag suit-{tone}" aria-label="조커가 부른 무늬: {leadLabel(lead)}">
  {#if 'Suit' in lead}
    <SuitIcon suit={lead.Suit} class="icon" />
  {:else}
    {leadLabel(lead)}
  {/if}
</span>

<style>
  .tag {
    position: absolute;
    left: 50%;
    bottom: -10px;
    transform: translateX(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    height: 24px;
    padding: 0 8px;
    border: 2px solid currentColor;
    border-radius: 999px;
    background: var(--card);
    font-size: 13px;
    font-weight: 800;
    white-space: nowrap;
    z-index: 1;
  }
  .tag :global(.icon) {
    width: 14px;
    height: 14px;
  }
  .suit-Spade {
    color: var(--suit-spade);
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
</style>
