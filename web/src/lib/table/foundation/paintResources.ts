import type {CardCollection,TableDocument} from './contracts';
import type {CardVisual} from '../../cardTypes';
export interface FramePaintCard {readonly entityId:string;readonly ownerId?:string;readonly visual:CardVisual;readonly emphasis?:'special'|'joker'|'call';}
export interface FramePaintCollection {readonly id:string;readonly purpose?:CardCollection['purpose'];readonly kind?:CardCollection['kind'];readonly availability:'current'|'next-deal';readonly collectedBy?:string;readonly hiddenCount?:number;readonly cards:readonly FramePaintCard[];}
export type FramePaintResources={readonly status:'available';readonly collections:readonly FramePaintCollection[]}|{readonly status:'unavailable';readonly reason:'budget'|'unsupported'};
export const PAINT_RESOURCE_LIMITS=Object.freeze({collections:4096,cards:4096,bytes:1048576,id:2048});
const unavailable=(reason:'budget'|'unsupported'):FramePaintResources=>Object.freeze({status:'unavailable',reason});
const field=(value:object,key:string):unknown=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor)return undefined;if(!('value'in descriptor)||!descriptor.enumerable)throw Error('unsupported');return descriptor.value;};
const identifier=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=PAINT_RESOURCE_LIMITS.id;
const array=(value:unknown):value is unknown[]=>Array.isArray(value)&&Reflect.ownKeys(value).length===value.length+1;
function front(value:unknown):CardVisual {
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('unsupported');
 const kind=field(value,'kind');
 if(kind==='standard'){
  const suit=field(value,'suit'),rank=field(value,'rank');
  if(!['Spade','Heart','Diamond','Club'].includes(String(suit))||!Number.isInteger(rank)||Number(rank)<2||Number(rank)>14)throw Error('unsupported');
  return Object.freeze({kind,suit:suit as 'Spade'|'Heart'|'Diamond'|'Club',rank:Number(rank)});
 }
 if(kind==='joker'){const color=field(value,'color');if(color!=='Red'&&color!=='Black')throw Error('unsupported');return Object.freeze({kind,color});}
 throw Error('unsupported');
}
/** Public-only immutable art membership. Failure never rejects a legacy scene,
 * changes selected UI, or authorizes partial resource-dependent motion. */
export function publicPaintResources(document:Pick<TableDocument<unknown>,'collections'|'participant'|'opponents'>):FramePaintResources {
 try{
  const raw=field(document,'collections');if(raw===undefined)return Object.freeze({status:'available',collections:Object.freeze([])});
  if(!array(raw))return unavailable('unsupported');if(raw.length>PAINT_RESOURCE_LIMITS.collections)return unavailable('budget');
  const participants=new Set([document.participant.id,...(document.opponents??[]).map(person=>person.id)]),ids=new Set<string>(),facts=new Map<string,string>();
  let count=0,bytes=32;
  const collections:FramePaintCollection[]=[];
  for(let index=0;index<raw.length;index++){
   const source=field(raw,String(index));if(!source||typeof source!=='object'||Array.isArray(source))return unavailable('unsupported');
   const id=field(source,'id'),purpose=field(source,'purpose'),kind=field(source,'kind'),availability=field(source,'availability')??'current',hiddenCount=field(source,'hiddenCount'),collectedBy=field(source,'collectedBy'),input=field(source,'cards');
   if(!identifier(id)||ids.has(id)||purpose!==undefined&&!['stock','play','captured'].includes(String(purpose))||kind!==undefined&&!['trick','deck'].includes(String(kind))||!['current','next-deal'].includes(String(availability))||!array(input)||collectedBy!==undefined&&(!identifier(collectedBy)||purpose!=='captured'||!participants.has(collectedBy)))return unavailable('unsupported');
   ids.add(id);count+=input.length;if(count>PAINT_RESOURCE_LIMITS.cards)return unavailable('budget');
   if(hiddenCount!==undefined&&(purpose!=='stock'||input.length||!Number.isSafeInteger(hiddenCount)||Number(hiddenCount)<0||Number(hiddenCount)>10000)||kind==='deck'&&(purpose!=='stock'||hiddenCount===undefined)||kind==='trick'&&(purpose!=='play'||hiddenCount!==undefined)||availability==='next-deal'&&(purpose!=='stock'||kind!=='deck'||hiddenCount===undefined||input.length))return unavailable('unsupported');
   const cards:FramePaintCard[]=[],entities=new Set<string>();
   for(let i=0;i<input.length;i++){
    const card=field(input,String(i));if(!card||typeof card!=='object'||Array.isArray(card))return unavailable('unsupported');
    const entityId=field(card,'id'),ownerId=field(card,'ownerId'),emphasis=field(card,'emphasis');
    if(!identifier(entityId)||entities.has(entityId)||ownerId!==undefined&&(!identifier(ownerId)||!participants.has(ownerId))||emphasis!==undefined&&!['special','joker','call'].includes(String(emphasis)))return unavailable('unsupported');
    const visual=front(field(card,'visual')),signature=JSON.stringify([ownerId,visual]);
    if(facts.has(entityId)&&facts.get(entityId)!==signature)return unavailable('unsupported');facts.set(entityId,signature);entities.add(entityId);
    const owned=Object.freeze({entityId,...(ownerId!==undefined?{ownerId}:{}),visual,...(emphasis!==undefined?{emphasis:emphasis as FramePaintCard['emphasis']}: {})});
    bytes+=new TextEncoder().encode(JSON.stringify(owned)).byteLength+1;if(bytes>PAINT_RESOURCE_LIMITS.bytes)return unavailable('budget');cards.push(owned);
   }
   const owned=Object.freeze({id,...(purpose!==undefined?{purpose:purpose as CardCollection['purpose']}:{}),...(kind!==undefined?{kind:kind as CardCollection['kind']}:{}),availability:availability as 'current'|'next-deal',...(collectedBy!==undefined?{collectedBy}:{}),...(hiddenCount!==undefined?{hiddenCount:Number(hiddenCount)}:{}),cards:Object.freeze(cards)});
   bytes+=new TextEncoder().encode(JSON.stringify({...owned,cards:[]})).byteLength+1;if(bytes>PAINT_RESOURCE_LIMITS.bytes)return unavailable('budget');collections.push(owned);
  }
  return Object.freeze({status:'available',collections:Object.freeze(collections)});
 }catch{return unavailable('unsupported');}
}
