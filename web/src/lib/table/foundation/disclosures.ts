import {validInformationToken} from './information';
import type {InformationPanel,InformationValue,ViewContext} from './contracts';
import type {DisclosureCardRef,DisclosureDocument} from './disclosureTypes';
import {validateInformation} from './information';
import type {FormOffer} from './forms';
export interface DisclosureScope {readonly roomId:string;readonly roomEpoch:string;readonly actorId:string;readonly connectionEpoch:string;readonly visibility:'public'|'audience';readonly audience?:string;}
export interface DisclosureCatalogOffer {readonly id:string;readonly policyId:string;readonly revision:string;readonly title:string;readonly description?:string;readonly total:number;readonly pageSize:12;readonly scope:DisclosureScope;}
export interface DisclosureEntryMetadata {readonly id:string;readonly title:string;readonly description?:string;readonly group?:{readonly id:string;readonly title:string};}
export interface DisclosureCatalogPage {readonly catalogId:string;readonly revision:string;readonly page:number;readonly total:number;readonly pageSize:12;readonly entries:readonly DisclosureEntryMetadata[];}
export interface DisclosureContext {readonly roomId:string;readonly roomEpoch:string;readonly actorId:string;readonly connectionEpoch:string;readonly audience:string;}
export interface DisclosureSelectionReceipt {readonly id:string;readonly catalogId:string;readonly revision:string;readonly entryId:string;readonly scope:DisclosureScope;}
export interface DisclosureFormAction {readonly id:string;readonly label:string;readonly intent:'primary'|'secondary'|'quiet'|'danger';readonly selectionId:string;readonly catalogId:string;readonly catalogRevision:string;readonly entryId:string;readonly formId:string;readonly formInstanceId:string;}
export interface DisclosureRefresh {readonly selectionId:string;readonly catalogId:string;readonly revision:string;}
export interface DisclosureReadPolicy {readonly id:string;page(offer:DisclosureCatalogOffer,page:number):DisclosureCatalogPage;select(offer:DisclosureCatalogOffer,entryId:string,options?:{readonly signal:AbortSignal}):DisclosureDocument|Promise<DisclosureDocument>;}
/** Narrow registration type for synchronous in-memory policies and their direct callers. */
export interface SyncDisclosureReadPolicy extends DisclosureReadPolicy {select(offer:DisclosureCatalogOffer,entryId:string,options?:{readonly signal:AbortSignal}):DisclosureDocument;}
export const DISCLOSURE_LIMITS=Object.freeze({bytes:128*1024,nodes:32768,depth:24,array:512,roster:8,cards:104,sections:8,rounds:54,cardGroups:9,groupCardRefs:104,pageSize:12});
const fail=():never=>{throw Error('Invalid bounded disclosure data');};
/** Preflight descriptors and UTF-8 wire size before allocating the owned tree.
 * Dense 8×54 round/matrix references need more nodes than scalar form models. */
