<script lang="ts">
  import {onDestroy,type Snippet} from 'svelte';
  import type {Attachment} from 'svelte/attachments';
  import {tableCoordinates} from './coordinateContext';
  import {createFrameMeasurements} from './frameMeasurements';
  import {layoutHudColumns,type HudColumn} from './hudLayout';
  let {columns,leading,cell,leadingColumns=2,gap=8}:{columns:readonly HudColumn[];leading:Snippet;cell:Snippet<[string]>;leadingColumns?:number;gap?:number}=$props();
  let host:HTMLDivElement;
  const shared=tableCoordinates();
  const measurements=shared?.measurements??createFrameMeasurements(()=>host);
  let width=$state(0),heights=$state<Record<string,number>>({});
  $effect(()=>host&&measurements.observeSize(host,size=>{width=size.width}));
  const attachments=new Map<string,Attachment<HTMLElement>>();
  function measure(id:string):Attachment<HTMLElement>{if(!attachments.has(id))attachments.set(id,element=>measurements.observeSize(element,size=>{if(heights[id]!==size.height)heights={...heights,[id]:size.height}}));return attachments.get(id)!;}
  const layout=$derived(layoutHudColumns(columns,width,gap));
  const values=$derived(layout.slice(leadingColumns));
  const leadingWidth=$derived(leadingColumns?((layout[leadingColumns-1]?.x??0)+(layout[leadingColumns-1]?.width??0)):0);
  const height=$derived(Math.max(0,...Object.values(heights)));
  onDestroy(()=>{attachments.clear();if(!shared)measurements.dispose()});
</script>
<div class="hud-heading" bind:this={host} style:height={`${height}px`} style:visibility={width>0?undefined:'hidden'} data-engine-layout="column-heading">
  <div class="heading-cell" {@attach measure('leading')} style:left="0px" style:width={`${leadingWidth}px`} style:top={`${(height-(heights.leading??height))/2}px`}>{@render leading()}</div>
  {#each values as column(column.id)}
    <div class="heading-cell" {@attach measure(column.id)} style:left={`${column.x}px`} style:width={`${column.width}px`} style:top={`${(height-(heights[column.id]??height))/2}px`} data-score-heading={column.id}>{@render cell(column.id)}</div>
  {/each}
</div>
<style>
 .hud-heading{position:relative;width:100%;min-width:0;}
 .heading-cell{position:absolute;min-width:0;}
</style>
