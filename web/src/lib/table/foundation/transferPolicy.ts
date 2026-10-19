import type {Environment,PlannedNode,PresentationFrame,TableDocument} from './contracts';
import {captureStateFromFrame} from './publicCapture';
import {publicPaintResources} from './paintResources';
import {FRESH_DEAL_LIMIT,proveFreshDealOrigin} from './freshDealOrigin';
/** Engine-owned bounds and pacing; no game can supply timings or paths. */
export const MAX_DEAL_TRANSFERS=FRESH_DEAL_LIMIT;
export const MAX_PUBLIC_TRANSFERS=8;
export function transferTiming(count:number){return {duration:360,stagger:count>MAX_PUBLIC_TRANSFERS?20:70};}

/** A neutral back may retain an origin across font-resource completion only. */
export function sameBackMotionSpace(a:Environment,b:Environment):boolean{
    return !!a.fontRevision&&!!b.fontRevision&&a.fontRevision!==b.fontRevision&&
        JSON.stringify([a.width,a.height,a.fontFamily,a.artFontFamily,a.textScale,a.controls,a.scrollbarWidth??0,a.scrollbarHeight??0])===JSON.stringify([b.width,b.height,b.fontFamily,b.artFontFamily,b.textScale,b.controls,b.scrollbarWidth??0,b.scrollbarHeight??0]);
}

/** Retain a canonical neutral resource across an observed fresh deal. Selected
 * stock paint is optional; this never supplies native geometry or input rights. */
export function neutralDealOrigin(previous:PresentationFrame|null,next:Pick<TableDocument<unknown>,'context'|'participant'|'opponents'|'hand'|'collections'|'deals'|'outcome'>):boolean{
 if(!previous||previous.modalId||next.deals?.length!==1)return false;
 const rosterIds=[...(next.participant.role==='observer'?[]:[next.participant.id]),...(next.opponents??[]).map(person=>person.id)];
 return proveFreshDealOrigin(captureStateFromFrame(previous),{context:next.context,resources:publicPaintResources(next),rosterIds,localParticipantId:next.participant.role==='observer'?null:next.participant.id,hand:next.hand.map(card=>({entityId:card.id,ownerId:card.ownerId,visual:card.visual,emphasis:card.emphasis})),recipientCounts:(next.opponents??[]).map(person=>({participantId:person.id,count:person.handCount})),settled:!!next.outcome},next.deals[0]);
}

/** A presentation-only revision may retain an already authorized flight. The
 * native adapter still rechecks actual target bounds and every protected path
 * after patching; this is only the pure, conservative identity/geometry gate. */
export function sameTransferPresentation(a:import('./contracts').PresentationFrame,b:import('./contracts').PresentationFrame):boolean {
 if((a.paintResources!==undefined||b.paintResources!==undefined)&&(a.paintResources?.status!=='available'||b.paintResources?.status!=='available'||JSON.stringify(a.paintResources)!==JSON.stringify(b.paintResources)))return false;
 if(a.modalId||b.modalId||!!a.settled!==!!b.settled||a.context.session!==b.context.session||a.context.audience!==b.context.audience||a.context.generation!==b.context.generation||a.width!==b.width||a.height!==b.height||JSON.stringify(a.environment)!==JSON.stringify(b.environment)||JSON.stringify([a.deals,a.stockReturn,a.reveals])!==JSON.stringify([b.deals,b.stockReturn,b.reveals]))return false;
 const signature=(frame:import('./contracts').PresentationFrame)=>{
  const nodes=new Map(frame.nodes.map(node=>[node.id,node]));
  return JSON.stringify(frame.nodes.filter(node=>node.kind==='card'&&!node.publicDisclosureEventId||node.ownHandAnchor||node.trickSlot||node.recipientId!==undefined||node.collectedBy!==undefined).map(node=>{
   const ancestry=[];let parent=node.parent;const seen=new Set<string>();
   while(parent){if(seen.has(parent))throw Error('Cyclic transfer ancestry');seen.add(parent);const owner=nodes.get(parent);if(!owner)throw Error('Missing transfer ancestry');ancestry.push([owner.id,owner.parent,owner.box,owner.scroll,owner.scrollAxis]);parent=owner.parent;}
   return [node.id,node.parent,node.box,node.visual,node.entityId,node.ownerId,node.zoneId,node.stockCount,node.recipientId,node.recipientCount,node.collectionPurpose,node.checked,node.emphasis,node.ownHandAnchor,node.trickSlot,node.collectedBy,ancestry];
  }));
 };
 try{return signature(a)===signature(b);}catch{return false;}
}

