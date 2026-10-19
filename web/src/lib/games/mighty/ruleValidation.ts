import {copyFormData} from '../../table/foundation/forms';
import {MIGHTY,isPreset} from './catalog';
import {SUITS} from './cards';
import {RULE_FIELDS,getPath,same,problems} from './ruleFields';
import type {Card,Rules} from './types';
import type {CustomSet} from './rulesets';
const fail=(message='기존 규칙을 안전하게 편집할 수 없어요.'):never=>{throw new Error(message);};
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const integer=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max;
const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>record(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a<b?-1:a>b?1:0)):item);
const exactKeys=(value:unknown,keys:readonly string[]):value is Record<string,any>=>record(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

/** Rules saved before `misdeal.window` said when by two flags; read them as
 * the server does (`ask_first` won over `after_bidding`). */
export function upgradeRules(saved: Rules): Rules {
  const misdeal = saved?.misdeal as (Partial<Rules['misdeal']> & { ask_first?: boolean; after_bidding?: boolean }) | undefined;
  if (!misdeal || misdeal.window !== undefined || (misdeal.ask_first === undefined && misdeal.after_bidding === undefined))
    return saved;
  const { ask_first, after_bidding, ...rest } = misdeal;
  const window = ask_first ? 'BeforeFirstBid' : after_bidding ? 'AllBidding' : 'OwnTurnUntilBid';
  return { ...saved, misdeal: { ...rest, window } as Rules['misdeal'] };
}

/** `saved` with every option it leaves out (rules saved before the option
 * existed) filled from `defaults`, as the server reads them. */
export function fillGaps<T>(saved: T, defaults: T): T {
  if (saved === undefined) return structuredClone(defaults);
  const plain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!plain(saved) || !plain(defaults)) return saved;
  // Serialized enum payloads are complete choices, not extensible records.
  // Merging two choices would invent an invalid multi-tag variant.
  const tags = ['BothOver', 'PaysBack', 'TeamAtMost', 'ShortBy', 'Normal', 'Joker'];
  if (tags.some(key => Object.hasOwn(saved, key) || Object.hasOwn(defaults, key))) return saved;
  const out: Record<string, unknown> = { ...saved };
  for (const [key, value] of Object.entries(defaults)) out[key] = fillGaps(saved[key], value);
  return out as T;
}

function card(value:unknown):value is Card{return exactKeys(value,['Normal'])&&Array.isArray(value.Normal)&&value.Normal.length===2&&SUITS.includes(value.Normal[0])&&integer(value.Normal[1],2,14)||exactKeys(value,['Joker'])&&(value.Joker==='Black'||value.Joker==='Red');}
function typedVariant(value:unknown,strings:readonly string[],parameters:readonly string[]):boolean{return typeof value==='string'?strings.includes(value):record(value)&&Object.keys(value).length===1&&parameters.some(key=>Object.hasOwn(value,key)&&integer(value[key],0,255));}
/** Strict editor compatibility, deliberately narrower than unchecked legacy storage.
 * It never repairs duplicate/out-of-domain overrides or unknown rule members. */
