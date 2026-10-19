import {cloneAssistanceData} from '../../table/foundation/assistance';
import {projectMightyHistory,type MightyHistoryProjection,type MightyHistoryInput} from './history';

/** Host revision changes for ANY catalog content replacement, including same-count
 * edits. A hand count alone is not an authority revision. */
export interface MightyHistoryCatalogIdentity {readonly roomId:string;readonly roomEpoch:string;readonly actorId:string;readonly revision:string;}
export interface MightyHistoryCatalogInput {
 readonly identity:MightyHistoryCatalogIdentity;
 readonly current:{readonly sessionId:number;readonly records?:unknown;readonly summary?:unknown};
 readonly archives?:unknown;
 readonly page?:number;
}
export interface MightyHistoryCatalogSession {readonly id:string;readonly sessionId:number;readonly title:string;readonly current:boolean;readonly entryCount:number;readonly recordCount:number;readonly summaryOnly:boolean;}
export interface MightyHistorySelection {readonly identity:MightyHistoryCatalogIdentity;readonly entryId:string;readonly sessionId:number;readonly recordIndex:number|null;}
export interface MightyHistoryCatalogEntry {readonly id:string;readonly sessionId:number;readonly kind:'record'|'summary-only'|'malformed';readonly handNumber?:number;readonly title:string;readonly names:readonly string[];readonly selection:MightyHistorySelection;}
export type MightyHistoryCatalog={readonly status:'ready';readonly identity:MightyHistoryCatalogIdentity;readonly page:number;readonly pageCount:number;readonly pageSize:12;readonly totalEntries:number;readonly sessions:readonly MightyHistoryCatalogSession[];readonly entries:readonly MightyHistoryCatalogEntry[]}|
 {readonly status:'unavailable';readonly reason:'malformed'|'too-large';readonly message:string};
/** entryId is the disclosure/cache identity. replay.id is semantic hand lineage
 * only and can coincide for malformed-source duplicate hand-number rows. */
export type MightyHistoryResolution={readonly status:'selected';readonly entryId:string;readonly replay:MightyHistoryProjection}|
 {readonly status:'unavailable';readonly reason:'stale'|'malformed'|'summary-only';readonly message:string};
