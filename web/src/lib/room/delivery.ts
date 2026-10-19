/** Closed socket contract from the bounded server outbound port. Reasons carry
 * no payload or credentials. Unknown close reasons retain ordinary recovery. */
import type {NativeResource,NativeCapacityReason} from '../generated/protocol';
const NATIVE_CAPACITY_RESOURCES={rooms:true,rules:true,settings:true,session:true,snapshot:true,hand_log:true,record:true,summary:true,chance_batch:true,archives:true,period_records:true,total_records:true,hand_number:true,session_number:true,game_version:true,room_version:true,score:true} as const satisfies Readonly<Record<NativeResource,true>>;
const NATIVE_CAPACITY_UNIT_REASONS={unsupported_profile:true,unreservable_legacy:true,serialization:true,invariant:true} as const satisfies Readonly<Record<Exclude<NativeCapacityReason['code'],'capacity'>,true>>;
export type DeliveryIssue='oversize'|'backpressure'|'capacity';
export const DELIVERY_NOTICES:Readonly<Record<DeliveryIssue,string>>=Object.freeze({oversize:'이 방의 데이터가 지원 범위를 넘어 연결할 수 없어요. 기록은 그대로 남아 있어요.',backpressure:'연결이 잠시 밀렸어요. 다시 연결할게요.',capacity:'이 방의 데이터가 지원 범위를 넘어 다시 열 수 없어요. 기록과 대기 중인 동작은 그대로 보관돼요.'});
export function deliveryIssue(event:Pick<CloseEvent,'code'|'reason'>|undefined):DeliveryIssue|null {
 return event?.code===1009&&event.reason==='outbound_message_limit'?'oversize':event?.code===1013&&event.reason==='outbound_backpressure'?'backpressure':null;
}
export function isNativeCapacityReason(value:unknown):boolean{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const fields=Object.getOwnPropertyDescriptors(value),keys=Object.keys(fields);
 if(keys.some(key=>!('value'in fields[key])))return false;
 const code=fields.code?.value;
 if(code==='capacity')return keys.length===3&&keys.every(key=>['code','resource','limit'].includes(key))&&
  typeof fields.resource?.value==='string'&&Object.hasOwn(NATIVE_CAPACITY_RESOURCES,fields.resource.value)&&
  Number.isSafeInteger(fields.limit?.value)&&fields.limit.value>=0;
 return keys.length===1&&typeof code==='string'&&Object.hasOwn(NATIVE_CAPACITY_UNIT_REASONS,code);
}

/** Only a bounded native refusal is permanent. Generic proxy 507 responses
 * remain transient, like 502, and never discard pending recovery evidence. */
export async function isNativeCapacityResponse(response:Response):Promise<boolean>{
 if(response.status!==507||!response.body)return false;
 const reader=response.body.getReader();let size=0,text='';const decoder=new TextDecoder();
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>4096)return false;text+=decoder.decode(value,{stream:true});}
  text+=decoder.decode();const body=JSON.parse(text),reason=body?.reason;
  if(body?.code!=='resource_capacity'||Object.keys(body).length!==2||reason===null||typeof reason!=='object')return false;
  return isNativeCapacityReason(reason);
 }catch{return false;}finally{try{await reader.cancel();}catch{/* The network may already be closed. */}reader.releaseLock();}
}
