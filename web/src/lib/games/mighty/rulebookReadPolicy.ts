import type {ConnectedDisclosureContext} from '../../table/foundation/connectedDisclosures';
import {ownDisclosureOffer,type DisclosureCatalogOffer,type DisclosureReadPolicy,type DisclosureScope} from '../../table/foundation/disclosures';
import {copyFormData} from '../../table/foundation/forms';
import {createMightyRulebook,mightyRulebookKey} from './rulebookMeaning';
import {validateMightyEditorRules} from './ruleValidation';
import type {Mighty,Rules} from './types';

export const MIGHTY_RULEBOOK_CATALOG='mighty:rulebook';
export const MIGHTY_RULEBOOK_POLICY='mighty:rulebook:v1';
export const MIGHTY_RULEBOOK_ENTRY='mighty:rulebook:current';
const BYTE_LIMIT=64*1024,REQUEST_TIMEOUT=3000;
interface Capture {readonly revision:string;readonly identity:string;readonly rulesKey:string;readonly rules:Rules;readonly scope:DisclosureScope;}
const abort=()=>new DOMException('Rulebook read retired','AbortError');
const offer=(capture:Capture):DisclosureCatalogOffer=>({id:MIGHTY_RULEBOOK_CATALOG,policyId:MIGHTY_RULEBOOK_POLICY,revision:capture.revision,title:'마이티 규칙',description:'현재 테이블의 규칙 설명과 서버 계산 예시',total:1,pageSize:12,scope:capture.scope});
async function boundedText(response:Response):Promise<string>{
 const length=response.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>BYTE_LIMIT)){await response.body?.cancel();throw Error('Rulebook response capacity');}
 if(!response.body)throw Error('Missing rulebook response');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,text='';
 try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>BYTE_LIMIT)throw Error('Rulebook response capacity');text+=decoder.decode(chunk.value,{stream:true});}return text+decoder.decode();}
 finally{try{await reader.cancel();}catch{/* Network may already be closed. */}reader.releaseLock();}
}
/** Fixed read-only host I/O. The canonical reader supplies cancellation and
 * admission; no fetch occurs in projection, paging or device/history reads. */
export function createMightyRulebookReadOwner(fetcher:typeof fetch=globalThis.fetch){
 let current:Capture|null=null,disposed=false,epoch=0,sequence=0;
 let outstanding:{readonly capture:Capture;readonly controller:AbortController}|null=null;
 function retire(){epoch++;current=null;const previous=outstanding;previous?.controller.abort();}
 function capture(request:DisclosureCatalogOffer):Capture{
  const owned=ownDisclosureOffer(request),value=current;
  if(disposed||!value||JSON.stringify(owned)!==JSON.stringify(offer(value)))throw Error('Rulebook grant expired');return value;
 }
 const policy:DisclosureReadPolicy={id:MIGHTY_RULEBOOK_POLICY,
  page(request,page){const value=capture(request);if(page!==0)throw Error('Invalid rulebook page');return {catalogId:request.id,revision:value.revision,page:0,total:1,pageSize:12,entries:[{id:MIGHTY_RULEBOOK_ENTRY,title:'규칙 설명과 계산 예시'}]};},
  async select(request,entryId,options){
   const value=capture(request),signal=options?.signal;
   if(entryId!==MIGHTY_RULEBOOK_ENTRY||!signal||signal.aborted||outstanding)throw Error('Rulebook read unavailable');
   const controller=new AbortController(),ticket={capture:value,controller},token=epoch;outstanding=ticket;
   const cancel=()=>controller.abort();signal.addEventListener('abort',cancel,{once:true});
   const timer=setTimeout(cancel,REQUEST_TIMEOUT);
   try{
    if(disposed||current!==value||epoch!==token||signal.aborted)throw abort();
    const body=JSON.stringify(value.rules);if(new TextEncoder().encode(body).byteLength>BYTE_LIMIT)throw Error('Rulebook request capacity');
    const response=await fetcher('/api/games/mighty/rules/examples',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:controller.signal});
    if(!response.ok||controller.signal.aborted){await response.body?.cancel();throw Error('Rulebook request unavailable');}
    const data=JSON.parse(await boundedText(response));
    if(disposed||current!==value||epoch!==token||signal.aborted)throw abort();
    if(controller.signal.aborted)throw Error('Rulebook request deadline');
    return createMightyRulebook({entryId,rules:value.rules,examples:{status:'ready',rulesKey:value.rulesKey,value:data}});
   }catch{
    if(disposed||current!==value||epoch!==token||signal.aborted)throw abort();
    // A network/schema/capacity refusal never fabricates worked examples.
    return createMightyRulebook({entryId,rules:value.rules,examples:{status:'unavailable'}});
   }finally{clearTimeout(timer);signal.removeEventListener('abort',cancel);if(outstanding===ticket)outstanding=null;}
  },
 };
 return {policy,
  project(input:ConnectedDisclosureContext<Mighty>):DisclosureCatalogOffer|null{
   const room=input.client.room,scope=input.roomScope;
   if(disposed||!room||room.game!=='mighty'||scope.domain!=='room'||room.id!==scope.room_id||scope.actor_id!==input.client.viewerId||scope.seat!==input.client.seat||scope.session_id!==room.session_id||!input.connectionEpoch){retire();return null;}
   try{
    const rules=validateMightyEditorRules(room.rules),rulesKey=mightyRulebookKey(rules);
    const identity=JSON.stringify([room.id,scope.room_epoch,scope.session_id,scope.actor_id,input.connectionEpoch,rulesKey]);
    if(current?.identity===identity)return offer(current);
    const token=++epoch;current=null;outstanding?.controller.abort();
    if(disposed||epoch!==token||sequence>=Number.MAX_SAFE_INTEGER)return null;
    current={identity,rulesKey,rules:copyFormData(rules),revision:`rulebook:${++sequence}`,scope:{roomId:room.id,roomEpoch:scope.room_epoch,actorId:scope.actor_id,connectionEpoch:input.connectionEpoch,visibility:'public'}};
    return offer(current);
   }catch{retire();return null;}
  },
  revoke:retire,
  dispose(){if(disposed)return;disposed=true;retire();},
 };
}