/** Every typed native hit target protects its native focus/pulse envelope. */
export function transferHitTarget(node:PlannedNode):boolean{return ['command','choice','select','toggle','range','editor'].includes(node.kind)||!!(node.cardId||node.inspectCardId);}

/** Count evidence itself paints nothing; the corresponding figure still protects its ink. */
export function emptyCountAnchor(node:PlannedNode):boolean{
 const forbidden:readonly(keyof PlannedNode)[]=['visual','entityId','ownerId','zoneId','stockCount','collectionPurpose','cardId','inspectCardId','actionId','fieldId','cardActionPickerIntent','cardActionOptionId','catalogueIntent','choiceLeaseId','editor','formIntent','formLeaseId','shellActionId','shellIntent','localIntent','preference','disclosureIntent','disclosureCatalogId','assistanceIntent','participantStatusFor','trickSlot','collectedBy','semanticRole','role'];
 const allowed=new Set(['id','parent','kind','label','box','inert','enabled','recipientId','recipientCount','ownHandAnchor']);
 if(Object.keys(node).some(key=>!allowed.has(key)&&node[key as keyof PlannedNode]!==undefined)||node.kind!=='group'||node.inert!==true||node.label!==''||node.enabled||forbidden.some(key=>node[key]!==undefined))return false;
 if(node.ownHandAnchor!==undefined){const fields=Object.getOwnPropertyDescriptors(node.ownHandAnchor);if(Object.keys(fields).length!==2||!fields.participantId||!fields.count||!('value'in fields.participantId)||!('value'in fields.count))return false;const person=fields.participantId.value,count=fields.count.value;return node.recipientId===undefined&&node.recipientCount===undefined&&typeof person==='string'&&person.length>0&&typeof count==='number'&&Number.isSafeInteger(count)&&count>=0;}
 return typeof node.recipientId==='string'&&node.recipientId.length>0&&Number.isSafeInteger(node.recipientCount)&&node.recipientCount!>=0;
}
export function pairedCountFigure(node:PlannedNode,nodes:readonly PlannedNode[]):PlannedNode|undefined{
 if(!emptyCountAnchor(node))return undefined;const owner=node.ownHandAnchor?.participantId??node.recipientId;
 const matches=nodes.filter(other=>other.kind==='figure'&&other.ownerId===owner&&other.parent===node.parent&&JSON.stringify(other.box)===JSON.stringify(node.box));return matches.length===1?matches[0]:undefined;
}
/** Readable participant information and retained private cards need protection
 * even when they have no executable input binding during another player's turn.
 * Source/destination exemptions remain scoped by the transfer controller. */
export function transferReadableTarget(node:PlannedNode,nodes?:readonly PlannedNode[]):boolean {
 if(nodes&&pairedCountFigure(node,nodes))return false;
 return node.kind==='text'&&node.role!=='art'||node.kind==='figure'&&node.ownerId!==undefined||node.recipientId!==undefined||!!node.ownHandAnchor||!!node.participantStatusFor||node.kind==='card'&&node.zoneId==='hand';
}
export function transferProtectedTarget(node:PlannedNode,nodes?:readonly PlannedNode[]):boolean{return transferHitTarget(node)||transferReadableTarget(node,nodes);}
