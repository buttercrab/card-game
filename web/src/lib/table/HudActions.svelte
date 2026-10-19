<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { tableCoordinates } from './coordinateContext';
  import { createFrameMeasurements } from './frameMeasurements';
  import { layoutHudColumns, resultHudPolicy } from './hudLayout';
  let { primary, secondary, gap = 8, onready }: { primary: Snippet; secondary: Snippet; gap?: number; onready?: (ready: boolean, size: {width:number;height:number}) => void } = $props();
  let host: HTMLDivElement;
  const shared = tableCoordinates();
  const measurements = shared?.measurements ?? createFrameMeasurements(() => host);
  let width = $state(0), primarySize = $state({ width: 0, height: 0 }), secondarySize = $state({ width: 0, height: 0 });
  let viewportWidth = $state(390), viewportHeight = $state(844);
  $effect(() => host && measurements.observeRegion(host, ({ viewport, region }) => { width = region.width; viewportWidth = viewport.width; viewportHeight = viewport.height; }));
  const policy = $derived(resultHudPolicy(viewportWidth, viewportHeight));
  const measurePrimary: Attachment<HTMLElement> = element => measurements.observeSize(element, size => { primarySize = size; });
  const measureSecondary: Attachment<HTMLElement> = element => measurements.observeSize(element, size => { secondarySize = size; });
  const columns = $derived(layoutHudColumns([{ id: 'primary', width: 'fill' }, { id: 'secondary', width: secondarySize.width }], width, gap));
  const height=$derived(Math.max(primarySize.height,secondarySize.height+policy.secondaryOffset));
  const ready = $derived(width > 0 && Math.abs(primarySize.width - columns[0].width) <= 1);
  $effect(() => { onready?.(ready,{width,height}); });
  onDestroy(() => { if (!shared) measurements.dispose(); });
</script>
<div class="footer" bind:this={host} style:height={`${height}px`} data-engine-layout="actions">
  <div class="primary-slot" {@attach measurePrimary} style:width={`${columns[0].width}px`}>{@render primary()}</div>
  <div class="secondary-slot" {@attach measureSecondary} style:left={`${columns[1].x}px`} style:top={`${policy.secondaryOffset}px`}>{@render secondary()}</div>
</div>
<style>
  .footer { position:relative; width:100%; min-width:0; }
  .primary-slot, .secondary-slot { position:absolute; top:0; }
  .primary-slot { left:0; }
  .secondary-slot { width:max-content; max-width:100%; }
</style>
