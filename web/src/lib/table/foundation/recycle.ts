import type { PresentationFrame, TableDocument, ViewContext } from './contracts';
import type {FramePaintResources} from './paintResources';
import {resourceMotionIndex,ownCountNode,recipientCountNode} from './resourceMotionIndex';

export interface RecycleTransition {readonly id:string;readonly source:string;readonly previousGeneration:string;readonly totalCount:number;}
export interface RecycleCount {readonly participantId:string;readonly count:number;}
const admissionBrand:unique symbol=Symbol('count-conserved recycle');
const admissions=new WeakSet<object>();
export function isRecycleAdmission(value:unknown):value is RecycleAdmission{return !!value&&typeof value==='object'&&admissions.has(value);}
/** Private-count evidence only. It retains neither a presentation frame nor physical card identities. */
export interface RecycleAdmission {
 readonly [admissionBrand]:true;
 readonly oldFrameId:number;readonly fromContext:ViewContext;readonly toContext:ViewContext;readonly transitionId:string;readonly source:string;readonly totalCount:number;
 readonly oldStock:number;readonly newStock:number;readonly dealt:number;readonly localParticipantId:string|null;readonly oldLocalCount:number;readonly newLocalCount:number;
 readonly collections:readonly {readonly id:string;readonly purpose:string|null;readonly kind:string|null;readonly availability:'current';readonly hiddenCount:number|null}[];
 readonly oldRecipients:readonly RecycleCount[];readonly newRecipients:readonly RecycleCount[];readonly rosterIds:readonly string[];readonly continuity:number;
 readonly deal:{readonly id:string;readonly source:string;readonly handCount:number;readonly recipients:readonly RecycleCount[]};
}
const fail=():never=>{throw Error('Invalid count-conserved recycle');};
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=2048;
const count=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=104;
/** Inspect shallow own data descriptors before reading; private face graphs are never cloned. */
function record(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Object.getOwnPropertySymbols(value).length) return fail();
 if(Object.getOwnPropertyNames(value).length>256)return fail();const descriptors=Object.getOwnPropertyDescriptors(value);
 const owned:Record<string,unknown>={};for(const [key,descriptor] of Object.entries(descriptors)){if(!('value'in descriptor)||!descriptor.enumerable||['__proto__','prototype','constructor'].includes(key))return fail();Object.defineProperty(owned,key,{value:descriptor.value,enumerable:true});}return owned;
}
function array(value:unknown,maximum:number):readonly unknown[]{
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>maximum||Object.getOwnPropertySymbols(value).length)return fail();
 const keys=Object.getOwnPropertyNames(value);if(keys.length!==value.length+1)return fail();
 const result:unknown[]=[];for(let index=0;index<value.length;index++){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)return fail();result.push(descriptor.value);}return result;
}
function context(value:unknown):ViewContext{
 const source=record(value);if(Object.keys(source).length!==4||!['session','audience','generation','revision'].every(key=>id(source[key])))return fail();
 return Object.freeze({session:source.session as string,audience:source.audience as string,generation:source.generation as string,revision:source.revision as string});
}
function visual(input:unknown):Record<string,unknown>{
 const value=record(input);
 if(value.kind==='back'){exact(value,['kind']);return value;}
 if(value.kind==='standard'){exact(value,['kind','rank','suit']);if(typeof value.rank!=='number'||!Number.isInteger(value.rank)||value.rank<2||value.rank>14||!['Spade','Heart','Club','Diamond'].includes(String(value.suit)))return fail();return value;}
 if(value.kind==='joker'){exact(value,['kind','color']);if(value.color!=='Black'&&value.color!=='Red')return fail();return value;}
 return fail();
}
function exact(source:Record<string,unknown>,keys:readonly string[]){if(Object.keys(source).length!==keys.length||!keys.every(key=>Object.hasOwn(source,key)))fail();}
/** Canonical hint ownership is independent of any previous private frame. */
export function ownRecycleTransition(input:unknown):RecycleTransition {
 if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input))||Object.getOwnPropertySymbols(input).length||Object.getOwnPropertyNames(input).length!==4)return fail();
 const source=record(input);exact(source,['id','source','previousGeneration','totalCount']);
 if(!id(source.id)||!id(source.source)||!id(source.previousGeneration)||!count(source.totalCount)||source.totalCount===0)return fail();
 return Object.freeze({id:source.id,source:source.source,previousGeneration:source.previousGeneration,totalCount:source.totalCount});
}
function frozenCount(participantId:string,value:number):RecycleCount{return Object.freeze({participantId,count:value});}

