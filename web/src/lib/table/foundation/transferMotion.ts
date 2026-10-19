import {proveFreshDealOrigin} from './freshDealOrigin';
import type { PlannedNode, PresentationFrame, Rect } from './contracts';
import {MAX_DEAL_TRANSFERS,MAX_PUBLIC_TRANSFERS,sameBackMotionSpace} from './transferPolicy';
import { sameScope } from './session';
import {isRecycleAdmission,type RecycleAdmission} from './recycle';
import type {FramePaintCard} from './paintResources';
import {resourceMotionIndex,samePublicCollection,unchangedPublicPartition,sameResourceVisual,ownCountNode,recipientCountNode} from './resourceMotionIndex';
import {captureStateFromFrame,provePublicCapture} from './publicCapture';
export type ResourceTransferEndpoint=
 | {readonly kind:'own-hand';readonly card:FramePaintCard;readonly node:PlannedNode}
 | {readonly kind:'recipient';readonly participantId:string;readonly count:number;readonly node:PlannedNode}
 | {readonly kind:'public-stock';readonly collectionId:string;readonly availability:'current'|'next-deal';readonly count:number;readonly node?:PlannedNode}
 | {readonly kind:'public-face';readonly collectionId:string;readonly availability:'current';readonly card:FramePaintCard;readonly node?:PlannedNode};
export interface ResourceTransfer {readonly entityId:string;readonly presentation:'face'|'back';readonly source:ResourceTransferEndpoint;readonly destination:ResourceTransferEndpoint;readonly revealed?:true;readonly origin?:'current';readonly artifactSource?:ResourceTransferEndpoint;readonly countedLanding?:PlannedNode;}
export interface Transfer { readonly revealed?:true; readonly entityId: string; readonly presentation: 'face' | 'back'; readonly source: PlannedNode; readonly destination: PlannedNode; readonly origin?:'current'; readonly artifactSource?:PlannedNode; readonly countedLanding?:PlannedNode; }
/** A public reveal departs an inert count-only seat landmark. No private SVG
 * or opponent card identity is needed; native paint clones the new public face. */
