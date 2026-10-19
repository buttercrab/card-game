import {copyPublicGameplayPresentation,type PublicGameplayPresentation} from './publicGameplayPresentation';
import type {CompletionReceiveSource} from './completionReceive';
import type {TableDocument,PresentationFrame} from './contracts';
import type {FramePaintResources,FramePaintCollection} from './paintResources';
import {provePublicCapture,type PublicCaptureState} from './publicCapture';
import {captureRetainedPublicTableRecipe,type RetainedPublicTableRecipe} from './retainedPublicTableRecipe';
const brand:unique symbol=Symbol('public completion');
const gameplayReadBrand:unique symbol=Symbol('public gameplay read');
export interface CompletionGameplayRead {readonly [gameplayReadBrand]:true;}
export interface PublicCompletionGrant {readonly id:string;readonly expiresAt:number;readonly [brand]:true;}
export interface PublicCompletionView {readonly event:PublicCompletionGrant;readonly sourceCollectionId:string;readonly capturedCollectionId:string;readonly entityIds:readonly string[];readonly recipe:RetainedPublicTableRecipe;}
interface Proof {scope:string;outcomeId:string;fingerprint:string;cohort:string;resources:string;selector:string;roster:string;environment:string;gameplay:PublicGameplayPresentation;read?:CompletionGameplayRead;view?:PublicCompletionView;}
const owners=new WeakMap<PublicCompletionGrant,Proof>();let serial=0;
const scope=(doc:{context:TableDocument<unknown>['context']})=>JSON.stringify([doc.context.session,doc.context.audience,doc.context.generation]);
const roster=(doc:TableDocument<unknown>)=>[...(doc.participant.role==='observer'?[]:[doc.participant.id]),...(doc.opponents??[]).map(person=>person.id)];
const held=(doc:TableDocument<unknown>)=>new Map([...(doc.participant.role==='observer'?[]:[[doc.participant.id,doc.hand.length] as const]),...(doc.opponents??[]).map(person=>[person.id,person.handCount] as const)]);
const fingerprint=(zone:FramePaintCollection)=>JSON.stringify([zone.id,zone.purpose,zone.kind,zone.availability,zone.hiddenCount,zone.collectedBy,zone.cards.map(card=>[card.entityId,card.ownerId,card.visual,card.emphasis]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))]);
export function isPublicCompletionGrant(event:unknown):event is PublicCompletionGrant{return !!event&&typeof event==='object'&&owners.has(event as PublicCompletionGrant);}
export function retirePublicCompletionGrant(event:PublicCompletionGrant):void{owners.delete(event);}
export function isPublicCompletionView(view:unknown):view is PublicCompletionView{if(!view||typeof view!=='object')return false;const event=Object.getOwnPropertyDescriptor(view,'event');return !!event&&'value'in event&&owners.get(event.value)?.view===view;}
export function publicCompletionFingerprint(view:PublicCompletionView):string|undefined{return isPublicCompletionView(view)?owners.get(view.event)?.fingerprint:undefined;}
/** Synchronous proof only; the returned view retains public references/geometry,
 * never a previous document, hand face, command or private scene subtree. */
