import {expect,test,vi} from 'vitest';
import type {FormSubmission} from '../../table/foundation/forms';
import {MIGHTY} from './catalog';
import {saveMightyRuleForm,MIGHTY_SAVE_OPERATION} from './ruleFormHost';
const submission=():FormSubmission=>({id:'form-op-1',instanceId:'editor-1',policyId:'mighty:rules:v1',actionId:'save',operationId:MIGHTY_SAVE_OPERATION,context:{session:'room',audience:'actor',generation:'1',revision:'1'},binding:{roomId:'room',actorId:'actor',seat:0},payload:{operation:MIGHTY_SAVE_OPERATION,set:{name:'우리 규칙',base:MIGHTY.presets[0].id,rules:structuredClone(MIGHTY.rule_defaults)},expectedRaw:null,sourceId:'s0'}});
test('fixed save sink preserves truthful stored, failed, conflict and unsupported outcomes',()=>{
 for(const status of ['stored','failed','conflict','unsupported'] as const){const save=vi.fn(()=>status==='stored'?{status,set:{...(submission().payload as any).set,id:'saved'},raw:JSON.stringify([{...(submission().payload as any).set,id:'saved'}])}:{status});const result=saveMightyRuleForm(submission(),save);expect(result.status).toBe(status);expect(save).toHaveBeenCalledTimes(1);expect(save.mock.calls[0]).toEqual([(submission().payload as any).set,{expectedRaw:null}]);}
});
test('wrong fixed operation, malformed payload and invalid custom catalog cannot reach storage',()=>{
 for(const input of [{...submission(),operationId:'other'},{...submission(),actionId:'apply'},{...submission(),policyId:'other'},{...submission(),payload:{...submission().payload as object,expectedRaw:'not JSON'}}]){const save=vi.fn();expect(saveMightyRuleForm(input,save).status).toBe('rejected');expect(save).not.toHaveBeenCalled();}
});
test('storage exceptions remain failed without claiming persistence',()=>{expect(saveMightyRuleForm(submission(),()=>{throw new Error('denied');}).status).toBe('failed');});
test('continued Save resolves only its exact opaque evidence and returns new exact written bytes',()=>{
 const original=submission(),payload=original.payload as any;const continued={...original,payload:{operation:payload.operation,set:{...payload.set,id:'saved'},sourceId:'s0',storageAuthority:'opaque'}};
 const raw=JSON.stringify([{...payload.set,id:'saved'}]),save=vi.fn(()=>({status:'stored' as const,set:{...payload.set,id:'saved'},raw}));
 const resolve=vi.fn((token:string)=>token==='opaque'?{expectedRaw:'exact prior bytes'}:null);
 expect(saveMightyRuleForm(continued,save,{resolve})).toMatchObject({status:'stored',authority:{data:{expectedRaw:raw},metadata:{savedId:'saved',sourceId:'s0'}}});expect(resolve).toHaveBeenCalledWith('opaque');expect(save.mock.calls[0]).toEqual([continued.payload.set,{expectedRaw:'exact prior bytes'}]);
 const denied=vi.fn();expect(saveMightyRuleForm(continued,denied,{resolve:()=>null}).status).toBe('conflict');expect(denied).not.toHaveBeenCalled();
});
test('failed Save never issues continuation evidence',()=>{
 for(const status of ['failed','conflict','unsupported'] as const){const result=saveMightyRuleForm(submission(),()=>({status}));expect(result.status).toBe(status);expect(result.authority).toBeUndefined();}
});