function revealOrigin(node:PlannedNode,minimum=1):boolean{return recipientCountNode(node,minimum);}
/** Internal count evidence has no card identity or executable authority. */
export function ownCountLanding(node:PlannedNode):boolean{return ownCountNode(node);}
type FaceEndpoint=Extract<ResourceTransferEndpoint,{kind:'own-hand'|'public-face'}>;
interface ResourceView {readonly index:NonNullable<ReturnType<typeof resourceMotionIndex>>;readonly hand:Map<string,Extract<ResourceTransferEndpoint,{kind:'own-hand'}>>;readonly peers:Map<string,Extract<ResourceTransferEndpoint,{kind:'recipient'}>>;readonly faces:Map<string,FaceEndpoint[]>;readonly anchor?:PlannedNode;}
const faceValue=(endpoint:FaceEndpoint)=>endpoint.card;
const equalFace=(a:FaceEndpoint,b:FaceEndpoint)=>sameResourceVisual(a.card.visual,b.card.visual)&&a.card.emphasis===b.card.emphasis&&(a.card.ownerId===undefined||b.card.ownerId===undefined||a.card.ownerId===b.card.ownerId);
const location=(endpoint:FaceEndpoint)=>endpoint.kind==='own-hand'?'hand':JSON.stringify(['public',endpoint.availability,endpoint.collectionId]);
function publicNode(frame:PresentationFrame,collectionId:string,card:FramePaintCard):PlannedNode|undefined{
 const nodes=frame.nodes.filter(node=>node.kind==='card'&&!node.publicDisclosureEventId&&node.zoneId===collectionId&&node.entityId===card.entityId);
 return nodes.length===1&&nodes[0].ownerId===card.ownerId&&nodes[0].emphasis===card.emphasis&&!!nodes[0].visual&&sameResourceVisual(nodes[0].visual,card.visual)?nodes[0]:undefined;
}
function resourceView(frame:PresentationFrame):ResourceView|null{
 const index=resourceMotionIndex(frame);if(!index||index.collection('hand'))return null;
 const hand=new Map<string,Extract<ResourceTransferEndpoint,{kind:'own-hand'}>>(),peers=new Map<string,Extract<ResourceTransferEndpoint,{kind:'recipient'}>>(),faces=new Map<string,FaceEndpoint[]>(),anchors=frame.nodes.filter(node=>node.ownHandAnchor);if(anchors.length>1)return null;
 const anchor=anchors[0],local=anchor?.ownHandAnchor?.participantId;
 for(const node of frame.nodes)if(node.kind==='card'&&node.entityId&&node.zoneId!=='hand'&&!node.publicDisclosureEventId&&(!node.zoneId||!index.face(node.zoneId,node.entityId)))return null;
 for(const node of frame.nodes){
  if(node.kind==='card'&&node.zoneId==='hand'&&node.entityId&&!node.publicDisclosureEventId){if(hand.has(node.entityId)||!node.visual||node.visual.kind==='back'||local&&node.ownerId!==undefined&&node.ownerId!==local)return null;const endpoint={kind:'own-hand' as const,node,card:{entityId:node.entityId,...(node.ownerId??local?{ownerId:node.ownerId??local}:{}),visual:node.visual,...(node.emphasis?{emphasis:node.emphasis}:{})}};hand.set(node.entityId,endpoint);faces.set(node.entityId,[endpoint]);}
  if(node.recipientId!==undefined){if(peers.has(node.recipientId)||!Number.isSafeInteger(node.recipientCount)||node.recipientCount!<0||!revealOrigin(node,0))return null;peers.set(node.recipientId,{kind:'recipient',participantId:node.recipientId,count:node.recipientCount!,node});}
 }
 if(anchor&&(!ownCountLanding(anchor)||anchor.ownHandAnchor!.count!==hand.size))return null;
 for(const collection of index.collections){if(collection.availability!=='current')continue;for(const card of collection.cards){const endpoint:FaceEndpoint={kind:'public-face',collectionId:collection.id,availability:'current',card,...(publicNode(frame,collection.id,card)?{node:publicNode(frame,collection.id,card)}:{})};const entries=faces.get(card.entityId)??[];entries.push(endpoint);faces.set(card.entityId,entries);}}
 return {index,hand,peers,faces,...(anchor?{anchor}:{})};
}
function stockEndpoint(view:ResourceView,frame:PresentationFrame,id:string,availability:'current'|'next-deal'='current'):Extract<ResourceTransferEndpoint,{kind:'public-stock'}>|undefined{
 const collection=view.index.collection(id,availability);if(collection?.purpose!=='stock'||collection.hiddenCount===undefined||collection.cards.length)return undefined;
 const nodes=frame.nodes.filter(node=>node.zoneId===id&&node.stockCount!==undefined),node=nodes.length===1&&nodes[0].stockCount===collection.hiddenCount&&nodes[0].entityId===undefined&&(collection.hiddenCount>0?nodes[0].kind==='card'&&nodes[0].visual?.kind==='back':nodes[0].kind==='group'&&nodes[0].visual===undefined)?nodes[0]:undefined;
 return {kind:'public-stock',collectionId:id,availability,count:collection.hiddenCount,...(node?{node}:{})};
}
function peersConserved(before:ResourceView,after:ResourceView,deltas:ReadonlyMap<string,number>):boolean{
 return before.peers.size===after.peers.size&&[...before.peers].every(([id,peer])=>{const current=after.peers.get(id);return !!current&&peer.count-current.count===(deltas.get(id)??0);})&&[...deltas.keys()].every(id=>before.peers.has(id));
}
function allStocksEqual(before:ResourceView,after:ResourceView,except?:string):boolean{
 const a=before.index.collections.filter(c=>c.purpose==='stock'&&c.availability==='current'&&c.id!==except),b=after.index.collections.filter(c=>c.purpose==='stock'&&c.availability==='current'&&c.id!==except);
 return a.length===b.length&&a.every(c=>{const d=after.index.collection(c.id);return !!d&&samePublicCollection(c,d);});
}
const retainedFaceLists=(before:readonly FaceEndpoint[],after:readonly FaceEndpoint[])=>before.length===after.length&&before.every(old=>after.some(current=>location(old)===location(current)&&equalFace(old,current)));
/** One authoritative semantic transition plan. Optional node references are
 * actual selected paint, never resource-derived replacement scene nodes. */