export function admitPublicCompletion(previous:PresentationFrame,before:TableDocument<unknown>,next:TableDocument<unknown>,resources:FramePaintResources,now:number,receiveSource?:(participantId:string)=>CompletionReceiveSource|null):PublicCompletionView|null {
 if(!Number.isFinite(now)||!next.outcome||before.outcome||previous.settled||previous.modalId||scope(previous)!==scope(next)||scope(before)!==scope(next)||resources.status!=='available'||previous.paintResources?.status!=='available'||next.presentation?.tableCollectionIds?.length!==0)return null;
 const ids=roster(next);if(ids.length<2||ids.length>8||JSON.stringify(ids)!==JSON.stringify(roster(before))||JSON.stringify(ids)!==JSON.stringify(previous.rosterIds))return null;
 const state=(document:TableDocument<unknown>,paintResources:FramePaintResources|undefined):PublicCaptureState=>({context:document.context,resources:paintResources,rosterIds:roster(document),localParticipantId:document.participant.role==='observer'?null:document.participant.id,hand:document.hand.map(card=>({entityId:card.id,...(card.ownerId?{ownerId:card.ownerId}:{}),visual:card.visual,...(card.emphasis?{emphasis:card.emphasis}:{})})),recipientCounts:(document.opponents??[]).map(person=>({participantId:person.id,count:person.handCount})),reveals:document.reveals,settled:!!document.outcome});
 const visiblePublic=previous.nodes.flatMap(node=>node.kind==='card'&&node.entityId&&node.zoneId&&node.zoneId!=='hand'&&node.visual&&node.visual.kind!=='back'?[{collectionId:node.zoneId,card:{entityId:node.entityId,...(node.ownerId?{ownerId:node.ownerId}:{}),visual:node.visual,...(node.emphasis?{emphasis:node.emphasis}:{})}}]:[]);
 const capture=provePublicCapture({...state(before,previous.paintResources),visiblePublic},state(next,resources));if(!capture)return null;
 if([...held(next).values()].some(count=>count!==0))return null;
 const sourceId=capture.sourceCollectionId,destination=resources.collections.find(zone=>zone.id===capture.capturedCollectionId&&zone.availability==='current');if(!destination)return null;
 if(before.presentation?.tableCollectionIds!==undefined&&!before.presentation.tableCollectionIds.includes(sourceId))return null;
 const gameplay=copyPublicGameplayPresentation(before);if(!gameplay)return null;
 const localWinner=next.participant.role!=='observer'&&capture.collectedBy===next.participant.id,receive=localWinner?receiveSource?.(next.participant.id):null;
 const recipe=captureRetainedPublicTableRecipe(previous,sourceId,receive?{participantId:next.participant.id,source:receive}:undefined,before.statusPresentation,before.facts.map(fact=>fact.id));if(!recipe)return null;
 const event:PublicCompletionGrant=Object.freeze({id:`public-completion-${++serial}`,expiresAt:now+(220+80+220+450+240+25*(ids.length-1))+2000,[brand]:true as const});
 owners.set(event,{gameplay,scope:scope(next),outcomeId:next.outcome.id,fingerprint:JSON.stringify([scope(next),fingerprint(destination)]),cohort:fingerprint(destination),resources:JSON.stringify(resources),selector:JSON.stringify(next.presentation?.tableCollectionIds),roster:JSON.stringify(ids),environment:JSON.stringify(previous.environment)});
 const view=Object.freeze({event,sourceCollectionId:sourceId,capturedCollectionId:destination.id,entityIds:Object.freeze(destination.cards.map(card=>card.entityId)),recipe});owners.get(event)!.view=view;return view;
}
function completionSemanticsCurrent(view:PublicCompletionView,document:TableDocument<unknown>,resources:FramePaintResources,environment:PresentationFrame['environment']):boolean {
 if(!isPublicCompletionView(view))return false;const proof=owners.get(view.event);if(!proof||scope(document)!==proof.scope||document.outcome?.id!==proof.outcomeId||JSON.stringify(roster(document))!==proof.roster||JSON.stringify(environment)!==proof.environment||JSON.stringify(document.presentation?.tableCollectionIds)!==proof.selector||[...held(document).values()].some(count=>count!==0)||resources.status!=='available'||JSON.stringify(resources)!==proof.resources)return false;
 const zone=resources.collections.find(zone=>zone.id===view.capturedCollectionId);return !!zone&&fingerprint(zone)===proof.cohort;
}

export function currentPublicCompletion(view:PublicCompletionView,document:TableDocument<unknown>,resources:FramePaintResources,environment:PresentationFrame['environment'],now:number):boolean {
 return Number.isFinite(now)&&completionSemanticsCurrent(view,document,resources,environment)&&now<view.event.expiresAt;
}
/** Runtime admission checks time and current authority; the cached opaque read
 * identity cannot extend the parent event or carry a replaceable payload. */
