<script lang="ts">
  import { onDestroy, untrack, type Snippet } from 'svelte';
  import { tableCoordinates } from './coordinateContext';
  import { createFrameMeasurements } from './frameMeasurements';
  import { IntrinsicDecisionSizes, isIntrinsicProbeMutation } from './intrinsicDecisionSize';
  import { decisionMinimumWidth, decisionPolicy, layoutDecision, type DecisionItem, type DecisionMode } from './decisionLayout';
  let { children, mode = 'flow', gap = 6, align = 'start', class: className = '', role, label,
    scroll = false, fade = false, fillHeight = false, inset = 0, onheight, ongeometrychange, height = $bindable(0) }: {
    children: Snippet; mode?: DecisionMode; gap?: number; align?: 'start'|'center'|'end'; class?: string;
    role?: 'radiogroup' | 'group'; label?: string; scroll?: boolean; fade?: boolean; fillHeight?: boolean; inset?: number; height?: number; onheight?:(height:number)=>void;
    /** Semantic widgets invalidate captures when their measured allocation moves. */
    ongeometrychange?: () => void;
  } = $props();
  let host: HTMLDivElement;
  let size=$state({width:0,height:0});
  let viewport=$state({width:390,height:844});
  let items=$state<DecisionItem[]>([]);
  let more=$state(false);
  const shared=tableCoordinates()?.measurements;
  const measurements=shared??createFrameMeasurements(()=>host);
  const paintInset=$derived(Math.max(inset,scroll?8:0));
  const layout=$derived(layoutDecision({mode,width:size.width,height:size.height,viewport,items,gap,align,inset:paintInset}));
  $effect(()=>onheight?.(layout.height));
  const minWidth=$derived(decisionMinimumWidth(mode,items,viewport,gap)+paintInset*2);
  const ids=new WeakMap<HTMLElement,string>();
  let sequence=0;
  const intrinsic = new IntrinsicDecisionSizes();
  let elements:HTMLElement[]=[];
  function overflow(){measurements.invalidate();}
  $effect(()=>host&&measurements.observeOverflow(host,value=>{more=value;}));
  $effect(()=>host&&measurements.observeRegion(host,metrics=>{size=metrics.region;viewport=metrics.viewport;ongeometrychange?.();}));
  $effect(()=>{
    if(!host)return;
    let stops:(()=>void)[]=[];
    function collect(){
      const next=Array.from(host.children).filter((node):node is HTMLElement=>node instanceof HTMLElement);
      if(next.length===elements.length&&next.every((node,i)=>node===elements[i]))return;
      stops.forEach(stop=>stop());stops=[];elements=next;intrinsic.track(next);
      const old=new Map(items.map(item=>[item.id,item]));
      items=next.map(element=>{
        let id=ids.get(element);if(!id){id=`decision-${++sequence}`;ids.set(element,id);}
        return {...(old.get(id)??{width:0,height:0}),id,primary:element.classList.contains('primary'),kind:Array.from(element.classList).find(value=>['caption','picks','actions','contract-controls','discard','count','muted','desktop-confirm','discard-btn','controls','aside'].includes(value))};
      });
      for(const element of next){
        const id=ids.get(element)!;
        stops.push(measurements.observeSize(element,measured=>{
          const previous=items.find(item=>item.id===id);
          if(!previous)return;
          const width=measured.width;
          items=items.map(item=>item.id===id?{...item,width,height:measured.height,primary:element.classList.contains('primary')}:item);
        }, (context) => intrinsic.read(element, context)));
      }
      measurements.invalidate();
    }
    untrack(collect);
    const mutations=new MutationObserver(allRecords=>{
      const records=allRecords.filter(record=>!isIntrinsicProbeMutation(record));
      if(!records.length)return;
      collect();
      for (const record of records) {
        let target=record.target instanceof HTMLElement?record.target:record.target.parentElement;
        while(target && target.parentElement!==host)target=target.parentElement;
        if(target)intrinsic.invalidate(target);
      }
      // Group minimums are numeric outputs, so reading them needs no DOM layout.
      for(const element of elements){
        const idForClass=ids.get(element), primary=element.classList.contains('primary');
        if(items.find(item=>item.id===idForClass)?.primary!==primary)items=items.map(item=>item.id===idForClass?{...item,primary}:item);
        const natural=Number(element.dataset.decisionNaturalWidth), id=ids.get(element);
        if(element.hasAttribute('data-decision-natural-width')&&Number.isFinite(natural)&&items.find(item=>item.id===id)?.width!==natural)
          items=items.map(item=>item.id===id?{...item,width:natural}:item);
      }
      if(records.some(record=>record.type==='childList'||record.type==='characterData'||record.attributeName==='class'||record.attributeName==='aria-checked'||record.attributeName==='disabled'))measurements.invalidate();
    });
    mutations.observe(host,{childList:true,characterData:true,subtree:true,attributes:true,attributeFilter:['class','aria-checked','disabled','data-decision-natural-width']});
    return()=>{stops.forEach(stop=>stop());mutations.disconnect();elements=[];};
  });
  $effect(()=>{
    height=layout.height;
    for(const node of layout.nodes){
      const element=elements.find(element=>ids.get(element)===node.id);
      if(!element)continue;
      if(size.width<=0 && !element.hasAttribute('data-engine-layout'))continue;
      if(!(items.find(item=>item.id===node.id)?.height) && !element.hasAttribute('data-engine-layout'))continue;
      element.style.position='absolute';
      element.style.left=`${node.bounds.x}px`;element.style.top=`${node.bounds.y}px`;
      element.style.display=node.visible?'':'none';
      element.style.width=`${node.bounds.width}px`;
      element.style.maxWidth=mode==='row'?'none':`${node.bounds.width}px`;
      element.dataset.decisionBox=JSON.stringify(node.bounds);
      if(mode==='strip'&&element.classList.contains('prompt'))element.style.fontSize=decisionPolicy(viewport).short?(element.classList.contains('pill')?'11px':'12px'):'';
    }
    // Position/gap changes can alter the scroll tail without resizing a leaf.
    // Recheck it in the read phase, coalesced into this settling transaction.
    measurements.invalidate();
  });
  onDestroy(()=>{if(!shared)measurements.dispose();});
