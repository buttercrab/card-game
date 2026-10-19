import {ACHIEVEMENTS} from './achievementCatalog';
import type {HandRecord} from './stats';
import {copyFormData} from '../../table/foundation/forms';

export const COMPLETION_STORAGE_KEY='mighty.device-records.v1';
export const COMPLETION_LIMIT=1000;
const LEGACY_STATS='mighty.stats',LEGACY_AWARDS='mighty.achievements';
const MAX_RAW=2*1024*1024;
const known=new Set(ACHIEVEMENTS.map(item=>item.id));
export interface CompletionStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;}
export interface DeviceRecords {readonly version:1;readonly completed:readonly string[];readonly hands:readonly HandRecord[];readonly unlocked:Readonly<Record<string,number>>;}
export type DeviceRead={readonly status:'ready';readonly records:DeviceRecords}|{readonly status:'failed'|'unsupported';readonly message:string};
function ownRecords(records:DeviceRecords):DeviceRecords {return Object.freeze({version:1,completed:Object.freeze([...records.completed]),hands:Object.freeze(records.hands.map(hand=>copyFormData(hand))),unlocked:copyFormData(records.unlocked)});}
export type CompletionWrite={readonly status:'stored'|'duplicate';readonly records:DeviceRecords;readonly earnedIds:readonly string[]}|{readonly status:'failed'|'unsupported'|'conflict'|'uncertain';readonly message:string};
interface Basis {raw:string|null;legacyStats:string|null;legacyAwards:string|null;records:DeviceRecords;}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const int=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
function validHand(v:unknown):v is HandRecord {
 return obj(v)&&Object.keys(v).length===7&&['key','at','role','won','payoff','contract','teamPoints'].every(k=>k in v)&&typeof v.key==='string'&&v.key.length>0&&v.key.length<=2048&&int(v.at,0,Number.MAX_SAFE_INTEGER)&&['declarer','friend','defense'].includes(v.role as string)&&typeof v.won==='boolean'&&int(v.payoff,-1e9,1e9)&&int(v.teamPoints,0,20)&&obj(v.contract)&&Object.keys(v.contract).length===2&&(v.contract.trump===null||['Spade','Diamond','Heart','Club'].includes(v.contract.trump as string))&&int(v.contract.count,0,255);
}
function hands(value:unknown,legacy=false):HandRecord[] {
 if(!Array.isArray(value)||value.length>COMPLETION_LIMIT)throw Error('기록 형식을 확인할 수 없어요. 기존 데이터를 보존했어요.');
 const keys=new Set<string>(),result:HandRecord[]=[];
 for(const entry of value){
  // Old keys embedded entire replay JSON. They are used only for import dedup,
  // then replaced with opaque ordinal IDs; no replay bytes are persisted here.
  if(!obj(entry)||Object.keys(entry).length!==7||typeof entry.key!=='string'||entry.key.length===0||entry.key.length>MAX_RAW||!legacy&&!/^imported:[0-9]+$/.test(entry.key)&&!canonicalCompletionKey(entry.key))throw Error('기록 형식을 확인할 수 없어요.');
  const normalized={key:legacy?`imported:${result.length}`:entry.key,at:entry.at,role:entry.role,won:entry.won,payoff:entry.payoff,contract:entry.contract,teamPoints:entry.teamPoints};
  if(!validHand(normalized))throw Error('기록 형식을 확인할 수 없어요.');
  if(keys.has(entry.key)){if(legacy)continue;throw Error('중복된 기록이에요.');}keys.add(entry.key);result.push(normalized as HandRecord);
 }
 return result;
}
function awards(value:unknown):Record<string,number> {
 if(!obj(value)||Object.keys(value).length>ACHIEVEMENTS.length||Object.entries(value).some(([id,at])=>!known.has(id)||!int(at,0,Number.MAX_SAFE_INTEGER)))throw Error('업적 형식을 확인할 수 없어요. 기존 데이터를 보존했어요.');
 return Object.fromEntries(Object.entries(value)) as Record<string,number>;
}
function decode(raw:string):unknown {if(raw.length>MAX_RAW)throw Error('기록이 지원하는 크기를 넘었어요.');return JSON.parse(raw);}
function readBasis(storage:CompletionStorage):Basis|Exclude<DeviceRead,{status:'ready'}> {
 let raw:string|null,legacyStats:string|null=null,legacyAwards:string|null=null;
 try {raw=storage.getItem(COMPLETION_STORAGE_KEY);if(raw===null){legacyStats=storage.getItem(LEGACY_STATS);legacyAwards=storage.getItem(LEGACY_AWARDS);}}
 catch{return {status:'failed',message:'이 기기의 기록을 읽지 못했어요.'};}
 try {
  let records:DeviceRecords;
  if(raw===null)records={version:1,completed:[],hands:hands(legacyStats===null?[]:decode(legacyStats),true),unlocked:awards(legacyAwards===null?{}:decode(legacyAwards))};
  else {const value=decode(raw);if(!obj(value)||value.version!==1||Object.keys(value).length!==4||!('hands'in value)||!('unlocked'in value)||!Array.isArray(value.completed)||value.completed.length>COMPLETION_LIMIT||value.completed.some(key=>typeof key!=='string'||!canonicalCompletionKey(key))||new Set(value.completed).size!==value.completed.length)throw Error('지원하지 않는 기록 형식이에요.');records={version:1,completed:value.completed as string[],hands:hands(value.hands),unlocked:awards(value.unlocked)};if(records.hands.some(hand=>!hand.key.startsWith('imported:')&&!records.completed.includes(hand.key)))throw Error('Missing completion ledger entry');}
  return {raw,legacyStats,legacyAwards,records:ownRecords(records)};
 }catch{return {status:'unsupported',message:'기존 기록을 해석할 수 없어 그대로 보존했어요.'};}
}
function write(storage:CompletionStorage,basis:Basis,records:DeviceRecords,earnedIds:readonly string[],isCurrent:()=>boolean=()=>true):CompletionWrite {
 const current=()=>{try{return isCurrent()===true;}catch{return false;}};
 const retired=():CompletionWrite=>({status:'conflict',message:'기록 요청이 만료됐어요. 다시 확인해 주세요.'});
 if(!current())return retired();
 const raw=JSON.stringify(records);if(raw.length>MAX_RAW)return {status:'unsupported',message:'기록이 지원하는 크기를 넘었어요.'};
 try {
  if(storage.getItem(COMPLETION_STORAGE_KEY)!==basis.raw||(basis.raw===null&&(storage.getItem(LEGACY_STATS)!==basis.legacyStats||storage.getItem(LEGACY_AWARDS)!==basis.legacyAwards)))return {status:'conflict',message:'다른 창에서 기록이 바뀌었어요. 다시 확인해 주세요.'};
  if(!current())return retired();
  // One atomic localStorage item owns both statistics and awards. There is no
  // stats-written/awards-not-written state. This is not cross-tab CAS.
  storage.setItem(COMPLETION_STORAGE_KEY,raw);
  let confirmed:string|null;try{confirmed=storage.getItem(COMPLETION_STORAGE_KEY);}catch{return {status:'uncertain',message:'기록이 저장됐는지 확인하지 못했어요.'};}
  if(confirmed!==raw)return {status:'conflict',message:'저장 후 다른 창의 변경이 확인됐어요.'};
  return {status:'stored',records:ownRecords(records),earnedIds:copyFormData(earnedIds)};
 }catch{return {status:'failed',message:'이 기기에 기록을 저장하지 못했어요.'};}
}
function storageOrNull(storage?:CompletionStorage):CompletionStorage|null {try{return storage??localStorage;}catch{return null;}}
export function readDeviceRecords(storage?:CompletionStorage):DeviceRead {
 const target=storageOrNull(storage);if(!target)return {status:'failed',message:'이 기기의 기록을 읽지 못했어요.'};const basis=readBasis(target);return 'status'in basis?basis:{status:'ready',records:basis.records};
}
/** Pure summary predicates; no persisted card faces or game state. */
export function completionAwards(hand:HandRecord,tookWithMighty:boolean,history:readonly HandRecord[]):readonly string[] {
 const earned=new Set<string>(),{won,role}=hand,made=hand.teamPoints>=hand.contract.count;
 if(won)earned.add('first-win');if(won&&role==='declarer')earned.add('declarer-win');if(won&&role==='friend')earned.add('friend-win');if(won&&role==='defense')earned.add('defense');
 if(made&&role==='declarer'&&hand.contract.count>=17)earned.add('big-contract');if(made&&role!=='defense'&&hand.contract.trump===null)earned.add('no-trump');
 if(made&&role!=='defense'&&hand.teamPoints===20)earned.add('run');if(tookWithMighty)earned.add('mighty-take');
 const last=history.slice(-3);if(last.length===3&&last.every(h=>h.won))earned.add('streak3');if(history.length>=10)earned.add('ten');if(history.length>=50)earned.add('fifty');return [...earned];
}
export function storeCompletion(input:{readonly hand:HandRecord;readonly tookWithMighty:boolean;readonly alone:boolean},storage?:CompletionStorage):CompletionWrite {
 const target=storageOrNull(storage);if(!target)return {status:'failed',message:'이 기기의 기록을 읽지 못했어요.'};
 let hand:HandRecord;try{input=copyFormData(input);hand=input.hand;if(!validHand(hand)||!canonicalCompletionKey(hand.key)||typeof input.tookWithMighty!=='boolean'||typeof input.alone!=='boolean')throw Error();}catch{return {status:'unsupported',message:'이번 판의 기록을 확인할 수 없어요.'};}
 const basis=readBasis(target);if('status'in basis)return basis;
 if(basis.raw===null&&basis.records.hands.some(prior=>prior.role===hand.role&&prior.won===hand.won&&prior.payoff===hand.payoff&&prior.contract.trump===hand.contract.trump&&prior.contract.count===hand.contract.count&&prior.teamPoints===hand.teamPoints))return {status:'unsupported',message:'이전 형식의 기록과 이번 판을 구분할 수 없어 중복 저장하지 않았어요.'};
 if(basis.records.completed.includes(hand.key))return {status:'duplicate',records:basis.records,earnedIds:[]};
 const history=[...basis.records.hands,hand].slice(-COMPLETION_LIMIT),unlocked={...basis.records.unlocked},earned=new Set(completionAwards(hand,input.tookWithMighty,history));
 if(input.alone&&hand.role==='declarer'&&hand.won)earned.add('alone');
 const fresh=ACHIEVEMENTS.filter(item=>earned.has(item.id)&&!(item.id in unlocked)).map(item=>item.id);for(const id of fresh)unlocked[id]=hand.at;
 return write(target,basis,{version:1,completed:[...basis.records.completed,hand.key].slice(-COMPLETION_LIMIT),hands:history,unlocked},fresh);
}
/** Private host capability: the selected storage basis never enters a canonical
 * disclosure/form. Confirmation must commit precisely this observed basis. */
