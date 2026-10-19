<script lang="ts">
  // Keep essential bid/status in their reserved row. A live reaction uses
  // its player-owned overlay anchor, without moving the row or the identity.
  import Bubble from './Bubble.svelte';
  import { onDestroy } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { tableCoordinates } from '../table/coordinateContext';
  import { createFrameMeasurements } from '../table/frameMeasurements';
  import { layoutFeedback, type FeedbackGeometry } from '../table/feedbackLayout';
  let {
    reaction = null,
    cue = null,
    credit = null,
    bid = null,
    status = null,
    geometry = {},
  }: {
    geometry?: FeedbackGeometry;
    reaction?: { text: string; id: number } | null;
    cue?: { text: string | null; id: number } | null;
    credit?: { n: number; id: number } | null;
    bid?: string | null;
    status?: {label:string;active:boolean} | null;
  } = $props();
  let host: HTMLDivElement;
  const shared = tableCoordinates();
  const measurements = shared?.measurements ?? createFrameMeasurements(() => host);
  let width = $state(0);
  let mobile = $state(false);
  let sizes = $state<Record<string, { width: number; height: number }>>({});
  $effect(() => host && measurements.observeRegion(host, ({ region, viewport }) => { width = region.width; mobile = viewport.width < 600; }));
  const attachments = new Map<string, Attachment<HTMLElement>>();
  function measure(id: string): Attachment<HTMLElement> {
    if (!attachments.has(id)) attachments.set(id, element => measurements.observeSize(element, size => { sizes = { ...sizes, [id]: size }; }));
    return attachments.get(id)!;
  }
  const items = $derived([
    ...(status ? [{ id: 'status' }] : []), ...(bid ? [{ id: 'bid' }] : []),
    ...(cue?.text || credit ? [{ id: 'event' }] : []),
  ]);
  const layout = $derived(layoutFeedback(width, items.map(item => ({ ...item, ...(sizes[item.id] ?? { width: 0, height: 0 }) })), sizes.reaction ?? { width: 0, height: 0 }, geometry));
  const positions = $derived(new Map(layout.nodes.map(node => [node.id, node.bounds])));
  onDestroy(() => { attachments.clear(); if (!shared) measurements.dispose(); });
</script>

<div class="feedback" bind:this={host} style:height={`${layout.height}px`} data-engine-layout="feedback">
  {#each items as item (item.id)}
    {@const bounds = positions.get(item.id)}
    <div class="feedback-item" {@attach measure(item.id)} style:left={`${bounds?.x ?? 0}px`} style:top={`${bounds?.y ?? 0}px`} style:max-width={`${layout.caps[item.id]}px`}>
      {#if item.id === 'status' && status}<span class="ready-label" class:is-ready={status.active}>{status.label}</span>
      {:else if item.id === 'bid' && bid}<Bubble text={bid} kind="bid" />
      {:else if cue?.text}{#key cue.id}<Bubble text={cue.text} kind="event" />{/key}
      {:else if credit}{#key credit.id}<Bubble text={`+${credit.n}점`} kind="event" />{/key}{/if}
    </div>
  {/each}
  {#if reaction}
    <span class="reaction-anchor" data-reaction-anchor {@attach measure('reaction')}
      style:left={`${layout.reaction.x}px`} style:top={`${layout.reaction.y}px`} style:max-width={`${layout.reactionCap}px`}>
      {#key reaction.id}<Bubble text={reaction.text} compact={geometry.compact} {mobile} />{/key}
    </span>
  {/if}
</div>

<style>
  .feedback { position:relative; width:100%; min-width:0; }
  .feedback-item { position:absolute; width:max-content; }
  .reaction-anchor { position:absolute; z-index:var(--z-feedback,var(--z-banner,15)); width:max-content; pointer-events:none; }
  .ready-label { font-size:11px; line-height:16px; font-weight:500; }
  .ready-label.is-ready { color:var(--accent); }
</style>
