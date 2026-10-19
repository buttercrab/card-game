import type { Bounds } from './movement';
export type DecisionMode = 'row' | 'flow' | 'stack' | 'actions' | 'bid' | 'exchange' | 'discard' | 'strip';
export interface DecisionItem { id: string; width: number; height: number; primary?: boolean; kind?: string }
export interface DecisionInput {
  mode: DecisionMode; width: number; height?: number; viewport: {width:number;height:number};
  items: readonly DecisionItem[]; gap?: number; align?: 'start' | 'center' | 'end';
  /** Reserved paint space inside a scrolling region. */
  inset?: number;
}
export interface DecisionNode { id: string; bounds: Bounds; fill: boolean; visible: boolean }
export function decisionPolicy(viewport: {width:number;height:number}) {
  return {wide:viewport.width>=600,desktop:viewport.width>=1024&&viewport.height>=640,
    short:viewport.width>viewport.height&&viewport.height<=520};
}
/** Minimum unconstrained width is distinct from the current assigned box. */
export function decisionMinimumWidth(mode: DecisionMode, items: readonly DecisionItem[], viewport: {width:number;height:number}, gap=6): number {
  const wide=decisionPolicy(viewport).wide;
  if(mode==='actions')return items.reduce((sum,item)=>sum+Math.max(item.primary?(wide?180:100):88,item.width),0)+Math.max(0,items.length-1)*gap;
  if(mode==='stack'||mode==='exchange'||mode==='strip')return Math.max(0,...items.map(item=>item.width));
  return items.reduce((sum,item)=>sum+item.width,0)+Math.max(0,items.length-1)*gap;
}
export function layoutDecision(input:DecisionInput) {
  const inset=Math.max(0,input.inset??0);
  const content=layoutDecisionContent({...input,width:Math.max(0,input.width-inset*2),height:Math.max(0,(input.height??0)-inset*2)});
  return {...content,height:content.height+inset*2,contentWidth:content.contentWidth+inset*2,
    nodes:content.nodes.map(node=>({...node,bounds:{...node.bounds,x:node.bounds.x+inset,y:node.bounds.y+inset}}))};
}
function layoutDecisionContent({mode,width,height=0,viewport,items,gap=6,align='start'}:DecisionInput) {
  width=Math.max(0,width);
  const policy=decisionPolicy(viewport);
  const nodes:DecisionNode[]=[];
  const add=(item:DecisionItem,x:number,y:number,w=item.width,h=item.height,fill=false,visible=true)=>{
    nodes.push({id:item.id,bounds:{x,y,width:Math.max(0,w),height:Math.max(0,h)},fill,visible});
  };
  if(mode==='strip') {
    let contentHeight=0;
    for(const item of items) {
      const isControls=item.kind==='controls';
      const w=isControls||item.kind==='aside'?width:Math.min(item.width,Math.max(0,width-16));
      const y=policy.short?0:height-item.height;
      add(item,isControls||item.kind==='aside'?0:(width-w)/2,y,w,item.height,isControls||item.kind==='aside');
      contentHeight=Math.max(contentHeight,item.height);
    }
    return {nodes,height:policy.short?contentHeight:height,contentWidth:width};
  }
  if(mode==='stack') {
    let y=0;
    for(const item of items) {add(item,0,y,width,item.height,true);y+=item.height+gap;}
    return {nodes,height:items.length?y-gap:0,contentWidth:width};
  }
  if(mode==='bid') {
    const contentWidth=policy.wide?Math.min(760,width):width;
    const x=(width-contentWidth)/2;
    const caption=items.find(i=>i.kind==='caption');
    const picks=items.find(i=>i.kind==='picks');
    const actions=items.find(i=>i.kind==='actions');
    let y=0;
    if(caption){add(caption,x,0,contentWidth,caption.height,true);y+=caption.height+gap;}
    // Two blocks are one numeric row only when their measured minimums fit.
    const pickWidth=picks?.width??0, actionWidth=actions?.width??0;
    if(policy.wide&&picks&&actions&&pickWidth+actionWidth+16<=contentWidth) {
      const rowWidth=pickWidth+actionWidth+16,rowHeight=Math.max(picks.height,actions.height);
      add(picks,(width-rowWidth)/2,y+(rowHeight-picks.height)/2,pickWidth,picks.height,true);
      add(actions,(width-rowWidth)/2+pickWidth+16,y+(rowHeight-actions.height)/2,actionWidth,actions.height,true);
      return {nodes,height:y+rowHeight,contentWidth:width};
    }
    if(picks){add(picks,x,y,contentWidth,picks.height,true);y+=picks.height+gap;}
    if(actions){add(actions,x,y,contentWidth,actions.height,true);y+=actions.height;}
    return {nodes,height:y,contentWidth:width};
  }
  if(mode==='exchange'&&policy.desktop) {
    const left=items.find(i=>i.kind==='contract-controls'), right=items.find(i=>i.kind==='discard');
    const rightWidth=Math.min(240,width),leftWidth=Math.max(0,width-rightWidth-12);
    if(left)add(left,0,0,leftWidth,left.height,true);
    if(right)add(right,leftWidth+12,0,rightWidth,right.height,true);
    for(const item of items)if(item!==left&&item!==right)add(item,0,0,0,0,true,false);
    return {nodes,height:Math.max(left?.height??0,right?.height??0),contentWidth:width};
  }
  if(mode==='exchange') {
    const contentWidth=policy.wide?Math.min(760,width):width;
    let y=0;
    for(const item of items){add(item,(width-contentWidth)/2,y,contentWidth,item.height,true);y+=item.height+gap;}
    return {nodes,height:items.length?y-gap:0,contentWidth:width};
  }
  if(mode==='discard'&&policy.desktop) {
    const count=items.find(i=>i.kind==='count'), description=items.find(i=>i.kind==='muted');
    const confirm=items.find(i=>i.kind==='desktop-confirm'), button=items.find(i=>i.kind==='discard-btn');
    const lineHeight=Math.max(count?.height??0,description?.height??0);
    if(count)add(count,0,0,count.width,lineHeight);
    if(description)add(description,(count?.width??0)+8,0,Math.max(0,width-(count?.width??0)-8),lineHeight,true);
    const selected=confirm??button;
    if(selected)add(selected,0,lineHeight+8,width,selected.height,true);
    for(const item of items)if(item!==count&&item!==description&&item!==selected)add(item,0,0,0,0,true,false);
    return {nodes,height:lineHeight+(selected?8+selected.height:0),contentWidth:width};
  }
  if(mode==='discard') {
    const count=items.find(i=>i.kind==='count'), description=items.find(i=>i.kind==='muted'), button=items.find(i=>i.kind==='discard-btn');
    const lineHeight=Math.max(0,...[count,description,button].map(item=>item?.height??0));
    const buttonWidth=button?.width??0, countWidth=count?.width??0;
    if(count)add(count,0,(lineHeight-count.height)/2,countWidth,count.height);
    if(description)add(description,countWidth+gap,(lineHeight-description.height)/2,Math.max(0,width-countWidth-buttonWidth-2*gap),description.height,true);
    if(button)add(button,Math.max(0,width-buttonWidth),(lineHeight-button.height)/2,buttonWidth,button.height,true);
    for(const item of items)if(item!==count&&item!==description&&item!==button)add(item,0,0,0,0,true,false);
    return {nodes,height:lineHeight,contentWidth:width};
  }
  const active=items;
  for(const item of items)if(!active.includes(item))add(item,0,0,0,0,true,false);
  const actionMode=mode==='actions';
  const minimums=active.map(item=> actionMode?Math.max(item.primary?(policy.wide?180:100):88,item.width):item.width);
  const naturalWidth=minimums.reduce((sum,n)=>sum+n,0)+Math.max(0,active.length-1)*gap;
  const lineHeight=Math.max(0,...active.map(i=>i.height));
  if(mode==='row'||actionMode) {
    const primaryIndex=active.findIndex(i=>i.primary);
    const allocations=minimums.map((minimum,index)=>actionMode&&index===primaryIndex&&!policy.wide?Math.max(minimum,width-naturalWidth+minimum):minimum);
    const allocatedWidth=allocations.reduce((sum,value)=>sum+value,0)+Math.max(0,active.length-1)*gap;
    let x=align==='center'?Math.max(0,(width-allocatedWidth)/2):align==='end'?Math.max(0,width-allocatedWidth):0;
    for(let index=0;index<active.length;index++) {
      const item=active[index],allocated=allocations[index];
      add(item,x,(lineHeight-item.height)/2,allocated,item.height,actionMode);x+=allocated+gap;
    }
    return {nodes,height:lineHeight,contentWidth:Math.max(width,allocatedWidth)};
  }
  // Wrapped rows keep the requested alignment, including the last row.
  let y=0,rowHeight=0,rowWidth=0;
  let row:{item:DecisionItem;width:number}[]=[];
  function finishRow(){
    if(!row.length)return;
    let x=align==='center'?(width-rowWidth)/2:align==='end'?width-rowWidth:0;
    for(const entry of row){add(entry.item,x,y,entry.width,entry.item.height);x+=entry.width+gap;}
    y+=rowHeight+gap;row=[];rowHeight=0;rowWidth=0;
  }
  for(const item of active){
    const w=Math.min(width,item.width);
    if(row.length&&rowWidth+gap+w>width)finishRow();
    rowWidth+=(row.length?gap:0)+w;row.push({item,width:w});rowHeight=Math.max(rowHeight,item.height);
  }
  finishRow();
  return {nodes,height:active.length?y-gap:0,contentWidth:width};
}
