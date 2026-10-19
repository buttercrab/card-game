<script lang="ts">
  import SuitText from '../SuitText.svelte';
  import { bubbleTypography } from '../table/feedbackLayout';
  let { text, kind = 'reaction', announce = true, compact = false, mobile = false }: { text: string; kind?: 'reaction' | 'event' | 'bid'; announce?: boolean; compact?: boolean; mobile?: boolean } = $props();
  const emoji = $derived(kind === 'reaction' && /^\p{Extended_Pictographic}/u.test(text));
  const typography = $derived(bubbleTypography(kind, emoji, compact, mobile));
</script>
<span style:font-size={`${typography.fontSize}px`} style:font-weight={typography.fontWeight} style:min-height={`${typography.minHeight}px`} style:line-height={typography.lineHeight} style:padding={typography.padding} style:--reaction-enter-y={`${typography.enterY}px`} class="reaction" class:emoji class:transient={kind !== 'bid'} data-kind={kind} aria-live={announce && kind === 'reaction' ? 'polite' : undefined}><span class="text"><SuitText {text} /></span></span>
<style>
  .reaction {
    box-sizing:border-box;
    display: inline-flex; align-items: center; justify-content: center;
    max-width: 100%; min-width: 0; min-height: 24px; padding: 2px 7px;
    border: 1px solid var(--card-edge); border-radius: var(--r-pill);
    background: var(--card); color: var(--card-ink); box-shadow: var(--lip);
    font-size: 12px; font-weight: 700; line-height: 1.2;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    --suit-tone: currentColor; pointer-events: none;
  }
  .text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .reaction[data-kind='reaction'] { white-space:normal; font-size: 16px; font-weight: 800; min-height: 34px; padding: 4px 5px; border-color: color-mix(in srgb,var(--card-ink) 38%,var(--card)); box-shadow: 0 3px 0 color-mix(in srgb,var(--card-ink) 18%,transparent); animation: reaction-in 240ms var(--ease-standard) both; transform-origin: center; }
  .reaction[data-kind='reaction'] .text { overflow:visible; text-overflow:clip; overflow-wrap:anywhere; text-wrap:balance; }
  .reaction.emoji { font-size: 32px; line-height: 1; min-height: 42px; padding: 4px 6px; }
  .reaction[data-kind='bid'] { flex: none; min-height: 20px; padding: 1px 6px; font-size: 12px; font-weight: 600; }
  .transient { animation: feedback-in 140ms var(--ease-standard) both; }
  @keyframes feedback-in { from { opacity: 0; } }
  @keyframes reaction-in {
    0% { opacity: 0; transform: translateY(var(--reaction-enter-y,6px)) scale(.92); }
    65% { opacity: 1; transform: translateY(-3px) scale(1.12); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
  }
  :global(:root[data-motion='off']) .reaction { animation:none; }
  :global(:root[data-motion='reduced']) .reaction[data-kind='reaction'] { animation: feedback-in 140ms var(--ease-standard) both; }
</style>
