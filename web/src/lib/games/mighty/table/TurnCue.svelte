<script lang="ts">
  import EngineRow from '../../../table/EngineRow.svelte';
  import { turnSurfacePolicy } from '../../../table/hudSurfacePolicy';
  let { name = null, mine = false, action = null, collecting = false, compact = false }: {
    name?: string | null;
    mine?: boolean;
    action?: string | null;
    collecting?: boolean;
    compact?: boolean;
  } = $props();
  const policy=$derived(turnSurfacePolicy(compact));
</script>

{#if name !== null}
  <div class="turn-line" class:compact style:min-height={`${policy.minHeight}px`} style:padding={`${policy.paddingY}px ${policy.paddingX}px`} aria-live="polite">
    <EngineRow items={[{id:'actor', ...(compact ? {} : {width:'fill' as const})}, ...(action ? [{id:'action'}] : [])]} fill={!compact} gap={8} minHeight={policy.rowHeight}>
      {#snippet children(id)}{#if id === 'actor'}<strong class="actor" title={name}>{mine ? '내 차례' : `${name} 차례`}</strong>{:else}<span class="action">{action}</span>{/if}{/snippet}
    </EngineRow>
  </div>
{:else if collecting}
  <p class="turn-line collecting" class:compact style:min-height={`${policy.minHeight}px`} style:padding={`${policy.paddingY}px ${policy.paddingX}px`} aria-live="polite">카드 모으는 중</p>
{/if}

<style>
  .turn-line {
    margin:0;
    border-left: 3px solid var(--accent);
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent) 10%, var(--panel));
    font-size: 14px; line-height: 18px;
  }
  .actor { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ink); font-weight: 700; }
  .action { display: block; color: var(--ink-muted); font-size: 12px; }
  .collecting { color: var(--ink-muted); border-color: var(--line); background: transparent; }
  .compact { display: inline-block; max-width: 100%; margin: 0; border: 0; background: transparent; font-size: inherit; line-height: var(--turn-line-height, 18px); }
  .compact .action { font-size: inherit; }
  .compact .actor { color: var(--accent); }
</style>
