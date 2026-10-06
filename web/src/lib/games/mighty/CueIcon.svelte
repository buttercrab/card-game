<script lang="ts" module>
  export type Cue = 'K' | 'Q' | 'J' | 'joker' | 'mighty' | 'call';
</script>

<script lang="ts">
  // The small shape that names a card's role where the figure does not fit:
  // under the corner index of an overlapped hand, and as the glyph of small
  // cards. Rank by outline, suit by colour (currentColor): a crown for kings,
  // a tiara for queens, a cap and feather for jacks, a jester's hat for
  // jokers, the ringed suit for the 마이티 and a bell for the joker call.
  import { PATHS } from '../../SuitIcon.svelte';
  import type { Suit } from './types';

  let { cue, suit = 'Spade', class: cls = '' }: { cue: Cue; suit?: Suit; class?: string } = $props();

  const GOLD = 'var(--card-gold)';
</script>

<svg viewBox="0 0 100 100" class="cue {cls}" aria-hidden="true">
  {#if cue === 'K'}
    <path d="M10 82 L16 30 L35 56 L50 16 L65 56 L84 30 L90 82 Z" fill="currentColor" />
  {:else if cue === 'Q'}
    <path d="M12 82 Q50 30 88 82 Z" fill="currentColor" />
    <circle cx="50" cy="26" r="12" fill="currentColor" />
  {:else if cue === 'J'}
    <path d="M8 80 Q14 40 50 40 Q86 40 92 80 Z" fill="currentColor" />
    <path d="M64 44 Q84 14 98 4 Q88 30 74 52 Z" fill="currentColor" />
  {:else if cue === 'joker'}
    <path d="M14 86 Q20 52 8 24 Q34 36 40 62 Q50 12 60 62 Q66 36 92 24 Q80 52 86 86 Z" fill="currentColor" />
    <circle cx="8" cy="22" r="8" fill={GOLD} /><circle cx="50" cy="12" r="8" fill={GOLD} /><circle cx="92" cy="22" r="8" fill={GOLD} />
  {:else if cue === 'mighty'}
    <circle cx="50" cy="50" r="44" fill="none" stroke={GOLD} stroke-width="9" />
    <path d={PATHS[suit]} fill="currentColor" transform="translate(23 23) scale(0.54)" />
  {:else}
    <path d="M50 10 Q74 12 76 46 L84 72 L16 72 L24 46 Q26 12 50 10 Z" fill="currentColor" />
    <circle cx="50" cy="84" r="9" fill="currentColor" />
  {/if}
</svg>

<style>
  .cue {
    display: block;
  }
</style>
