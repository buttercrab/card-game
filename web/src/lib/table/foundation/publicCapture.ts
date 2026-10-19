import type {RevealTransition,ViewContext} from './contracts';
import type {FramePaintCard,FramePaintResources} from './paintResources';
import {resourceMotionIndex,samePublicFace,samePublicCollection,ownCountNode,recipientCountNode} from './resourceMotionIndex';
export interface PublicCaptureState {
 readonly context:ViewContext;readonly resources?:FramePaintResources;readonly rosterIds:readonly string[];readonly localParticipantId:string|null;
 /** Transient authorized own-hand facts, never retained by the public result. */
 readonly hand:readonly FramePaintCard[];readonly recipientCounts:readonly {readonly participantId:string;readonly count:number}[];
 readonly reveals?:readonly RevealTransition[];readonly settled:boolean;
}
export interface PublicCaptureSourceState extends PublicCaptureState {readonly visiblePublic:readonly {readonly collectionId:string;readonly card:FramePaintCard}[];}
export interface PublicCaptureProof {
 readonly sourceCollectionId:string;readonly capturedCollectionId:string;readonly collectedBy:string;readonly incomingId:string;readonly incomingOwnerId:string;readonly incoming:'hand'|'peer';
 readonly cards:readonly FramePaintCard[];readonly retiredCurrentStockIds:readonly string[];
}
const sameScope=(a:ViewContext,b:ViewContext)=>a.session===b.session&&a.audience===b.audience&&a.generation===b.generation;
const number=(n:number)=>Number.isSafeInteger(n)&&n>=0&&n<=10000;
function held(state:PublicCaptureState):Map<string,number>|null {
 const ids=state.rosterIds;if(ids.length<2||ids.length>8||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!id.length)||state.localParticipantId!==null&&!ids.includes(state.localParticipantId))return null;
 if(new Set(state.hand.map(card=>card.entityId)).size!==state.hand.length||state.localParticipantId===null&&state.hand.length||state.hand.some(card=>!card.entityId||!card.visual||!['standard','joker'].includes(card.visual.kind)||card.ownerId!==undefined&&card.ownerId!==state.localParticipantId))return null;
 const result=new Map<string,number>();if(state.localParticipantId!==null)result.set(state.localParticipantId,state.hand.length);
 for(const peer of state.recipientCounts){if(!ids.includes(peer.participantId)||result.has(peer.participantId)||!number(peer.count))return null;result.set(peer.participantId,peer.count);}
 return result.size===ids.length?result:null;
}
/** Exact current public cohort authority, independent of environment or future
 * geometry. The result contains no hand snapshot, native node, timer or grant. */
