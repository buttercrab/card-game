import type {CommandScope} from '../../generated/protocol';
import type {HostCommand} from '../../table/foundation/connectedDocument';
import {copyFormData,validateFormOffer,type CompositeFormPolicy,type FormOffer,type FormValues,type FormValue,type FormEdit,type FormReduction,type FormField,type FormCluster,type FormRow} from '../../table/foundation/forms';
import {MIGHTY,PRESETS,isPreset,presetRules,presetTitle} from './catalog';
import {SUITS,cardLabel} from './cards';
import {RULE_FIELDS,GROUPS,getPath,setPath,setField,shown,same,problems,type Field} from './ruleFields';
import type {CustomSet} from './rulesets';
import {validateMightyEditorRules,decodeMightyCustomCatalog} from './ruleValidation';
export {validateMightyEditorRules,decodeMightyCustomCatalog} from './ruleValidation';
import type {Card,Rules,MightySettings,CurrentRoomView as RoomView} from './types';
export type MightyRuleCommand=Extract<HostCommand<never,MightySettings>,{kind:'room'}>;
export const MIGHTY_RULE_FORM_ID='mighty-rules';
export const MIGHTY_RULE_POLICY_ID='mighty:rules:v1';
export const MIGHTY_RULE_SAVE_OPERATION='mighty:save-custom';
export interface MightyLocalSavePayload {readonly operation:typeof MIGHTY_RULE_SAVE_OPERATION;readonly set:Omit<CustomSet,'id'>&{id?:string};readonly sourceId:string;readonly expectedRaw?:string|null;readonly storageAuthority?:string;}
interface Model {readonly settings:MightySettings;readonly currentRules?:Rules;readonly customStorageRaw:string|null;}
interface Start {id:string;preset:MightySettings['preset'];rules:Rules;base:Rules;name:string;customId?:string;}
interface Scalar {id:string;definition?:Field;section:string;label:string;kind:'toggle'|'number'|'select'|'text';part?:string;card?:Card;options?:{id:string;label:string;value:unknown}[];min?:number;max?:number;}
const fail=(message='기존 규칙을 안전하게 편집할 수 없어요.'):never=>{throw new Error(message);};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const integer=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max;
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>record(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
const fingerprint=(value:unknown):string=>{let hash=0xcbf29ce484222325n;for(const char of canonical(value))hash=BigInt.asUintN(64,(hash^BigInt(char.codePointAt(0)!))*0x100000001b3n);return hash.toString(16);};
const exactKeys=(value:unknown,keys:readonly string[]):value is Record<string,any>=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const comparableRules=(rules:Rules):Rules=>({...rules,misdeal:{...rules.misdeal,card_values:[...rules.misdeal.card_values].sort(([a],[b])=>canonical(a).localeCompare(canonical(b)))}});
const sameRules=(a:Rules,b:Rules):boolean=>same(comparableRules(a),comparableRules(b));
const card=(value:unknown):value is Card=>CARD_IDENTITIES.some(card=>same(card,value));
const CARD_IDENTITIES:readonly Card[]=[...SUITS.flatMap(suit=>Array.from({length:13},(_,index):Card=>({Normal:[suit,index+2]}))),{Joker:'Black'},{Joker:'Red'}];
function model(offer:FormOffer<MightyRuleCommand>):Model {const value=offer.model;if(!record(value)||!Object.hasOwn(value,'settings')||!Object.hasOwn(value,'customStorageRaw'))return fail();return value as unknown as Model;}
function starts(offer:FormOffer<MightyRuleCommand>):Start[]{
 const captured=model(offer),settings=captured.settings,customs=decodeMightyCustomCatalog(captured.customStorageRaw);
 const baseline=(preset:MightySettings['preset'])=>structuredClone(preset===settings.preset?settings.preset_rules??presetRules(preset):presetRules(preset));
 const result:Start[]=PRESETS.map((preset,index)=>({id:`s${index}`,preset:preset.id,base:baseline(preset.id),rules:baseline(preset.id),name:''}));
 for(const [index,custom] of customs.entries())result.push({id:`s${PRESETS.length+index}`,preset:custom.base as MightySettings['preset'],base:baseline(custom.base as MightySettings['preset']),rules:custom.rules,name:custom.name,customId:custom.id});
 const initial=captured.currentRules??settings.rules??settings.preset_rules??presetRules(settings.preset);
 // Initial current rules share the selected preset token, but stay a captured initial overlay.
 if(!result.some(start=>start.preset===settings.preset))fail();
 validateMightyEditorRules(initial);
 return result;
}
function scalars(offer:FormOffer<MightyRuleCommand>):Scalar[]{
 const captured=model(offer),all=[captured.currentRules??captured.settings.rules??captured.settings.preset_rules??presetRules(captured.settings.preset),...starts(offer).flatMap(start=>[start.rules,start.base])];
 const out:Scalar[]=[{id:'start',section:'start',label:'시작 규칙',kind:'select',options:starts(offer).map(start=>({id:start.id,label:start.customId?start.name.trim()||'우리 규칙':presetTitle(start.preset),value:start.id}))},{id:'custom-name',section:'local',label:'이 기기에 저장할 이름',kind:'text'}];
 RULE_FIELDS.forEach((definition,index)=>{
  const id=`f${index}`,common={definition,section:definition.group,label:definition.label};const control=definition.control;
  if(control.kind==='toggle')out.push({...common,id,kind:'toggle'});
  if(control.kind==='stepper')out.push({...common,id,kind:'number',min:definition.path.startsWith('misdeal.')?-128:0,max:definition.path.startsWith('misdeal.')?127:255});
  if(control.kind==='maybe')out.push({...common,id:`${id}e`,part:'enabled',kind:'toggle'},{...common,id:`${id}v`,part:'value',kind:'number',min:0,max:255});
  if(control.kind==='flags')for(const [partIndex,option] of control.options.entries())out.push({...common,id:`${id}p${partIndex}`,part:option.key,label:option.label,kind:'toggle'});
  if(control.kind==='rounds')for(const part of ['first','last'])out.push({...common,id:`${id}${part==='first'?'a':'b'}`,part,label:part==='first'?'첫 라운드':'마지막 라운드',kind:'select',options:['Valid','NoEffect','NoLead','Invalid'].map((value,i)=>({id:`o${i}`,label:control.options.find(option=>option.value===value)?.label??(value==='NoLead'?'선 못 냄':'못 냄'),value}))});
  if(control.kind==='cardValues')for(const [cardIndex,value] of CARD_IDENTITIES.entries()){const cardCommon={...common,card:value,label:cardLabel(value)};out.push({...cardCommon,id:`c${cardIndex}e`,part:'enabled',kind:'toggle'},{...cardCommon,id:`c${cardIndex}v`,part:'value',kind:'number',min:-128,max:127});}
  if(control.kind==='segment'){
   const options=control.options.map(option=>({...option}));
   // Scoring discriminants use typed parameters, never parameter enumeration.
   const variant=(value:unknown)=>record(value)?Object.keys(value)[0]:value;
   if(definition.path.startsWith('scoring.')){
    const unique=options.filter((option,i)=>options.findIndex(other=>same(variant(option.value),variant(other.value)))===i);
    out.push({...common,id,kind:'select',options:unique.map((option,i)=>({id:`o${i}`,label:option.label,value:variant(option.value)}))});
   }else{
    for(const rules of all){const value=getPath(rules,definition.path);if(value!==undefined&&!options.some(option=>same(option.value,value)))options.push({value,label:`기존 값 · ${Array.isArray(value)&&value.every(card)?value.map(cardLabel).join(' / '):String(value)}`});}
    out.push({...common,id,kind:'select',options:options.map((option,i)=>({...option,id:`o${i}`}))});
   }
  }
 });
 for(const [index,path,label] of [[0,'scoring.win','이긴 점수 기준'],[1,'scoring.lose','갚는 점수 기준'],[2,'scoring.back_run','백런 기준']] as const)out.push({id:`n${index}`,definition:RULE_FIELDS.find(field=>field.path===path)!,section:'score',label,kind:'number',min:0,max:255,part:'parameter'});
 return out;
}
function selection(offer:FormOffer<MightyRuleCommand>,values:FormValues):Start {const selected=starts(offer).find(start=>start.id===values.start)??fail('시작 규칙을 다시 선택해주세요.');const captured=model(offer),fixed=captured.currentRules??captured.settings.rules??captured.settings.preset_rules??presetRules(captured.settings.preset);if(selected.rules.players!==fixed.players)fail('이 테이블과 인원이 같은 시작 규칙을 선택해주세요.');return selected;}
function parameter(value:unknown,fallback:number):number {return record(value)?Object.values(value)[0] as number:fallback;}
function project(offer:FormOffer<MightyRuleCommand>,rules:Rules,start:Start,name:string):Record<string,FormValue>{
 const values:Record<string,FormValue>={start:start.id,'custom-name':name};
 for(const item of scalars(offer)){if(!item.definition)continue;const value=getPath(rules,item.definition.path),control=item.definition.control;
  if(item.card){const pair=rules.misdeal.card_values.find(([card])=>same(card,item.card));values[item.id]=item.part==='enabled'?!!pair:String(pair?.[1]??0);}
  else if(item.part==='parameter')values[item.id]=String(parameter(value,item.id==='n0'?13:item.id==='n1'?10:10));
  else if(control.kind==='maybe')values[item.id]=item.part==='enabled'?value!==null:String(value??control.start);
  else if(control.kind==='flags'||control.kind==='rounds')values[item.id]=item.kind==='toggle'?value[item.part!]:item.options!.find(option=>same(option.value,value[item.part!]))!.id;
  else if(item.kind==='toggle')values[item.id]=value;
  else if(item.kind==='number')values[item.id]=String(value);
  else {const target=item.definition.path.startsWith('scoring.')&&record(value)?Object.keys(value)[0]:value;values[item.id]=item.options!.find(option=>same(option.value,target))?.id??item.options![0].id;}
 }
 return values;
}
function rawIssues(offer:FormOffer<MightyRuleCommand>,values:FormValues):Record<string,string>{const issues:Record<string,string>={};for(const item of scalars(offer)){const value=values[item.id];if(item.kind==='number'){if(typeof value!=='string'||! /^-?\d+$/.test(value)||!integer(Number(value),item.min!,item.max!))issues[item.id]=`${item.min}부터 ${item.max}까지 정수를 입력해주세요.`;}else if(item.kind==='toggle'){if(typeof value!=='boolean')issues[item.id]='켜기 또는 끄기를 선택해주세요.';}else if(item.kind==='select'){if(!item.options!.some(option=>option.id===value))issues[item.id]='선택지를 다시 골라주세요.';}else if(typeof value!=='string'||Array.from(value).length>24)issues[item.id]='이름은 24자까지 입력해주세요.';}return issues;}
/** Structural discriminants precede typed overlays, independent of record key order. */
function decode(offer:FormOffer<MightyRuleCommand>,values:FormValues):{rules:Rules;start:Start;issues:Record<string,string>}{
 const start=selection(offer,values),rules=structuredClone(start.rules),items=scalars(offer),issues=rawIssues(offer,values);
 const captured=model(offer),fixed=captured.currentRules??captured.settings.rules??captured.settings.preset_rules??presetRules(captured.settings.preset);
 rules.players=fixed.players;rules.hand_size=fixed.hand_size;rules.lowest_rank=fixed.lowest_rank;rules.extra_cards=structuredClone(fixed.extra_cards);
 const numeric=(item:Scalar,fallback:number)=>issues[item.id]?fallback:Number(values[item.id]);
 for(const item of items){if(!item.definition||item.card||item.part==='parameter'||item.kind!=='select'||item.definition.path==='joker_call.calls.1'&&rules.deck==='OneJoker')continue;const value=item.options!.find(option=>option.id===values[item.id])?.value;if(value===undefined)continue;
  if(item.part)setPath(rules,`${item.definition.path}.${item.part}`,value);
  else if(item.definition.path==='scoring.win')rules.scoring.win=value==='BothOver'?{BothOver:parameter(start.rules.scoring.win,13)}:value as Rules['scoring']['win'];
  else if(item.definition.path==='scoring.lose')rules.scoring.lose=value==='PaysBack'?{PaysBack:parameter(start.rules.scoring.lose,10)}:'Shortfall';
  else if(item.definition.path==='scoring.back_run')rules.scoring.back_run=value==='TeamAtMost'?{TeamAtMost:parameter(start.rules.scoring.back_run,10)}:value==='ShortBy'?{ShortBy:parameter(start.rules.scoring.back_run,5)}:value as Rules['scoring']['back_run'];
  else setField(rules,item.definition,value);
 }
 for(const item of items){if(!item.definition||item.card||item.kind==='select'||item.part==='parameter')continue;const control=item.definition.control,value=values[item.id];
  if(control.kind==='maybe'){if(item.part==='enabled')setPath(rules,item.definition.path,value===true?getPath(start.rules,item.definition.path)??control.start:null);else {const enabled=values[`f${RULE_FIELDS.indexOf(item.definition)}e`]===true;if(enabled)setPath(rules,item.definition.path,numeric(item,getPath(start.rules,item.definition.path)??control.start));}}
  else if(item.kind==='toggle'){if(typeof value==='boolean')setPath(rules,item.part?`${item.definition.path}.${item.part}`:item.definition.path,value);}
  else setPath(rules,item.definition.path,numeric(item,getPath(start.rules,item.definition.path)));
 }
 const origin=start.customId?start.rules:start.preset===captured.settings.preset?fixed:start.rules;
 const ordered=[...origin.misdeal.card_values.map(([card])=>card),...CARD_IDENTITIES.filter(card=>!origin.misdeal.card_values.some(([value])=>same(value,card)))];
 rules.misdeal.card_values=ordered.flatMap(card=>{const index=CARD_IDENTITIES.findIndex(value=>same(value,card));if(values[`c${index}e`]!==true)return [];const item=items.find(item=>item.id===`c${index}v`)!;const prior=start.rules.misdeal.card_values.find(([value])=>same(value,card));return [[structuredClone(card),numeric(item,prior?.[1]??0)] as [Card,number]];});
 for(const item of items.filter(item=>item.part==='parameter')){const path=item.definition!.path,value=getPath(rules,path);if(record(value)){const tag=Object.keys(value)[0];setPath(rules,path,{[tag]:numeric(item,parameter(getPath(start.rules,path),item.id==='n0'?13:item.id==='n1'?10:tag==='ShortBy'?5:10))});}}
 return {rules,start,issues};
}
function visible(item:Scalar,rules:Rules,values:FormValues):boolean {if(!item.definition)return true;if(item.card)return item.part==='enabled'||values[item.id.replace(/v$/,'e')]===true;if(item.part==='parameter')return record(getPath(rules,item.definition.path));if(item.definition.control.kind==='maybe'&&item.part==='value'&&values[`f${RULE_FIELDS.indexOf(item.definition)}e`]!==true)return false;return shown(item.definition,rules);}
function scalarSemantic(item:Scalar,rules:Rules):unknown {
 if(!item.definition)return undefined;
 const value=getPath(rules,item.definition.path),control=item.definition.control;
 if(item.card){const pair=rules.misdeal.card_values.find(([card])=>same(card,item.card));return item.part==='enabled'?!!pair:pair?.[1];}
 if(control.kind==='maybe')return item.part==='enabled'?value!==null:value??control.start;
 if(control.kind==='flags'||control.kind==='rounds')return value[item.part!];
 if(item.part==='parameter')return record(value)?Object.values(value)[0]:undefined;
 if(item.kind==='select'&&item.definition.path.startsWith('scoring.')&&record(value))return Object.keys(value)[0];
 return value;
}
function reduction(offer:FormOffer<MightyRuleCommand>,values:FormValues,changed:readonly string[]):FormReduction {
 const decoded=decode(offer,values),items=scalars(offer),visibility=Object.fromEntries(items.map(item=>[item.id,visible(item,decoded.rules,values)])),issues={...decoded.issues};
 // Hidden optional numeric values are local defaults, not invalid payload cells.
 for(const item of items)if(!visibility[item.id]&&item.kind==='number')delete issues[item.id];
 for(const problem of problems(decoded.rules)){const fields=items.filter(item=>item.definition&&problem.paths.includes(item.definition.path)&&visibility[item.id]);if(fields.length)for(const item of fields)issues[item.id]=problem.message;else issues.start=problem.message;}
 const changedFields=items.filter(item=>item.definition?!!decoded.issues[item.id]&&visibility[item.id]||!same(scalarSemantic(item,decoded.rules),scalarSemantic(item,decoded.start.base)):item.id==='custom-name'?values[item.id]!==decoded.start.name:values[item.id]!==offer.fields.find(field=>field.id===item.id)?.initial).map(item=>item.id);
 const summary=[...new Map(items.filter(item=>item.definition&&changedFields.includes(item.id)).map(item=>[item.definition!.path,{text:item.definition!.label,fieldIds:items.filter(other=>other.definition===item.definition&&visibility[other.id]).map(other=>other.id)}])).values()];
 return {values:{...values},visibility,enabled:Object.fromEntries(items.map(item=>[item.id,true])),issues,changedFields,summary};
}
function applyEdit(offer:FormOffer<MightyRuleCommand>,previous:FormValues,edit:FormEdit):FormReduction {
 if(edit.kind==='initialize')return reduction(offer,previous,[]);
 const before=decode(offer,previous),items=scalars(offer);let values:Record<string,FormValue>={...previous};
 if(edit.kind==='reset-all')values=project(offer,before.start.base,before.start,typeof previous['custom-name']==='string'?previous['custom-name']:'');
 else {const item=items.find(item=>item.id===edit.fieldId)??fail('알 수 없는 규칙 항목이에요.');
  if(edit.kind==='base-choice'||item.id==='start'&&edit.kind!=='reset-field'){if(typeof edit.value!=='string')fail();const selected=selection(offer,{...previous,start:edit.value});values=project(offer,selected.rules,selected,selected.name);}
  else if(edit.kind==='reset-field'){
   const baseline=project(offer,before.start.base,before.start,typeof previous['custom-name']==='string'?previous['custom-name']:'');
   if(!item.definition)values[item.id]=item.id==='custom-name'?before.start.name:baseline[item.id];else for(const sibling of items.filter(other=>other.definition===item.definition&&(item.card?same(other.card,item.card):true)))values[sibling.id]=baseline[sibling.id];
  }else {
   values[item.id]=edit.value;
   if(item.definition?.control.kind==='maybe'&&item.part==='enabled')values[`f${RULE_FIELDS.indexOf(item.definition)}v`]=String(item.definition.control.start);
   if(item.card&&item.part==='enabled')values[item.id.replace(/e$/,'v')]='0';
  }
  if(edit.kind!=='reset-field'&&item.id!=='start'&&item.definition){
   const decoded=decode(offer,values),projected=project(offer,decoded.rules,decoded.start,String(values['custom-name']??''));
   // A structural transition may normalize dependent values; never discard an
   // unrelated invalid raw cell as a side effect of a parent toggle/deck edit.
   for(const other of items){if(other.id===item.id)continue;const oldVisible=visible(other,before.rules,previous),newVisible=visible(other,decoded.rules,values);if(before.issues[other.id]&&oldVisible&&(!newVisible||projected[other.id]!==previous[other.id])){
     const sameOptional=item.definition===other.definition&&(item.part==='enabled'||item.card&&same(item.card,other.card));
     if(!sameOptional)return {...reduction(offer,previous,[]),issues:{...reduction(offer,previous,[]).issues,[item.id]:`${other.label} 입력을 마치거나 초기화한 뒤 바꿔주세요.`}};
   }}
   // Normalize only known dependency edits; independent invalid raw overlays survive.
   if(item.definition.path==='deck')for(const other of items.filter(value=>value.definition?.path.startsWith('joker_call.calls.')))values[other.id]=projected[other.id];
  }
 }
 return reduction(offer,values,Object.keys(values).filter(id=>values[id]!==previous[id]));
}
function settingsFor(offer:FormOffer<MightyRuleCommand>,values:FormValues):MightySettings {
 const decoded=decode(offer,values),check=reduction(offer,values,[]);if(Object.keys(check.issues).length)fail('규칙 입력을 먼저 확인해주세요.');validateMightyEditorRules(decoded.rules);
 const captured=model(offer),fixed=(captured.currentRules??captured.settings.rules??captured.settings.preset_rules??presetRules(captured.settings.preset)).players;
 if(decoded.rules.players!==fixed)fail('이 테이블의 인원은 바꿀 수 없어요.');
 const pinned=decoded.start.preset===captured.settings.preset?captured.settings.preset_rules:undefined;
 return {preset:decoded.start.preset,...(!sameRules(decoded.rules,decoded.start.base)?{rules:decoded.rules}:{}),...(pinned?{preset_rules:structuredClone(pinned)}:{})};
}
function commandTemplate(offer:FormOffer<MightyRuleCommand>):MightyRuleCommand {const target=offer.actions?.find(action=>action.id==='apply')?.target;if(target?.kind!=='command'||target.template.kind!=='room'||target.template.action.type!=='set_settings')return fail();return target.template;}
interface SaveAuthority {readonly token:string;readonly savedId:string;readonly sourceId:string;}
function saveAuthority(offer:FormOffer<MightyRuleCommand>):SaveAuthority|null {
 const target=offer.actions?.find(action=>action.id==='save')?.target;if(target?.kind!=='host'||target.authority===undefined)return null;
 const value=copyFormData(target.authority);if(!exactKeys(value,['token','savedId','sourceId'])||!['token','savedId','sourceId'].every(key=>typeof value[key]==='string'&&value[key].length>0&&value[key].length<=128)||!starts(offer).some(start=>start.id===value.sourceId))return fail('저장 권한이 변경되었어요. 다시 열어주세요.');return value as unknown as SaveAuthority;
}
export function decodeLocalSavePayload(payload:unknown):MightyLocalSavePayload|null {try{
 const value=copyFormData(payload);if(!record(value)||!Object.keys(value).every(key=>['operation','set','expectedRaw','sourceId','storageAuthority'].includes(key))||Object.hasOwn(value,'expectedRaw')===Object.hasOwn(value,'storageAuthority')||value.operation!==MIGHTY_RULE_SAVE_OPERATION||typeof value.sourceId!=='string'||!value.sourceId||value.sourceId.length>128||!record(value.set)||!Object.keys(value.set).every(key=>['id','name','base','rules'].includes(key))||typeof value.set.name!=='string'||Array.from(value.set.name).length>24||typeof value.set.base!=='string'||!isPreset(value.set.base)||value.set.id!==undefined&&(typeof value.set.id!=='string'||!value.set.id||value.set.id.length>128))return null;
 if(Object.hasOwn(value,'expectedRaw')){if(!(value.expectedRaw===null||typeof value.expectedRaw==='string'))return null;decodeMightyCustomCatalog(value.expectedRaw);}else if(typeof value.storageAuthority!=='string'||!value.storageAuthority||value.storageAuthority.length>128)return null;
 const rules=validateMightyEditorRules(value.set.rules);return {operation:MIGHTY_RULE_SAVE_OPERATION,sourceId:value.sourceId,set:{...(typeof value.set.id==='string'?{id:value.set.id}:{}),name:value.set.name,base:value.set.base,rules},...(Object.hasOwn(value,'expectedRaw')?{expectedRaw:value.expectedRaw as string|null}:{storageAuthority:value.storageAuthority as string})};
 }catch{return null;}}
export const MIGHTY_RULE_FORM_POLICY:CompositeFormPolicy<MightyRuleCommand>={
 kind:'actions',id:MIGHTY_RULE_POLICY_ID,
 reduce:applyEdit,
 normalize(offer,values){const result=reduction(offer,values,[]),decoded=decode(offer,values),projected=project(offer,decoded.rules,decoded.start,String(values['custom-name']??''));return {values:Object.fromEntries(Object.entries(result.values).map(([id,value])=>[id,result.visibility[id]===false?projected[id]:value])),issues:result.issues};},
 compile(offer,values,actionId){
  const settings=settingsFor(offer,values);
  if(actionId==='apply'){const template=commandTemplate(offer);return {kind:'command',action:{kind:'room',expected:structuredClone(template.expected),action:{type:'set_settings',settings}}};}
  if(actionId!=='save')return fail('알 수 없는 저장 동작이에요.');
  const decoded=decode(offer,values),authority=saveAuthority(offer),savedId=authority?.sourceId===values.start?authority.savedId:decoded.start.customId;return {kind:'host',payload:{operation:MIGHTY_RULE_SAVE_OPERATION,sourceId:String(values.start),set:{...(savedId?{id:savedId}:{}),name:String(values['custom-name']??'').trim(),base:settings.preset,rules:decoded.rules},...(authority?{storageAuthority:authority.token}:{expectedRaw:model(offer).customStorageRaw})} satisfies MightyLocalSavePayload};
 },
 validateCompiled(offer,candidate,actionId){try{if(actionId==='save'){if(candidate.kind!=='host')return false;const payload=decodeLocalSavePayload(candidate.payload),authority=saveAuthority(offer);if(!payload)return false;const source=starts(offer).find(start=>start.id===payload.sourceId);if(!source)return false;return payload.set.id===(authority?.sourceId===source.id?authority.savedId:source.customId)&&(authority?payload.storageAuthority===authority.token:payload.storageAuthority===undefined&&same(payload.expectedRaw,model(offer).customStorageRaw));}if(actionId!=='apply'||candidate.kind!=='command')return false;const template=commandTemplate(offer),value=candidate.action;if(value.kind!=='room'||value.action.type!=='set_settings'||!same(value.expected,template.expected))return false;const settings=value.action.settings;if(!isPreset(settings.preset)||Object.keys(settings).some(key=>!['preset','rules','preset_rules'].includes(key)))return false;const effective=validateMightyEditorRules(settings.rules??settings.preset_rules??presetRules(settings.preset));const captured=model(offer);const fixed=captured.currentRules??captured.settings.rules??captured.settings.preset_rules??presetRules(captured.settings.preset);return ['players','hand_size','lowest_rank','extra_cards'].every(key=>same(getPath(effective,key),getPath(fixed,key)))&&same(settings.preset_rules,settings.preset===captured.settings.preset?captured.settings.preset_rules:undefined);}catch{return false;}},
 expectedResult(_offer,action){return action.kind==='room'&&action.action.type==='set_settings'?copyFormData(action.action.settings):null;},
 matchesResult(offer,expected){try{const captured=model(offer),settings=expected as MightySettings;if(!isPreset(settings.preset))return false;const actual=captured.settings;return actual.preset===settings.preset&&sameRules(actual.rules??actual.preset_rules??presetRules(actual.preset),settings.rules??settings.preset_rules??presetRules(settings.preset))&&sameRules(actual.preset_rules??presetRules(actual.preset),settings.preset_rules??presetRules(settings.preset));}catch{return false;}},
};
export function createMightyRuleForm(input:{room:RoomView;scope:CommandScope;viewerId:string|null;seat:number|null;customs?:unknown;customStorageRaw:string|null}):{offer?:FormOffer<MightyRuleCommand>;diagnostic?:string}{
 try{
  const {room,scope,viewerId,seat}=input;if(!viewerId||seat===null||room.in_hand||scope.domain!=='room'||scope.room_id!==room.id||scope.actor_id!==viewerId||scope.seat!==seat||room.seats[seat]?.kind!=='human')return {};
  const settings=copyFormData(room.settings);if(!isPreset(settings.preset)||Object.keys(settings).some(key=>!['preset','rules','preset_rules'].includes(key)))return fail('이 테이블의 기준 규칙을 알 수 없어요.');
  const effective=validateMightyEditorRules(room.rules);if(settings.rules)validateMightyEditorRules(settings.rules);if(settings.preset_rules)validateMightyEditorRules(settings.preset_rules);
  if(effective.players!==room.seats.length)fail('인원과 규칙이 맞지 않아 편집을 열지 않았어요.');
  const customs=decodeMightyCustomCatalog(input.customStorageRaw);if(input.customs!==undefined&&!same(customs,input.customs))fail('저장한 규칙 목록이 변경되었어요. 다시 열어주세요.');
  const derived=settings.rules??settings.preset_rules??presetRules(settings.preset),modelValue:Model={settings,...(!same(effective,derived)?{currentRules:effective}:{}),customStorageRaw:input.customStorageRaw};
  const template:MightyRuleCommand={kind:'room',expected:copyFormData(scope),action:{type:'set_settings',settings:{preset:settings.preset}}};
  let offer:FormOffer<MightyRuleCommand>={id:MIGHTY_RULE_FORM_ID,instanceId:`mighty-rules:${room.id}:${viewerId}`,schemaVersion:'mighty-rule-fields-v1',policyId:MIGHTY_RULE_POLICY_ID,baseVersion:`settings:${fingerprint(settings)}`,editBinding:`${room.id}:${viewerId}`,title:'마이티 규칙 바꾸기',help:'다음 판부터 적용돼요.',submitLabel:'테이블에 적용',fields:[],binding:{roomId:room.id,actorId:viewerId,seat},enabled:true,model:modelValue,sections:[{id:'start',title:'시작 규칙'},...GROUPS.map(group=>({id:group.id,title:group.label})),{id:'local',title:'이 기기에 저장'}],actions:[{id:'apply',label:'테이블에 적용',intent:'primary',target:{kind:'command',actionId:'mighty:apply-rules',template},completion:'lock',basis:'current'},{id:'save',label:'이 기기에 저장',intent:'secondary',target:{kind:'host',operationId:MIGHTY_RULE_SAVE_OPERATION},completion:'continue',basis:'draft'}]};
  const availableStarts=starts(offer),start=availableStarts.find(start=>start.customId&&start.preset===settings.preset&&sameRules(start.rules,effective))??availableStarts.find(start=>start.preset===settings.preset)!,initial=project(offer,effective,start,start.name),items=scalars(offer),clusters:FormCluster[]=[],rows:FormRow[]=[];
  RULE_FIELDS.forEach((definition,index)=>{clusters.push({id:`g${index}`,sectionId:definition.group,label:definition.label,help:definition.help,fieldIds:items.filter(item=>item.definition===definition).map(item=>item.id)});});
  const cardDefinition=RULE_FIELDS.find(field=>field.control.kind==='cardValues')!,cardCluster=`g${RULE_FIELDS.indexOf(cardDefinition)}`;
  for(const [index,value] of CARD_IDENTITIES.entries())rows.push({id:`r${index}`,clusterId:cardCluster,label:cardLabel(value),fieldIds:[`c${index}e`,`c${index}v`]});
  const fields:FormField[]=items.map(item=>{
   const shared={id:item.id,label:item.label,required:item.kind==='number',...(!item.definition?{sectionId:item.section}:{})};
   if(item.kind==='toggle')return {...shared,kind:'toggle',initial:initial[item.id] as boolean};
   if(item.kind==='select')return {...shared,kind:'select',initial:initial[item.id] as string,options:item.options!.map(option=>({id:option.id,label:option.label,enabled:item.id!=='start'||starts(offer).find(start=>start.id===option.id)!.rules.players===effective.players}))};
   return {...shared,kind:item.kind,initial:initial[item.id] as string,maxCodePoints:item.kind==='text'?24:4,maxCodeUnits:item.kind==='text'?48:4,...(item.kind==='number'?{min:item.min,max:item.max,step:1}:{})};
  });
  offer={...offer,fields,clusters,rows};return {offer:validateFormOffer(offer)};
 }catch(error){return {diagnostic:error instanceof Error?error.message:'기존 규칙을 편집할 수 없어요. 원본은 그대로 두었어요.'};}
}