export type MightyHistorySourceResolution={readonly status:'selected';readonly entryId:string;readonly source:MightyHistoryInput}|Extract<MightyHistoryResolution,{status:'unavailable'}>;
const PAGE_SIZE=12,MAX_SESSIONS=128,MAX_RECORDS=4096,MAX_TOTAL=16384;
class CatalogLimit extends Error {}
function plain(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);}
/** Read only requested data descriptors. In particular never touch record.view. */
function field(value:unknown,key:string):unknown {
 if(!value||typeof value!=='object')throw Error('Invalid catalog object');
 const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor)return undefined;if(!('value'in descriptor))throw Error('Catalog accessors are unsupported');return descriptor.value;
}
function length(value:unknown,max:number):number {
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)throw Error('Invalid catalog list');
 const size=field(value,'length');if(typeof size!=='number'||!Number.isSafeInteger(size)||size<0)throw Error('Invalid catalog size');if(size>max)throw new CatalogLimit();return size;
}
const natural=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
function identity(value:unknown):MightyHistoryCatalogIdentity {
 const owned=cloneAssistanceData(value);if(!plain(owned)||Object.keys(owned).length!==4||!['roomId','roomEpoch','actorId','revision'].every(key=>text(owned[key],128)))throw Error('Invalid catalog identity');return owned as unknown as MightyHistoryCatalogIdentity;
}
const sameIdentity=(a:MightyHistoryCatalogIdentity,b:MightyHistoryCatalogIdentity)=>a.roomId===b.roomId&&a.roomEpoch===b.roomEpoch&&a.actorId===b.actorId&&a.revision===b.revision;
function summaryPresent(summary:unknown):boolean {
 if(summary===null||summary===undefined)return false;if(!plain(summary))throw Error('Invalid summary');
 const count=field(summary,'hands_played');if(count!==undefined&&!natural(count))throw Error('Invalid summary count');
 const hands=field(summary,'hands'),history=field(summary,'history');
 const handCount=hands===undefined?0:length(hands,MAX_TOTAL),historyCount=history===undefined?0:length(history,MAX_TOTAL);
 return !!count||handCount>0||historyCount>0;
}
interface IndexedSession {sessionId:number;current:boolean;records:unknown;recordCount:number;summaryOnly:boolean;entryCount:number;}
function index(source:MightyHistoryCatalogInput):{scope:MightyHistoryCatalogIdentity;sessions:IndexedSession[];total:number}{
 if(!plain(source))throw Error('Invalid catalog input');const scope=identity(field(source,'identity')),current=field(source,'current'),archives=field(source,'archives');
 if(!plain(current))throw Error('Invalid current session');const currentId=field(current,'sessionId');if(!natural(currentId))throw Error('Invalid current session id');
 const archiveCount=archives===undefined?0:length(archives,MAX_SESSIONS-1),sessions:IndexedSession[]=[],seen=new Set<number>();let total=0;
 function add(value:unknown,sessionId:number,isCurrent:boolean){
  if(!plain(value)||seen.has(sessionId))throw Error('Invalid session identity');seen.add(sessionId);
  const records=field(value,'records'),recordCount=records===undefined||records===null?0:length(records,MAX_RECORDS);
  const summaryOnly=recordCount===0&&summaryPresent(field(value,'summary'));
  const entryCount=recordCount||Number(summaryOnly);total+=entryCount;if(total>MAX_TOTAL)throw new CatalogLimit();
  sessions.push({sessionId,current:isCurrent,records,recordCount,summaryOnly,entryCount});
 }
 add(current,currentId,true);
 // Server archives append oldest first. The catalog presents the latest period first.
 for(let i=archiveCount-1;i>=0;i--){const archive=field(archives,String(i));if(!plain(archive))throw Error('Invalid archive');const sessionId=field(archive,'id');if(!natural(sessionId))throw Error('Invalid archive id');add(archive,sessionId,false);}
 return {scope,sessions,total};
}
function names(value:unknown):readonly string[]{
 if(value===undefined)return [];const count=length(value,8),result:string[]=[];
 for(let i=0;i<count;i++){const name=field(value,String(i));if(!text(name,128))throw Error('Invalid recorded name');result.push(name);}return Object.freeze(result);
}
function metadata(scope:MightyHistoryCatalogIdentity,session:IndexedSession,recordIndex:number|null):MightyHistoryCatalogEntry {
 if(recordIndex===null){const id=JSON.stringify(['mighty-history-summary',scope.roomId,scope.roomEpoch,session.sessionId]);return {id,sessionId:session.sessionId,kind:'summary-only',title:'요약만 남은 기록',names:[],selection:{identity:scope,entryId:id,sessionId:session.sessionId,recordIndex:null}};}
 let number:unknown,recordNames:readonly string[]=[];
 try {const record=field(session.records,String(recordIndex));if(!plain(record))throw Error();const origin=field(record,'session_id');if(origin!==undefined&&(!natural(origin)||origin!==session.sessionId))throw Error('Record origin disagrees with containing period');number=field(record,'number');if(!natural(number)||number<1)throw Error();recordNames=names(field(record,'names'));}
 catch {number=undefined;}
 const valid=typeof number==='number',id=valid?JSON.stringify(['mighty-history-entry',scope.roomId,scope.roomEpoch,session.sessionId,recordIndex,number]):JSON.stringify(['mighty-history-invalid',scope.roomId,scope.roomEpoch,session.sessionId,recordIndex]);
 return {id,sessionId:session.sessionId,kind:valid?'record':'malformed',...(typeof number==='number'?{handNumber:number}:{}),title:valid?`${number}판 기록`:'읽을 수 없는 기록',names:recordNames,selection:{identity:scope,entryId:id,sessionId:session.sessionId,recordIndex}};
}
/** Count/index touches only headers. At most twelve record metadata rows are read. */
export function createMightyHistoryCatalog(source:MightyHistoryCatalogInput):MightyHistoryCatalog {
 try {
  const {scope,sessions,total}=index(source),requested=field(source,'page');if(requested!==undefined&&!natural(requested))throw Error('Invalid catalog page');
  const pageCount=Math.ceil(total/PAGE_SIZE),page=Math.min(requested as number??0,Math.max(0,pageCount-1)),start=page*PAGE_SIZE,end=Math.min(total,start+PAGE_SIZE),entries:MightyHistoryCatalogEntry[]=[];let offset=0;
  for(const session of sessions){const from=Math.max(0,start-offset),until=Math.min(session.entryCount,end-offset);for(let entry=from;entry<until;entry++)entries.push(metadata(scope,session,session.summaryOnly?null:session.recordCount-1-entry));offset+=session.entryCount;if(offset>=end)break;}
  if(new Set(entries.map(entry=>entry.id)).size!==entries.length)throw Error('Duplicate historical hand identity');
  return cloneAssistanceData({status:'ready',identity:scope,page,pageCount,pageSize:PAGE_SIZE,totalEntries:total,sessions:sessions.map(session=>({id:JSON.stringify(['mighty-history-session',scope.roomId,scope.roomEpoch,session.sessionId]),sessionId:session.sessionId,title:session.current?'현재 기록':`${session.sessionId}번째 기록`,current:session.current,entryCount:session.entryCount,recordCount:session.recordCount,summaryOnly:session.summaryOnly})),entries});
 }catch(error){return Object.freeze({status:'unavailable',reason:error instanceof CatalogLimit?'too-large':'malformed',message:error instanceof CatalogLimit?'기록이 지원 범위를 넘어 일부를 추측해 표시하지 않았어요.':'기록 목록을 안전하게 읽을 수 없어요.'});}
}
/** A captured selected public snapshot can then remain open independently of live play.
 * A new resolution always requires the current catalog identity; no live cache fallback. */