export function ownDisclosureData<T>(input:T):T{
 let bytes=0,nodes=0;const ancestors=new Set<object>(),captured=new WeakMap<object,PropertyDescriptorMap>(),encoder=new TextEncoder();
 const add=(amount:number)=>{bytes+=amount;if(bytes>DISCLOSURE_LIMITS.bytes)fail();};
 function string(value:string){if(value.length>8192)fail();add(encoder.encode(JSON.stringify(value)).length);}
 function inspect(value:unknown,depth:number):void{
  if(++nodes>DISCLOSURE_LIMITS.nodes||depth>DISCLOSURE_LIMITS.depth)fail();
  if(value===null){add(4);return;}if(typeof value==='string'){string(value);return;}if(typeof value==='boolean'){add(value?4:5);return;}if(typeof value==='number'){if(!Number.isFinite(value))fail();add(String(value).length);return;}
  if(!value||typeof value!=='object'||ancestors.has(value))return fail();
  const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);if(prototype!==(array?Array.prototype:Object.prototype)&&!(prototype===null&&!array))fail();
  let descriptors=captured.get(value);
  if(!descriptors){
   descriptors=Object.create(null) as PropertyDescriptorMap;
   // Reject oversized arrays before enumerating their keys or index descriptors.
   const length=array?Object.getOwnPropertyDescriptor(value,'length'):undefined;
   if(array&&(!length||!('value'in length)||!Number.isSafeInteger(length.value)||length.value<0||length.value>DISCLOSURE_LIMITS.array))return fail();
   const keys=Reflect.ownKeys(value);
   if(array){
    const size=length!.value as number;
    if(keys.length!==size+1||keys.some(key=>typeof key!=='string'||key!=='length'&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=size)))return fail();
    descriptors.length=length!;
    for(let index=0;index<size;index++){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(!descriptor)return fail();descriptors[String(index)]=descriptor;}
   }else{
    // ownKeys allocation is intrinsic to JS; no descriptor amplification follows
    // a rejected key budget or symbol-bearing record.
    if(keys.length>64||keys.some(key=>typeof key!=='string'))return fail();
    for(const key of keys as string[]){const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor)return fail();descriptors[key]=descriptor;}
   }
   captured.set(value,descriptors);
  }
  const entries=Object.entries(descriptors).filter(([key])=>!(array&&key==='length'));
  ancestors.add(value);add(2);
  try{for(const [index,[key,descriptor]] of entries.entries()){if(!('value'in descriptor)||!descriptor.enumerable)fail();if(index)add(1);if(!array){string(key);add(1);}inspect(descriptor.value,depth+1);}}finally{ancestors.delete(value);}
 }
 inspect(input,0);
 function copy(value:unknown):unknown{if(!value||typeof value!=='object')return value;const descriptors=captured.get(value)!;if(Array.isArray(value))return Object.freeze(Array.from({length:descriptors.length.value},(_,index)=>copy(descriptors[String(index)].value)));const out:Record<string,unknown>={};for(const [key,descriptor]of Object.entries(descriptors))Object.defineProperty(out,key,{value:copy(descriptor.value),enumerable:true});return Object.freeze(out);}
 return copy(input) as T;
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:unknown,allowed:readonly string[],required:readonly string[]=allowed):value is Record<string,unknown>=>object(value)&&Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key));
const text=(value:unknown,max=500):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=max;
const id=(value:unknown):value is string=>text(value,2048);
const list=(value:unknown,max:number):value is unknown[]=>Array.isArray(value)&&value.length<=max;
const distinct=(values:readonly unknown[])=>new Set(values).size===values.length;
const count=(value:unknown,max=1e9):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;
function scope(input:unknown):input is DisclosureScope{return exact(input,['roomId','roomEpoch','actorId','connectionEpoch','visibility','audience'],['roomId','roomEpoch','actorId','connectionEpoch','visibility'])&&[input.roomId,input.roomEpoch,input.actorId,input.connectionEpoch].every(id)&&(input.visibility==='public'?input.audience===undefined:input.visibility==='audience'&&id(input.audience));}
export function ownDisclosureSelectionReceipt(input:DisclosureSelectionReceipt):DisclosureSelectionReceipt{
 const value=ownDisclosureData(input);if(!exact(value,['id','catalogId','revision','entryId','scope'])||![value.id,value.catalogId,value.revision,value.entryId].every(id)||!scope(value.scope))fail();return value;
}
export function ownDisclosureRefresh(input:DisclosureRefresh):DisclosureRefresh{
 const value=ownDisclosureData(input);if(!exact(value,['selectionId','catalogId','revision'])||![value.selectionId,value.catalogId,value.revision].every(id))fail();return value;
}
/** References grant no authority by themselves. Session admission additionally
 * requires its current engine-minted receipt and registered form policy. */
