<script lang="ts" generics="T extends { id: string; mine?: boolean; active?: boolean }">
  import { onDestroy, type Snippet } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import { tableCoordinates } from './coordinateContext';
  import { createFrameMeasurements } from './frameMeasurements';
  import { layoutHudColumns, type HudColumn } from './hudLayout';
  let { rows, columns, cell, gap = 8, rowGap = 2, rowHeight = 30 }: {
    rows: readonly T[]; columns: readonly HudColumn[]; cell: Snippet<[T, string]>; gap?: number; rowGap?: number; rowHeight?: number;
  } = $props();
  let host: HTMLOListElement;
  const shared = tableCoordinates();
  const measurements = shared?.measurements ?? createFrameMeasurements(() => host);
  let width = $state(0);
  let heights = $state<Record<string, number>>({});
  $effect(() => host && measurements.observeSize(host, size => { width = size.width; }));
  const attachments = new Map<string, Attachment<HTMLElement>>();
  function measure(id: string): Attachment<HTMLElement> {
    if (!attachments.has(id)) attachments.set(id, element => measurements.observeSize(element, size => {
      if (heights[id] !== size.height) heights = { ...heights, [id]: size.height };
    }));
    return attachments.get(id)!;
  }
  const columnLayout = $derived(layoutHudColumns(columns, width, gap));
  const rowLayout = $derived.by(() => {
    let y = 0;
    return rows.map(row => { const height = Math.max(rowHeight, ...columns.map(column => heights[`${row.id}:${column.id}`] ?? 0)); const result = { row, y, height }; y += height + rowGap; return result; });
  });
  const height = $derived(rowLayout.length ? rowLayout.at(-1)!.y + rowLayout.at(-1)!.height : 0);
  onDestroy(() => { attachments.clear(); if (!shared) measurements.dispose(); });
</script>
<ol class="score-rows" bind:this={host} style:height={`${height}px`} style:visibility={width > 0 ? undefined : 'hidden'} data-engine-layout="rows">
  {#each rowLayout as entry (entry.row.id)}
    <li class:me={entry.row.mine} class:turn={entry.row.active} style:top={`${entry.y}px`} style:height={`${entry.height}px`} data-score-id={entry.row.id}>
      {#each columnLayout as column (column.id)}
        <div class="hud-cell" {@attach measure(`${entry.row.id}:${column.id}`)} data-score-cell={column.id}
          style:left={`${column.x}px`} style:width={`${column.width}px`}
          style:top={`${(entry.height - (heights[`${entry.row.id}:${column.id}`] ?? entry.height)) / 2}px`} style:visibility={heights[`${entry.row.id}:${column.id}`] !== undefined ? undefined : 'hidden'}>
          {@render cell(entry.row, column.id)}
        </div>
      {/each}
    </li>
  {/each}
</ol>
<style>
  .score-rows { position:relative; width:100%; margin:0; padding:0; list-style:none; }
  li { position:absolute; left:0; width:100%; color:var(--ink-muted); }
  li.me, li.turn { color:var(--ink); }
  .hud-cell { position:absolute; min-width:0; }
</style>
