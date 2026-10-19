import type {InformationValue,ParticipantStatus,Scoreboard,TableDocument} from './contracts';
import {validateInformation,validInformationToken} from './information';
import {ownParticipantStatus,ownStatusPresentation} from './statusPresentation';

/** Inert public values only. Participant references resolve against CURRENT names.
 * Card atoms are semantic symbols, never entity-backed paper/resource grants. */
export interface PublicGameplayPresentation {
 readonly information:NonNullable<TableDocument<unknown>['information']>;
 readonly facts:TableDocument<unknown>['facts'];
 readonly scoreboard?:Omit<Scoreboard,'disclosure'>;
 readonly standing:readonly {readonly participantId:string;readonly markers:readonly string[];readonly status?:ParticipantStatus}[];
 readonly statusPresentation?:TableDocument<unknown>['statusPresentation'];
}
export const PUBLIC_GAMEPLAY_LIMITS=Object.freeze({bytes:65536,values:4096,depth:12,array:128});
const fail=():never=>{throw Error('Public gameplay presentation unavailable');};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:unknown,allowed:readonly string[],required:readonly string[]=allowed):value is Record<string,unknown>=>record(value)&&Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key));
const text=(value:unknown,max=2048):value is string=>typeof value==='string'&&value.length<=max;
const identifier=(value:unknown):value is string=>text(value,128)&&value.length>0;
/** Inspect only selected own data properties, never private/name/shell getters. */
function data(input:unknown,key:string):unknown {
 if(!record(input))return fail();const descriptor=Object.getOwnPropertyDescriptor(input,key);
 if(!descriptor)return undefined;if(!('value'in descriptor)||!descriptor.enumerable)return fail();return descriptor.value;
}
/** Own registry references without invoking raw array iteration/index reads.
 * Person names/counts/private fields are intentionally not traversed. */
function opponentRegistry(input:unknown):readonly unknown[] {
 if(!Array.isArray(input)||Object.getPrototypeOf(input)!==Array.prototype)return fail();
 const keys=Reflect.ownKeys(input),length=Object.getOwnPropertyDescriptor(input,'length');
 if(!length||!('value'in length)||typeof length.value!=='number'||!Number.isSafeInteger(length.value)||length.value<0||length.value>8||keys.length!==length.value+1||keys.some(key=>typeof key!=='string'||key!=='length'&&!/^(0|[1-9]\d*)$/.test(key)))return fail();
 const result:unknown[]=[];
 for(let index=0;index<length.value;index++){const descriptor=Object.getOwnPropertyDescriptor(input,String(index));if(!descriptor||!('value'in descriptor)||!descriptor.enumerable)return fail();result.push(descriptor.value);}
 return Object.freeze(result);
}
function closedValue(value:unknown,inline=true):value is InformationValue {
 if(!record(value))return false;
 switch(value.kind){
  case 'text':return exact(value,['kind','text']);
  case 'token':return validInformationToken(value);
  case 'number':return exact(value,['kind','value']);
  case 'participant':return exact(value,['kind','participantId']);
  case 'suit':return exact(value,['kind','suit','label']);
  case 'card':return exact(value,['kind','visual','label','emphasis'],['kind','visual','label'])&&(value.emphasis===undefined||['special','joker','call'].includes(String(value.emphasis)))&&(exact(value.visual,['kind','suit','rank'])||exact(value.visual,['kind','color']));
  case 'inline':return inline&&exact(value,['kind','values'])&&Array.isArray(value.values)&&value.values.every(atom=>closedValue(atom,false));
  default:return false;
 }
}
function closedBadges(value:unknown):boolean{return value===undefined||Array.isArray(value)&&value.every(item=>exact(item,['text','tone']));}
function closedPanel(value:unknown):boolean {
 if(!exact(value,['id','title','summary','primary','fields','progress','badges'],['id','title','fields'])||!Array.isArray(value.fields)||!closedBadges(value.badges)||value.summary!==undefined&&!closedBadges([value.summary])||value.primary!==undefined&&(!exact(value.primary,['label','value'],['value'])||!closedValue(value.primary.value))||!value.fields.every(field=>exact(field,['id','label','value'])&&closedValue(field.value)))return false;
 const progress=value.progress;
 return progress===undefined||exact(progress,['label','total','target','series'],['label','total','series'])&&Array.isArray(progress.series)&&progress.series.every(series=>exact(series,['id','label','value','tone','from']));
}
/** Bounded copy only; this does not issue a presentation lease. Overflow leaves
 * the canonical document valid and makes this optional projection unavailable. */
