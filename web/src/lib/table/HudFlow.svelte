<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { tableCoordinates } from './coordinateContext';
  import { createFrameMeasurements } from './frameMeasurements';
  import { layoutHudFlow, layoutHudStack } from './hudLayout';
  let { items, children, fill = false, gapX = 14, gapY = 2, justify = 'center', direction = 'row' }: {
    items: readonly { id: string; full?: boolean }[]; children: Snippet<[string]>; fill?: boolean;
    gapX?: number; gapY?: number; justify?: 'start' | 'center' | 'end';
    direction?: 'row' | 'column';
  } = $props();
  let host: HTMLDivElement;
  const shared = tableCoordinates();
  const measurements = shared?.measurements ?? createFrameMeasurements(() => host);
  let size = $state({ width: 0, height: 0 });
  let measured = $state<Record<string, { width: number; height: number }>>({});
  $effect(() => host && measurements.observeRegion(host, ({ region }) => { size = { width: region.width, height: region.height }; }));
  const attachments = new Map<string, Attachment<HTMLElement>>();
  function measure(id: string): Attachment<HTMLElement> {
    if (!attachments.has(id)) attachments.set(id, element => measurements.observeSize(element, next => {
      if (measured[id]?.width !== next.width || measured[id]?.height !== next.height) measured = { ...measured, [id]: next };
    }));
    return attachments.get(id)!;
  }
  const measuredItems = $derived(items.map(item => ({ ...item, ...(measured[item.id] ?? { width: 0, height: 0 }) })));
  const layout = $derived(direction === 'column' ? layoutHudStack(measuredItems, size.width, gapY) : layoutHudFlow(measuredItems, size.width,
    { gapX, gapY, justify, height: fill ? size.height : undefined }));
  const positions = $derived(new Map(layout.nodes.map(node => [node.id, node.bounds])));
  onDestroy(() => { attachments.clear(); if (!shared) measurements.dispose(); });
</script>
<div class="hud-flow" bind:this={host} style:height={fill ? '100%' : `${layout.height}px`} style:visibility={size.width > 0 ? undefined : 'hidden'} data-engine-layout="flow">
  {#each items as item (item.id)}
    {@const bounds = positions.get(item.id)}
    <div class="hud-item" {@attach measure(item.id)} data-hud-item={item.id}
      style:left={`${bounds?.x ?? 0}px`} style:top={`${bounds?.y ?? 0}px`}
      style:width={item.full || direction === 'column' ? `${size.width}px` : 'max-content'} style:visibility={measured[item.id] ? undefined : 'hidden'}>
      {@render children(item.id)}
    </div>
  {/each}
</div>
<style>
  .hud-flow { position:relative; width:100%; min-width:0; }
  .hud-item { position:absolute; max-width:100%; }
</style>
