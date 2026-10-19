import type {PlannedNode,Rect} from './contracts';
import {transferHitTarget} from './transferPolicy';
const MAX_NODES=4096;
/** Read-only placement: existing measured allocations remain authoritative.
 * Public artwork may cover decoration, never native targets, stock or a modal. */
export function choosePublicDisclosurePlacement(nodes:readonly PlannedNode[],width:number,height:number,overlayHeight:number):Rect|null{
 if(!Array.isArray(nodes)||nodes.length<1||nodes.length>MAX_NODES||![width,height,overlayHeight].every(Number.isFinite)||width<=32||height<=32||overlayHeight<=0||overlayHeight>height-32)return null;
 const byId=new Map<string,PlannedNode>(),positions=new Map<string,Rect>(),visiting=new Set<string>();
 for(const node of nodes){if(!node||typeof node.id!=='string'||!node.id||byId.has(node.id)||node.parent!==null&&typeof node.parent!=='string'||!node.box||![node.box.x,node.box.y,node.box.width,node.box.height].every(Number.isFinite)||node.box.width<0||node.box.height<0)return null;byId.set(node.id,node);}
 function global(node:PlannedNode):Rect|null{
  const existing=positions.get(node.id);if(existing)return existing;if(visiting.has(node.id))return null;visiting.add(node.id);
  let x=node.box.x,y=node.box.y;
  if(node.parent!==null){const owner=byId.get(node.parent);if(!owner)return null;const parent=global(owner);if(!parent)return null;x+=parent.x;y+=parent.y;}
  visiting.delete(node.id);const rect={x,y,width:node.box.width,height:node.box.height};if(![x,y].every(Number.isFinite))return null;positions.set(node.id,rect);return rect;
 }
 const blockers:Rect[]=[],stockBottoms:number[]=[],dockTops:number[]=[];let headerBottom=4;
 const headingIds=new Set(['room-shell','room-header','room-notices','room-notice-content']),headingMembership=new Map<string,boolean>();
 function inHeading(node:PlannedNode):boolean{
  if(headingMembership.has(node.id))return headingMembership.get(node.id)!;
  const result=headingIds.has(node.id)||node.parent!==null&&inHeading(byId.get(node.parent)!);headingMembership.set(node.id,result);return result;
 }
 function paintedHeading(node:PlannedNode,box:Rect):Rect{
  let left=box.x,top=box.y,right=box.x+box.width,bottom=box.y+box.height,parent=node.parent;
  // Scroll content may be taller than the reserved notice viewport. Protect
  // its actual clipped paint, never its unscrolled offscreen allocation.
  while(parent!==null){const owner=byId.get(parent)!,clip=positions.get(parent)!;if(owner.scroll){left=Math.max(left,clip.x);right=Math.min(right,clip.x+clip.width);top=Math.max(top,clip.y);bottom=Math.min(bottom,clip.y+clip.height);}parent=owner.parent;}
  return{x:left,y:top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
 }
 // Every ancestry is resolved once; invalid disconnected/cyclic geometry fails closed.
 try{for(const node of nodes){const box=global(node);if(!box)return null;
  if(inHeading(node)){const painted=paintedHeading(node,box);if(painted.width>0&&painted.height>0){headerBottom=Math.max(headerBottom,painted.y+painted.height);blockers.push(painted);}}
  const stock=node.stockCount!==undefined&&node.visual?.kind==='back'||!!node.ownHandAnchor;
  if(stock)stockBottoms.push(box.y+box.height);
  if(node.id==='dock'||node.enabled&&transferHitTarget(node)&&node.zoneId==='hand')dockTops.push(box.y);
  if(node.enabled&&transferHitTarget(node))blockers.push({x:box.x-6,y:box.y-6,width:box.width+12,height:box.height+12});
  else if(stock||node.semanticRole==='dialog'||node.semanticRole==='alertdialog')blockers.push(box);
 }}catch{return null;}
 const candidates=[headerBottom+12,...stockBottoms.map(bottom=>bottom+12),...(dockTops.length?[Math.min(...dockTops)-overlayHeight-12]:[]),height-overlayHeight-16];
 const ys=[...new Set(candidates)].slice(0,nodes.length);
 for(const y of ys){const box={x:16,y,width:width-32,height:overlayHeight};if(!Number.isFinite(y)||y<16||y+overlayHeight>height-16)continue;
  if(blockers.every(other=>Math.min(box.x+box.width,other.x+other.width)<=Math.max(box.x,other.x)||Math.min(box.y+box.height,other.y+other.height)<=Math.max(box.y,other.y)))return Object.freeze(box);
 }
 return null;
}
