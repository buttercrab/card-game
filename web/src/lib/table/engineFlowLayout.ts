import type { Bounds } from './movement';
export interface EngineFlowItem { id:string; width:number; height:number; size?:number|'fill'; minWidth?:number; maxWidth?:number; gapAfter?:number }
export interface EngineFlowOptions { direction?:'row'|'column'; gap?:number; rowGap?:number; nowrap?:boolean; justify?:'start'|'center'|'end'|'between'; align?:'start'|'center'|'end'; minHeight?:number }
/** Resolve measured native leaves into engine-owned boxes, including nested intrinsic rows. */
export function layoutEngineFlow(items:readonly EngineFlowItem[], available:number|undefined, options:EngineFlowOptions={}) {
 const gap=Math.max(0,options.gap??0),rowGap=Math.max(0,options.rowGap??gap),direction=options.direction??'row';
 const natural=(item:EngineFlowItem)=>Math.max(0,typeof item.size==='number'?item.size:item.size==='fill'?(item.minWidth??0):item.width);
 const width=Math.max(0,available??(direction==='column'?Math.max(0,...items.map(natural)):items.reduce((s,i)=>s+natural(i),0)+Math.max(0,items.length-1)*gap));
 const nodes:{id:string;bounds:Bounds}[]=[];
 if(direction==='column'){let y=0;for(const item of items){const itemWidth=item.size==='fill'?width:Math.min(width,natural(item));const x=options.align==='start'?0:options.align==='end'?width-itemWidth:(width-itemWidth)/2;nodes.push({id:item.id,bounds:{x,y,width:itemWidth,height:Math.max(0,item.height)}});y+=Math.max(0,item.height)+(item.gapAfter??gap);}return{width,height:Math.max(options.minHeight??0,items.length?y-(items.at(-1)!.gapAfter??gap):0),nodes};}
 const lines:EngineFlowItem[][]=[];
 for(const item of items){let line=lines.at(-1);const candidateWidth=Math.max(item.minWidth??0,Math.min(width,natural(item)));const used=line?.reduce((sum,i)=>sum+Math.min(width,natural(i)),0)??0;if(!line||options.nowrap===false&&(used+line.length*gap+candidateWidth>width)){line=[];lines.push(line);}line.push(item);}
 let y=0;
 for(const line of lines){const reserved=Math.max(0,line.length-1)*gap;const fixed=line.reduce((sum,item)=>sum+(item.size==='fill'?0:Math.min(width,natural(item))),0);const fills=line.filter(item=>item.size==='fill');const flexible=Math.max(0,width-fixed-reserved)/Math.max(1,fills.length);const sizes=line.map(item=>item.size==='fill'?Math.max(0,Math.min(item.maxWidth??Infinity,Math.max(item.minWidth??0,flexible))):Math.min(width,natural(item)));const used=sizes.reduce((s,w)=>s+w,0)+reserved;let spacing=gap;let x=options.justify==='center'?(width-used)/2:options.justify==='end'?width-used:0;if(options.justify==='between'&&line.length>1)spacing=gap+Math.max(0,width-used)/(line.length-1);const h=Math.max(options.minHeight??0,...line.map(item=>Math.max(0,item.height)));line.forEach((item,index)=>{const height=Math.max(0,item.height);const offset=options.align==='start'?0:options.align==='end'?h-height:(h-height)/2;nodes.push({id:item.id,bounds:{x,y:y+offset,width:sizes[index],height}});x+=sizes[index]+spacing;});y+=h+rowGap;}
 return{width,height:Math.max(options.minHeight??0,lines.length?y-rowGap:0),nodes};
}
