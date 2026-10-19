import {expect,test,vi} from 'vitest';
import {createCardSession} from './session';
import type {TableDocument} from './contracts';
import type {DisclosureCatalogOffer,DisclosureReadPolicy,DisclosureSelectionReceipt} from './disclosures';
import type {FormDraftSnapshot,FormOffer,HostFormPolicy} from './forms';

const context={roomId:'room',roomEpoch:'epoch',actorId:'actor',connectionEpoch:'connection',audience:'actor'};
const catalog:DisclosureCatalogOffer={id:'checkpoints',policyId:'read:v1',revision:'catalog:1',title:'Saved checkpoints',total:1,pageSize:12,scope:{roomId:'room',roomEpoch:'epoch',actorId:'actor',connectionEpoch:'connection',visibility:'public'}};
const base=(revision='1'):TableDocument<string>=>({context:{session:'s',audience:'actor',generation:'g',revision},participant:{id:'actor',name:'Actor',markers:[]},hand:[],facts:[],decision:{id:'decision',kind:'commands',commands:['pass']},offer:{id:`offer:${revision}`,actions:[{id:'pass',kind:'command',label:'Pass',intent:'secondary',enabled:true,action:'pass'}]},disclosureContext:context,disclosures:[catalog]});
const draft=():FormDraftSnapshot=>Object.freeze({values:Object.freeze({}),revision:0,compositionEpoch:0,composing:false});
function fixture({connected=false,policyAccess=true,guard=true}:{connected?:boolean;policyAccess?:boolean;guard?:boolean}={}){
 let nativeCurrent:unknown=true;
 const transport=vi.fn(),formTransport=vi.fn();
 const policy:HostFormPolicy={id:'delete:v1',...(policyAccess?{access:'disclosure-selection' as const}:{}),normalize:vi.fn((_offer,values)=>({values,issues:{}})),compile:vi.fn(()=>({checkpoint:'row0'}))};
 const readPolicy:DisclosureReadPolicy={id:'read:v1',page:offer=>({catalogId:offer.id,revision:offer.revision,page:0,total:1,pageSize:12,entries:[{id:'row0',title:'Checkpoint'}]}),select:(_offer,entryId)=>({entryId,title:'Checkpoint',roster:[],cards:[],sections:[{id:'summary',kind:'content',title:'Summary',information:[]}]})};
 const session=createCardSession({transport,formTransport,formPolicies:[policy],disclosurePolicies:[readPolicy],...(guard?{disclosureCurrent:()=>nativeCurrent as boolean}:{}),disclosureRetainedCurrent:()=>true});
 if(!connected)session.setConnected(false);session.receive(base());
 expect(session.disclosures.page(catalog.id,0)).toBe(true);expect(session.disclosures.select(catalog.id,'row0')).toBe(true);
 const receipt=session.disclosures.snapshot().selection!;
 const form=(instanceId='delete:1'):FormOffer<string>=>({id:'delete',instanceId,schemaVersion:'1',policyId:policy.id,baseVersion:'catalog:1',editBinding:'actor',title:'Delete checkpoint?',submitLabel:'Delete',enabled:true,binding:{actor:'actor'},fields:[],purpose:'confirmation',retry:'new-offer',access:{kind:'disclosure-selection',selectionId:receipt.id},target:{kind:'host',operationId:'checkpoint:delete',authority:{key:'row0'}}});
 const publication=(instanceId='delete:1',revision='2',selection:DisclosureSelectionReceipt=receipt):TableDocument<string>=>({...base(revision),forms:[{...form(instanceId),access:{kind:'disclosure-selection',selectionId:selection.id}}],disclosureFormActions:[{id:'delete-record',label:'Delete',intent:'danger',selectionId:selection.id,catalogId:selection.catalogId,catalogRevision:selection.revision,entryId:selection.entryId,formId:'delete',formInstanceId:instanceId}]});
 const publish=(instanceId='delete:1',revision='2')=>session.receive(publication(instanceId,revision));
 const bind=(instanceId='delete:1')=>{const source=draft();return session.bindForm(instanceId,()=>source);};
 const commit=(port:ReturnType<typeof bind>)=>port.commit(session.snapshot().document!.context,'delete');
 return{session,policy,transport,formTransport,receipt,publication,publish,bind,commit,set nativeCurrent(value:unknown){nativeCurrent=value;}};
}

test('an engine-minted selection survives form metadata publication and admits a disconnected fresh checkpoint confirmation',async()=>{
 const f=fixture();f.publish();expect(f.session.snapshot().connected).toBe(false);expect(f.session.disclosures.snapshot().selection?.id).toBe(f.receipt.id);
 const port=f.bind();expect(f.commit(port)).toBe(true);await Promise.resolve();expect(f.formTransport).toHaveBeenCalledTimes(1);expect(f.transport).not.toHaveBeenCalled();
 expect(f.formTransport.mock.calls[0][0]).toMatchObject({formId:'delete',offerInstanceId:'delete:1',access:{kind:'disclosure-selection',selectionId:f.receipt.id},operationId:'checkpoint:delete',payload:{checkpoint:'row0'}});
 expect(f.session.snapshot().formOperations?.[0]).toMatchObject({status:'sending',attempted:true,formId:'delete',offerInstanceId:'delete:1'});
});

