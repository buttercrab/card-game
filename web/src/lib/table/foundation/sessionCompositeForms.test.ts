import { describe, expect, it, vi } from 'vitest';
import { createCardSession } from './session';
import { validateFormValues, type CompositeFormPolicy, type FormCompiledAction, type FormDraftSnapshot, type FormEdit, type FormOffer, type FormReduction, type FormValues } from './forms';
import type { SessionSnapshot, TableDocument } from './contracts';

type Action={readonly kind:'apply';readonly amount:number;readonly flag:boolean;readonly version:number}|{readonly kind:'ping'};
const form=(version=1,amount=1,flag=false):FormOffer<Action>=>({id:'settings',instanceId:'settings:actor',schemaVersion:'1',policyId:'settings:v1',baseVersion:`base:${amount}:${flag}`,editBinding:'room:actor:settings',title:'Settings',submitLabel:'Apply',enabled:true,
 binding:{room:'room',actor:'actor',storage:'catalog:1'},model:{amount,flag},fields:[{id:'amount',label:'Amount',kind:'number',required:true,initial:String(amount),min:0,max:10,step:1,maxCodePoints:4,maxCodeUnits:4},{id:'flag',label:'Flag',kind:'toggle',required:true,initial:flag}],actions:[
  {id:'apply',label:'Apply',target:{kind:'command',actionId:'settings:apply',template:{kind:'apply',amount,flag,version}},completion:'lock',basis:'current'},
  {id:'save',label:'Save locally',target:{kind:'host',operationId:'local:settings'},completion:'continue',basis:'draft'},
 ]});
const document=(version=1,amount=1,flag=false):TableDocument<Action>=>({context:{session:'s',audience:'actor',generation:'g',revision:String(version)},participant:{id:'actor',name:'Actor',markers:[]},hand:[],facts:[],forms:[form(version,amount,flag)],decision:{id:'game',kind:'commands',commands:['ping']},offer:{id:`offer:${version}`,actions:[{id:'ping',kind:'command',label:'Ping',intent:'secondary',enabled:true,action:{kind:'ping'}}]}});
const model=(offer:FormOffer)=>offer.model as {amount:number;flag:boolean};
const makePolicy=():CompositeFormPolicy<Action>=>({id:'settings:v1',kind:'actions',
 reduce(offer,previous,edit){const values:Record<string,string|boolean>=edit.kind==='initialize'?previous:edit.kind==='reset-all'?Object.fromEntries(offer.fields.map(field=>[field.id,field.initial])):edit.kind==='reset-field'?{...previous,[edit.fieldId]:offer.fields.find(field=>field.id===edit.fieldId)!.initial}:{...previous,[edit.fieldId]:edit.value};return {values,visibility:{amount:true,flag:true},enabled:{amount:true,flag:true},issues:validateFormValues(offer,values),changedFields:Object.keys(values).filter(key=>values[key]!==previous[key])};},
 normalize(offer,values){return {values,issues:validateFormValues(offer,values)};},
 compile(offer,values,actionId){const amount=Number(values.amount),flag=values.flag===true;if(actionId==='save')return {kind:'host',payload:{name:'Custom',settings:{amount,flag}}};const action=offer.actions!.find(action=>action.id==='apply')!;if(action.target.kind!=='command'||action.target.template.kind!=='apply')throw Error('bad template');return {kind:'command',action:{...action.target.template,amount,flag}};},
 validateCompiled(_offer,candidate,actionId){return candidate.kind===(actionId==='save'?'host':'command');},
 expectedResult(_offer,action){if(action.kind!=='apply')throw Error('unexpected action');return {amount:action.amount,flag:action.flag};},
 matchesResult(offer,expected){const wanted=expected as {amount:number;flag:boolean};return model(offer).amount===wanted.amount&&model(offer).flag===wanted.flag;},
});
const context=(session:{snapshot():SessionSnapshot<Action>})=>session.snapshot().document!.context;
const fixture=(policy=makePolicy())=>{
 let source:FormDraftSnapshot={values:{amount:'3',flag:true},revision:1,compositionEpoch:0,composing:false};
 const send=vi.fn(),save=vi.fn(),session=createCardSession<Action>({transport:send,formTransport:save,formPolicies:[policy]});session.receive(document());const port=session.bindForm(form().instanceId,()=>source);
 return {session,port,send,save,policy,get source(){return source;},replace(values:FormValues){source={...source,values,revision:source.revision+1};},setSource(value:FormDraftSnapshot){source=value;}};
};