export function resourceTransferPlan(previous:PresentationFrame|null,next:PresentationFrame):readonly ResourceTransfer[]{
 if(!previous||previous.modalId||next.modalId||sameScope(previous.context,next.context)&&previous.context.revision===next.context.revision)return [];
 const before=resourceView(previous),after=resourceView(next);if(!before||!after||before.anchor?.ownHandAnchor?.participantId!==after.anchor?.ownHandAnchor?.participantId)return [];
 const scope=sameScope(previous.context,next.context),fresh=!scope&&next.deals?.length===1&&proveFreshDealOrigin(captureStateFromFrame(previous),captureStateFromFrame(next),next.deals[0]);
 if(!scope&&!fresh)return [];
 if(previous.rosterIds&&next.rosterIds&&JSON.stringify(previous.rosterIds)!==JSON.stringify(next.rosterIds))return [];
 const returnHint=next.stockReturn,oldReturn=returnHint&&stockEndpoint(before,previous,returnHint.destination),newReturn=returnHint&&stockEndpoint(after,next,returnHint.destination),returning=!!oldReturn&&!!newReturn&&newReturn.count>oldReturn.count;
 if(previous.environment.revision!==next.environment.revision&&!((next.deals?.length||returning&&returnHint?.source.kind==='participant')&&sameBackMotionSpace(previous.environment,next.environment)))return [];
 if(returning&&returnHint&&oldReturn&&newReturn){
  const count=newReturn.count-oldReturn.count;if(next.deals?.length||count<1||count>MAX_PUBLIC_TRANSFERS||!allStocksEqual(before,after,returnHint.destination)||!unchangedPublicPartition(before.index,after.index,new Set([returnHint.destination]))||!unchangedPublicPartition(before.index,after.index,new Set(),'next-deal'))return [];
  const removed:Extract<ResourceTransferEndpoint,{kind:'own-hand'}>[]=[];
  for(const [entity,old]of before.faces){const current=after.faces.get(entity);if(!current){if(old.length!==1||old[0].kind!=='own-hand')return [];removed.push(old[0]);}else if(!retainedFaceLists(old,current))return [];}
  if([...after.faces.keys()].some(id=>!before.faces.has(id)))return [];
  const delta=new Map<string,number>();if(returnHint.source.kind==='participant')delta.set(returnHint.source.id,count);if(!peersConserved(before,after,delta))return [];
  if(returnHint.source.kind==='hand')return removed.length===count?removed.map(source=>({entityId:source.card.entityId,presentation:'face',source,destination:newReturn})):[];
  const source=before.peers.get(returnHint.source.id);return removed.length||!source?[]:Array.from({length:count},(_,i)=>({entityId:JSON.stringify(['anonymous-return',next.context.revision,i]),presentation:'back',source,destination:newReturn}));
 }
 const hint=next.deals?.length===1?next.deals[0]:null;
 if(hint){
  if(next.settled||scope&&previous.deals?.some(old=>old.id===hint.id)||hint.handCount!==undefined&&hint.cardIds.length)return [];
  const local=hint.handCount??hint.cardIds.length,recipients=hint.recipients??[],total=local+recipients.reduce((sum,peer)=>sum+peer.count,0);
  if(!Number.isSafeInteger(local)||local<0||local>MAX_DEAL_TRANSFERS||total<1||total>MAX_DEAL_TRANSFERS||recipients.length>8||new Set(recipients.map(peer=>peer.participantId)).size!==recipients.length||recipients.some(peer=>!Number.isSafeInteger(peer.count)||peer.count<1)||new Set(hint.cardIds).size!==hint.cardIds.length)return [];
  const oldCurrent=stockEndpoint(before,previous,hint.source),preview=stockEndpoint(before,previous,hint.source,'next-deal'),sourceBefore=oldCurrent??(fresh&&previous.settled?preview:undefined),sourceAfter=stockEndpoint(after,next,hint.source);
  if(!sourceBefore||!sourceAfter||sourceBefore.count-sourceAfter.count!==total||!allStocksEqual(before,after,hint.source))return [];
  if(sourceBefore.availability==='next-deal'&&(!fresh||!previous.settled||next.settled))return [];
  if(fresh&&before.index.collections.some(c=>c.availability==='current'&&c.cards.length&&!['play','captured'].includes(c.purpose??'')))return [];
  const delta=new Map(recipients.map(peer=>[peer.participantId,-peer.count]));if(!peersConserved(before,after,delta))return [];
  for(const [entity,old]of before.hand){const current=after.hand.get(entity);if(!current||!equalFace(old,current))return [];}
  const added=[...after.hand.values()].filter(card=>!before.hand.has(card.card.entityId));if(added.length!==local||!fresh&&added.some(card=>before.faces.has(card.card.entityId))||hint.handCount===undefined&&(!hint.cardIds.every(id=>added.some(card=>card.card.entityId===id))))return [];
  if(!fresh){for(const collection of before.index.collections.filter(c=>c.availability==='current'&&c.id!==hint.source)){const current=after.index.collection(collection.id);if(!current||!samePublicCollection(collection,current))return [];}if(after.index.collections.some(c=>c.availability==='current'&&c.id!==hint.source&&!before.index.collection(c.id)))return [];}
  const currentOrigin=fresh||before.hand.size===0&&[...before.peers.values()].every(peer=>peer.count===0),source=currentOrigin?sourceAfter:sourceBefore,origin=currentOrigin?{origin:'current' as const,artifactSource:sourceBefore}:{};
  const countedLanding=local>0&&before.anchor&&after.anchor&&before.anchor.ownHandAnchor!.participantId===after.anchor.ownHandAnchor!.participantId?after.anchor:undefined;
  const ordered:ResourceTransfer[]=[];for(let round=0;round<Math.max(local,...recipients.map(peer=>peer.count));round++){
   if(added[round])ordered.push({entityId:added[round].card.entityId,presentation:'back',source,destination:added[round],...origin,...(countedLanding?{countedLanding}:{})});
   for(const peer of recipients)if(round<peer.count){const destination=after.peers.get(peer.participantId);if(!destination)return [];ordered.push({entityId:JSON.stringify(['anonymous-deal',hint.id,peer.participantId,round]),presentation:'back',source,destination,...origin});}
  }return ordered;
 }
 if(!scope)return [];
 const oldState=captureStateFromFrame(previous),newState=captureStateFromFrame(next),capture=oldState&&newState?provePublicCapture(oldState,newState):null;
 if(!allStocksEqual(before,after)&&!capture)return [];
 if(!capture&&!unchangedPublicPartition(before.index,after.index,new Set(),'next-deal'))return [];
 for(const collection of before.index.collections.filter(c=>c.availability==='current')){const current=after.index.collection(collection.id);if(current&&(current.purpose!==collection.purpose||current.kind!==collection.kind||current.hiddenCount!==collection.hiddenCount||current.collectedBy!==collection.collectedBy&&collection.id!==capture?.capturedCollectionId))return [];}
 const transfers:ResourceTransfer[]=[],reveals:ResourceTransfer[]=[];
 for(const [entity,old]of before.faces){const current=after.faces.get(entity);if(!current){if(old.length===1&&old[0].kind==='public-face'&&capture&&old[0].collectionId===capture.capturedCollectionId)continue;return [];}
  if(old.length!==1||current.length!==1){if(!retainedFaceLists(old,current))return [];continue;}
  if(!equalFace(old[0],current[0]))return [];if(location(old[0])!==location(current[0]))transfers.push({entityId:entity,presentation:'face',source:old[0],destination:current[0]});
 }
 const hints=next.reveals??[];if(hints.length>16||new Set(hints.map(h=>h.cardId)).size!==hints.length)return [];
 for(const [entity,current]of after.faces){if(before.faces.has(entity))continue;if(current.length!==1||current[0].kind!=='public-face'||!['play','captured'].includes(after.index.collection(current[0].collectionId)?.purpose??''))return [];
  const destination=current[0],hint=hints.find(h=>h.cardId===entity),source=hint&&before.peers.get(hint.participantId);if(!hint||!source||source.count<1||destination.card.ownerId!==undefined&&destination.card.ownerId!==hint.participantId)return [];
  reveals.push({entityId:entity,presentation:'face',revealed:true,source,destination});
 }
 const deltas=new Map<string,number>();for(const reveal of reveals)if(reveal.source.kind==='recipient')deltas.set(reveal.source.participantId,(deltas.get(reveal.source.participantId)??0)+1);if(!peersConserved(before,after,deltas))return [];
 transfers.push(...reveals);return transfers.length<=MAX_PUBLIC_TRANSFERS?transfers:[];
}
/** Compatibility adapter for genuinely selected visible endpoints only. */
export function transferCandidates(previous:PresentationFrame|null,next:PresentationFrame):readonly Transfer[]{
 const plan=resourceTransferPlan(previous,next);if(plan.some(item=>!item.source.node||!item.destination.node||item.artifactSource&&!item.artifactSource.node))return [];
 return plan.map(item=>({entityId:item.entityId,presentation:item.presentation,source:item.source.node!,destination:item.destination.node!,...(item.revealed?{revealed:true as const}:{}),...(item.origin?{origin:item.origin}:{}),...(item.artifactSource?.node?{artifactSource:item.artifactSource.node}:{}),...(item.countedLanding?{countedLanding:item.countedLanding}:{})}));
}
/** Current-only recycle proof can supply anonymous resource art without a
 * hidden stock scene node. Native origin geometry is proved separately. */
