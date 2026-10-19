import {layoutFeedback,type FeedbackGeometry} from './participantPolicy';
import {figurePaintBounds} from './figureArtworkMetrics';
import {transferHitTarget} from './transferPolicy';
import type {PlannedNode,Rect,Size} from './contracts';
/** Existing FeedbackDock reaction geometry, translated into the owned table. */
export function participantReactionAnchor(identity:Rect,reaction:Size,geometry:FeedbackGeometry={}):Rect{
 const anchor=layoutFeedback(identity.width,[],reaction,geometry).reaction;
 return {...anchor,x:identity.x+anchor.x,y:identity.y+anchor.y};
}
export type ParticipantReactionFit={readonly kind:'fits'}|{readonly kind:'unavailable';readonly reason:'shape'|'owner'|'viewport'|'paint';readonly blockerId?:string};
/** Read-only fit proof for the ORIGINAL anchor. It never moves a reaction,
 * changes layout, hides canonical facts, or grants input/motion authority. */
export function participantReactionFits(nodes:readonly PlannedNode[],ownerId:string,candidate:Rect,viewport:Size):ParticipantReactionFit{
 const fail=(reason:'shape'|'owner'|'viewport'|'paint',blockerId?:string):ParticipantReactionFit=>({kind:'unavailable',reason,...(blockerId?{blockerId}:{})});
 const valid=(box:Rect)=>[box.x,box.y,box.width,box.height].every(Number.isFinite)&&box.width>=0&&box.height>=0;
 const overlap=(a:Rect,b:Rect)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
 const intersect=(a:Rect,b:Rect):Rect=>({x:Math.max(a.x,b.x),y:Math.max(a.y,b.y),width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))});
 try{
  if(!nodes.length||nodes.length>4096||!valid(candidate)||candidate.width<=0||candidate.height<=0||![viewport.width,viewport.height].every(value=>Number.isFinite(value)&&value>0))return fail('shape');
  if(candidate.x<0||candidate.y<0||candidate.x+candidate.width>viewport.width||candidate.y+candidate.height>viewport.height)return fail('viewport');
  const byId=new Map(nodes.map(node=>[node.id,node]));if(byId.size!==nodes.length||nodes.filter(node=>node.parent===null).length!==1||nodes.some(node=>!valid(node.box)))return fail('shape');
  if(nodes.filter(node=>node.kind==='figure'&&node.ownerId===ownerId).length!==1)return fail('owner');
  const boxes=new Map<string,Rect>();
  const world=(node:PlannedNode):Rect=>{const cached=boxes.get(node.id);if(cached)return cached;let x=node.box.x,y=node.box.y,parent=node.parent;const seen=new Set([node.id]);while(parent){const ancestor=byId.get(parent);if(!ancestor||seen.has(parent))throw Error('ancestry');seen.add(parent);x+=ancestor.box.x;y+=ancestor.box.y;parent=ancestor.parent;}const box={...node.box,x,y};if(!valid(box))throw Error('shape');boxes.set(node.id,box);return box;};
  const screen:Rect={x:0,y:0,...viewport};
  for(const node of nodes){
   const box=world(node),rootViewport=node.parent===null&&node.id==='table'&&node.kind==='group'&&node.label===''&&node.arrangement==='overlay'&&!node.decoration&&!node.tone&&Object.keys(node).every(key=>['id','parent','kind','label','arrangement','scroll','box'].includes(key)),hit=transferHitTarget(node)||!!node.scroll&&!rootViewport,paint=node.kind!=='group'||node.decoration||node.tone||node.trickSlot;
   if(!hit&&!paint)continue;
   let footprint=node.kind==='figure'?figurePaintBounds(box,true):box,parent=node.parent;
   if(hit&&!node.scroll){const container=node.parent?byId.get(node.parent):undefined;if(container?.id===JSON.stringify(['control-envelope',node.id])||container?.id===JSON.stringify(['tool-envelope',node.id]))footprint=world(container);else footprint={x:footprint.x-6,y:footprint.y-6,width:footprint.width+12,height:footprint.height+12};}
   while(parent){const ancestor=byId.get(parent)!;if(ancestor.scroll)footprint=intersect(footprint,world(ancestor));parent=ancestor.parent;}
   footprint=intersect(footprint,screen);if(footprint.width>0&&footprint.height>0&&overlap(candidate,footprint))return fail('paint',node.id);
  }
  return {kind:'fits'};
 }catch{return fail('shape');}
}