describe('composite form transactions and independent outcomes',()=>{
 it('keeps Apply receipts independent from local Save and permits a new save only after a new draft revision',async()=>{
  const f=fixture();expect(f.port.commit(context(f.session),'settings','save')).toBe(true);await Promise.resolve();const saved=f.save.mock.calls[0][0];expect(saved).toMatchObject({actionId:'save',operationId:'local:settings',payload:{name:'Custom',settings:{amount:3,flag:true}}});expect(f.send).not.toHaveBeenCalled();expect(f.session.resolveForm(saved.id,'stored','Saved')).toBe(true);
  expect(f.port.commit(context(f.session),'settings','save')).toBe(false);expect(f.port.commit(context(f.session),'settings','apply')).toBe(true);await Promise.resolve();const applied=f.send.mock.calls[0][0];expect(f.session.resolve(applied.id,'accepted')).toBe(true);
  expect(f.session.snapshot().formOperations).toEqual(expect.arrayContaining([expect.objectContaining({actionId:'save',status:'stored'}),expect.objectContaining({actionId:'apply',status:'accepted'})]));
  f.replace({amount:'4',flag:true});expect(f.port.commit(context(f.session),'settings','save')).toBe(true);await Promise.resolve();expect(f.save).toHaveBeenCalledTimes(2);expect(f.save.mock.calls[1][0].payload.settings.amount).toBe(4);expect(f.send).toHaveBeenCalledTimes(1);
 });
 it('can explicitly save its captured draft after a foreign table base changes while Apply remains revoked',async()=>{
  const f=fixture();f.session.receive(document(2,7,false));expect(f.port.renew(context(f.session),'settings')).toBe(false);expect(f.port.commit(context(f.session),'settings','apply')).toBe(false);expect(f.port.commit(context(f.session),'settings','save')).toBe(true);await Promise.resolve();expect(f.send).not.toHaveBeenCalled();expect(f.save).toHaveBeenCalledTimes(1);expect(f.save.mock.calls[0][0].payload.settings).toEqual({amount:3,flag:true});expect(f.source.values).toEqual({amount:'3',flag:true});
 });
 it('does not permit disposed or actor-revoked sources to save retained drafts',async()=>{
  for(const revoke of ['dispose','actor','revoke']){const f=fixture();if(revoke==='dispose')f.port.dispose();else if(revoke==='revoke'){f.session.revoke();f.session.receive(document(2));}else f.session.receive({...document(2),context:{...document(2).context,audience:'other'}});expect(f.port.commit(context(f.session),'settings','save')).toBe(false);await Promise.resolve();expect(f.save).not.toHaveBeenCalled();}
 });
 it('retains invalid numeric intermediates during unrelated reducer edits without emitting an action',()=>{
  const f=fixture();f.replace({amount:'-',flag:false});const result=f.port.reduce({fieldId:'flag',value:true});expect(result).toMatchObject({values:{amount:'-',flag:true},issues:{amount:expect.any(String)},changedFields:['flag']});expect(f.source.values).toEqual({amount:'-',flag:false});expect(f.port.commit(context(f.session),'settings','apply')).toBe(false);expect(f.send).not.toHaveBeenCalled();expect(f.save).not.toHaveBeenCalled();
 });
 it('rejects reducer reentry and draft mutation atomically',()=>{
  const f=fixture(),base=f.policy.reduce;let calls=0;f.policy.reduce=(offer,values,edit)=>{calls++;expect(f.port.reduce({fieldId:'flag',value:false})).toBe(null);const result=base(offer,values,edit);f.replace({amount:'5',flag:false});return result;};expect(f.port.reduce({fieldId:'flag',value:true})).toBe(null);expect(calls).toBe(1);expect(f.source.values).toEqual({amount:'5',flag:false});expect(f.send).not.toHaveBeenCalled();
 });
 it('rejects a reduction if policy reentry replaces the canonical form basis',()=>{
  const f=fixture(),base=f.policy.reduce;f.policy.reduce=(offer,values,edit)=>{const result=base(offer,values,edit);f.session.receive(document(2,8,false));return result;};expect(f.port.reduce({fieldId:'flag',value:false})).toBe(null);expect(f.source.values).toEqual({amount:'3',flag:true});
 });
 it('does not revive captured local saving after its schema or storage binding becomes incompatible',()=>{
  for(const change of ['schema','storage','operation']){const f=fixture(),next=document(2,7,false),offered=next.forms![0];const replacement=change==='schema'?{...offered,schemaVersion:'2'}:change==='storage'?{...offered,binding:{...offered.binding,storage:'catalog:2'}}:{...offered,actions:offered.actions!.map(action=>action.id==='save'?{...action,target:{kind:'host' as const,operationId:'other:save'}}:action)};f.session.receive({...next,forms:[replacement]});expect(f.port.commit(context(f.session),'settings','save')).toBe(false);expect(f.save).not.toHaveBeenCalled();}
 });
 it('rejects asynchronous, incomplete or malformed reduction output without changing the draft',()=>{
  for(const output of [Promise.resolve({}),{values:{amount:'3'},visibility:{},enabled:{},issues:{},changedFields:[]},{values:{amount:'3',flag:true},visibility:{unknown:true},enabled:{},issues:{},changedFields:[]}]){const f=fixture();f.policy.reduce=()=>output as FormReduction;const before=f.source;expect(f.port.reduce({fieldId:'flag',value:false})).toBe(null);expect(f.source).toBe(before);}
 });
 it('requires compiler action kind to match its exact declared target even if the policy validator says true',()=>{
  for(const id of ['save','apply']){const f=fixture();f.policy.compile=()=>id==='save'?{kind:'command',action:{kind:'ping'}}:{kind:'host',payload:{fake:true}};f.policy.validateCompiled=()=>true;expect(f.port.commit(context(f.session),'settings',id)).toBe(false);expect(f.send).not.toHaveBeenCalled();expect(f.save).not.toHaveBeenCalled();expect(f.session.snapshot().formOperations).toEqual([]);}
 });
 it('matches its expected publication before receipt without inventing acceptance and retains evidence after receipt',async()=>{
  const f=fixture();expect(f.port.commit(context(f.session),'settings','apply')).toBe(true);await Promise.resolve();const op=f.send.mock.calls[0][0],matching=form(2,3,true),foreign=form(3,9,false);
  expect(f.port.matchesResult?.(matching)).toBe(true);expect(f.port.matchesResult?.(foreign)).toBe(false);expect(f.session.snapshot().formOperations![0].status).toBe('sending');
  f.session.receive(document(2,3,true));expect(f.port.matchesResult?.(matching)).toBe(true);expect(f.session.resolve(op.id,'accepted')).toBe(true);expect(f.port.matchesResult?.(matching)).toBe(true);expect(f.port.matchesResult?.(foreign)).toBe(false);expect(f.session.snapshot().formOperations![0].status).toBe('accepted');
 });
 it('supports accepted receipt before publication and still distinguishes a newer foreign result',async()=>{
  const f=fixture();expect(f.port.commit(context(f.session),'settings','apply')).toBe(true);await Promise.resolve();expect(f.session.resolve(f.send.mock.calls[0][0].id,'accepted')).toBe(true);expect(f.port.matchesResult?.(form(2,3,true))).toBe(true);f.session.receive(document(2,9,false));expect(f.port.matchesResult?.(form(2,9,false))).toBe(false);expect(f.session.snapshot().formOperations![0].status).toBe('accepted');
 });
});
it('result matching cannot survive policy reentry revocation, replacement or port disposal',async()=>{
 for(const mutation of ['revoke','receive','dispose']){const f=fixture();expect(f.port.commit(context(f.session),'settings','apply')).toBe(true);await Promise.resolve();f.policy.matchesResult=()=>{if(mutation==='revoke')f.session.revoke();else if(mutation==='receive')f.session.receive(document(2,9,false));else f.port.dispose();return true;};expect(f.port.matchesResult?.(form(2,3,true))).toBe(false);}
});
it('renews only local continuation authority across a conflicted room base while preserving original comparison model',async()=>{
 const f=fixture();f.policy.compile=(offered,values,id)=>{if(id==='save'){const target=offered.actions!.find(action=>action.id==='save')!.target;return {kind:'host',payload:{model:offered.model,authority:target.kind==='host'?target.authority??null:null,amount:values.amount}};}return {kind:'command',action:{kind:'ping'}};};
 const next=document(2,8,false),original=next.forms![0],renewed={...original,actions:original.actions!.map(action=>action.id==='save'?{...action,target:{kind:'host' as const,operationId:'local:settings',authority:{token:'new-authority'}}}:action)};
 f.session.receive({...next,forms:[renewed]});expect(f.port.renew(context(f.session),'settings')).toBe(false);expect(f.port.commit(context(f.session),'settings','apply')).toBe(false);expect(f.port.commit(context(f.session),'settings','save')).toBe(true);await Promise.resolve();expect(f.save.mock.calls[0][0].payload).toEqual({model:{amount:1,flag:false},authority:{token:'new-authority'},amount:'3'});
});
it('cancels an undispatched local save when its exact authority token changes',async()=>{
 const f=fixture();expect(f.port.commit(context(f.session),'settings','save')).toBe(true);const next=document(2),offered=next.forms![0];f.session.receive({...next,forms:[{...offered,actions:offered.actions!.map(action=>action.id==='save'?{...action,target:{kind:'host' as const,operationId:'local:settings',authority:{token:'replacement'}}}:action)}]});expect(f.port.renew(context(f.session),'settings')).toBe(true);await Promise.resolve();expect(f.save).not.toHaveBeenCalled();expect(f.session.snapshot().formOperations!.at(-1)!.status).toBe('cancelled');
});
it('host continuation eligibility belongs to the actual active source, including after status resolution',async()=>{
 const f=fixture();expect(f.port.commit(context(f.session),'settings','save')).toBe(true);await Promise.resolve();const old=f.save.mock.calls[0][0];expect(f.session.isCurrentFormSubmission(old)).toBe(true);expect(f.session.resolveForm(old.id,'stored')).toBe(true);expect(f.session.isCurrentFormSubmission(old)).toBe(true);f.port.dispose();const next=f.session.bindForm(form().instanceId,()=>f.source);expect(f.session.isCurrentFormSubmission(old)).toBe(false);expect(next.commit(context(f.session),'settings','save')).toBe(true);await Promise.resolve();const current=f.save.mock.calls[1][0];expect(current.instanceId).not.toBe(old.instanceId);expect(f.session.isCurrentFormSubmission(current)).toBe(true);expect(f.session.isCurrentFormSubmission({...current,operationId:'other'})).toBe(false);f.session.revoke();expect(f.session.isCurrentFormSubmission(current)).toBe(false);
});
it('a delayed local result cannot regain continuation eligibility after reset disposes its source',async()=>{const f=fixture();expect(f.port.commit(context(f.session),'settings','save')).toBe(true);await Promise.resolve();const pending=f.save.mock.calls[0][0];f.port.dispose();f.session.bindForm(form().instanceId,()=>f.source);expect(f.session.resolveForm(pending.id,'stored')).toBe(true);expect(f.session.isCurrentFormSubmission(pending)).toBe(false);});
