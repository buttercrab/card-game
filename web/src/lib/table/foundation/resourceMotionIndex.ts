import type {PresentationFrame} from './contracts';
import type {CardVisual} from '../../cardTypes';
import {PAINT_RESOURCE_LIMITS,type FramePaintCard,type FramePaintCollection} from './paintResources';
export type ResourceAvailability=FramePaintCollection['availability'];
export interface PublicFaceReference {readonly availability:ResourceAvailability;readonly collectionId:string;readonly entityId:string;readonly card:FramePaintCard;}
export interface ResourceMotionIndex {
 readonly collections:readonly FramePaintCollection[];
 collection(id:string,availability?:ResourceAvailability):FramePaintCollection|undefined;
 face(collectionId:string,entityId:string,availability?:ResourceAvailability):PublicFaceReference|undefined;
 /** Aliases remain distinct scoped references. Never pick the first location. */
 locations(entityId:string,availability?:ResourceAvailability):readonly PublicFaceReference[];
}
const id=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=PAINT_RESOURCE_LIMITS.id;
export const sameResourceVisual=(a:CardVisual|{readonly kind:'back'},b:CardVisual|{readonly kind:'back'}):boolean=>a.kind===b.kind&&(a.kind==='standard'&&b.kind==='standard'?a.rank===b.rank&&a.suit===b.suit:a.kind==='joker'&&b.kind==='joker'?a.color===b.color:a.kind==='back'&&b.kind==='back');
export const samePublicFace=(a:FramePaintCard,b:FramePaintCard):boolean=>a.entityId===b.entityId&&a.ownerId===b.ownerId&&a.emphasis===b.emphasis&&sameResourceVisual(a.visual,b.visual);
export function samePublicCollection(a:FramePaintCollection,b:FramePaintCollection):boolean {
 if(a.id!==b.id||a.availability!==b.availability||a.purpose!==b.purpose||a.kind!==b.kind||a.collectedBy!==b.collectedBy||a.hiddenCount!==b.hiddenCount||a.cards.length!==b.cards.length)return false;
 const cards=new Map(b.cards.map(card=>[card.entityId,card]));if(cards.size!==b.cards.length)return false;
 for(const card of a.cards){const other=cards.get(card.entityId);if(!other||!samePublicFace(card,other))return false;cards.delete(card.entityId);}return cards.size===0;
}
/** Geometry-free membership only; absent/unavailable resources never fall back
 * to painted nodes. The runtime owns and freezes the underlying public plane. */
