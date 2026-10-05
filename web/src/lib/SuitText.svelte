<script lang="ts">
  // Running text with its suits drawn (SuitIcon) instead of set as font
  // glyphs, which differ on every device: "♣를 따라 내야 해요" shows a
  // drawn club. Screen readers hear the suit's name.
  import { suitRuns } from './cards';
  import SuitIcon, { SUIT_NAME } from './SuitIcon.svelte';

  let { text }: { text: string } = $props();
  const runs = $derived(suitRuns(text));
</script>

{#each runs as part, i (i)}{#if 'suit' in part}<SuitIcon suit={part.suit} inline label={SUIT_NAME[part.suit]} />{:else}{part.text}{/if}{/each}
