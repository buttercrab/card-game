import {expect,test} from 'vitest';
import {createHostFormContinuations} from './hostFormContinuations';
import type {FormSubmission} from './forms';
const submission=():FormSubmission=>({id:'op1',instanceId:'native1',offerInstanceId:'offer1',formId:'rules',policyId:'rules1',actionId:'save',operationId:'save-local',binding:{actorId:'actor',roomId:'room',seat:0},context:{session:'room',audience:'actor',generation:'hand1',revision:'1'},payload:{}});
test('opaque evidence is owned, bounded and scoped to the same form/action/actor lineage',()=>{
 let serial=0;const registry=createHostFormContinuations(()=>`token${++serial}`),source=submission(),data={expectedRaw:'private',savedId:'saved'};
 const first=registry.issue(source,data,{savedId:'saved'});data.expectedRaw='mutated';expect(first).toEqual({token:'token1',savedId:'saved'});expect(JSON.stringify(first)).not.toContain('private');
 const next={...source,id:'op2',context:{...source.context,generation:'hand2',revision:'2'}};expect(registry.resolve(next,first.token)).toEqual({expectedRaw:'private',savedId:'saved'});
 const leaked=registry.resolve(next,first.token) as typeof data;expect(()=>{leaked.expectedRaw='mutated';}).toThrow();expect(registry.resolve(next,first.token)).toEqual({expectedRaw:'private',savedId:'saved'});
 for(const foreign of [{...next,actionId:'apply'},{...next,offerInstanceId:'other'},{...next,binding:{...next.binding,actorId:'other'}},{...next,context:{...next.context,audience:'other'}}])expect(registry.resolve(foreign,first.token)).toBeNull();
 const second=registry.issue(next,{expectedRaw:'new'},{savedId:'saved'});expect(registry.size).toBe(1);expect(registry.resolve(next,first.token)).toBeNull();expect(registry.resolve(next,second.token)).toEqual({expectedRaw:'new'});registry.clear();expect(registry.size).toBe(0);expect(registry.resolve(next,second.token)).toBeNull();
});
test('failed issuance cannot replace existing evidence and distinct owners are bounded',()=>{
 let serial=0;const registry=createHostFormContinuations(()=>`token${++serial}`),source=submission();const first=registry.issue(source,{raw:'original'},{});
 expect(()=>registry.issue(source,{raw:'x'.repeat(65537)},{})).toThrow();expect(registry.resolve(source,first.token)).toEqual({raw:'original'});
 expect(()=>registry.issue(source,{}, {token:'forged'})).toThrow();
 for(let i=1;i<16;i++)registry.issue({...source,offerInstanceId:`offer${i+1}`},{},{});expect(registry.size).toBe(16);expect(()=>registry.issue({...source,offerInstanceId:'overflow'},{},{})).toThrow();
});