test('retained display, missing native authority and nonliteral freshness never admit a confirmation',async()=>{
 for(const value of [false,undefined,null,1,'true',new Boolean(true),Promise.resolve(true)]){
  const f=fixture();f.publish();const port=f.bind();f.nativeCurrent=value;expect(f.commit(port)).toBe(false);await Promise.resolve();expect(f.formTransport).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
 }
 const missing=fixture({guard:false});missing.publish();expect(missing.commit(missing.bind())).toBe(false);expect(missing.formTransport).not.toHaveBeenCalled();
 const detached=fixture();detached.publish();const port=detached.bind();detached.session.revokeGameView();expect(detached.session.disclosures.snapshot().selected).toBeDefined();expect(port.commit(base().context,'delete')).toBe(false);expect(detached.formTransport).not.toHaveBeenCalled();
});

test('selection access requires an explicitly registered host policy declaration',()=>{
 const f=fixture({policyAccess:false});const before=f.session.snapshot().document;expect(()=>f.publish()).toThrow('Unknown form policy');expect(f.session.snapshot().document).toBe(before);expect(f.formTransport).not.toHaveBeenCalled();
});

test('an attempted failed confirmation cannot retry through reset or a new port until a new offer instance',async()=>{
 const f=fixture();f.publish();const port=f.bind();expect(f.commit(port)).toBe(true);await Promise.resolve();const operation=f.session.snapshot().formOperations![0];expect(f.session.resolveForm(operation.id,'failed')).toBe(true);expect(f.commit(port)).toBe(false);
 expect(port.reduce({kind:'reset-all'})?.values).toEqual({});expect(f.commit(port)).toBe(false);port.dispose();const reopened=f.bind();expect(f.commit(reopened)).toBe(false);
 f.publish('delete:2','3');const fresh=f.bind('delete:2');expect(f.commit(fresh)).toBe(true);await Promise.resolve();expect(f.formTransport).toHaveBeenCalledTimes(2);
});

test('normalization cannot transport after deselecting its captured reader receipt',async()=>{
 const f=fixture();f.publish();const port=f.bind();f.policy.normalize=vi.fn((_offer,values)=>{f.session.disclosures.deselect();return{values,issues:{}};});expect(f.commit(port)).toBe(false);await Promise.resolve();expect(f.formTransport).not.toHaveBeenCalled();expect(f.session.snapshot().formOperations).toEqual([]);
});

test('queued and sending notifications cannot transport after replacing the selected receipt',async()=>{
 for(const stage of ['queued','sending']){
  const f=fixture();f.publish();const port=f.bind();let armed=true;f.session.subscribe(snapshot=>{if(armed&&snapshot.formOperations?.some(operation=>operation.status===stage)){armed=false;f.session.disclosures.deselect();}});
  expect(f.commit(port)).toBe(true);await Promise.resolve();expect(f.formTransport).not.toHaveBeenCalled();expect(f.session.snapshot().formOperations?.[0]).toMatchObject({status:'cancelled',attempted:false});expect(f.transport).not.toHaveBeenCalled();
 }
});

test('registry metadata cannot forge or renew a reader selection receipt',async()=>{
 for(const change of ['forged','reselected'] as const){
  const f=fixture();
  if(change==='forged')f.session.receive(f.publication('delete:1','2',{...f.receipt,id:'forged-selection'}));
  else {f.publish();expect(f.session.disclosures.select(catalog.id,'row0')).toBe(true);expect(f.session.disclosures.snapshot().selection?.id).not.toBe(f.receipt.id);}
  expect(f.commit(f.bind())).toBe(false);await Promise.resolve();expect(f.formTransport).not.toHaveBeenCalled();expect(f.policy.compile).not.toHaveBeenCalled();
 }
});

test('a disconnected stale checkpoint must receive a fresh canonical document before selection commit',async()=>{
 const f=fixture({connected:true});f.publish();const port=f.bind();f.session.setConnected(false);expect(f.commit(port)).toBe(false);await Promise.resolve();expect(f.formTransport).not.toHaveBeenCalled();
});

test('stored results retain truthful outcome when an optional refresh is stale or malformed',async()=>{
 for(const mode of ['fresh','stale','malformed','retired'] as const){
  const f=fixture();f.publish();const port=f.bind();expect(f.commit(port)).toBe(true);await Promise.resolve();const operation=f.session.snapshot().formOperations![0];
  if(mode==='retired')port.dispose();
  const refresh={selectionId:f.receipt.id,catalogId:catalog.id,revision:mode==='stale'?catalog.revision:'catalog:2',...(mode==='malformed'?{payload:'forbidden'}:{})};
  expect(f.session.resolveForm(operation.id,'stored',undefined,refresh)).toBe(true);
  const settled=f.session.snapshot().formOperations![0];expect(settled.status).toBe('stored');expect(settled.refreshDisclosure).toEqual(mode==='fresh'?refresh:undefined);expect(f.formTransport).toHaveBeenCalledTimes(1);
 }
});

test('reset and source replacement preserve a single-attempt offer fence',async()=>{
 const f=fixture();f.publish();const port=f.bind();expect(f.commit(port)).toBe(true);await Promise.resolve();const operation=f.session.snapshot().formOperations![0];f.session.resolveForm(operation.id,'failed');
 for(let index=0;index<130;index++){port.dispose();const replacement=f.bind();expect(f.commit(replacement)).toBe(false);replacement.dispose();}
 expect(f.session.snapshot().formOperations).toHaveLength(1);expect(f.formTransport).toHaveBeenCalledTimes(1);
});