export function resourceRecycledDealPlan(proof:RecycleAdmission,next:PresentationFrame):readonly ResourceTransfer[]{
 if(!isRecycleAdmission(proof)||next.recycleAdmission!==proof||next.modalId||next.settled||!sameScope(proof.toContext,next.context)||JSON.stringify(next.rosterIds)!==JSON.stringify(proof.rosterIds))return [];
 const view=resourceView(next),hint=next.deals?.length===1?next.deals[0]:null;if(!view||!hint||hint.id!==proof.deal.id||hint.source!==proof.source||hint.handCount!==proof.newLocalCount||hint.cardIds.length||JSON.stringify(hint.recipients??[])!==JSON.stringify(proof.deal.recipients))return [];
 const source=stockEndpoint(view,next,proof.source);if(!source||source.count!==proof.newStock||view.hand.size!==proof.newLocalCount||view.index.collections.some(c=>c.availability!=='current'||c.cards.length)||view.peers.size!==proof.newRecipients.length||proof.newRecipients.some(peer=>view.peers.get(peer.participantId)?.count!==peer.count))return [];
 if(view.index.collections.length!==proof.collections.length||proof.collections.some(c=>{const current=view.index.collection(c.id);return !current||current.availability!==c.availability||(current.purpose??null)!==c.purpose||(current.kind??null)!==c.kind||(current.hiddenCount??null)!==c.hiddenCount;}))return [];
 if(proof.localParticipantId===null?view.anchor!==undefined||view.hand.size>0:!view.anchor||view.anchor.ownHandAnchor!.participantId!==proof.localParticipantId||[...view.hand.values()].some(endpoint=>endpoint.card.ownerId!==undefined&&endpoint.card.ownerId!==proof.localParticipantId))return [];
 if(proof.totalCount-source.count!==proof.dealt||proof.dealt!==view.hand.size+proof.newRecipients.reduce((sum,p)=>sum+p.count,0))return [];
 const hand=[...view.hand.values()],ordered:ResourceTransfer[]=[];for(let round=0;round<Math.max(hand.length,...proof.deal.recipients.map(p=>p.count));round++){
  if(hand[round])ordered.push({entityId:hand[round].card.entityId,presentation:'back',source,destination:hand[round],origin:'current',...(view.anchor?{countedLanding:view.anchor}:{})});for(const peer of proof.deal.recipients)if(round<peer.count)ordered.push({entityId:JSON.stringify(['recycled-deal',proof.transitionId,peer.participantId,round]),presentation:'back',source,destination:view.peers.get(peer.participantId)!,origin:'current'});
 }return ordered.length===proof.dealt?ordered:[];
}
export function recycledDealCandidates(proof:RecycleAdmission,next:PresentationFrame):readonly Transfer[]{const plan=resourceRecycledDealPlan(proof,next);return plan.every(item=>item.source.node&&item.destination.node)?plan.map(item=>({entityId:item.entityId,presentation:item.presentation,source:item.source.node!,destination:item.destination.node!,origin:'current',...(item.countedLanding?{countedLanding:item.countedLanding}:{})})):[];}
export const contains = (outer: Rect, inner: Rect) => inner.x >= outer.x - .5 && inner.y >= outer.y - .5 && inner.x + inner.width <= outer.x + outer.width + .5 && inner.y + inner.height <= outer.y + outer.height + .5;
export function safeFlight(from: Rect, to: Rect, clip: Rect, protectedRects: readonly Rect[]): boolean {
    if (![from, to, clip, ...protectedRects].every(box => [box.x,box.y,box.width,box.height].every(Number.isFinite) && box.width > 0 && box.height > 0)) return false;
    if (!contains(clip, from) || !contains(clip, to)) return false;
    // Axis-aligned translation + scale makes every card edge affine in path
    // progress. Intersect the four time intervals instead of an oversized AABB.
    return protectedRects.every(box => {
        let low = 0, high = 1;
        for (const [start,end] of [
            [from.x+from.width-box.x, to.x+to.width-box.x],
            [box.x+box.width-from.x, box.x+box.width-to.x],
            [from.y+from.height-box.y, to.y+to.height-box.y],
            [box.y+box.height-from.y, box.y+box.height-to.y],
        ]) {
            const change = end-start;
            if (Math.abs(change) < 1e-9) { if (start <= 0) return true; }
            else if (change > 0) low = Math.max(low, -start/change);
            else high = Math.min(high, -start/change);
        }
        return low >= high;
    });
}
/** Flights use one straight segment; blocked paths snap rather than detour. */
export function flightPath(from: Rect, to: Rect, clip: Rect, protectedRects: readonly Rect[]): readonly Rect[] | null {
    return safeFlight(from,to,clip,protectedRects) ? [from,to] : null;
}

/** Native paint may be suspended only for an actual current terminal collection
 * or a fully reconciled return. Persisted transition hints grant no lease. */
export function requiresEssentialTransfer(previous:PresentationFrame|null,next:PresentationFrame):boolean{
    const terminal=!!previous&&!previous.settled&&next.settled===true&&next.outcomeLaneId==='outcome';
    if(!terminal&&!next.stockReturn)return false;
    const candidates=resourceTransferPlan(previous,next);
    if(!candidates.length)return false;
    if(terminal){const resources=resourceMotionIndex(next);return !!resources&&candidates.every(item=>item.destination.kind==='public-face'&&resources.collection(item.destination.collectionId)?.purpose==='captured');}
    const hint=next.stockReturn!;
    return candidates.every(item=>item.destination.kind==='public-stock'&&item.destination.availability==='current'&&item.destination.collectionId===hint.destination&&(hint.source.kind==='hand'?item.source.kind==='own-hand'&&item.presentation==='face':item.source.kind==='recipient'&&item.source.participantId===hint.source.id&&item.presentation==='back'));
}
