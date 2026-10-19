import {validInformationToken} from './information';
import type {DisclosureRefresh} from './disclosures';
import type { ViewContext, InformationAtom } from './contracts';
export type FormValue = string | boolean;
export type FormValues = Readonly<Record<string,FormValue>>;
interface FormFieldBase { readonly id:string; readonly label:string; readonly help?:string; readonly sectionId?:string; readonly clusterId?:string; readonly rowId?:string; readonly required:boolean; }
export interface TextFormField extends FormFieldBase { readonly kind:'text'|'multiline'|'number'; readonly initial:string; readonly maxCodePoints:number; readonly maxCodeUnits:number; readonly min?:number; readonly max?:number; readonly step?:number; }
export interface ToggleFormField extends FormFieldBase { readonly kind:'toggle'; readonly initial:boolean; readonly onLabel?:string; readonly offLabel?:string; }
export interface FiniteFormField extends FormFieldBase { readonly kind:'select'; readonly initial:string; readonly options:readonly {readonly id:string;readonly label:string;readonly enabled:boolean;readonly help?:string}[]; }
export type FormField = TextFormField | ToggleFormField | FiniteFormField;
export interface FormSection { readonly id:string; readonly title:string; readonly help?:string; }
export interface FormCluster { readonly id:string; readonly sectionId:string; readonly label:string; readonly help?:string; readonly fieldIds:readonly string[]; }
export interface FormRow { readonly id:string; readonly clusterId:string; readonly label:string; readonly fieldIds:readonly string[]; readonly leading?:InformationAtom; }
export type FormTarget<A=unknown> = {readonly kind:'host';readonly operationId?:string;readonly authority?:unknown}|{readonly kind:'command';readonly actionId:string;readonly template:A};
export type FormActionIntent = 'primary'|'secondary'|'danger'|'ghost';
export interface FormAction<A=unknown> { readonly id:string;readonly label:string;readonly intent?:FormActionIntent;readonly target:FormTarget<A>;readonly completion?:'lock'|'continue';readonly basis?:'current'|'draft'; }
export type NormalizedFormAction<A=unknown> = FormAction<A> & {readonly intent:FormActionIntent;readonly completion:'lock'|'continue';readonly basis:'current'|'draft'};
export interface FormOffer<A=unknown> {
 readonly purpose?:'editing'|'confirmation';
 readonly retry?:'same-offer'|'new-offer';
 readonly access?:{readonly kind:'disclosure-selection';readonly selectionId:string};
 readonly id:string;readonly instanceId:string;readonly schemaVersion:string;readonly policyId:string;readonly baseVersion:string;readonly editBinding:string;readonly title:string;readonly help?:string;
 readonly submitLabel:string;readonly fields:readonly FormField[];readonly binding:Readonly<Record<string,string|number|null>>;readonly enabled:boolean;readonly target?:FormTarget<A>;
 readonly sections?:readonly FormSection[];readonly clusters?:readonly FormCluster[];readonly rows?:readonly FormRow[];readonly model?:unknown;readonly actions?:readonly FormAction<A>[];
}
export type FormEdit = {readonly kind?:'set-field';readonly fieldId:string;readonly value:FormValue}|{readonly kind:'reset-field';readonly fieldId:string}|{readonly kind:'reset-all'}|{readonly kind:'initialize'}|{readonly kind:'base-choice';readonly fieldId:string;readonly value:FormValue};
export interface FormReduction {readonly values:FormValues;readonly visibility:Readonly<Record<string,boolean>>;readonly enabled:Readonly<Record<string,boolean>>;readonly issues:Readonly<Record<string,string>>;readonly changedFields:readonly string[];readonly summary?:readonly {readonly text:string;readonly fieldIds?:readonly string[]}[];}
export interface FormDraftSnapshot {readonly values:FormValues;readonly revision:number;readonly compositionEpoch:number;readonly composing:boolean;}
export interface NormalizedForm {readonly values:FormValues;readonly issues:Readonly<Record<string,string>>;}
export interface HostFormPolicy {readonly kind?:'host';readonly access?:'connected'|'disclosure-selection';readonly id:string;normalize(offer:FormOffer<unknown>,values:FormValues):NormalizedForm;compile(offer:FormOffer<unknown>,values:FormValues):Readonly<Record<string,string|number|null>>;}
export interface CommandFormPolicy<A> {readonly kind:'command';readonly id:string;normalize(offer:FormOffer<A>,values:FormValues):NormalizedForm;compile(offer:FormOffer<A>,values:FormValues):A;validateCompiled(offer:FormOffer<A>,action:A):boolean;expectedResult?(offer:FormOffer<A>,action:A):unknown;matchesResult?(offer:FormOffer<A>,expected:unknown):boolean;}
export type FormCompiledAction<A> = {readonly kind:'command';readonly action:A}|{readonly kind:'host';readonly payload:unknown};
export interface CompositeFormPolicy<A> {readonly kind:'actions';readonly id:string;reduce(offer:FormOffer<A>,previousValues:FormValues,edit:FormEdit):FormReduction;normalize(offer:FormOffer<A>,values:FormValues):NormalizedForm;compile(offer:FormOffer<A>,values:FormValues,actionId:string):FormCompiledAction<A>;validateCompiled(offer:FormOffer<A>,candidate:FormCompiledAction<A>,actionId:string):boolean;expectedResult?(offer:FormOffer<A>,action:A):unknown;matchesResult?(offer:FormOffer<A>,expected:unknown):boolean;}
export type FormPolicy<A=unknown> = HostFormPolicy|CommandFormPolicy<A>|CompositeFormPolicy<A>;
export type FormStatus = 'queued'|'sending'|'accepted'|'processed'|'rejected'|'uncertain'|'cancelled'|'stored'|'failed'|'conflict'|'unsupported';
export interface FormSubmission {readonly access?:{readonly kind:'disclosure-selection';readonly selectionId:string};readonly id:string;readonly instanceId:string;readonly policyId:string;readonly context:ViewContext;readonly binding:Readonly<Record<string,string|number|null>>;readonly payload:unknown;readonly actionId?:string;readonly operationId?:string;readonly offerInstanceId?:string;readonly formId?:string;}
export interface FormOperationView {readonly attempted?:boolean;readonly formId?:string;readonly offerInstanceId?:string;readonly refreshDisclosure?:DisclosureRefresh;readonly id:string;readonly instanceId:string;readonly status:FormStatus;readonly actionId?:string;readonly draftRevision?:number;readonly message?:string;}
export interface FormCommitPort {readonly instanceId:string;commit(context:ViewContext,formId:string,actionId?:string):boolean;reduce(edit:FormEdit):FormReduction|null;matchesResult?(offer:FormOffer):boolean;renew(context:ViewContext,formId:string):boolean;dispose():void;}
export interface FormActionView {readonly id:string;readonly label:string;readonly intent:FormActionIntent;readonly enabled:boolean;readonly status?:FormStatus;readonly message?:string;readonly completion?:'lock'|'continue';}
export interface FormView {readonly offer:FormOffer;readonly leaseId:string;readonly sourceInstanceId?:string;readonly values:FormValues;readonly issues:Readonly<Record<string,string>>;readonly status:'editing'|'conflict'|FormStatus;readonly draftRevision:number;readonly compositionEpoch:number;readonly composingFieldId?:string;readonly canSubmit:boolean;readonly activeSection?:string;readonly summaryPage?:number;readonly reduction?:FormReduction;readonly actions?:readonly FormActionView[];readonly fieldLeases?:Readonly<Record<string,string>>;}