export type DeviceStatsDeletion=Exclude<DeviceRead,{status:'ready'}>|{
 readonly status:'ready';readonly records:DeviceRecords;
 commit(isCurrent?:()=>boolean):CompletionWrite;
};
export function captureDeviceStatsDeletion(storage?:CompletionStorage):DeviceStatsDeletion {
 const target=storageOrNull(storage);if(!target)return {status:'failed',message:'이 기기의 기록을 읽지 못했어요.'};
 const basis=readBasis(target);if('status'in basis)return basis;
 return Object.freeze({status:'ready' as const,records:basis.records,commit:(isCurrent?:()=>boolean)=>write(target,basis,{version:1,completed:basis.records.completed,hands:[],unlocked:basis.records.unlocked},[],isCurrent)});
}
/** The caller owns confirmation. Achievements and deduplication survive deletion. */
export function deleteDeviceStats(storage?:CompletionStorage):CompletionWrite {
 const captured=captureDeviceStatsDeletion(storage);return captured.status==='ready'?captured.commit():captured;
}

export interface CompletionIdentity {readonly roomId:string;readonly roomEpoch:string;readonly sessionId:number;readonly handNumber:number;readonly actorId:string;}
export function completionKey(identity:CompletionIdentity):string {
 const {roomId,roomEpoch,sessionId,handNumber,actorId}=identity;
 if([roomId,roomEpoch,actorId].some(id=>typeof id!=='string'||!id||id.length>128)||!int(sessionId,0,0xffffffff)||!int(handNumber,1,0xffffffff))throw Error('Invalid completion identity');
 return JSON.stringify(['mighty-completion',roomId,roomEpoch,sessionId,handNumber,actorId]);
}
function canonicalCompletionKey(key:string):boolean {try {const v=JSON.parse(key);return Array.isArray(v)&&v.length===6&&v[0]==='mighty-completion'&&completionKey({roomId:v[1],roomEpoch:v[2],sessionId:v[3],handNumber:v[4],actorId:v[5]})===key;}catch{return false;}}
