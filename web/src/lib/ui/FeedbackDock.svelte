<script lang="ts">
  // One reserved player-feedback slot on both the seat and mobile tray.
  // Live reactions take priority over event cues, collection credit and bids.
  import Bubble from './Bubble.svelte';
  let {
    reaction = null,
    cue = null,
    credit = null,
    bid = null,
  }: {
    reaction?: { text: string; id: number } | null;
    cue?: { text: string | null; id: number } | null;
    credit?: { n: number; id: number } | null;
    bid?: string | null;
  } = $props();
</script>

<div class="feedback">
  {#if reaction}{#key reaction.id}<Bubble text={reaction.text} />{/key}
  {:else if cue?.text}{#key cue.id}<Bubble text={cue.text} kind="event" />{/key}
  {:else if credit}{#key credit.id}<Bubble text={`+${credit.n}점`} kind="event" />{/key}
  {:else if bid}<Bubble text={bid} kind="bid" />{/if}
</div>

<style>
  .feedback {
    height: var(--feedback-h, 28px);
    width: 100%;
    min-width: 0;
    display: flex;
    justify-content: center;
    align-items: start;
  }
</style>
