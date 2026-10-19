import type {PlannedNode,Rect,Size} from './contracts';
import {transferHitTarget} from './transferPolicy';
const MAX_NODES=4096,MARGIN=16,GAP=8;
const kinds=new Set(['editor','group','text','figure','card','command','choice','suit','progress','select','icon','toggle','range']);
const headingIds=new Set(['room-shell','room-header','room-notices','room-notice-content']);
const positive=(value:number)=>Number.isFinite(value)&&value>0;
const intersects=(a:Rect,b:Rect)=>Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)&&Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y);
/** Read-only observer feedback placement in measured current paint space.
 * This supplies no input/motion waiver and never measures or calls the host. */
export function chooseObserverReactionPlacement(nodes:readonly PlannedNode[],width:number,height:number,overlay:Size,naturalText?:ReadonlyMap<string,Size>):Rect|null{
 try{
  if(!Array.isArray(nodes)||nodes.length<1||nodes.length>MAX_NODES||!positive(width)||!positive(height)||!overlay||!positive(overlay.width)||!positive(overlay.height)||overlay.width>width-MARGIN*2||overlay.height>height-MARGIN*2)return null;
  const byId=new Map<string,PlannedNode>(),children=new Map<string,string[]>();let root:PlannedNode|undefined;
  for(const node of nodes){
   if(!node||typeof node.id!=='string'||!node.id||node.id.length>2048||byId.has(node.id)||!kinds.has(node.kind)||typeof node.label!=='string'||node.label.length>32768||node.parent!==null&&(typeof node.parent!=='string'||!node.parent)||!node.box||![node.box.x,node.box.y,node.box.width,node.box.height].every(Number.isFinite)||node.box.width<0||node.box.height<0||node.textAlign!==undefined&&!['start','center','end'].includes(node.textAlign)||node.scroll!==undefined&&typeof node.scroll!=='boolean'||node.enabled!==undefined&&typeof node.enabled!=='boolean')return null;
   if(node.semanticRole==='dialog'||node.semanticRole==='alertdialog')return null;
   if(node.parent===null){if(root||node.kind!=='group')return null;root=node;}
   byId.set(node.id,node);
  }
  if(!root)return null;
  for(const node of nodes)if(node.parent!==null){if(!byId.has(node.parent))return null;const list=children.get(node.parent)??[];list.push(node.id);children.set(node.parent,list);}
  const positions=new Map<string,Rect>(),clips=new Map<string,Rect>(),headings=new Map<string,boolean>(),queue=[root.id],viewport:Rect={x:0,y:0,width,height};
  const intersect=(a:Rect,b:Rect):Rect=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);return{x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};};
  for(let index=0;index<queue.length;index++){
   const node=byId.get(queue[index])!;if(positions.has(node.id))return null;
   const parent=node.parent===null?null:byId.get(node.parent)!,parentBox=parent?positions.get(parent.id)!:null;
   const box={x:node.box.x+(parentBox?.x??0),y:node.box.y+(parentBox?.y??0),width:node.box.width,height:node.box.height};if(![box.x,box.y,box.x+box.width,box.y+box.height].every(Number.isFinite))return null;
   const parentClip=parent?clips.get(parent.id)!:viewport,clip=parent?.scroll?intersect(parentClip,parentBox!):parentClip;
   positions.set(node.id,box);clips.set(node.id,clip);headings.set(node.id,headingIds.has(node.id)||!!(parent&&headings.get(parent.id)));queue.push(...children.get(node.id)??[]);
  }
  if(positions.size!==nodes.length)return null; // Disconnected cycles cannot be silently ignored.
  const blockers:Rect[]=[],stockEdges:number[]=[],dockEdges:number[]=[],xEdges:number[]=[],yEdges:number[]=[];let headerBottom=4;
  for(const node of nodes){
   const box=positions.get(node.id)!,clip=clips.get(node.id)!;let paint=box;
   const heading=headings.get(node.id),native=transferHitTarget(node),card=node.kind==='card'||node.stockCount!==undefined||!!node.ownHandAnchor;
   if(node.id==='dock'){const painted=intersect(box,clip);if(painted.width>0&&painted.height>0)dockEdges.push(painted.y-overlay.height-GAP);}
   const readable=node.kind==='text'&&!!node.label.trim(),status=node.semanticRole==='status'&&!!node.label.trim();
   if(!heading&&!native&&!card&&!readable&&!status&&node.kind!=='suit'&&node.kind!=='progress'&&node.kind!=='figure')continue;
   if(readable&&!heading&&!native&&naturalText&&!/[\n\r\u2028\u2029]/.test(node.label)){
    const natural=naturalText.get(node.id);
    // An intrinsic advance fitting the allocation proves no wrapping. A
    // reserved multi-label envelope must not turn whitespace into a blocker.
    if(natural&&positive(natural.width)&&positive(natural.height)&&natural.width<=box.width&&natural.height<=box.height){
     const offset=node.textAlign==='center'?(box.width-natural.width)/2:node.textAlign==='end'?box.width-natural.width:0;
     paint={x:box.x+offset,y:box.y,width:natural.width,height:natural.height};
    }
   }
   paint=intersect(paint,clip);if(paint.width<=0||paint.height<=0)continue;
   if(heading)headerBottom=Math.max(headerBottom,paint.y+paint.height);
   if(node.stockCount!==undefined||node.ownHandAnchor)stockEdges.push(paint.y+paint.height+GAP);
   if(node.id==='dock'||node.zoneId==='hand')dockEdges.push(paint.y-overlay.height-GAP);
   if(native)paint={x:paint.x-6,y:paint.y-6,width:paint.width+12,height:paint.height+12};
   blockers.push(paint);xEdges.push(paint.x-overlay.width-GAP,paint.x+paint.width+GAP);yEdges.push(paint.y-overlay.height-GAP,paint.y+paint.height+GAP);
  }
  // Eight independent x/y choices cap all candidate tests at64. Center is
  // exhausted before side positions; measured edges supply narrow gaps.
  const middle=(width-overlay.width)/2,minX=MARGIN,maxX=width-overlay.width-MARGIN,minY=MARGIN,maxY=height-overlay.height-MARGIN;
  const boundedUnique=(values:readonly number[],min:number,max:number)=>[...new Set(values.filter(value=>Number.isFinite(value)&&value>=min&&value<=max))].slice(0,8);
  const xs=boundedUnique([middle,minX,maxX,...xEdges.sort((a,b)=>Math.abs(a-middle)-Math.abs(b-middle))],minX,maxX);
  const firstY=Math.max(MARGIN,headerBottom+12);
  const ys=boundedUnique([firstY,...stockEdges,...dockEdges,...yEdges.sort((a,b)=>Math.abs(a-firstY)-Math.abs(b-firstY)),minY,maxY,(height-overlay.height)/2],minY,maxY);
  for(const x of xs)for(const y of ys){const box={x,y,width:overlay.width,height:overlay.height};if(blockers.every(blocker=>!intersects(box,blocker)))return Object.freeze(box);}
  return null;
 }catch{return null;}
}