export function provePublicCapture(before:PublicCaptureSourceState,next:PublicCaptureState):PublicCaptureProof|null {
 try{
  if(before.settled||!sameScope(before.context,next.context)||before.context.revision===next.context.revision||before.localParticipantId!==next.localParticipantId||JSON.stringify(before.rosterIds)!==JSON.stringify(next.rosterIds))return null;
  const old=resourceMotionIndex({paintResources:before.resources}),fresh=resourceMotionIndex({paintResources:next.resources}),oldHeld=held(before),newHeld=held(next);if(!old||!fresh||!oldHeld||!newHeld)return null;
  const n=next.rosterIds.length,candidates:{source:typeof old.collections[number];destination:typeof old.collections[number];incoming:FramePaintCard}[]=[];
  for(const source of old.collections){
   if(source.availability!=='current'||source.purpose!=='play'||source.kind!=='trick'||source.cards.length!==n-1||new Set(source.cards.map(card=>card.ownerId)).size!==n-1||source.cards.some(card=>!card.ownerId||!next.rosterIds.includes(card.ownerId)))continue;
   const visible=before.visiblePublic.filter(item=>item.collectionId===source.id);if(visible.length!==source.cards.length||new Set(visible.map(item=>item.card.entityId)).size!==visible.length||!source.cards.every(card=>visible.some(item=>samePublicFace(card,item.card))))continue;
   const currentSource=fresh.collection(source.id);if(!currentSource||currentSource.kind!=='trick'||currentSource.purpose!=='play'||currentSource.cards.length||currentSource.hiddenCount!==undefined)continue;
   for(const destination of fresh.collections){
    if(destination.availability!=='current'||destination.purpose!=='captured'||destination.cards.length!==n||!destination.collectedBy||!next.rosterIds.includes(destination.collectedBy)||new Set(destination.cards.map(card=>card.ownerId)).size!==n||destination.cards.some(card=>!card.ownerId||!next.rosterIds.includes(card.ownerId)))continue;
    if(!source.cards.every(card=>destination.cards.some(current=>samePublicFace(card,current))))continue;
    const incoming=destination.cards.filter(card=>!source.cards.some(prior=>prior.entityId===card.entityId));if(incoming.length!==1||old.locations(incoming[0].entityId).length)continue;
    if(source.cards.some(card=>old.locations(card.entityId).length!==1)||destination.cards.some(card=>fresh.locations(card.entityId).length!==1))continue;
    candidates.push({source,destination,incoming:incoming[0]});
   }
  }
  if(candidates.length!==1)return null;const {source,destination,incoming}=candidates[0],owner=incoming.ownerId!;
  if([...oldHeld].some(([person,count])=>count-(newHeld.get(person)??-1)!==(person===owner?1:0))||next.settled&&[...newHeld.values()].some(value=>value!==0))return null;
  const fromHand=owner===before.localParticipantId;
  const oldHand=new Map(before.hand.map(card=>[card.entityId,card])),newHand=new Map(next.hand.map(card=>[card.entityId,card]));
  if(fromHand){const card=oldHand.get(incoming.entityId);if(!card||!samePublicFace({...card,ownerId:owner},incoming)||newHand.has(incoming.entityId))return null;}
  else if(oldHand.has(incoming.entityId)||!next.reveals?.some(hint=>hint.cardId===incoming.entityId&&hint.participantId===owner))return null;
  if(newHand.size!==oldHand.size-(fromHand?1:0)||[...oldHand].some(([id,card])=>id!==incoming.entityId&&(!newHand.has(id)||!samePublicFace(card,newHand.get(id)!)))||[...newHand.keys()].some(id=>!oldHand.has(id)))return null;
  const retired:string[]=[];
  for(const collection of old.collections.filter(value=>value.availability==='current')){
   if(collection.id===source.id||collection.id===destination.id)continue;
   const current=fresh.collection(collection.id);
   if(current){if(!samePublicCollection(collection,current))return null;}
   else{const preview=fresh.collection(collection.id,'next-deal');if(!next.settled||collection.purpose!=='stock'||collection.hiddenCount===undefined||collection.cards.length||!preview||preview.purpose!=='stock'||preview.kind!=='deck'||preview.hiddenCount===undefined||preview.cards.length)return null;retired.push(collection.id);}
  }
  if(fresh.collections.some(collection=>collection.availability==='current'&&collection.id!==source.id&&collection.id!==destination.id&&!old.collection(collection.id)))return null;
  // A captured window is replaced, never matched as an old alias of this cohort.
  const previousCapture=old.collection(destination.id);if(previousCapture&&previousCapture.cards.some(card=>destination.cards.some(current=>current.entityId===card.entityId)))return null;
  const cards=Object.freeze(destination.cards.map(card=>Object.freeze({entityId:card.entityId,ownerId:card.ownerId,visual:Object.freeze({...card.visual}),...(card.emphasis?{emphasis:card.emphasis}:{})})));
  return Object.freeze({sourceCollectionId:source.id,capturedCollectionId:destination.id,collectedBy:destination.collectedBy!,incomingId:incoming.entityId,incomingOwnerId:owner,incoming:fromHand?'hand':'peer',cards,retiredCurrentStockIds:Object.freeze(retired)});
 }catch{return null;}
}
/** Read only the currently owned hand/count nodes and exact selected public
 * references. This adapter never manufactures nodes from the resource plane. */
export function captureStateFromFrame(frame:import('./contracts').PresentationFrame):PublicCaptureSourceState|null {
 try{
  const index=resourceMotionIndex(frame);if(!index||!frame.rosterIds)return null;
  const anchors=frame.nodes.filter(node=>node.ownHandAnchor);if(anchors.length>1||anchors.some(node=>!ownCountNode(node))||frame.nodes.some(node=>node.recipientId!==undefined&&!recipientCountNode(node)))return null;const local=anchors[0]?.ownHandAnchor?.participantId??null;
  const hand:FramePaintCard[]=[];
  for(const node of frame.nodes){if(node.kind!=='card'||node.zoneId!=='hand'||!node.entityId)continue;const visual=node.visual;if(!visual||visual.kind==='back')return null;hand.push({entityId:node.entityId,...(node.ownerId!==undefined?{ownerId:node.ownerId}:{}),visual,...(node.emphasis?{emphasis:node.emphasis}:{})});}
  if(anchors[0]&&anchors[0].ownHandAnchor!.count!==hand.length||!anchors.length&&hand.length)return null;
  const recipientCounts=frame.nodes.filter(node=>node.recipientId!==undefined).map(node=>({participantId:node.recipientId!,count:node.recipientCount!}));
  const visiblePublic:{collectionId:string;card:FramePaintCard}[]=[];
  for(const node of frame.nodes){if(node.collectedBy!==undefined&&(!node.zoneId||index.collection(node.zoneId)?.collectedBy!==node.collectedBy))return null;if(node.kind!=='card'||!node.entityId||!node.zoneId||node.zoneId==='hand'||node.publicDisclosureEventId)continue;const reference=index.face(node.zoneId,node.entityId),visual=node.visual;if(!reference||!visual||visual.kind==='back')return null;const card={entityId:node.entityId,...(node.ownerId!==undefined?{ownerId:node.ownerId}:{}),visual,...(node.emphasis?{emphasis:node.emphasis}:{})};if(!samePublicFace(card,reference.card))return null;visiblePublic.push({collectionId:node.zoneId,card});}
  const state={context:frame.context,resources:frame.paintResources,rosterIds:frame.rosterIds,localParticipantId:local,hand,recipientCounts,reveals:frame.reveals,settled:frame.settled===true,visiblePublic};return held(state)?state:null;
 }catch{return null;}
}
