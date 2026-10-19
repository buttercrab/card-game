<script lang="ts">
  import { onDestroy } from 'svelte';
  import { leadLabel } from './cards';
  import EngineFlow from '../../table/EngineFlow.svelte';
  import { tableCoordinates } from '../../table/coordinateContext';
  import { createFrameMeasurements } from '../../table/frameMeasurements';
  import { leadTagLayout } from '../../table/overlayLayout';
  import SuitIcon from '../../SuitIcon.svelte';
  import type { Color, Lead, Suit } from './types';
  let { lead, compact=false, cardWidth,cardHeight,short=false }: {lead:Lead;compact?:boolean;cardWidth?:number;cardHeight?:number;short?:boolean}=$props();
  const SUITS_OF:Record<Color,Suit[]>={Red:['Heart','Diamond'],Black:['Spade','Club']};
  const tone=$derived('Suit' in lead?lead.Suit:lead.Color==='Red'?'Heart':'Spade');
  const parts=$derived('Suit' in lead?['suit']:[...(!compact?['label']:[]),...SUITS_OF[lead.Color]]);
  let host:HTMLSpanElement;
  let contentHost:HTMLSpanElement;
  const shared=tableCoordinates()?.measurements;
  const measurements=shared??createFrameMeasurements(()=>host);
  let parentSize=$state({width:40,height:56});
  let contentSize=$state({width:0,height:0});
  $effect(()=>{const parent=host?.parentElement;if(parent)return measurements.observeSize(parent,size=>parentSize=size);});
  $effect(()=>{const content=contentHost?.querySelector<HTMLElement>('[data-engine-layout]');if(content)return measurements.observeSize(content,size=>contentSize=size);});
  const geometry=$derived(leadTagLayout({width:cardWidth??parentSize.width,height:cardHeight??parentSize.height},contentSize,compact,short));
  onDestroy(()=>{if(!shared)measurements.dispose();});
</script>
<span class="tag" bind:this={host} style:visibility={contentSize.height>0?undefined:'hidden'} style:color="var(--suit-{tone.toLowerCase()})" style:left={`${geometry.x}px`} style:top={`${geometry.y}px`} style:width={`${geometry.width}px`} style:height={`${geometry.height}px`} style:border-width={`${geometry.border}px`} aria-label="조커가 부른 무늬: {leadLabel(lead)}" data-engine-layout="lead-tag">
  <span class="content" bind:this={contentHost} style:left={`${geometry.contentX}px`} style:top={`${geometry.contentY}px`}>
    <EngineFlow items={parts.map(id=>({id}))} gap={geometry.gap}>
      {#snippet children(id)}{#if id==='label'}<span>{leadLabel(lead)}</span>{:else}<span class="glyph" style:width={`${geometry.iconSize}px`} style:height={`${geometry.iconSize}px`}><SuitIcon suit={id==='suit'&&'Suit' in lead?lead.Suit:id as Suit} size={`${geometry.iconSize}px`} /></span>{/if}{/snippet}
    </EngineFlow>
  </span>
</span>
<style>
  .tag { --spade-ink:var(--suit-spade); position:absolute; box-sizing:border-box; border-style:solid; border-color:currentColor; border-radius:var(--r-pill); background:var(--card); font-size:var(--text-label); font-weight:800; white-space:nowrap; z-index:1; }
  .content { position:absolute; }
  .glyph { display:block; line-height:0; }
</style>
