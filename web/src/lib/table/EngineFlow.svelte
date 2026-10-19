<script lang="ts">
 import {onDestroy,type Snippet} from 'svelte';
 import type {Attachment} from 'svelte/attachments';
 import {tableCoordinates} from './coordinateContext';
 import {createFrameMeasurements} from './frameMeasurements';
 import {layoutEngineFlow,type EngineFlowOptions} from './engineFlowLayout';
 let {items,children,fill=false,gap=0,rowGap,nowrap=true,justify='start',align='center',direction='row',minHeight=0,onready,inset={left:0,right:0,top:0,bottom:0},class:className='',style=''}:{items:readonly {id:string;width?:number|'fill';minWidth?:number;maxWidth?:number;gapAfter?:number;allowEmpty?:boolean;expectedHeight?:number}[];children:Snippet<[string]>;fill?:boolean;gap?:number;rowGap?:number;nowrap?:boolean;justify?:EngineFlowOptions['justify'];align?:EngineFlowOptions['align'];direction?:EngineFlowOptions['direction'];minHeight?:number;onready?:(ready:boolean)=>void;inset?:{left?:number;right?:number;top?:number;bottom?:number};class?:string;style?:string}=$props();
 let host:HTMLDivElement;const shared=tableCoordinates();const measurements=shared?.measurements??createFrameMeasurements(()=>host);let width=$state(0),hostHeight=$state(0),sizes=$state<Record<string,{width:number;height:number}>>({});
 $effect(()=>host&&measurements.observeSize(host,size=>{width=size.width;hostHeight=size.height}));
 const attachments=new Map<string,Attachment<HTMLElement>>();function measure(id:string):Attachment<HTMLElement>{if(!attachments.has(id))attachments.set(id,element=>measurements.observeSize(element,size=>{if(sizes[id]?.width!==size.width||sizes[id]?.height!==size.height)sizes={...sizes,[id]:size}}));return attachments.get(id)!;}
 const layout=$derived.by(()=>{const left=inset.left??0,right=inset.right??0,top=inset.top??0,bottom=inset.bottom??0;const core=layoutEngineFlow(items.map(item=>({id:item.id,...(sizes[item.id]??{width:0,height:0}),size:item.width,minWidth:item.minWidth,maxWidth:item.maxWidth,gapAfter:item.gapAfter})),fill?Math.max(0,width-left-right):undefined,{gap,rowGap,nowrap,justify,align,direction,minHeight:Math.max(0,minHeight-top-bottom)});return{width:core.width+left+right,height:core.height+top+bottom,nodes:core.nodes.map(node=>({...node,bounds:{...node.bounds,x:node.bounds.x+left,y:node.bounds.y+top}}))};});
 const ready=$derived((!fill||width>0)&&Math.abs(hostHeight-layout.height)<=1&&items.every(item=>{const size=sizes[item.id],box=layout.nodes.find(node=>node.id===item.id)?.bounds;return !!size&&!!box&&(size.height>0||item.allowEmpty===true)&&(item.expectedHeight===undefined||Math.abs(size.height-item.expectedHeight)<=1)&&(item.width!=='fill'&&typeof item.width!=='number'||Math.abs(size.width-box.width)<=1);}));
 $effect(()=>{onready?.(ready)});
 const boxes=$derived(new Map(layout.nodes.map(node=>[node.id,node.bounds])));
 onDestroy(()=>{attachments.clear();if(!shared)measurements.dispose()});
</script>
<div class="engine-flow {className}" {style} bind:this={host} style:width={fill?'100%':`${layout.width}px`} style:height={`${layout.height}px`} data-engine-layout="measured-flow">
 {#each items as item(item.id)}
  {@const box=boxes.get(item.id)}
  <div class="engine-slot" style:left={`${box?.x??0}px`} style:top={`${box?.y??0}px`} style:width={`${box?.width??0}px`} style:height={`${box?.height??0}px`} style:visibility={sizes[item.id]&&(!fill||width>0)?undefined:'hidden'}>
   <div class="engine-content" {@attach measure(item.id)} style:width={item.width==='fill'||typeof item.width==='number'?'100%':'max-content'}>{@render children(item.id)}</div>
  </div>
 {/each}
</div>
<style>
 .engine-flow{position:relative;min-width:0;}
 .engine-slot{position:absolute;min-width:0;overflow:visible;}
 .engine-content{min-width:0;}
</style>
