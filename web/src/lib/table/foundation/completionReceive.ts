import {consumeOwnDockReceiveCandidate,type OwnDockReceiveAllocation} from './ownDockReceive';
import type {PresentationFrame,Rect,CandidateLayout} from './contracts';
import {ownHandReceiveAllocation,ownHandReceiveStructure,participantIdentityStructure} from './participantHandoff';
import {isPublicCompletionView,completionFrameInputProof} from './publicCompletion';
/** Internal receipts only. No application DTO, native hand placeholder or card
 * artwork is retained. All rectangles here are local to the planned table root. */
export interface CompletionReceiveSource {readonly participantId:string;readonly bounds:Rect;}
export interface CompletionReceiveReservation {readonly kind:'local-receive';readonly participantId:string;readonly bounds:Rect;}
export interface CompletionReceiveNativeProof {readonly reservation:CompletionReceiveReservation;readonly regionBounds:Rect;}
type Witness={element:HTMLElement;parent:HTMLElement|null;bounds:Rect};
type Mapping={host:HTMLElement;elements:ReadonlyMap<string,HTMLElement>;content:HTMLElement;witnesses:readonly Witness[];rootBounds:Rect;viewport:Rect};
const activeAllocations=new WeakMap<OwnDockReceiveAllocation,{frame:PresentationFrame}>();
const sources=new WeakMap<CompletionReceiveSource,{frame:PresentationFrame}>();
const reservations=new WeakMap<CompletionReceiveReservation,{frame:PresentationFrame;owner:object;ready:boolean}>();
const proofs=new WeakMap<CompletionReceiveNativeProof,{frame:PresentationFrame;mapping:Mapping}>();
const copy=(b:Rect):Rect=>Object.freeze({...b});
const equal=(a:Rect,b:Rect)=>a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;
const valid=(b:Rect)=>[b.x,b.y,b.width,b.height,b.x+b.width,b.y+b.height].every(Number.isFinite)&&b.width>0&&b.height>0;
const inside=(b:Rect,c:Rect)=>valid(b)&&valid(c)&&b.x>=c.x&&b.y>=c.y&&b.x+b.width<=c.x+c.width&&b.y+b.height<=c.y+c.height;
const rect=(e:HTMLElement):Rect=>{const b=e.getBoundingClientRect();return {x:b.left,y:b.top,width:b.width,height:b.height};};
const world=(frame:PresentationFrame,id:string):Rect|null=>{const map=new Map(frame.nodes.map(n=>[n.id,n]));let n=map.get(id);if(!n)return null;const b={...n.box},seen=new Set([id]);while(n.parent){if(seen.has(n.parent))return null;seen.add(n.parent);n=map.get(n.parent);if(!n)return null;b.x+=n.box.x;b.y+=n.box.y;}return b;};
/** Exact publisher mapping, not an arbitrary matching-class wrapper. The root
 * map/stamps and content parent identify the publisher. Page offsets translate;
 * internal scrolling/transforms require another mapping and are refused. */
