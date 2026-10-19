<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { tableCoordinates } from './coordinateContext';
  import { createFrameMeasurements } from './frameMeasurements';
  import { layoutHudResult } from './hudLayout';
  let { title, description, value = null, negative = false, award = '', onready }: {
    title: string; description: string; value?: string | null; negative?: boolean; award?: string; onready?: (ready: boolean, size: {width:number;height:number}) => void;
  } = $props();
  let host: HTMLDivElement;
  const shared = tableCoordinates();
  const measurements = shared?.measurements ?? createFrameMeasurements(() => host);
  let width = $state(0), sizes = $state<Record<string, { width: number; height: number }>>({});
  $effect(() => host && measurements.observeRegion(host, ({ region }) => { width = region.width; }));
  const attachments = new Map<string, Attachment<HTMLElement>>();
  function measure(id: string): Attachment<HTMLElement> {
    if (!attachments.has(id)) attachments.set(id, element => measurements.observeSize(element, size => {
      if (sizes[id]?.width !== size.width || sizes[id]?.height !== size.height) sizes = { ...sizes, [id]: size };
    }));
    return attachments.get(id)!;
  }
  const layout = $derived(layoutHudResult(width, { ...sizes, value: value === null ? { width: 0, height: 0 } : sizes.value, award: award ? sizes.award : { width: 0, height: 0 } }));
  const boxes = $derived(new Map(layout.nodes.map(node => [node.id, node.bounds])));
  const ready = $derived(width > 0 && !!sizes.title && !!sizes.description &&
    Math.abs(sizes.title.width - layout.leftWidth) <= 1 && Math.abs(sizes.description.width - layout.leftWidth) <= 1 &&
    (value === null || !!sizes.value) && (!award || !!sizes.award));
  $effect(() => { onready?.(ready,{width,height:layout.height}); });
  onDestroy(() => { attachments.clear(); if (!shared) measurements.dispose(); });
</script>
<div class="summary" bind:this={host} style:height={`${layout.height}px`}  style:visibility={width > 0 ? undefined : 'hidden'} data-engine-layout="result-summary">
  <h2 {@attach measure('title')} style:width={`${layout.leftWidth}px`}>{title}</h2>
  <p class="description" {@attach measure('description')} style:top={`${boxes.get('description')?.y ?? 0}px`} style:width={`${layout.leftWidth}px`}>{description}</p>
  {#if value !== null}<strong class:negative {@attach measure('value')} style:left={`${boxes.get('value')?.x ?? 0}px`} style:top={`${boxes.get('value')?.y ?? 0}px`}>{value}</strong>{/if}
  {#if award}<p class="award" {@attach measure('award')} style:top={`${boxes.get('award')?.y ?? 0}px`}>{award}</p>{/if}
</div>
<style>
  .summary { position:relative; width:100%; min-width:0; text-align:left; }
  h2, p, strong { position:absolute; margin:0; }
  h2 { top:0; left:0; font-size:20px; line-height:24px; }
  p { font-size:12px; line-height:16px; color:var(--ink-muted); text-wrap:balance; }
  .description { left:0; }
  strong { width:max-content; max-width:100%; font-size:14px; line-height:18px; }
  .negative { color:var(--danger); }
  .award { left:0; width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--gold); }
  @media (max-width:599px) { h2 {font-size:18px;line-height:22px;} .description {line-height:15px;} strong {font-size:13px;line-height:17px;} }
</style>