</script>
<div bind:this={host} class="decision-region {className}" class:scroll class:fade={fade&&more}
  data-engine-layout="decision" data-decision-mode={mode} data-decision-short={decisionPolicy(viewport).short} data-decision-natural-width={minWidth} data-decision-paint-inset={paintInset}
  style:height={fillHeight?'100%':`${layout.height}px`} style:--decision-content-width={`${layout.contentWidth}px`} style:--decision-content-height={`${layout.height}px`} role={role} aria-label={label} onscroll={overflow}>
  {@render children()}
</div>
<style>
  .decision-region { position:relative; width:100%; min-width:0; }
  .decision-region :global(> *) { position:absolute; width:max-content; max-width:100%; box-sizing:border-box; }
  .decision-region :global(> .card) { width:var(--w); max-width:none; }
  .decision-region :global(> [data-engine-layout]), .decision-region[data-decision-mode='strip'] :global(> .controls) { width:100%; }
  .decision-region[data-decision-mode='strip'] { z-index:var(--z-controls); }
  .decision-region[data-decision-mode='strip'][data-decision-short='true'] { overflow-y:auto; }
  .decision-region[data-decision-short='true'] :global(> .pill .instruction) { display:none; }
  .decision-region[data-decision-short='true'] :global(> .pill .brief) { display:inline; }
  .scroll { overflow-x:auto; scrollbar-width:none; }
  /* Absolute children do not create trailing padding in a scroll viewport. */
  .decision-region:not([data-decision-paint-inset='0'])::after { content:'';position:absolute;left:calc(var(--decision-content-width) - 1px);top:calc(var(--decision-content-height) - 1px);width:1px;height:1px;pointer-events:none; }
  .fade { mask-image:linear-gradient(to right,#000 calc(100% - 28px),transparent); }
</style>
