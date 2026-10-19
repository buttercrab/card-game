import {ownCaption,type DecisionCaptionAtom} from './decisionModel';
/** Inert decision descriptions have a different capacity from executable action
 * payloads. The action wire guard is deliberately not shared or widened here.
 * 2048 offered rows × bounded eight-field tuples/16-part captions fit the node
 * budget; bytes remain an independent aggregate refusal bound (not a promise
 * that every individual maximum may be combined). Native max255 Exchange is
 * 33,526 nodes /623,112 UTF-8 JSON bytes (588,662 UTF-16 units), well within these fixed limits. */
export const DECISION_DESCRIPTOR_LIMITS=Object.freeze({actions:2048,groups:2,fields:8,options:4096,variants:2048,captionAtoms:16,nodes:262144,bytes:2097152,depth:32,string:2048});
const fail=():never=>{throw Error('Invalid decision descriptor bounds or shape');};
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))return fail();return value as Record<string,unknown>;};
const shape=(value:unknown,required:readonly string[],optional:readonly string[]=[])=>{const record=object(value),keys=Object.keys(record);if(required.some(key=>!Object.hasOwn(record,key))||keys.some(key=>!required.includes(key)&&!optional.includes(key)))return fail();return record;};
const array=(value:unknown,max:number)=>{if(!Array.isArray(value)||value.length>max)return fail();return value;};
/** Descriptor-safe plain-data walk precedes every schema/property read. No
 * getters, sparse arrays, cycles, symbols or exotic prototypes cross ownership. */