const fail = (): never => { throw new Error('Invalid bounded form data'); };
/** Own and freeze plain data before reading it; getters and exotic objects are never evaluated. */
export function copyFormData<T>(input: T): T {
    // Preflight the aggregate serialized footprint before allocating the owned model.
    let bytes = 0, inspected = 0; const ancestors = new Set<object>();
    const add = (size: number) => { bytes += size; if (bytes > 65536) fail(); };
    const stringBytes = (value: string) => {
        add(2);
        for (let index = 0; index < value.length; index++) {
            const code = value.charCodeAt(index);
            if (code === 8 || code === 9 || code === 10 || code === 12 || code === 13) add(2);
            else if (code < 32) add(6);
            else if (code === 34 || code === 92) add(2);
            else if (code < 128) add(1);
            else if (code < 2048) add(2);
            else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) { add(4); index++; }
            else if (code >= 0xd800 && code <= 0xdfff) add(6);
            else add(3);
        }
    };
    const inspect = (value: unknown, depth: number): void => {
        if (++inspected > 8192 || depth > 12) fail();
        if (typeof value === 'string') { if (value.length > 256768) fail(); stringBytes(value); return; }
        if (value === null) { add(4); return; }
        if (typeof value === 'boolean') { add(value ? 4 : 5); return; }
        if (typeof value === 'number') { if (!Number.isFinite(value)) fail(); add(String(value).length); return; }
        if (!value || typeof value !== 'object' || ancestors.has(value)) return fail();
        const prototype = Object.getPrototypeOf(value);
        if (Array.isArray(value) ? prototype !== Array.prototype || value.length > 256 : prototype !== Object.prototype && prototype !== null) return fail();
        if (Object.getOwnPropertySymbols(value).length) fail();
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const entries = Object.entries(descriptors).filter(([key]) => !(Array.isArray(value) && key === 'length'));
        if (entries.length > 256) fail();
        ancestors.add(value); add(2);
        try {
            for (let index = 0; index < entries.length; index++) {
                const [key, descriptor] = entries[index];
                if (!('value' in descriptor) || !descriptor.enumerable) fail();
                if (index) add(1);
                if (!Array.isArray(value)) { stringBytes(key); add(1); }
                inspect(descriptor.value, depth + 1);
            }
        } finally { ancestors.delete(value); }
    };
    inspect(input, 0);
    const active = new Set<object>(); let nodes = 0;
    const copy = (value: unknown, depth: number): unknown => {
        if (++nodes > 8192 || depth > 12) return fail();
        if (value === null || typeof value === 'boolean') return value;
        if (typeof value === 'string') return value.length <= 32768 ? value : fail();
        if (typeof value === 'number') return Number.isFinite(value) ? value : fail();
        if (!value || typeof value !== 'object' || active.has(value)) return fail();
        const prototype = Object.getPrototypeOf(value);
        if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return fail();
        if (Object.getOwnPropertySymbols(value).length) return fail();
        active.add(value);
        try {
            const descriptors = Object.getOwnPropertyDescriptors(value);
            if (Array.isArray(value)) {
                if (value.length > 256 || Object.keys(descriptors).some(key => key !== 'length' && !/^(0|[1-9]\d*)$/.test(key))) return fail();
                const result: unknown[] = [];
                for (let index = 0; index < value.length; index++) {
                    const descriptor = descriptors[String(index)];
                    if (!descriptor || !('value' in descriptor)) return fail();
                    result.push(copy(descriptor.value, depth + 1));
                }
                return Object.freeze(result);
            }
            if (Object.keys(descriptors).length > 256) return fail();
            const result: Record<string,unknown> = {};
            for (const [key, descriptor] of Object.entries(descriptors)) {
                if (!('value' in descriptor) || !descriptor.enumerable || key === '__proto__' || key === 'constructor' || key === 'prototype') return fail();
                Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true });
            }
            return Object.freeze(result);
        } finally { active.delete(value); }
    };
    return copy(input, 0) as T;
}
const text = (value: unknown, max = 500): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const keys = (value: object, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 16384;
const record = (value: unknown): value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function validateBinding(value: unknown): void {
    if (!record(value) || Object.keys(value).length > 16) return fail();
    for (const [key, item] of Object.entries(value)) {
        if (!text(key,128) || !(item === null || typeof item === 'string' && item.length <= 2048 || typeof item === 'number' && Number.isFinite(item))) return fail();
    }
}
const id = (value:unknown):value is string => text(value,128) && !['__proto__','constructor','prototype'].includes(value);
const unique = (values:readonly unknown[]) => new Set(values).size === values.length;
function assertFormAccess(value:unknown):asserts value is NonNullable<FormOffer['access']> {
 if(!record(value)||Object.keys(value).length!==2||!keys(value,['kind','selectionId'])||value.kind!=='disclosure-selection'||!id(value.selectionId))return fail();
}
/** Own disclosure selection authority before using it outside an offer snapshot. */
export function validateFormAccess(input:unknown):NonNullable<FormOffer['access']> {
 const access=copyFormData(input);assertFormAccess(access);return access;
}
function target(value:unknown):asserts value is FormTarget {
 if(!record(value))return fail();
 if(value.kind==='host'){if(!keys(value,['kind','operationId','authority'])||value.operationId!==undefined&&!id(value.operationId))fail();}
 else if(value.kind!=='command'||!keys(value,['kind','actionId','template'])||Object.keys(value).length!==3||!id(value.actionId))fail();
}
function ids(value:unknown,known:Set<string>,maximum=192):value is readonly string[] {
 return Array.isArray(value)&&value.length<=maximum&&unique(value)&&value.every(item=>id(item)&&known.has(item));
}
function atom(input:unknown):boolean {
 if(!record(input))return false;
 const suits=['Spade','Diamond','Heart','Club'];
 switch(input.kind){
  case 'text':return keys(input,['kind','text'])&&text(input.text);
  case 'token':return validInformationToken(input);
  case 'number':return keys(input,['kind','value'])&&typeof input.value==='number'&&Number.isFinite(input.value);
  case 'participant':return keys(input,['kind','participantId'])&&id(input.participantId);
  case 'suit':return keys(input,['kind','suit','label'])&&typeof input.suit==='string'&&suits.includes(input.suit)&&text(input.label);
  case 'card':{
   const visual=input.visual;
   return keys(input,['kind','visual','label'])&&text(input.label)&&record(visual)&&(visual.kind==='standard'&&keys(visual,['kind','suit','rank'])&&typeof visual.suit==='string'&&suits.includes(visual.suit)&&typeof visual.rank==='number'&&Number.isInteger(visual.rank)&&visual.rank>=2&&visual.rank<=14||visual.kind==='joker'&&keys(visual,['kind','color'])&&(visual.color==='Black'||visual.color==='Red'));
  }
  default:return false;
 }
}
/** Reject invalid schemas and references rather than repairing them; return an owned snapshot. */
export function validateFormOffer<A>(input:FormOffer<A>):FormOffer<A> {
 const offer=copyFormData(input);
 if(!record(offer)||!keys(offer,['id','instanceId','schemaVersion','policyId','baseVersion','editBinding','title','help','submitLabel','fields','binding','enabled','target','sections','clusters','rows','model','actions','purpose','access','retry'])||
  !['id','instanceId','schemaVersion','policyId','editBinding'].every(key=>text(offer[key as keyof FormOffer],128))||!text(offer.baseVersion,32768)||!text(offer.title)||!text(offer.submitLabel)||offer.help!==undefined&&!text(offer.help)||typeof offer.enabled!=='boolean'||
  offer.purpose!==undefined&&!['editing','confirmation'].includes(offer.purpose)||offer.retry!==undefined&&(!['same-offer','new-offer'].includes(offer.retry)||offer.retry==='new-offer'&&offer.purpose!=='confirmation')||
  !Array.isArray(offer.fields)||offer.fields.length<(offer.purpose==='confirmation'?0:1)||offer.fields.length>192||!unique(offer.fields.map(field=>field?.id)))return fail();
 validateBinding(offer.binding);if(offer.access!==undefined)assertFormAccess(offer.access);if(offer.target!==undefined)target(offer.target);
 if(offer.purpose==='confirmation'&&offer.target?.kind==='command')return fail();
 let options=0;
 for(const field of offer.fields){
  if(!record(field)||!id(field.id)||!text(field.label)||field.help!==undefined&&!text(field.help)||typeof field.required!=='boolean'||
   ['sectionId','clusterId','rowId'].some(key=>field[key]!==undefined&&!id(field[key])))return fail();
  const common=['id','label','help','required','sectionId','clusterId','rowId','kind','initial'];
  if(field.kind==='toggle'){
   if(!keys(field,[...common,'onLabel','offLabel'])||typeof field.initial!=='boolean'||field.onLabel!==undefined&&!text(field.onLabel)||field.offLabel!==undefined&&!text(field.offLabel))return fail();
  }else if(field.kind==='select'){
   if(!keys(field,[...common,'options'])||typeof field.initial!=='string'||!Array.isArray(field.options)||field.options.length<1||field.options.length>256||!unique(field.options.map(option=>option?.id))||
    field.options.some(option=>!record(option)||!keys(option,['id','label','enabled','help'])||!text(option.id,128)||!text(option.label)||typeof option.enabled!=='boolean'||option.help!==undefined&&!text(option.help))||!field.options.some(option=>option.id===field.initial))return fail();
   options+=field.options.length;
  }else{
   if(typeof field.kind!=='string'||!['text','multiline','number'].includes(field.kind)||!keys(field,[...common,'maxCodePoints','maxCodeUnits','min','max','step'])||!count(field.maxCodePoints)||!count(field.maxCodeUnits)||typeof field.initial!=='string'||field.initial.length>field.maxCodeUnits||Array.from(field.initial).length>field.maxCodePoints)return fail();
   if(field.kind==='number'){
    const min=typeof field.min==='number'?field.min:undefined,max=typeof field.max==='number'?field.max:undefined,step=typeof field.step==='number'?field.step:undefined;
    if([field.min,field.max,field.step].some(value=>value!==undefined&&(typeof value!=='number'||!Number.isFinite(value)))||min!==undefined&&max!==undefined&&(min>max||max-min>1e12)||step!==undefined&&step<=0)return fail();
   }else if(field.min!==undefined||field.max!==undefined||field.step!==undefined)return fail();
  }
 }
 if(options>256)return fail();
 const fields=new Map(offer.fields.map(field=>[field.id,field])),fieldIds=new Set(fields.keys());
 const sections=offer.sections??[],clusters=offer.clusters??[],rows=offer.rows??[];
 if(!Array.isArray(sections)||sections.length>16||!unique(sections.map(item=>item?.id))||sections.some(item=>!record(item)||!keys(item,['id','title','help'])||!id(item.id)||!text(item.title)||item.help!==undefined&&!text(item.help))||
  !Array.isArray(clusters)||clusters.length>64||!unique(clusters.map(item=>item?.id))||!Array.isArray(rows)||rows.length>64||!unique(rows.map(item=>item?.id)))return fail();
 const sectionIds=new Set(sections.map(item=>item.id)),clusterIds=new Set(clusters.map(item=>item.id)),rowIds=new Set(rows.map(item=>item.id));
 const clustered=new Set<string>(),rowed=new Set<string>();
 for(const cluster of clusters){
  if(!record(cluster)||!keys(cluster,['id','sectionId','label','help','fieldIds'])||!id(cluster.id)||!sectionIds.has(cluster.sectionId)||!text(cluster.label)||cluster.help!==undefined&&!text(cluster.help)||!ids(cluster.fieldIds,fieldIds)||cluster.fieldIds.length<1)return fail();
  for(const key of cluster.fieldIds){const field=fields.get(key)!;if(clustered.has(key)||field.clusterId!==undefined&&field.clusterId!==cluster.id||field.sectionId!==undefined&&field.sectionId!==cluster.sectionId)return fail();clustered.add(key);}
 }
 for(const row of rows){
  if(!record(row)||!keys(row,['id','clusterId','label','fieldIds','leading'])||!id(row.id)||!clusterIds.has(row.clusterId)||!text(row.label)||!ids(row.fieldIds,fieldIds)||row.fieldIds.length<1||row.leading!==undefined&&!atom(row.leading))return fail();
  const cluster=clusters.find(item=>item.id===row.clusterId)!;
  for(const key of row.fieldIds){const field=fields.get(key)!;if(rowed.has(key)||!cluster.fieldIds.includes(key)||field.rowId!==undefined&&field.rowId!==row.id)return fail();rowed.add(key);}
 }
 for(const field of offer.fields)if(field.sectionId!==undefined&&!sectionIds.has(field.sectionId)||field.clusterId!==undefined&&(!clusterIds.has(field.clusterId)||!clusters.find(item=>item.id===field.clusterId)!.fieldIds.includes(field.id))||field.rowId!==undefined&&(!rowIds.has(field.rowId)||!rows.find(item=>item.id===field.rowId)!.fieldIds.includes(field.id)))return fail();
 if(offer.actions!==undefined){
  if(!Array.isArray(offer.actions)||offer.actions.length<1||offer.actions.length>16||!unique(offer.actions.map(action=>action?.id)))return fail();
  const commands:string[]=[];
  for(const action of offer.actions){if(!record(action)||!keys(action,['id','label','intent','target','completion','basis'])||!id(action.id)||!text(action.label)||action.intent!==undefined&&(typeof action.intent!=='string'||!['primary','secondary','danger','ghost'].includes(action.intent))||action.completion!==undefined&&(typeof action.completion!=='string'||!['lock','continue'].includes(action.completion))||action.basis!==undefined&&(typeof action.basis!=='string'||!['current','draft'].includes(action.basis)))return fail();target(action.target);if(offer.purpose==='confirmation'&&action.target.kind!=='host')return fail();if(action.basis==='draft'&&action.target.kind!=='host')return fail();if(action.target.kind==='command')commands.push(action.target.actionId);}
  if(!unique(commands))return fail();
 }
 return offer;
}
/** Compatibility convenience, normalized into the same opaque action model. */
export function normalizeFormActions<A>(input:FormOffer<A>):readonly NormalizedFormAction<A>[] {
 const offer=validateFormOffer(input);const actions:readonly FormAction<A>[]=offer.actions??[{id:'submit',label:offer.submitLabel,target:offer.target??{kind:'host' as const}}];
 return Object.freeze(actions.map(action=>Object.freeze({...action,intent:action.intent??'primary',completion:action.completion??'lock',basis:action.basis??'current'})));
}
export function formAction<A>(offer:FormOffer<A>,actionId?:string):NormalizedFormAction<A>|null {
 const actions=normalizeFormActions(offer);return actionId===undefined?actions[0]??null:actions.find(action=>action.id===actionId)??null;
}
/** Structural/type checks only: raw numeric intermediates remain editable. */
export function validateFormRawShape(input:FormOffer,raw:unknown):FormValues {
 const offer=validateFormOffer(input),values=copyFormData(raw);
 if(!record(values)||Object.keys(values).length>192)return fail();
 for(const [key,value] of Object.entries(values)){
  const field=offer.fields.find(field=>field.id===key);
  if(!field||(field.kind==='toggle'?typeof value!=='boolean':typeof value!=='string'))return fail();
 }
 return values as FormValues;
}
/** Domain issues never truncate raw text or coerce numeric intermediates. */
export function validateFormValues(input:FormOffer,raw:FormValues):Readonly<Record<string,string>> {
 const offer=validateFormOffer(input),values=validateFormRawShape(offer,raw),issues:Record<string,string>={};
 for(const field of offer.fields){
  const value=values[field.id];let issue:string|undefined;
  if(value===undefined)issue='값이 필요해요';
  else if(field.kind==='toggle')continue;
  else if(typeof value!=='string')return fail();
  else if(field.kind==='select'){if(!field.options.some(option=>option.id===value&&option.enabled))issue='사용 가능한 값을 골라 주세요';}
  else if(value.length>field.maxCodeUnits||Array.from(value).length>field.maxCodePoints)issue='입력 가능한 길이를 넘었어요';
  else if(field.required&&!value.trim())issue='값이 필요해요';
  else if(field.kind==='number'&&value!==''){
   const number=Number(value),steps=field.step===undefined?0:(number-(field.min??0))/field.step;
   if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)||!Number.isFinite(number)||field.min!==undefined&&number<field.min||field.max!==undefined&&number>field.max||!Number.isFinite(steps)||Math.abs(steps-Math.round(steps))>1e-7)issue='올바른 숫자를 입력해 주세요';
  }
  if(issue)Object.defineProperty(issues,field.id,{value:issue,enumerable:true});
 }
 return Object.freeze(issues);
}
/** Own editor state without interpreting intermediate text or composition. */
export function ownFormDraft(input:unknown):FormDraftSnapshot {
 const source=copyFormData(input);
 if(!record(source)||Object.keys(source).length!==4||!keys(source,['values','revision','compositionEpoch','composing'])||typeof source.revision!=='number'||!Number.isSafeInteger(source.revision)||source.revision<0||typeof source.compositionEpoch!=='number'||!Number.isSafeInteger(source.compositionEpoch)||source.compositionEpoch<0||typeof source.composing!=='boolean'||!record(source.values)||Object.keys(source.values).length>192||Object.entries(source.values).some(([key,value])=>!id(key)||typeof value!=='string'&&typeof value!=='boolean'))return fail();
 return source as unknown as FormDraftSnapshot;
}
function ownIssues(offer:FormOffer,input:unknown):Readonly<Record<string,string>> {
 if(!record(input)||Object.entries(input).some(([key,value])=>!(key==='$form'||offer.fields.some(field=>field.id===key))||!text(value,500)))return fail();
 return input as Readonly<Record<string,string>>;
}
/** Exact normalized output records are owned before reading or trusting policy state. */
export function ownNormalizedForm(offer:FormOffer,input:unknown):NormalizedForm {
 const source=copyFormData(input);
 if(!record(source)||Object.keys(source).length!==2||!keys(source,['values','issues']))return fail();
 const values=validateFormRawShape(offer,source.values),issues=ownIssues(offer,source.issues);
 return Object.freeze({values,issues});
}
/** One bounded synchronous reducer transaction; every reference names the offered schema. */
export function ownFormReduction(inputOffer:FormOffer,input:unknown):FormReduction {
 const offer=validateFormOffer(inputOffer),source=copyFormData(input),fieldIds=new Set(offer.fields.map(field=>field.id));
 if(!record(source)||!keys(source,['values','visibility','enabled','issues','changedFields','summary'])||!Object.hasOwn(source,'values')||!Object.hasOwn(source,'visibility')||!Object.hasOwn(source,'enabled')||!Object.hasOwn(source,'issues')||!Object.hasOwn(source,'changedFields'))return fail();
 const values=validateFormRawShape(offer,source.values);if(Object.keys(values).length!==offer.fields.length)return fail();ownIssues(offer,source.issues);
 for(const registry of [source.visibility,source.enabled])if(!record(registry)||Object.entries(registry).some(([key,value])=>!fieldIds.has(key)||typeof value!=='boolean'))return fail();
 if(!ids(source.changedFields,fieldIds))return fail();
 if(source.summary!==undefined&&(!Array.isArray(source.summary)||source.summary.length>192||source.summary.some(item=>!record(item)||!keys(item,['text','fieldIds'])||!text(item.text)||item.fieldIds!==undefined&&!ids(item.fieldIds,fieldIds))))return fail();
 return source as unknown as FormReduction;
}
/** Legacy host payload compatibility. Composite actions use their own typed compiler validation. */
export function ownCompiledForm(input:unknown):Readonly<Record<string,string|number|null>> {
 const source=copyFormData(input);
 if(!record(source)||Object.entries(source).some(([key,value])=>!id(key)||!(value===null||typeof value==='string'||typeof value==='number'&&Number.isFinite(value))))return fail();
 return source as Readonly<Record<string,string|number|null>>;
}

