<script lang="ts">
  import SuitText from '../SuitText.svelte';
  let { text, kind = 'reaction' }: { text: string; kind?: 'reaction' | 'event' | 'bid' } = $props();
  const emoji = $derived(/^\p{Extended_Pictographic}/u.test(text));
</script>
<span class="reaction" class:emoji class:transient={kind !== 'bid'} data-kind={kind} aria-live={kind === 'reaction' ? 'polite' : undefined}><SuitText {text} /></span>
<style>
  .reaction {
    display: inline-flex; align-items: center; justify-content: center;
    max-width: 100%; min-height: 24px; padding: 2px 7px;
    border: 1px solid var(--card-edge); border-radius: var(--r-pill);
    background: var(--card); color: var(--card-ink); box-shadow: var(--lip);
    font-size: 12px; font-weight: 700; line-height: 1.2;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    --suit-tone: currentColor; pointer-events: none;
  }
  .emoji { font-size: 18px; line-height: 1; }
  .transient { animation: feedback-in 140ms var(--ease-standard) both; }
  @keyframes feedback-in { from { opacity: 0; } }
</style>