export function issuePublicGameplayRead(view:PublicCompletionView,document:TableDocument<unknown>,resources:FramePaintResources,environment:PresentationFrame['environment'],now:number):CompletionGameplayRead|null {
 if(!currentPublicCompletion(view,document,resources,environment,now))return null;
 const proof=owners.get(view.event)!;
 return proof.read??(proof.read=Object.freeze({[gameplayReadBrand]:true as const}));
}
/** Pure planner lookup. Runtime must repeat timed admission before publishing
 * a computed layout; Ready is not value settlement. */
export function readPublicGameplayPresentation(read:CompletionGameplayRead|undefined,view:PublicCompletionView,document:TableDocument<unknown>,resources:FramePaintResources,environment:PresentationFrame['environment']):PublicGameplayPresentation|null {
 if(!read||!completionSemanticsCurrent(view,document,resources,environment))return null;
 const proof=owners.get(view.event)!;return proof.read===read?proof.gameplay:null;
}

/** The exact current event is the only lease for these inert outgoing values.
 * Ready does not retire this association; End/revocation removes the owner. */
export function currentPublicGameplayPresentation(view:PublicCompletionView,document:TableDocument<unknown>,resources:FramePaintResources,environment:PresentationFrame['environment'],now:number):PublicGameplayPresentation|null {
 if(!currentPublicCompletion(view,document,resources,environment,now))return null;
 return owners.get(view.event)?.gameplay??null;
}

/** Issuer-owned zero-game-input recipe. Room navigation may remain available;
 * no native game binding is retained, including disabled or mixed bindings. */
export function completionFrameInputProof(frame:PresentationFrame,document:TableDocument<unknown>):boolean {
 if(!isPublicCompletionView(frame.publicCompletion)||!document.outcome||frame.modalId!==undefined||frame.decisionLaneId!==undefined||frame.outcomeLaneId!==undefined||frame.nodes.length<1||frame.nodes.length>4096)return false;
 const passive=new Set(['id','parent','box','kind','label','accessibleDescription','role','textAlign','arrangement','columnSpan','semanticRole','controlsId','scrollResetKey','paintChildren','shellIcon','shellSlot','connectionState','inert','decoration','visual','emphasis','tone','deemphasized','identityMetaFor','participantFeedbackFor','participantStatusFor','observerReactionLayer','observerReactionSlot','observerReactionSlotId','suit','progressPaint','appearance','collectionPurpose','collectedBy','stockCount','recipientId','recipientCount','ownHandAnchor','trickSlot','intent','enabled','entityId','ownerId','zoneId','scroll','scrollAxis','scrollbarGutter','figureCue','clockPaint','clockTextScale']);
 return frame.nodes.every(node=>{
  const interactive=['command','choice','select','editor','toggle','range'].includes(node.kind);
  const action=node.shellActionId===undefined?undefined:document.shell?.header.actions.find(action=>action.id===node.shellActionId);
  // Header accessibility text includes current room/count context. It is
  // descriptive paint; only the exact canonical route can own a read control.
  const readonlyHeader=!!action&&node.kind==='command'&&typeof node.label==='string'&&node.label.trim().length>0&&(node.enabled!==true||action.enabled)&&JSON.stringify(node.shellIntent)===JSON.stringify(action.intent)&&(action.intent.kind==='open-page'||action.intent.kind==='open-disclosure'||action.intent.kind==='request-effect'&&action.intent.effect==='share-room');
  if(interactive&&!readonlyHeader)return false;
  return Object.keys(node).every(key=>(node as unknown as Record<string,unknown>)[key]===undefined||passive.has(key)||readonlyHeader&&(key==='shellActionId'||key==='shellIntent'));
 });
}