/** Draft basis identity excludes renewable command payload/scope authority. */
export function formEditIdentity<A>(input:FormOffer<A>):string {
 const offer=validateFormOffer(input);
 const semanticTarget=(value:FormTarget<A>)=>value.kind==='host'?{kind:value.kind,operationId:value.operationId??null}:{kind:value.kind,actionId:value.actionId};
 const basis={purpose:offer.purpose??'editing',retry:offer.retry??'same-offer',access:offer.access??null,id:offer.id,instanceId:offer.instanceId,schemaVersion:offer.schemaVersion,policyId:offer.policyId,baseVersion:offer.baseVersion,editBinding:offer.editBinding,
  fields:offer.fields,binding:offer.binding,model:Object.hasOwn(offer,'model')?{value:offer.model}:{absent:true},sections:offer.sections??[],clusters:offer.clusters??[],rows:offer.rows??[],
  actions:normalizeFormActions(offer).map(action=>({id:action.id,label:action.label,intent:action.intent,completion:action.completion,basis:action.basis,target:semanticTarget(action.target)}))};
 const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value!==null&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)])):value;
 return JSON.stringify(canonical(basis));
}
/** Own an exact compiler wrapper before a registered policy validates its typed meaning. */
export function ownCompiledAction<A=unknown>(input:unknown):FormCompiledAction<A> {
 const source=copyFormData(input);
 if(!record(source)||Object.keys(source).length!==2||!(source.kind==='command'&&keys(source,['kind','action'])&&Object.hasOwn(source,'action')||source.kind==='host'&&keys(source,['kind','payload'])&&Object.hasOwn(source,'payload')))return fail();
 return source as unknown as FormCompiledAction<A>;
}
export function ownFormEdit(offer:FormOffer,input:unknown):FormEdit {
 const source=copyFormData(input);
 if(!record(source))return fail();
 if(source.kind==='reset-all'||source.kind==='initialize'){if(Object.keys(source).length!==1)return fail();return source as unknown as FormEdit;}
 if(typeof source.fieldId!=='string'||!offer.fields.some(field=>field.id===source.fieldId))return fail();
 if(source.kind==='reset-field'){if(!keys(source,['kind','fieldId'])||Object.keys(source).length!==2)return fail();}
 else{
  if(source.kind!==undefined&&source.kind!=='set-field'&&source.kind!=='base-choice'||!keys(source,['kind','fieldId','value'])||!Object.hasOwn(source,'value'))return fail();
  validateFormRawShape(offer,{[source.fieldId]:source.value});
 }
 return source as unknown as FormEdit;
}