function mapping(frame:PresentationFrame,host:HTMLElement,elements:ReadonlyMap<string,HTMLElement>,ids:readonly string[],local:Rect,expectedContent:HTMLElement|null):Mapping|null {
 try{
  const root=elements.get('table'),content=root?.parentElement,model=frame.nodes.find(n=>n.id==='table');
  if(host.clientWidth!==frame.environment.width||host.clientHeight!==frame.environment.height||!root||!content||content!==expectedContent||!model||model.parent!==null||model.box.x!==0||model.box.y!==0||model.box.width!==frame.environment.width||model.box.height!==frame.environment.height||model.scroll||content.parentElement!==host||content.className!=='foundation-content'||Array.from(host.children).filter(e=>e.className==='foundation-content').length!==1)return null;
  const rootBounds=rect(root),viewport={x:0,y:0,width:innerWidth,height:innerHeight};if(rootBounds.width!==model.box.width||rootBounds.height!==model.box.height||!equal(rootBounds,rect(content)))return null;
  if(ids.includes('table-underlay')){const underlay=elements.get('table-underlay');if(!underlay||!equal(rect(underlay),rootBounds))return null;}
  const region={...local,x:rootBounds.x+local.x,y:rootBounds.y+local.y};if(!inside(region,viewport)||!inside(region,rect(host)))return null;
  const witnesses:Witness[]=[],seen=new Set<HTMLElement>();
  for(const id of ['table',...ids]){
   const node=frame.nodes.find(n=>n.id===id),element=elements.get(id);if(!node||!element||!element.isConnected||!host.contains(element)||element.dataset.foundationNode!==id||element.dataset.foundationFrame!==String(frame.id)||element.parentElement!==(node.parent===null?content:elements.get(node.parent)))return null;
   // Native layout quantizes CSS positions. Ownership comes from the exact
   // current model/element/parent/stamp chain; retain actual native witnesses,
   // never approximate DOMRect equality with unquantized planned arithmetic.
   if(!valid(rect(element)))return null;
   let opacity=1;for(let current:HTMLElement|null=element;current;current=current.parentElement){
    if(!current.isConnected)return null;const css=getComputedStyle(current),alpha=Number(css.opacity);opacity*=alpha;if(!Number.isFinite(alpha)||!Number.isFinite(opacity)||opacity<=0||css.display==='none'||css.visibility==='hidden'||css.visibility==='collapse'||css.transform!=='none'||css.perspective!=='none'||css.scale!=='none'||css.rotate!=='none'||css.translate!=='none'||css.zoom!=='1'&&css.zoom!=='normal')return null;
    if((current===root||current===content||current===host)&&((current.scrollLeft??0)!==0||(current.scrollTop??0)!==0))return null;
    if(/auto|scroll|hidden|clip/.test(`${css.overflowX} ${css.overflowY}`)){const b=rect(current),clip={x:b.x+current.clientLeft,y:b.y+current.clientTop,width:current.clientWidth,height:current.clientHeight};if(!inside(region,clip))return null;}
    if(!seen.has(current)){seen.add(current);witnesses.push({element:current,parent:current.parentElement,bounds:copy(rect(current))});}
   }
  }
  return {host,elements,content,witnesses:Object.freeze(witnesses),rootBounds:copy(rootBounds),viewport:copy(viewport)};
 }catch{return null;}
}
export function captureCompletionReceiveSource(frame:PresentationFrame,participantId:string,host:HTMLElement,elements:ReadonlyMap<string,HTMLElement>,content:HTMLElement|null):CompletionReceiveSource|null {
 try{
  const structure=ownHandReceiveStructure(frame,participantId),allocation=structure&&ownHandReceiveAllocation(frame,participantId,host,elements,content);
  const root=elements.get('table');if(!root)return null;const origin=rect(root);let bounds:Rect,ids:readonly string[];
  if(structure&&allocation){bounds={...allocation.regionBounds,x:allocation.regionBounds.x-origin.x,y:allocation.regionBounds.y-origin.y};ids=[structure.identity.id,structure.core.id,structure.anchor.id,structure.figure.id];}
  else {
   const issued=frame.ownDockReceiveAllocation,owner=issued&&activeAllocations.get(issued),identity=participantIdentityStructure(frame,'own-hand-count-anchor');
   if(!issued||owner?.frame!==frame||issued.participantId!==participantId||frame.settled||frame.modalId||!identity?.local||identity.participantId!==participantId||identity.anchor.ownHandAnchor?.count!==0)return null;
   const dock=elements.get('dock'),hand=elements.get('hand'),figure=elements.get(identity.figure.id),anchor=elements.get(identity.anchor.id),core=elements.get(identity.core.id),person=elements.get(identity.identity.id);
   if(!dock||!hand||hand.children.length!==0||!figure||!anchor||!core||!person)return null;
   const d=rect(dock),h=rect(hand),i=rect(person),f=rect(figure),clip={x:d.x+dock.clientLeft,y:d.y+dock.clientTop,width:dock.clientWidth,height:dock.clientHeight};
   // The parent owns this CURRENT side-row column. Its silent reserved
   // hand row has no text, private artwork or fake nonempty fan. Sibling geometry
   // carries browser quantization, while private candidate identity owns it.
   if(h.y!==i.y||h.x<i.x+i.width||!inside(i,clip)||!inside(h,clip)||!equal(rect(anchor),f)||!inside(f,rect(core)))return null;
   const intersection=(a:Rect,b:Rect):Rect=>({x:Math.max(a.x,b.x),y:Math.max(a.y,b.y),width:Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x),height:Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)});
   const visible=intersection({x:h.x+hand.clientLeft,y:i.y,width:hand.clientWidth,height:Math.max(i.height,h.height)},clip);
   bounds={...visible,x:visible.x-origin.x,y:visible.y-origin.y};ids=['dock','hand',identity.identity.id,identity.core.id,identity.anchor.id,identity.figure.id];
  }
  if(!mapping(frame,host,elements,ids,bounds,content))return null;
  const source=Object.freeze({participantId,bounds:copy(bounds)});sources.set(source,{frame});return source;
 }catch{return null;}
}
/** Consumed synchronously at the owned before→Done boundary; no old frame/DOM
 * is retained by the public recipe or completion grant. */