export function validateMightyEditorRules(input:unknown):Rules {
 const owned=copyFormData(input);if(!record(owned))return fail();
 const defaults=MIGHTY.rule_defaults;
 for(const path of ['', 'misdeal','bidding','friend','policy','joker_call','joker_lead','scoring']){
  const value=path?getPath(owned,path):owned,template=path?getPath(defaults,path):defaults;
  if(!exactKeys(value,Object.keys(template)))fail('알 수 없거나 빠진 규칙 항목이 있어 편집을 열지 않았어요.');
 }
 if(!integer(owned.players,2,8)||!integer(owned.hand_size,1,54)||!integer(owned.lowest_rank,2,10)||!Array.isArray(owned.extra_cards)||owned.extra_cards.length>54||!owned.extra_cards.every(card))fail();
 const rules=owned as unknown as Rules;
 for(const field of RULE_FIELDS){const value=getPath(rules,field.path),control=field.control;
  switch(control.kind){
   case 'toggle':if(typeof value!=='boolean')fail();break;
   case 'stepper':if(!integer(value,field.path.startsWith('misdeal.')?-128:0,field.path.startsWith('misdeal.')?127:255))fail();break;
   case 'maybe':if(value!==null&&!integer(value,0,255))fail();break;
   case 'flags':if(!exactKeys(value,control.options.map(option=>option.key))||control.options.some(option=>typeof value[option.key]!=='boolean'))fail();break;
   case 'rounds':if(!exactKeys(value,['first','last'])||![value.first,value.last].every(policy=>['Valid','NoEffect','NoLead','Invalid'].includes(policy)))fail();break;
   case 'cardValues':if(!Array.isArray(value)||value.length>54||value.some(pair=>!Array.isArray(pair)||pair.length!==2||!card(pair[0])||!integer(pair[1],-128,127))||new Set(value.map(pair=>canonical(pair[0]))).size!==value.length)fail('카드별 값에 중복·잘못된 카드가 있어 편집을 열지 않았어요.');break;
   case 'segment':{
    if(field.path==='scoring.win'){if(!typedVariant(value,['OverTen','OverMin','OverBid','BidBonus'],['BothOver']))fail();}
    else if(field.path==='scoring.lose'){if(!typedVariant(value,['Shortfall'],['PaysBack']))fail();}
    else if(field.path==='scoring.back_run'){if(!typedVariant(value,['Never','DefenceReachesBid'],['TeamAtMost','ShortBy']))fail();}
    else if(field.path.startsWith('joker_call.calls.')){if(value!==undefined&&(!Array.isArray(value)||value.length!==2||!value.every(card)))fail();}
    else if(!control.options.some(option=>same(option.value,value)))fail();break;
   }
  }
 }
 if(!Array.isArray(rules.joker_call.calls)||rules.joker_call.calls.length!==(rules.deck==='TwoJokers'?2:1))fail();
 const issues=problems(rules);if(issues.length)fail(`기존 규칙 확인이 필요해요: ${issues[0].message}`);
 return rules;
}
/** Validate before upgrading known old defaults; unknown members remain a refusal. */
export function decodeMightyCustomCatalog(raw:string|null):readonly CustomSet[]{
 if(raw!==null&&(typeof raw!=='string'||new TextEncoder().encode(raw).length>65536))fail('저장한 규칙 목록이 너무 커요.');
 let parsed:unknown;try{parsed=JSON.parse(raw??'[]');}catch{return fail('저장한 규칙 목록을 읽을 수 없어요. 원본은 그대로 두었어요.');}
 const owned=copyFormData(parsed);if(!Array.isArray(owned)||owned.length>5)return fail('저장한 규칙은 다섯 개까지 안전하게 편집할 수 있어요.');
 const ids=new Set<string>();
 return owned.map(item=>{
  if(!exactKeys(item,['id','name','base','rules'])||typeof item.id!=='string'||!item.id||item.id.length>128||ids.has(item.id)||typeof item.name!=='string'||Array.from(item.name).length>24||!isPreset(item.base))return fail('저장한 규칙의 이름이나 기준이 올바르지 않아요.');
  ids.add(item.id);
  // Legacy compatibility accepts omitted booleans, never truthy substitutes.
  // Validate before upgradeRules removes the historical members.
  const legacy=record(item.rules)&&record(item.rules.misdeal)?item.rules.misdeal:null;
  if(legacy&&['ask_first','after_bidding'].some(key=>Object.hasOwn(legacy,key)&&typeof legacy[key]!=='boolean'))return fail('이전 규칙의 딜미스 설정이 올바르지 않아요.');
  const upgraded=upgradeRules(item.rules as Rules);
  // fillGaps only supplies documented omitted fields; strict validation rejects extras.
  const rules=validateMightyEditorRules(fillGaps(upgraded,MIGHTY.rule_defaults));
  return {id:item.id,name:item.name,base:item.base,rules};
 });
}
