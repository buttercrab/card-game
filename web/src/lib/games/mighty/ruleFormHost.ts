import type {ConnectedHostFormResult} from '../../table/foundation/connected';
import {copyFormData,type FormSubmission} from '../../table/foundation/forms';
import {decodeLocalSavePayload} from './ruleForms';
import {saveCustomWithOutcome,type CustomSaveOutcome,type CustomSet} from './rulesets';
export const MIGHTY_SAVE_OPERATION='mighty:save-custom';
export type MightyRuleStorageSink=(set:Omit<CustomSet,'id'>&{id?:string},options:{expectedRaw:string|null})=>CustomSaveOutcome;
/** Fixed local operation only. No user-controlled key, URL or connection owner. */
export function saveMightyRuleForm(input:FormSubmission,save:MightyRuleStorageSink=saveCustomWithOutcome,continuation?:{resolve(token:string):unknown|null}):ConnectedHostFormResult{
    try{
        const submission=copyFormData(input);
        if(submission.policyId!=='mighty:rules:v1'||submission.operationId!==MIGHTY_SAVE_OPERATION||submission.actionId!=='save')return {status:'rejected',message:'지원하지 않는 저장 요청이에요.'};
        const payload=decodeLocalSavePayload(submission.payload);
        if(!payload||payload.operation!==MIGHTY_SAVE_OPERATION)return {status:'rejected',message:'규칙 저장 내용을 확인할 수 없어요.'};
        let expectedRaw:string|null;
        if(typeof payload.storageAuthority==='string'){
            const authority=copyFormData(continuation?.resolve(payload.storageAuthority)??null);
            if(!authority||typeof authority!=='object'||!('expectedRaw' in authority)||!(authority.expectedRaw===null||typeof authority.expectedRaw==='string'))return {status:'conflict',message:'저장 권한이 바뀌었어요. 다시 열어 확인해주세요.'};
            expectedRaw=authority.expectedRaw;
        }else {if(payload.expectedRaw!==null&&typeof payload.expectedRaw!=='string')return {status:'rejected'};expectedRaw=payload.expectedRaw;}
        const outcome=save(payload.set,{expectedRaw});
        return {status:outcome.status,...(outcome.status==='stored'?{authority:{data:{expectedRaw:outcome.raw},metadata:{savedId:outcome.set.id,sourceId:payload.sourceId}}}:{}),message:outcome.status==='stored'?'이 기기에 저장했어요.':outcome.status==='conflict'?'이 기기의 규칙 목록이 바뀌었어요. 다시 열어 확인해주세요.':outcome.status==='unsupported'?'기존 규칙 목록을 안전하게 읽을 수 없어 저장하지 않았어요.':'이 기기에 저장하지 못했어요. 저장 공간과 브라우저 권한을 확인해주세요.'};
    }catch{return {status:'failed',message:'이 기기에 저장하지 못했어요. 저장 공간과 브라우저 권한을 확인해주세요.'};}
}