/** The caller supplies the actual latest committed source and verifies continuity
 * and transition deduplication again at use. This pure function grants no motion lease. */
export function admitRecycle(previous:PresentationFrame,next:TableDocument<unknown>,continuity:number,nextResources?:FramePaintResources):RecycleAdmission|null{
 try{
  if(!Number.isSafeInteger(continuity)||continuity<0)return null;
  const old=record(previous),current=record(next),hint=ownRecycleTransition(current.recycle);
  if(!id(hint.id)||!id(hint.source)||!id(hint.previousGeneration)||!count(hint.totalCount)||hint.totalCount===0||typeof old.id!=='number'||!Number.isSafeInteger(old.id)||old.id<1||old.modalId!==undefined||old.settled!==undefined&&old.settled!==false||current.stage!==undefined&&current.stage!=='active'||current.outcome!==undefined||current.stockReturn!==undefined)return null;
  const from=context(old.context),to=context(current.context);
  if(from.session!==to.session||from.audience!==to.audience||from.generation!==hint.previousGeneration||from.generation===to.generation)return null;
  const person=record(current.participant);if(!id(person.id)||person.role!==undefined&&!['player','observer'].includes(String(person.role)))return null;
  const local=person.role==='observer'?null:person.id;
  const peers=array(current.opponents??[],8).map(value=>{const peer=record(value);if(!id(peer.id)||!count(peer.handCount))return fail();return frozenCount(peer.id,peer.handCount);});
  const roster=[...(local?[local]:[]),...peers.map(peer=>peer.participantId)],priorRoster=array(old.rosterIds,9);
  if(!roster.length||new Set(roster).size!==roster.length||priorRoster.length!==roster.length||!priorRoster.every((value,index)=>id(value)&&value===roster[index]))return null;
  const hand=array(current.hand,104),newOwn=new Set<string>();
  for(const item of hand){const card=record(item);if(!id(card.id)||newOwn.has(card.id)||card.ownerId!==undefined&&card.ownerId!==local)return null;if(visual(card.visual).kind==='back')return null;newOwn.add(card.id);}
  if(local===null&&hand.length)return null;
  const previousResources=resourceMotionIndex(previous),resources=resourceMotionIndex({paintResources:nextResources});if(!previousResources||!resources)return null;
  const collections=resources.collections,stocks=new Map<string,number>(),oldStocks=new Map<string,number>();
  for(const collection of collections){if(collection.availability!=='current'||collection.cards.length)return null;if(collection.hiddenCount!==undefined){if(collection.purpose!=='stock'||!count(collection.hiddenCount))return null;stocks.set(collection.id,collection.hiddenCount);}}
  for(const collection of previousResources.collections){if(collection.availability!=='current'||collection.cards.length)return null;if(collection.hiddenCount!==undefined){if(collection.purpose!=='stock'||!count(collection.hiddenCount))return null;oldStocks.set(collection.id,collection.hiddenCount);}}
  if(previousResources.collections.length!==collections.length||previousResources.collections.some(old=>{const fresh=resources.collection(old.id);return !fresh||old.purpose!==fresh.purpose||old.kind!==fresh.kind||old.id!==hint.source&&old.hiddenCount!==fresh.hiddenCount;}))return null;
  const collectionCounts=collections.map(collection=>Object.freeze({id:collection.id,purpose:collection.purpose??null,kind:collection.kind??null,availability:'current' as const,hiddenCount:collection.hiddenCount??null}));
  const newStock=stocks.get(hint.source);if(newStock===undefined)return null;
  const nodes=array(old.nodes,4096),nodeIds=new Set<string>(),oldEntities=new Set<string>(),oldPeers=new Map<string,number>();let oldLocalCount:number|null=null;
  for(const item of nodes){const node=record(item);if(!id(node.id)||nodeIds.has(node.id))return null;nodeIds.add(node.id);const paint=node.visual===undefined?null:visual(node.visual);
   if(node.zoneId==='hand'&&node.kind==='card'&&node.entityId===undefined)return null;
   if(node.entityId!==undefined){if(node.kind!=='card'||!id(node.entityId)||node.zoneId!=='hand'||local===null||oldEntities.has(node.entityId)||node.ownerId!==undefined&&node.ownerId!==local)return null;oldEntities.add(node.entityId);}
   if(node.ownHandAnchor!==undefined){const anchor=record(node.ownHandAnchor);exact(anchor,['participantId','count']);if(local===null||oldLocalCount!==null||anchor.participantId!==local||!count(anchor.count)||node.entityId!==undefined||node.zoneId!==undefined||node.recipientId!==undefined||node.recipientCount!==undefined||node.stockCount!==undefined||!ownCountNode(node as unknown as import('./contracts').PlannedNode))return null;oldLocalCount=anchor.count;}
   if(node.recipientId!==undefined||node.recipientCount!==undefined){if(!id(node.recipientId)||!count(node.recipientCount)||oldPeers.has(node.recipientId)||!peers.some(peer=>peer.participantId===node.recipientId)||node.entityId!==undefined||node.zoneId!==undefined||node.ownHandAnchor!==undefined||node.stockCount!==undefined||!recipientCountNode(node as unknown as import('./contracts').PlannedNode))return null;oldPeers.set(node.recipientId,node.recipientCount);}

  }
  if(local!==null&&(oldLocalCount===null||oldLocalCount!==oldEntities.size)||local===null&&(oldLocalCount!==null||oldEntities.size>0)||oldPeers.size!==peers.length)return null;
  const oldStock=oldStocks.get(hint.source);if(oldStock===undefined||oldStocks.size!==stocks.size)return null;
  for(const [stockId,value] of oldStocks)if(stockId!==hint.source&&stocks.get(stockId)!==value)return null;
  const oldRecipients=peers.map(peer=>frozenCount(peer.participantId,oldPeers.get(peer.participantId)!));
  const oldHeld=(oldLocalCount??0)+oldRecipients.reduce((sum,peer)=>sum+peer.count,0),newHeld=hand.length+peers.reduce((sum,peer)=>sum+peer.count,0);
  if(oldStock+oldHeld!==hint.totalCount||newStock+newHeld!==hint.totalCount)return null;
  const deals=array(current.deals,1);if(deals.length!==1)return null;const deal=record(deals[0]);
  if(!id(deal.id)||deal.source!==hint.source||array(deal.cardIds,104).length||deal.handCount!==hand.length||!count(deal.handCount))return null;
  const recipients=array(deal.recipients??[],8).map(value=>{const peer=record(value);exact(peer,['participantId','count']);if(!id(peer.participantId)||!count(peer.count)||peer.count===0)return fail();return frozenCount(peer.participantId,peer.count);});
  const expected=peers.filter(peer=>peer.count>0);if(recipients.length!==expected.length||new Set(recipients.map(peer=>peer.participantId)).size!==recipients.length||!recipients.every(peer=>expected.some(candidate=>candidate.participantId===peer.participantId&&candidate.count===peer.count)))return null;
  const dealt=deal.handCount+recipients.reduce((sum,peer)=>sum+peer.count,0);if(dealt<1||dealt>64||dealt!==newHeld)return null;
  const proof={oldFrameId:old.id,fromContext:from,toContext:to,transitionId:hint.id,source:hint.source,totalCount:hint.totalCount,oldStock,newStock,dealt,localParticipantId:local,oldLocalCount:oldLocalCount??0,newLocalCount:hand.length,collections:Object.freeze(collectionCounts),oldRecipients:Object.freeze(oldRecipients),newRecipients:Object.freeze(peers),rosterIds:Object.freeze(roster),continuity,
   deal:Object.freeze({id:deal.id,source:hint.source,handCount:deal.handCount,recipients:Object.freeze(recipients)})};
  Object.defineProperty(proof,admissionBrand,{value:true});admissions.add(proof);return Object.freeze(proof) as RecycleAdmission;
 }catch{return null;}
}