export function resourceMotionIndex(frame:Pick<PresentationFrame,'paintResources'>):ResourceMotionIndex|null {
 try{
  const resources=frame.paintResources;if(resources?.status!=='available'||resources.collections.length>PAINT_RESOURCE_LIMITS.collections)return null;
  const byCollection=new Map<ResourceAvailability,Map<string,FramePaintCollection>>(),faces=new Map<ResourceAvailability,Map<string,Map<string,PublicFaceReference>>>(),locations=new Map<ResourceAvailability,Map<string,PublicFaceReference[]>>(),facts=new Map<string,FramePaintCard>();let count=0;
  const collectionIds=new Set<string>();
  for(const collection of resources.collections){
   if(!id(collection.id)||collectionIds.has(collection.id)||!['current','next-deal'].includes(collection.availability)||!Array.isArray(collection.cards))return null;collectionIds.add(collection.id);count+=collection.cards.length;if(count>PAINT_RESOURCE_LIMITS.cards)return null;
   if(collection.hiddenCount!==undefined&&(!Number.isSafeInteger(collection.hiddenCount)||collection.hiddenCount<0||collection.hiddenCount>10000||collection.purpose!=='stock'||collection.cards.length))return null;
   if(collection.availability==='next-deal'&&(collection.purpose!=='stock'||collection.kind!=='deck'||collection.hiddenCount===undefined||collection.cards.length))return null;
   let registry=byCollection.get(collection.availability);if(!registry){registry=new Map();byCollection.set(collection.availability,registry);}registry.set(collection.id,collection);
   let scoped=faces.get(collection.availability);if(!scoped){scoped=new Map();faces.set(collection.availability,scoped);}const entries=new Map<string,PublicFaceReference>();scoped.set(collection.id,entries);
   let aliases=locations.get(collection.availability);if(!aliases){aliases=new Map();locations.set(collection.availability,aliases);}
   for(const card of collection.cards){
    const visual=card.visual;
    if(!id(card.entityId)||entries.has(card.entityId)||card.ownerId!==undefined&&!id(card.ownerId)||!visual||!(visual.kind==='standard'&&Number.isInteger(visual.rank)&&visual.rank>=2&&visual.rank<=14&&['Spade','Heart','Diamond','Club'].includes(visual.suit)||visual.kind==='joker'&&['Black','Red'].includes(visual.color)))return null;
    const prior=facts.get(card.entityId);if(prior&&(prior.ownerId!==card.ownerId||!sameResourceVisual(prior.visual,card.visual)))return null;facts.set(card.entityId,card);
    const reference=Object.freeze({availability:collection.availability,collectionId:collection.id,entityId:card.entityId,card});entries.set(card.entityId,reference);const list=aliases.get(card.entityId)??[];list.push(reference);aliases.set(card.entityId,list);
   }
  }
  for(const registry of locations.values())for(const [entity,list]of registry)registry.set(entity,Object.freeze(list) as PublicFaceReference[]);
  return Object.freeze({collections:resources.collections,collection:(collectionId:string,availability:ResourceAvailability='current')=>byCollection.get(availability)?.get(collectionId),face:(collectionId:string,entityId:string,availability:ResourceAvailability='current')=>faces.get(availability)?.get(collectionId)?.get(entityId),locations:(entityId:string,availability:ResourceAvailability='current')=>locations.get(availability)?.get(entityId)??Object.freeze([])});
 }catch{return null;}
}
/** Collection-scoped equality for every unaffected public resource. */
export function unchangedPublicPartition(before:ResourceMotionIndex,after:ResourceMotionIndex,except:ReadonlySet<string>,availability:ResourceAvailability='current'):boolean{
 const old=before.collections.filter(collection=>collection.availability===availability&&!except.has(collection.id)),next=after.collections.filter(collection=>collection.availability===availability&&!except.has(collection.id));
 return old.length===next.length&&old.every(collection=>{const other=after.collection(collection.id,availability);return !!other&&samePublicCollection(collection,other);});
}
const countBindings:readonly(keyof import('./contracts').PlannedNode)[]=['entityId','ownerId','zoneId','stockCount','collectionPurpose','cardId','inspectCardId','actionId','fieldId','optionId','cardActionPickerIntent','cardActionOptionId','catalogueIntent','choiceLeaseId','editor','formIntent','formLeaseId','formActionId','formNavigation','formField','shellActionId','shellIntent','localIntent','preference','disclosureIntent','disclosureCatalogId','disclosureFormActionId','modalLeaseId','assistanceIntent','feedbackDismissId','publicDisclosureEventId','inspectionPreviewFor','trickSlot','collectedBy','checked'];
export function recipientCountNode(node:import('./contracts').PlannedNode,minimum=0):boolean {
 return !!node.recipientId&&Number.isSafeInteger(node.recipientCount)&&node.recipientCount!>=minimum&&node.recipientCount!<=10000&&node.ownHandAnchor===undefined&&node.enabled===undefined&&countBindings.every(key=>node[key]===undefined)&&(node.kind==='group'&&node.inert===true&&node.label===''&&node.visual===undefined||node.kind==='card'&&node.visual?.kind==='back');
}
export function ownCountNode(node:import('./contracts').PlannedNode):boolean {
 return !!node.ownHandAnchor?.participantId&&Number.isSafeInteger(node.ownHandAnchor.count)&&node.ownHandAnchor.count>=0&&node.ownHandAnchor.count<=10000&&node.recipientId===undefined&&node.recipientCount===undefined&&!node.enabled&&countBindings.every(key=>node[key]===undefined)&&(node.kind==='group'&&node.inert===true&&node.label===''&&node.visual===undefined||node.kind==='card'&&node.visual?.kind==='back');
}