export function copyPublicGameplayPresentation(document:TableDocument<unknown>):PublicGameplayPresentation|null {
 try{
  let visited=0,bytes=0;const active=new Set<object>(),encoder=new TextEncoder();
  const add=(amount:number)=>{bytes+=amount;if(bytes>PUBLIC_GAMEPLAY_LIMITS.bytes)fail();};
  const string=(value:string)=>{if(value.length>PUBLIC_GAMEPLAY_LIMITS.bytes)fail();add(encoder.encode(value).byteLength+2);};
  const copy=(input:unknown,depth=0):unknown=>{
   if(++visited>PUBLIC_GAMEPLAY_LIMITS.values||depth>PUBLIC_GAMEPLAY_LIMITS.depth) return fail();
   if(input===undefined)return undefined;
   if(typeof input==='string'){string(input);return input;}
   if(input===null||typeof input==='boolean'){add(5);return input;}
   if(typeof input==='number'){if(!Number.isFinite(input))return fail();add(String(input).length);return input;}
   if(!input||typeof input!=='object'||active.has(input))return fail();
   const array=Array.isArray(input),prototype=Object.getPrototypeOf(input);
   if(prototype!==(array?Array.prototype:Object.prototype)&&!(prototype===null&&!array))return fail();
   const descriptors=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(input);
   if(keys.some(key=>typeof key!=='string'||!('value'in descriptors[key])||!descriptors[key].enumerable&&key!=='length'))return fail();
   active.add(input);add(2);
   try{
    if(array){const length=descriptors.length.value;if(!Number.isSafeInteger(length)||length>PUBLIC_GAMEPLAY_LIMITS.array||keys.length!==length+1)return fail();const result:unknown[]=[];for(let i=0;i<length;i++){if(!descriptors[String(i)])return fail();add(1);result.push(copy(descriptors[String(i)].value,depth+1));}return Object.freeze(result);}
    if(keys.length>PUBLIC_GAMEPLAY_LIMITS.array)return fail();const result:Record<string,unknown>={};
    for(const key of keys as string[]){if(['__proto__','constructor','prototype'].includes(key))return fail();string(key);add(1);Object.defineProperty(result,key,{value:copy(descriptors[key].value,depth+1),enumerable:true});}return Object.freeze(result);
   }finally{active.delete(input);}
  };
  const participant=data(document,'participant'),opponents=opponentRegistry(data(document,'opponents')??[]);
  const role=data(participant,'role'),localId=data(participant,'id');if(!identifier(localId)||role!==undefined&&role!=='player'&&role!=='observer')return fail();
  const people=[...(role==='observer'?[]:[participant]),...opponents],ids=people.map(person=>data(person,'id'));
  if(ids.some(id=>!identifier(id))||new Set(ids).size!==ids.length)return fail();
  const standing=Object.freeze(people.map((person,index)=>{
   const participantId=ids[index] as string,markers=person===participant?copy(data(person,'markers')??[]):Object.freeze([]);
   if(!Array.isArray(markers)||!markers.every(marker=>text(marker)))return fail();
   const rawStatus=data(person,'status'),purpose=rawStatus===undefined?undefined:data(rawStatus,'purpose');
   const status=purpose==='standing'?copy(rawStatus):undefined;
   return Object.freeze({participantId,markers:markers as readonly string[],...(status===undefined?{}:{status})});
  }));
  const information=copy(data(document,'information')??[]),facts=copy(data(document,'facts')??[]),scoreboard=copy(data(document,'scoreboard')),statusPresentation=copy(data(document,'statusPresentation'));
  if(!Array.isArray(information)||!information.every(closedPanel)||!Array.isArray(facts)||!facts.every(fact=>exact(fact,['id','label','value','subject','essential'])&&identifier(fact.id)&&text(fact.label)&&text(fact.value)&&['table','participant'].includes(String(fact.subject))&&typeof fact.essential==='boolean'))return fail();
  if(scoreboard!==undefined&&(!exact(scoreboard,['id','title','columns','rows','disclosure'],['id','title','columns','rows'])||!Array.isArray(scoreboard.columns)||!scoreboard.columns.every(column=>exact(column,['id','label']))||!Array.isArray(scoreboard.rows)||!scoreboard.rows.every(row=>exact(row,['participantId','values','badges'],['participantId','values'])&&closedBadges(row.badges))||scoreboard.disclosure!==undefined&&!exact(scoreboard.disclosure,['openLabel','closeLabel'])))return fail();
  // Semantic validation uses an ephemeral public-only context, never a retained
  // historical document or private/card/action source.
  const validation:TableDocument<never>={context:{session:'hud',audience:'hud',generation:'hud',revision:'1'},participant:{id:localId,name:'hud',markers:[],...(role==='observer'?{role:'observer'}:{})},opponents:opponents.map((_,index)=>({id:ids[index+(role==='observer'?0:1)] as string,name:'hud',handCount:0})),hand:[],facts:[],offer:{id:'hud',actions:[]},decision:{id:'hud',kind:'commands',commands:[]},information:information as TableDocument<never>['information'],...(scoreboard===undefined?{}:{scoreboard:scoreboard as unknown as Scoreboard})};
  validateInformation(validation);
  const ownedStanding=Object.freeze(standing.map(person=>Object.freeze({participantId:person.participantId,markers:person.markers,...(person.status===undefined?{}:{status:ownParticipantStatus(person.status,validation)})})));
  const ownedStatus=statusPresentation===undefined?undefined:ownStatusPresentation(statusPresentation,validation);
  const score=scoreboard as unknown as Scoreboard|undefined;
  const result=Object.freeze({information:information as NonNullable<TableDocument<unknown>['information']>,facts:facts as TableDocument<unknown>['facts'],standing:ownedStanding,...(score?{scoreboard:Object.freeze({id:score.id,title:score.title,columns:score.columns,rows:score.rows})}:{}),...(ownedStatus?{statusPresentation:ownedStatus}:{})});
  if(encoder.encode(JSON.stringify(result)).byteLength>PUBLIC_GAMEPLAY_LIMITS.bytes)return fail();
  return result;
 }catch{return null;}
}
