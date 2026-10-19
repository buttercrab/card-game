<script lang="ts">
  import { onDestroy } from 'svelte';
  import Card from '../Card.svelte';
  import Icon from '../../../Icon.svelte';
  import EngineFlow from '../../../table/EngineFlow.svelte';
  import { tableCoordinates } from '../../../table/coordinateContext';
  import { createFrameMeasurements } from '../../../table/frameMeasurements';
  import { thrownInLayout } from '../../../table/overlayLayout';
  import type { Card as CardT } from '../types';
  let {who,hand,twoJokers,onclose}:{who:string;hand:CardT[];twoJokers:boolean;onclose:()=>void}=$props();
  let host:HTMLDivElement;
  const shared=tableCoordinates()?.measurements;
  const measurements=shared??createFrameMeasurements(()=>host);
  let metrics=$state({viewport:{width:390,height:844},region:{width:0,height:0}});
  $effect(()=>{const parent=host?.parentElement;if(parent)return measurements.observeRegion(parent,next=>metrics=next);});
  const geometry=$derived(thrownInLayout(metrics.viewport,metrics.region,hand.length));
  onDestroy(()=>{if(!shared)measurements.dispose();});
</script>
<div class="thrown-in fade-up" bind:this={host} style:visibility={metrics.region.width>0?undefined:'hidden'} style:left={`${geometry.x}px`} style:top={`${geometry.y}px`} style:width={`${geometry.width}px`} style:height={`${geometry.height}px`} role="status" aria-label="딜미스로 보여 준 패" data-engine-layout="misdeal-overlay">
  <div class="head" style:left={`${geometry.header.x}px`} style:top={`${geometry.header.y}px`} style:width={`${geometry.header.width}px`} style:height={`${geometry.header.height}px`}>
    <EngineFlow fill minHeight={44} gap={8} items={[{id:'title',width:'fill'},{id:'close',width:geometry.closeSize}]}>
      {#snippet children(id)}{#if id==='title'}<p class="title"><EngineFlow fill gap={4} items={[{id:'who',width:'fill',maxWidth:geometry.nameMax},{id:'label'}]}>{#snippet children(part)}{#if part==='who'}<span class="who">{who}</span>{:else}<span>딜미스</span>{/if}{/snippet}</EngineFlow></p>
      {:else}<button class="btn icon close" style:width={`${geometry.closeSize}px`} style:height={`${geometry.closeSize}px`} aria-label="닫기" onclick={onclose}><Icon name="close" size="16px" /></button>{/if}{/snippet}
    </EngineFlow>
  </div>
  {#each geometry.cards as node (node.index)}
    <span class="in-fan" style:left={`${node.x}px`} style:top={`${node.y}px`} style:width={`${node.width}px`} style:height={`${node.height}px`} data-misdeal-card={node.index}>
      <Card card={hand[node.index]} width={geometry.cardWidth} size="fluid" {twoJokers} overlapped={node.overlapped} />
    </span>
  {/each}
</div>
<style>
  .thrown-in { position:absolute; z-index:3; border-radius:var(--r-panel); background:var(--panel); box-shadow:var(--lip); }
  :global(:root[data-motion='reduced']) .thrown-in { animation-name:fade; }
  .head,.in-fan { position:absolute; }
  .title { margin:0; font-size:var(--text-label); font-weight:700; white-space:nowrap; }
  .who { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
</style>
