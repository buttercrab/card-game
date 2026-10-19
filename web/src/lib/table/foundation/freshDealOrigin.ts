import type {DealTransition} from './contracts';
import type {PublicCaptureState} from './publicCapture';
import {resourceMotionIndex,samePublicCollection} from './resourceMotionIndex';
/** Shared semantic cap; scheduling and native paths do not change this bound. */
export const FRESH_DEAL_LIMIT=64;
/** Count/resource proof only. The runtime separately owns authenticated view
 * continuity; actual transfer admission still checks current native geometry. */
export function proveFreshDealOrigin(before:PublicCaptureState|null,after:PublicCaptureState|null,hint:DealTransition|undefined):boolean {
 if(!before||!after||!hint||after.settled||before.context.session!==after.context.session||before.context.audience!==after.context.audience||before.context.generation===after.context.generation||before.localParticipantId!==after.localParticipantId||JSON.stringify(before.rosterIds)!==JSON.stringify(after.rosterIds))return false;
 const roster=before.rosterIds,local=before.localParticipantId;
 if(roster.length<2||roster.length>8||new Set(roster).size!==roster.length||roster.some(id=>!id)||local!==null&&!roster.includes(local)||before.hand.length||before.recipientCounts.some(peer=>peer.count!==0))return false;
 const peers=roster.filter(id=>id!==local),counts=(state:PublicCaptureState)=>{
  if(state.recipientCounts.length!==peers.length||new Set(state.recipientCounts.map(peer=>peer.participantId)).size!==peers.length||state.recipientCounts.some(peer=>!peers.includes(peer.participantId)||!Number.isSafeInteger(peer.count)||peer.count<0||peer.count>10000))return null;
  return new Map(state.recipientCounts.map(peer=>[peer.participantId,peer.count]));
 };
 if(!counts(before))return false;const current=counts(after);if(!current)return false;
 const localCount=hint.handCount??hint.cardIds.length,recipients=hint.recipients??[],total=localCount+recipients.reduce((sum,peer)=>sum+peer.count,0);
 if(!hint.id||hint.id.length>2048||!hint.source||hint.source.length>2048||recipients.length>8||hint.cardIds.length>FRESH_DEAL_LIMIT||!Number.isSafeInteger(localCount)||localCount<0||localCount>FRESH_DEAL_LIMIT||total<1||total>FRESH_DEAL_LIMIT||hint.handCount!==undefined&&hint.cardIds.length||new Set(hint.cardIds).size!==hint.cardIds.length||new Set(recipients.map(peer=>peer.participantId)).size!==recipients.length||recipients.some(peer=>!peers.includes(peer.participantId)||!Number.isSafeInteger(peer.count)||peer.count<1)||local===null&&localCount!==0||after.hand.length!==localCount)return false;
 const entities=new Set<string>();for(const card of after.hand){const visual=card.visual;if(!card.entityId||entities.has(card.entityId)||card.ownerId!==undefined&&card.ownerId!==local||!(visual.kind==='standard'&&Number.isInteger(visual.rank)&&visual.rank>=2&&visual.rank<=14&&['Spade','Heart','Diamond','Club'].includes(visual.suit)||visual.kind==='joker'&&['Black','Red'].includes(visual.color)))return false;entities.add(card.entityId);}
 if(hint.handCount===undefined&&hint.cardIds.some(id=>!entities.has(id))||peers.some(id=>current.get(id)!==(recipients.find(peer=>peer.participantId===id)?.count??0)))return false;
 const old=resourceMotionIndex({paintResources:before.resources}),next=resourceMotionIndex({paintResources:after.resources});if(!old||!next||old.collection('hand')||next.collection('hand'))return false;
 // This event distributes the whole new held partition, not cards onto a
 // public board. Old-generation history may retire; new public allocations
 // require their own counted event proof rather than borrowing this deal.
 if(next.collections.some(collection=>collection.availability==='current'&&collection.cards.length))return false;
 const source=old.collection(hint.source,before.settled?'next-deal':'current'),destination=next.collection(hint.source);
 if(!source||source.purpose!=='stock'||(before.settled?source.kind!=='deck':source.kind!==undefined&&source.kind!=='deck')||source.hiddenCount===undefined||source.cards.length||!destination||destination.purpose!=='stock'||destination.hiddenCount===undefined||destination.cards.length||source.hiddenCount-destination.hiddenCount!==total)return false;
 if(old.collections.some(collection=>collection.availability==='current'&&collection.cards.length&&!['play','captured'].includes(collection.purpose??'')))return false;
 // Other counted collections retain their full semantic identity, including
 // temporal availability; the selected next-deal source alone is promoted.
 const stocks=(index:NonNullable<typeof old>)=>index.collections.filter(collection=>collection.purpose==='stock'&&collection.id!==hint.source);
 const a=stocks(old),b=stocks(next);if(a.length!==b.length||!a.every(collection=>{const other=next.collection(collection.id,collection.availability);return !!other&&samePublicCollection(collection,other);}))return false;
 return true;
}