export function consumeCompletionReceiveSource(source:CompletionReceiveSource,frame:PresentationFrame,participantId:string):Rect|null {
 const proof=sources.get(source);sources.delete(source);return proof?.frame===frame&&source.participantId===participantId?copy(source.bounds):null;
}
function completionShape(frame:PresentationFrame,participantId:string,bounds:Rect):boolean {
 const view=frame.publicCompletion;if(!isPublicCompletionView(view)||frame.modalId||!frame.settled||!inside(bounds,{x:0,y:0,width:frame.environment.width,height:frame.environment.height})||frame.nodes.some(n=>n.id==='hand'||n.id==='hand-fan'||n.entityId||n.cardId))return false;
 if(frame.nodes.length>4096||new Set(frame.nodes.map(n=>n.id)).size!==frame.nodes.length||view.recipe.width!==frame.environment.width||view.recipe.height!==frame.environment.height)return false;
 const slots=frame.nodes.filter(n=>n.trickSlot);if(slots.length!==view.recipe.slots.length||slots.some(n=>n.zoneId!==view.sourceCollectionId||!view.recipe.slots.some(s=>s.ownerId===n.ownerId&&equal(world(frame,n.id)!,s.bounds))))return false;
 const local=view.recipe.participants.filter(p=>p.local);if(local.length!==1||local[0].participantId!==participantId)return false;
 const identityProof=participantIdentityStructure(frame,'own-hand-count-anchor');if(!identityProof?.local||identityProof.participantId!==participantId)return false;
 for(const retained of view.recipe.containers??[]){const node=frame.nodes.find(n=>n.id===retained.id),bounds=node&&world(frame,node.id);if(!node||node.kind!=='group'||node.parent!==retained.parentId||!bounds||!equal(bounds,retained.bounds))return false;}
 const root=frame.nodes.filter(n=>n.parent===null),underlay=frame.nodes.find(n=>n.id==='table-underlay'),identity=frame.nodes.find(n=>n.id==='identity'),core=frame.nodes.find(n=>n.id==='identity-portrait'),anchor=frame.nodes.find(n=>n.id==='own-hand-count-anchor'),figure=frame.nodes.find(n=>n.id==='identity-figure');
 return root.length===1&&root[0].id==='table'&&root[0].box.x===0&&root[0].box.y===0&&!root[0].scroll&&root[0].box.width===frame.environment.width&&root[0].box.height===frame.environment.height&&!!underlay&&underlay.parent==='table'&&underlay.box.x===0&&underlay.box.y===0&&underlay.box.width===frame.environment.width&&underlay.box.height===frame.environment.height&&!underlay.scroll&&!!identity&&identity.parent===(local[0].parentId??'table-underlay')&&!!world(frame,identity.id)&&inside(world(frame,identity.id)!,local[0].bounds)&&!!core&&core.parent==='identity'&&!!anchor&&anchor.parent===core.id&&anchor.ownHandAnchor?.participantId===participantId&&anchor.ownHandAnchor.count===0&&!!figure&&figure.parent===core.id&&figure.ownerId===participantId&&equal(anchor.box,figure.box)&&frame.nodes.filter(n=>n.kind==='figure'&&n.ownerId===participantId).length===1;
}
function materializeCompletionReceiveFrame(frame:PresentationFrame,owner:object,layout?:CandidateLayout):PresentationFrame {
 const active=layout&&consumeOwnDockReceiveCandidate(layout,frame);if(active){const owned=Object.freeze({...frame,ownDockReceiveAllocation:active});activeAllocations.set(active,{frame:owned});return owned;}
 const local=frame.publicCompletion?.recipe.localReceive;if(!local||!completionShape(frame,local.participantId,local.bounds))return frame;
 const reservation:CompletionReceiveReservation=Object.freeze({kind:'local-receive',participantId:local.participantId,bounds:copy(local.bounds)}),owned=Object.freeze({...frame,completionReceiveReservation:reservation});reservations.set(reservation,{frame:owned,owner,ready:false});return owned;
}
/** Issued reader is for postpatch proof construction only; it grants no paper. */
export function issuedCompletionReceiveReservation(frame:PresentationFrame):CompletionReceiveReservation|null {
 const r=frame.completionReceiveReservation,proof=r&&reservations.get(r);return r&&proof?.frame===frame&&isPublicCompletionView(frame.publicCompletion)&&performance.now()<frame.publicCompletion.event.expiresAt&&completionShape(frame,r.participantId,r.bounds)?r:null;
}
export function readyCompletionReceiveReservation(frame:PresentationFrame):CompletionReceiveReservation|null {const r=issuedCompletionReceiveReservation(frame);return r&&reservations.get(r)?.ready?r:null;}
/** Native postpatch mapping proof; never marks runtime Ready itself. */
export function completionReceiveNativeProof(frame:PresentationFrame,host:HTMLElement,elements:ReadonlyMap<string,HTMLElement>,content:HTMLElement|null):CompletionReceiveNativeProof|null {
 const reservation=issuedCompletionReceiveReservation(frame);if(!reservation)return null;const mapped=mapping(frame,host,elements,['table-underlay','identity','identity-portrait','identity-figure','own-hand-count-anchor'],reservation.bounds,content);if(!mapped)return null;
 const proof=Object.freeze({reservation,regionBounds:copy({...reservation.bounds,x:reservation.bounds.x+mapped.rootBounds.x,y:reservation.bounds.y+mapped.rootBounds.y})});proofs.set(proof,{frame,mapping:mapped});return proof;
}
export function currentCompletionReceiveNativeProof(proof:CompletionReceiveNativeProof,frame:PresentationFrame,host:HTMLElement,elements:ReadonlyMap<string,HTMLElement>,requireReady=true):boolean {
 const owned=proofs.get(proof);if(!owned||owned.frame!==frame||owned.mapping.host!==host||owned.mapping.elements!==elements||(requireReady?!readyCompletionReceiveReservation(frame):!issuedCompletionReceiveReservation(frame))||proof.reservation!==frame.completionReceiveReservation)return false;
 const next=completionReceiveNativeProof(frame,host,elements,owned.mapping.content),m=next&&proofs.get(next)?.mapping;return !!next&&!!m&&equal(next.regionBounds,proof.regionBounds)&&equal(m.viewport,owned.mapping.viewport)&&m.witnesses.length===owned.mapping.witnesses.length&&m.witnesses.every((w,i)=>{const old=owned.mapping.witnesses[i];return w.element===old.element&&w.parent===old.parent&&equal(w.bounds,old.bounds);});
}
function acknowledgeCompletionReceive(frame:PresentationFrame,proof:CompletionReceiveNativeProof|undefined,document:Parameters<typeof completionFrameInputProof>[1],owner:object):boolean {
 if(!frame.completionReceiveReservation)return true;if(reservations.get(frame.completionReceiveReservation)?.owner!==owner||!proof||!completionFrameInputProof(frame,document))return false;const owned=proofs.get(proof);if(!owned||!currentCompletionReceiveNativeProof(proof,frame,owned.mapping.host,owned.mapping.elements,false))return false;reservations.get(proof.reservation)!.ready=true;return true;
}

/** The runtime keeps this issuer closure private. Native proof producers and
 * readers cannot promote an issued receipt to Ready. */
export function createCompletionReceiveIssuer(){const owner={};return Object.freeze({materialize:(frame:PresentationFrame,layout?:CandidateLayout)=>materializeCompletionReceiveFrame(frame,owner,layout),acknowledge:(frame:PresentationFrame,proof:CompletionReceiveNativeProof|undefined,document:Parameters<typeof completionFrameInputProof>[1])=>acknowledgeCompletionReceive(frame,proof,document,owner)});}
