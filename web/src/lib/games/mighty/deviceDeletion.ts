import {copyFormData,type FormOffer,type HostFormPolicy,type FormSubmission} from '../../table/foundation/forms';
import type {ConnectedHostFormResult} from '../../table/foundation/connected';
import type {CompletionWrite} from './completionStore';
import type {DisclosureSelectionReceipt} from '../../table/foundation/disclosures';
export const MIGHTY_DEVICE_DELETE_POLICY='mighty:device-delete:v1';
export const MIGHTY_DEVICE_DELETE_OPERATION='mighty:delete-device-stats';
export const MIGHTY_DEVICE_DELETE_FORM='mighty:delete-device-stats';
export interface DeviceDeleteAuthority {commit(isCurrent:()=>boolean):CompletionWrite;}
export function mightyDeviceDeleteForm(input:{selection:DisclosureSelectionReceipt;instanceId:string;token:string;seat:number|null;enabled:boolean}):FormOffer<never>{
 const {selection,instanceId,token,seat,enabled}=input;
 return {id:MIGHTY_DEVICE_DELETE_FORM,instanceId,schemaVersion:'mighty-device-delete-v1',policyId:MIGHTY_DEVICE_DELETE_POLICY,purpose:'confirmation',retry:'new-offer',access:{kind:'disclosure-selection',selectionId:selection.id},baseVersion:selection.revision,editBinding:instanceId,title:'이 기기의 플레이 기록을 삭제할까요?',help:'승률과 최근 판 기록을 삭제해요. 업적과 기존 판의 중복 저장 방지 정보는 그대로 남아요.',submitLabel:'기록 삭제',fields:[],binding:{roomId:selection.scope.roomId,actorId:selection.scope.actorId,seat,selectionId:selection.id,captureToken:token},enabled,actions:[{id:'delete',label:'기록 삭제',intent:'danger',target:{kind:'host',operationId:MIGHTY_DEVICE_DELETE_OPERATION},completion:'lock',basis:'current'}]};
}
function payload(offer:FormOffer<unknown>){
 if(offer.id!==MIGHTY_DEVICE_DELETE_FORM||offer.policyId!==MIGHTY_DEVICE_DELETE_POLICY||offer.purpose!=='confirmation'||offer.access?.kind!=='disclosure-selection'||offer.access.selectionId!==offer.binding.selectionId||typeof offer.binding.captureToken!=='string')throw Error('Invalid device deletion form');
 return {selectionId:offer.access.selectionId,captureToken:offer.binding.captureToken};
}
export const MIGHTY_DEVICE_DELETE_FORM_POLICY:HostFormPolicy={
 id:MIGHTY_DEVICE_DELETE_POLICY,access:'disclosure-selection',
 normalize(offer,values){payload(offer);return {values,issues:{}};},
 compile(offer){return payload(offer);},
};
/** Fixed local sink. The private capture is never copied into canonical data. */
export function deleteMightyDeviceStats(input:FormSubmission,continuation?:{resolve(token:string):unknown|null;isCurrent():boolean}):ConnectedHostFormResult{
 try{
  const submission=copyFormData(input),data=submission.payload;
  if(submission.policyId!==MIGHTY_DEVICE_DELETE_POLICY||submission.operationId!==MIGHTY_DEVICE_DELETE_OPERATION||submission.actionId!=='delete'||submission.formId!==MIGHTY_DEVICE_DELETE_FORM||submission.access?.kind!=='disclosure-selection'||!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==2||!('selectionId'in data)||data.selectionId!==submission.access.selectionId||!('captureToken'in data)||typeof data.captureToken!=='string')return {status:'rejected',message:'기록 삭제 요청을 확인할 수 없어요.'};
  if(!continuation?.isCurrent())return {status:'conflict',message:'기록 삭제 요청이 만료됐어요. 다시 열어 확인해주세요.'};
  const authority=continuation.resolve(data.captureToken) as DeviceDeleteAuthority|null;
  if(!authority||typeof authority.commit!=='function'||!continuation.isCurrent())return {status:'conflict',message:'기록 삭제 요청이 만료됐어요. 다시 열어 확인해주세요.'};
  const result=authority.commit(continuation.isCurrent);
  if(!continuation.isCurrent())return {status:'uncertain',message:'현재 화면에서 기록 삭제 결과를 확인할 수 없어요. 다시 열어 확인해주세요.'};
  return {status:result.status==='stored'?'stored':result.status==='duplicate'?'conflict':result.status,message:result.status==='stored'?'플레이 기록을 삭제했어요. 업적은 그대로 보관돼요.':'message'in result?result.message:'기록을 다시 열어 확인해주세요.'};
 }catch{return {status:'failed',message:'이 기기의 기록을 삭제하지 못했어요.'};}
}
