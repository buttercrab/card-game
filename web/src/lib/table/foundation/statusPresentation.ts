import type {InformationValue,ParticipantStatus,StatusPresentation,TableDocument} from './contracts';
import {validateInformation,validInformationToken} from './information';
const fail=():never=>{throw Error('Invalid readonly status presentation');};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,allowed:readonly string[],required:readonly string[]=allowed)=>Object.keys(value).every(key=>allowed.includes(key))&&required.every(key=>Object.hasOwn(value,key));
const identifier=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=128;
/** Own only the small status payload. Descriptors are inspected before any
 * value read, so getters/toJSON/symbol capabilities never run. */
function own(input:unknown):unknown{
 let budget=0;const seen=new Set<object>();
 const copy=(value:unknown,depth:number):unknown=>{
  if(++budget>96||depth>7) return fail();
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='string')return value.length<=500?value:fail();
  if(typeof value==='number')return Number.isFinite(value)?value:fail();
  if(typeof value!=='object'||!value||seen.has(value))return fail();
  const prototype=Object.getPrototypeOf(value);if(prototype!==(Array.isArray(value)?Array.prototype:Object.prototype)&&!(prototype===null&&!Array.isArray(value)))return fail();
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(value);
  if(keys.some(key=>typeof key!=='string'||!('value'in descriptors[key])||!descriptors[key].enumerable&&key!=='length'))return fail();
  seen.add(value);let result:unknown;
  if(Array.isArray(value)){
   const length=descriptors.length.value;if(!Number.isSafeInteger(length)||length>4||keys.length!==length+1)return fail();
   const items:unknown[]=[];for(let index=0;index<length;index++){const descriptor=descriptors[String(index)];if(!descriptor)return fail();items.push(copy(descriptor.value,depth+1));}result=Object.freeze(items);
  }else{const resultObject:Record<string,unknown>={};for(const key of keys as string[]){if(['__proto__','constructor','prototype'].includes(key))return fail();Object.defineProperty(resultObject,key,{value:copy(descriptors[key].value,depth+1),enumerable:true});}result=Object.freeze(resultObject);}
  seen.delete(value);return result;
 };
 return copy(input,0);
}
function closedValue(value:unknown,inline=true):value is InformationValue{
 if(!record(value))return false;
 switch(value.kind){
  case 'text':return exact(value,['kind','text']);
  case 'token':return validInformationToken(value);
  case 'number':return exact(value,['kind','value']);
  case 'participant':return exact(value,['kind','participantId']);
  case 'suit':return exact(value,['kind','suit','label']);
  case 'card':{
   if(!exact(value,['kind','visual','label','emphasis'],['kind','visual','label'])||value.emphasis!==undefined&&!['special','joker','call'].includes(value.emphasis as string)||!record(value.visual))return false;
   return value.visual.kind==='standard'?exact(value.visual,['kind','rank','suit']):value.visual.kind==='joker'&&exact(value.visual,['kind','color']);
  }
  case 'inline':return inline&&exact(value,['kind','values'])&&Array.isArray(value.values)&&value.values.length>0&&value.values.length<=4&&value.values.every(atom=>closedValue(atom,false));
  default:return false;
 }
}
export function ownParticipantStatus(input:unknown,document:TableDocument<unknown>):ParticipantStatus{
 const value=own(input);if(!record(value)||!exact(value,['value','tone','muted','badges','purpose'],['value','tone'])||value.purpose!==undefined&&!['standing','announcement'].includes(value.purpose as string)||!['accent','gold','danger','plain','muted'].includes(value.tone as string)||Object.hasOwn(value,'muted')&&typeof value.muted!=='boolean'||!closedValue(value.value)||value.badges!==undefined&&(!Array.isArray(value.badges)||value.badges.length>2||value.badges.some(badge=>!record(badge)||!exact(badge,['text','tone'])||typeof badge.text!=='string'||!badge.text.trim()||badge.text.length>100||!['accent','gold','danger','plain','muted'].includes(badge.tone as string))))return fail();
 // Reuse canonical atom bounds and current participant admission without
 // cloning the document, its card library, history or other information.
 const minimal:TableDocument<never>={context:{session:'status',audience:'status',generation:'status',revision:'1'},participant:{id:document.participant.id,role:document.participant.role,name:'status',markers:[]},opponents:(document.opponents??[]).map(person=>({id:person.id,name:'status',handCount:0})),hand:[],facts:[],decision:{id:'status',kind:'commands',commands:[]},offer:{id:'status',actions:[]},information:[{id:'status',title:'status',...(value.badges?{badges:value.badges as unknown as ParticipantStatus['badges']}:{}),fields:[{id:'value',label:'status',value:value.value}]}]};
 try{validateInformation(minimal);}catch{return fail();}
 return value as unknown as ParticipantStatus;
}
export function ownStatusPresentation(input:unknown,document:TableDocument<unknown>):StatusPresentation{
 const value=own(input);if(document.stage==='waiting'||!record(value)||!exact(value,['informationId','fieldIds','primary','summary','progress'],['informationId','fieldIds'])||!identifier(value.informationId)||!Array.isArray(value.fieldIds)||value.fieldIds.length>3||value.fieldIds.some(id=>!identifier(id))||new Set(value.fieldIds).size!==value.fieldIds.length)return fail();
 for(const flag of ['primary','summary','progress'])if(Object.hasOwn(value,flag)&&typeof value[flag]!=='boolean')return fail();
 const panel=document.information?.find(panel=>panel.id===value.informationId);if(!panel||document.outcome?.informationId===panel.id||value.fieldIds.some(id=>!panel.fields.some(field=>field.id===id))||value.primary===true&&!panel.primary||value.summary===true&&!panel.summary||value.progress===true&&!panel.progress||!value.fieldIds.length&&value.primary!==true&&value.summary!==true&&value.progress!==true)return fail();
 return value as unknown as StatusPresentation;
}