export function resolveMightyHistorySource(source:MightyHistoryCatalogInput,captured:MightyHistorySelection):MightyHistorySourceResolution {
 try {
  const selection=cloneAssistanceData(captured),{scope,sessions}=index(source);
  if(!plain(selection)||Object.keys(selection).length!==4||!sameIdentity(identity(selection.identity),scope))return Object.freeze({status:'unavailable',reason:'stale',message:'기록 목록이 바뀌었어요. 다시 선택해주세요.'});
  if(!natural(selection.sessionId)||!(selection.recordIndex===null||natural(selection.recordIndex)))throw Error('Invalid selection');
  const session=sessions.find(item=>item.sessionId===selection.sessionId);if(!session)throw Error('Unknown selected session');if(selection.recordIndex===null?!session.summaryOnly:selection.recordIndex>=session.recordCount)throw Error('Unknown selected record');
  const entry=metadata(scope,session,selection.recordIndex);if(entry.id!==selection.entryId)throw Error('Changed selected record');
  if(entry.kind==='summary-only')return Object.freeze({status:'unavailable',reason:'summary-only',message:'요약만 남아 있어 라운드 기록을 볼 수 없어요.'});
  if(entry.kind==='malformed'||entry.handNumber===undefined)throw Error('Malformed selected record');
  const record=field(session.records,String(selection.recordIndex));
  // Host-only transient source: the strict disclosure/history builder must own
  // and validate this single record inside its captured read transaction.
  // Never publish or retain this native reference as a disclosure document.
  return Object.freeze({status:'selected',entryId:entry.id,source:Object.freeze({identity:Object.freeze({roomId:scope.roomId,roomEpoch:scope.roomEpoch,sessionId:session.sessionId,handNumber:entry.handNumber}),record})});
 }catch{return Object.freeze({status:'unavailable',reason:'malformed',message:'선택한 기록을 안전하게 읽을 수 없어요.'});}
}

/** Strict public replay convenience; uses the same selected-source authority as
 * the disclosure provider, without a second catalog scan or record copy. */
export function resolveMightyHistoryEntry(source:MightyHistoryCatalogInput,captured:MightyHistorySelection):MightyHistoryResolution {
 const selected=resolveMightyHistorySource(source,captured);
 return selected.status==='selected'?Object.freeze({status:'selected',entryId:selected.entryId,replay:projectMightyHistory(selected.source)}):selected;
}