export function ownDisclosureFormActions<A>(input:readonly DisclosureFormAction[],offers:readonly DisclosureCatalogOffer[],forms:readonly FormOffer<A>[]):readonly DisclosureFormAction[]{
 const values=ownDisclosureData(input);if(!list(values,32)||!distinct(values.map(value=>object(value)?value.id:undefined)))fail();const perSelection=new Map<string,number>(),selectionIdentity=new Map<string,string>();
 for(const value of values){
  if(!exact(value,['id','label','intent','selectionId','catalogId','catalogRevision','entryId','formId','formInstanceId'])||!text(value.id,128)||!text(value.label)||!['primary','secondary','quiet','danger'].includes(value.intent)||![value.selectionId,value.catalogId,value.catalogRevision,value.entryId,value.formId,value.formInstanceId].every(id))fail();
  const offered=offers.filter(offer=>offer.id===value.catalogId&&offer.revision===value.catalogRevision),matched=forms.filter(form=>form.id===value.formId&&form.instanceId===value.formInstanceId);
  if(offered.length!==1||matched.length!==1)fail();const form=matched[0],targets=form.actions?.map(action=>action.target)??[form.target??{kind:'host' as const}];
  if(!targets.length||targets.some(target=>target.kind!=='host'||!id(target.operationId)))fail();
  const identity=JSON.stringify([value.catalogId,value.catalogRevision,value.entryId]);if(selectionIdentity.has(value.selectionId)&&selectionIdentity.get(value.selectionId)!==identity)fail();selectionIdentity.set(value.selectionId,identity);
  const count=(perSelection.get(value.selectionId)??0)+1;if(count>4)fail();perSelection.set(value.selectionId,count);
 }
 return values;
}
export function ownDisclosureOffer(input:DisclosureCatalogOffer):DisclosureCatalogOffer{const value=ownDisclosureData(input);if(!exact(value,['id','policyId','revision','title','description','total','pageSize','scope'],['id','policyId','revision','title','total','pageSize','scope'])||![value.id,value.policyId,value.revision].every(id)||!text(value.title)||value.description!==undefined&&!text(value.description)||!count(value.total)||value.pageSize!==12||!scope(value.scope))fail();return value;}
export function sameDisclosureScope(a:DisclosureScope,b:DisclosureScope):boolean{return a.roomId===b.roomId&&a.roomEpoch===b.roomEpoch&&a.actorId===b.actorId&&a.connectionEpoch===b.connectionEpoch&&a.visibility===b.visibility&&a.audience===b.audience;}
export function disclosureScopeCurrent(scope:DisclosureScope,context:DisclosureContext):boolean{return scope.roomId===context.roomId&&scope.roomEpoch===context.roomEpoch&&scope.actorId===context.actorId&&scope.connectionEpoch===context.connectionEpoch&&(scope.visibility==='public'||scope.audience===context.audience);}
export function ownDisclosurePage(input:DisclosureCatalogPage,offered:DisclosureCatalogOffer,page:number):DisclosureCatalogPage{
 const offer=ownDisclosureOffer(offered),value=ownDisclosureData(input),pages=Math.max(1,Math.ceil(offer.total/12));
 if(!count(page)||page>=pages||!exact(value,['catalogId','revision','page','total','pageSize','entries'])||value.catalogId!==offer.id||value.revision!==offer.revision||value.page!==page||value.total!==offer.total||value.pageSize!==12||!list(value.entries,12)||value.entries.length!==Math.min(12,Math.max(0,offer.total-page*12))||!distinct(value.entries.map(entry=>object(entry)?entry.id:undefined)))fail();
 for(const entry of value.entries)if(!exact(entry,['id','title','description','group'],['id','title'])||!id(entry.id)||!text(entry.title)||entry.description!==undefined&&!text(entry.description)||entry.group!==undefined&&(!exact(entry.group,['id','title'])||!id(entry.group.id)||!text(entry.group.title)))fail();return value;
}
const tones=new Set(['plain','muted','accent','gold','danger']),suits=new Set(['Spade','Diamond','Heart','Club']),emphases=new Set(['special','joker','call']);
function visual(value:unknown):boolean{return object(value)&&(value.kind==='standard'?exact(value,['kind','suit','rank'])&&suits.has(value.suit as string)&&typeof value.rank==='number'&&Number.isInteger(value.rank)&&value.rank>=2&&value.rank<=14:value.kind==='joker'&&exact(value,['kind','color'])&&['Black','Red'].includes(value.color as string));}
function badge(value:unknown):boolean{return exact(value,['text','tone'])&&text(value.text)&&tones.has(value.tone as string);}
function informationValue(value:unknown,people:Set<string>,inline=true):value is InformationValue{
 if(!object(value))return false;
 switch(value.kind){case'text':return exact(value,['kind','text'])&&text(value.text);case'token':return validInformationToken(value);case'number':return exact(value,['kind','value'])&&typeof value.value==='number'&&Number.isFinite(value.value);case'participant':return exact(value,['kind','participantId'])&&typeof value.participantId==='string'&&people.has(value.participantId);case'suit':return exact(value,['kind','suit','label'])&&suits.has(value.suit as string)&&text(value.label);case'card':return exact(value,['kind','visual','label','emphasis'],['kind','visual','label'])&&visual(value.visual)&&text(value.label)&&(value.emphasis===undefined||emphases.has(value.emphasis as string));case'inline':return inline&&exact(value,['kind','values'])&&list(value.values,4)&&value.values.length>0&&value.values.every(atom=>informationValue(atom,people,false));default:return false;}
}
function information(input:unknown,people:Set<string>):input is readonly InformationPanel[]{
 if(!list(input,4))return false;
 for(const panel of input){if(!exact(panel,['id','title','summary','primary','fields','progress','badges'],['id','title','fields'])||!id(panel.id)||!text(panel.title)||!list(panel.fields,12)||panel.fields.some(field=>!exact(field,['id','label','value'])||!id(field.id)||!text(field.label)||!informationValue(field.value,people))||panel.summary!==undefined&&!badge(panel.summary)||panel.badges!==undefined&&(!list(panel.badges,8)||!panel.badges.every(badge))||panel.primary!==undefined&&(!exact(panel.primary,['label','value'],['value'])||panel.primary.label!==undefined&&!text(panel.primary.label)||!informationValue(panel.primary.value,people)))return false;
  const progress=panel.progress;if(progress!==undefined){if(!exact(progress,['label','total','target','series'],['label','total','series'])||!list(progress.series,4)||progress.series.some(series=>!exact(series,['id','label','value','tone','from'])))return false;}
 }
 // This is an isolated validation context, never appended to the live scene.
 const roster=[...people],context:ViewContext={session:'disclosure',audience:'local-roster',generation:'selected',revision:'1'};
 try{validateInformation({context,participant:{role:'observer',id:'disclosure-reader',name:'기록',markers:[]},opponents:roster.map(id=>({id,name:id,handCount:0})),hand:[],facts:[],decision:{id:'read-only',kind:'commands',commands:[]},offer:{id:'read-only',actions:[]},information:input as unknown as readonly InformationPanel[]});return true;}catch{return false;}
}
export function ownDisclosureDocument(input:DisclosureDocument,entryId?:string):DisclosureDocument{
 const value=ownDisclosureData(input);if(!exact(value,['entryId','title','roster','cards','sections'])||!id(value.entryId)||entryId!==undefined&&value.entryId!==entryId||!text(value.title)||!list(value.roster,8)||!list(value.cards,104)||!list(value.sections,8))fail();
 if(!distinct(value.roster.map(person=>object(person)?person.id:undefined))||!distinct(value.cards.map(card=>object(card)?card.id:undefined))||!distinct(value.sections.map(section=>object(section)?section.id:undefined)))fail();
 for(const person of value.roster)if(!exact(person,['id','name','badges'],['id','name'])||!id(person.id)||!text(person.name)||person.badges!==undefined&&(!list(person.badges,8)||!person.badges.every(badge)))fail();
 for(const card of value.cards)if(!exact(card,['id','label','visual','emphasis'],['id','label','visual'])||!id(card.id)||!text(card.label)||!visual(card.visual)||card.emphasis!==undefined&&!emphases.has(card.emphasis as string))fail();
 const people=new Set(value.roster.map(person=>person.id)),cards=new Set(value.cards.map(card=>card.id));let groups=0,groupRefs=0;
 const cardRef=(ref:unknown,play=false):ref is DisclosureCardRef=>exact(ref,['cardId','annotations','winner','leader','lead',...(play?['personId']:[])],['cardId',...(play?['personId']:[])])&&typeof ref.cardId==='string'&&cards.has(ref.cardId)&&(!play||typeof ref.personId==='string'&&people.has(ref.personId))&&['winner','leader'].every(key=>ref[key]===undefined||typeof ref[key]==='boolean')&&(ref.annotations===undefined||list(ref.annotations,8)&&ref.annotations.every(badge))&&(ref.lead===undefined||informationValue(ref.lead,people));
 for(const section of value.sections){if(!object(section)||!id(section.id)||!text(section.title))fail();
  if(section.kind==='content'){
   if(!exact(section,['id','title','kind','information','cardGroups'],['id','title','kind'])||section.information!==undefined&&!information(section.information,people)||section.cardGroups!==undefined&&!list(section.cardGroups,9))fail();
   for(const group of section.cardGroups??[]){groups++;if(!exact(group,['id','label','personId','description','cardIds'],['id','label','cardIds'])||!id(group.id)||!text(group.label)||group.personId!==undefined&&!people.has(group.personId)||group.description!==undefined&&!text(group.description)||!list(group.cardIds,104)||!distinct(group.cardIds)||group.cardIds.some(card=>!cards.has(card)))fail();groupRefs+=group.cardIds.length;}
   if(section.cardGroups&&!distinct(section.cardGroups.map(group=>group.id)))fail();
  }else if(section.kind==='rounds'){
   if(!exact(section,['id','title','kind','rounds'])||!list(section.rounds,54)||!distinct(section.rounds.map(round=>object(round)?round.id:undefined)))fail();
   for(const round of section.rounds){if(!exact(round,['id','title','lead','summary','plays'],['id','title','plays'])||!id(round.id)||!text(round.title)||round.lead!==undefined&&!informationValue(round.lead,people)||round.summary!==undefined&&!text(round.summary)||!list(round.plays,8)||!round.plays.every(play=>cardRef(play,true))||!distinct(round.plays.map(play=>play.personId)))fail();}
  }else if(section.kind==='matrix'){
   if(!exact(section,['id','title','kind','columns','rows'])||!list(section.columns,54)||!distinct(section.columns.map(column=>object(column)?column.id:undefined))||section.columns.some(column=>!exact(column,['id','label','shortLabel'],['id','label'])||!id(column.id)||!text(column.label)||column.shortLabel!==undefined&&(!text(column.shortLabel)||column.shortLabel.length>32))||!list(section.rows,8)||!distinct(section.rows.map(row=>object(row)?row.personId:undefined)))fail();
   for(const row of section.rows)if(!exact(row,['personId','cells'])||!people.has(row.personId)||!list(row.cells,54)||row.cells.length!==section.columns.length||row.cells.some(ref=>ref!==null&&!cardRef(ref)))fail();
  }else fail();
 }
 if(groups>9||groupRefs>104)fail();return value;
}
