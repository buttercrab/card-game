import type {PlannedNode,PresentationFrame} from './contracts';
import type {FramePaintCard} from './paintResources';
import {captureStateFromFrame,provePublicCapture} from './publicCapture';
import {resourceMotionIndex,samePublicFace,unchangedPublicPartition,sameResourceVisual} from './resourceMotionIndex';
import {resourceTransferPlan} from './transferMotion';
export interface TrickResolutionItem {
 readonly entityId:string;readonly ownerId:string;readonly sourceId?:string;readonly slotId:string;readonly destinationId?:string;readonly presentation:'face'|'back';
}
/** Public-only cohort recipe. Optional node IDs name actual selected paint;
 * absent captured UI is never replaced by a synthetic scene destination. */
export interface TrickResolutionPlan {
 readonly previousFrameId:number;readonly frameId:number;readonly sourceZone:string;readonly destinationZone:string;readonly capturedCollectionId:string;readonly incomingId:string;readonly incoming:'peer'|'hand';readonly collectedBy:string;readonly winnerId:string;readonly items:readonly TrickResolutionItem[];readonly cards:readonly FramePaintCard[];
}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const slots=(frame:PresentationFrame)=>frame.nodes.filter(node=>node.trickSlot===true);
const matches=(node:PlannedNode,card:FramePaintCard)=>node.kind==='card'&&node.entityId===card.entityId&&node.ownerId===card.ownerId&&node.emphasis===card.emphasis&&!!node.visual&&sameResourceVisual(node.visual,card.visual);
export function planTrickResolution(previous:PresentationFrame|null,next:PresentationFrame):TrickResolutionPlan|null {
 if(!previous||previous.modalId||next.modalId||previous.settled||next.deals?.length||next.recycleAdmission||!same(previous.rosterIds,next.rosterIds))return null;
 const before=captureStateFromFrame(previous),after=captureStateFromFrame(next);if(!before||!after)return null;const proof=provePublicCapture(before,after);if(!proof)return null;
 const papers=slots(next),n=proof.cards.length;if(papers.length!==n||new Set(papers.map(node=>node.ownerId)).size!==n||papers.some(node=>node.kind!=='group'||node.zoneId!==proof.sourceCollectionId||!node.ownerId||!next.rosterIds?.includes(node.ownerId)))return null;
 const winners=next.nodes.filter(node=>node.kind==='figure'&&node.ownerId===proof.collectedBy);if(winners.length!==1)return null;
 const items:TrickResolutionItem[]=[];
 for(const card of proof.cards){
  const paper=papers.find(node=>node.ownerId===card.ownerId);if(!paper)return null;
  const old=previous.nodes.filter(node=>node.zoneId===proof.sourceCollectionId&&matches(node,card));
  let sourceId=old.length===1?old[0].id:undefined;
  if(card.entityId===proof.incomingId){const origins=previous.nodes.filter(node=>proof.incoming==='hand'?node.zoneId==='hand'&&node.entityId===card.entityId:node.recipientId===proof.incomingOwnerId);sourceId=origins.length===1?origins[0].id:undefined;}
  const destinations=next.nodes.filter(node=>node.zoneId===proof.capturedCollectionId&&matches(node,card));
  items.push(Object.freeze({entityId:card.entityId,ownerId:card.ownerId!,...(sourceId?{sourceId}:{}),slotId:paper.id,...(destinations.length===1?{destinationId:destinations[0].id}:{}),presentation:'face'}));
 }
 return Object.freeze({previousFrameId:previous.id,frameId:next.id,sourceZone:proof.sourceCollectionId,destinationZone:proof.capturedCollectionId,capturedCollectionId:proof.capturedCollectionId,incomingId:proof.incomingId,incoming:proof.incoming,collectedBy:proof.collectedBy,winnerId:winners[0].id,items:Object.freeze(items),cards:proof.cards});
}
/** Running paint retains the same public cohort; latest canonical command and
 * hand state still replace immediately. Environment changes revoke the chain. */
export function continuesTrickResolution(plan:TrickResolutionPlan,previous:PresentationFrame,next:PresentationFrame):boolean{
 if(previous.modalId||next.modalId||!same([previous.context.session,previous.context.audience,previous.context.generation],[next.context.session,next.context.audience,next.context.generation])||!same(previous.environment,next.environment)||!same(previous.rosterIds,next.rosterIds)||previous.settled!==next.settled||next.deals?.length||next.recycleAdmission)return false;
 const old=resourceMotionIndex(previous),fresh=resourceMotionIndex(next),before=captureStateFromFrame(previous),after=captureStateFromFrame(next);if(!old||!fresh||!before||!after)return false;
 const winner=next.nodes.filter(node=>node.kind==='figure'&&node.ownerId===plan.collectedBy);if(winner.length!==1||winner[0].id!==plan.winnerId)return false;
 const captured=fresh.collection(plan.capturedCollectionId);if(!captured||captured.purpose!=='captured'||captured.collectedBy!==plan.collectedBy||captured.cards.length!==plan.cards.length||!plan.cards.every(card=>captured.cards.some(other=>samePublicFace(card,other)))||captured.cards.some(card=>fresh.locations(card.entityId).length!==1))return false;
 const papers=slots(next);if(papers.length!==plan.items.length||plan.items.some(item=>!papers.some(node=>node.id===item.slotId&&node.ownerId===item.ownerId&&node.zoneId===plan.sourceZone)))return false;
 const plays=fresh.collection(plan.sourceZone),oldPlay=old.collection(plan.sourceZone);if(!plays||!oldPlay||plays.purpose!=='play'||plays.kind!=='trick'||plays.cards.length>=plan.cards.length||new Set(plays.cards.map(card=>card.ownerId)).size!==plays.cards.length||plays.cards.some(card=>!card.ownerId||!next.rosterIds?.includes(card.ownerId)||plan.cards.some(old=>old.entityId===card.entityId)||fresh.locations(card.entityId).length!==1))return false;
 if(!unchangedPublicPartition(old,fresh,new Set([plan.sourceZone,plan.capturedCollectionId]))||!unchangedPublicPartition(old,fresh,new Set(),'next-deal'))return false;
 const controls=(state:typeof before)=>JSON.stringify([state.hand,state.recipientCounts]);
 if(!same(oldPlay.cards,plays.cards)||controls(before)!==controls(after)){
  const candidates=resourceTransferPlan(previous,next);if(!candidates.length||candidates.some(item=>item.destination.kind!=='public-face'||item.destination.collectionId!==plan.sourceZone))return false;
 }
 return true;
}