export function validateDecisionDescriptor(input:unknown):void{
 const kind=input&&typeof input==='object'?Object.getOwnPropertyDescriptor(input,'kind'):undefined;
 const modern=!!kind&&'value'in kind&&kind.value==='composition';
 // Legacy descriptors retain their former plain-wire capacity and inert extra
 // metadata behavior. Only the new composition discriminant opts into the
 // closed structured descriptor capacity below.
 const limits=modern?DECISION_DESCRIPTOR_LIMITS:{nodes:10000,depth:64,string:100000,options:10000};
 let nodes=0,bytes=0;const ancestors=new Set<object>(),stringBytes=new Map<string,number>();
 const quotedBytes=(text:string)=>{let size=stringBytes.get(text);if(size!==undefined)return size;size=0;for(const char of JSON.stringify(text)){const code=char.codePointAt(0)!;size+=code<=0x7f?1:code<=0x7ff?2:code<=0xffff?3:4;}stringBytes.set(text,size);return size;};
 const charge=(count:number)=>{if(!modern)return;bytes+=count;if(bytes>DECISION_DESCRIPTOR_LIMITS.bytes)fail();};
 const walk=(value:unknown,depth:number):void=>{
  if(++nodes>limits.nodes||depth>limits.depth)fail();
  if(value===null){charge(4);return;}if(typeof value==='boolean'){charge(5);return;}if(typeof value==='number'){if(!Number.isFinite(value))fail();charge(24);return;}if(typeof value==='string'){if(value.length>limits.string)fail();if(modern)charge(quotedBytes(value));return;}
  if(!value||typeof value!=='object'||ancestors.has(value))return fail();const list=Array.isArray(value),prototype=Object.getPrototypeOf(value);if(list?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)fail();
  if(list&&value.length>limits.options)fail();ancestors.add(value);charge(2);const descriptors=Object.getOwnPropertyDescriptors(value);
  if(list)for(let index=0;index<value.length;index++)if(!Object.hasOwn(descriptors,String(index)))fail();
  for(const key of Reflect.ownKeys(descriptors)){if(list&&key==='length')continue;if(typeof key!=='string'||modern&&key.length>limits.string||list&&(!/^(0|[1-9][0-9]*)$/.test(key)||Number(key)>=(value as unknown[]).length))fail();const field=descriptors[key as string];if(!('value'in field)||!field.enumerable)fail();if(modern)charge(quotedBytes(key as string)+2);walk(field.value,depth+1);}ancestors.delete(value);
 };
 walk(input,0);if(!modern)return;let options=0;
 const text=(value:unknown,max=2048,nonempty=true)=>{if(typeof value!=='string'||value.length>max||nonempty&&!value.trim())return fail();return value;};
 const ids=(value:unknown,max:number)=>array(value,max).map(item=>text(item));
 const nonempty=(value:unknown,max:number)=>{const values=array(value,max);if(!values.length)fail();return values;};
 const values=(value:unknown)=>{const record=object(value);if(Object.keys(record).length>8)fail();for(const [key,value]of Object.entries(record)){text(key);text(value);}return record;};
 const caption=(value:unknown)=>ownCaption(nonempty(value,16) as readonly DecisionCaptionAtom[]);
 const group=(value:unknown)=>{
  const head=object(value);text(head.id);
  if(head.kind==='card-selection'){
   shape(head,['kind','id','mode','variants','submit'],['count','disambiguation']);
   if(!['one','many','count'].includes(String(head.mode))||typeof head.mode!=='string'||head.mode==='count'&&(!Number.isSafeInteger(head.count)||Number(head.count)<1)||head.mode!=='count'&&head.count!==undefined||head.disambiguation!==undefined&&(head.mode==='count'||head.disambiguation!=='choose-action'))fail();
   for(const row of nonempty(head.variants,2048)){const r=shape(row,['cardIds','actionId']);text(r.actionId);if(!ids(r.cardIds,104).length)fail();}
   const submit=shape(head.submit,['prefix'],['prompt']);text(submit.prefix);if(submit.prompt!==undefined)text(submit.prompt);return;
  }
  if(head.kind!=='finite-choice')fail();
  shape(head,['kind','id','fields','variants','initialValues','reconciliation','submit'],['presentation','policy','contexts']);
  if(!['preserve-compatible','reset-to-defaults'].includes(String(head.reconciliation))||typeof head.reconciliation!=='string'||head.policy!==undefined&&!['complete','staged'].includes(String(head.policy)))fail();
  for(const field of nonempty(head.fields,8)){
   const f=shape(field,['id','label','options'],['catalogue']);text(f.id);text(f.label);const choices=nonempty(f.options,4096);options+=choices.length;if(options>4096)fail();
   for(const option of choices){
    const o=shape(option,['id','label','enabled'],['reason','visual','emphasis','description','caption']);text(o.id);text(o.label);if(typeof o.enabled!=='boolean')fail();
    if(o.reason!==undefined)text(o.reason,1000,false);if(o.description!==undefined)text(o.description,1000);if(o.caption!==undefined)caption(o.caption);
    if(o.emphasis!==undefined&&!['special','joker','call'].includes(String(o.emphasis)))fail();
    if(o.visual!==undefined){const v=object(o.visual);if(v.kind==='standard'){shape(v,['kind','suit','rank']);if(!['Spade','Heart','Diamond','Club'].includes(String(v.suit))||!Number.isInteger(v.rank)||Number(v.rank)<2||Number(v.rank)>14)fail();}else{shape(v,['kind','color']);if(v.kind!=='joker'||!['Black','Red'].includes(String(v.color)))fail();}}
   }
   if(f.catalogue!==undefined){const c=shape(f.catalogue,['title','openLabel','featuredIds'],['groups']);text(c.title);text(c.openLabel);ids(c.featuredIds,12);if(c.groups!==undefined)for(const item of array(c.groups,8)){const g=shape(item,['id','label','optionIds']);text(g.id);text(g.label);if(!ids(g.optionIds,104).length)fail();}}
  }
  for(const row of nonempty(head.variants,2048)){const r=shape(row,['tuple','actionId'],['caption']);text(r.actionId);values(r.tuple);if(r.caption!==undefined)caption(r.caption);}
  values(head.initialValues);if(head.contexts!==undefined){const contexts=object(head.contexts);if(Object.keys(contexts).length>8)fail();for(const [id,context]of Object.entries(contexts)){text(id);const c=shape(context,['value','caption']);text(c.value);caption(c.caption);}}
  const submit=shape(head.submit,['unavailable'],['presentationLabel']);if(!['disabled','hidden'].includes(String(submit.unavailable))||typeof submit.unavailable!=='string')fail();if(submit.presentationLabel!==undefined)text(shape(submit.presentationLabel,['prefix']).prefix);if(head.presentation!==undefined&&shape(head.presentation,['kind']).kind!=='choice-strips')fail();
 };
 const root=shape(input,['kind','id','commands','groups']);text(root.id);ids(root.commands,2048);for(const value of array(root.groups,2))group(value);
}
