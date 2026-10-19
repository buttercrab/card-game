import {expect,test,vi} from 'vitest';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import type {ChoiceView,Environment,PlannedNode,Planner,SurfaceCallbacks,SurfacePort,TableDocument} from './contracts';
import type {DisclosureCatalogOffer,DisclosureFormAction,DisclosureReadPolicy,DisclosureSelectionReceipt} from './disclosures';
import type {FormOffer,HostFormPolicy} from './forms';
const environment:Environment={width:500,height:500,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
const context={roomId:'room',roomEpoch:'epoch',actorId:'alice',connectionEpoch:'socket',audience:'alice:0'};
const policy:HostFormPolicy={id:'device-delete:v1',access:'disclosure-selection',normalize:(_offer,values)=>({values,issues:{}}),compile:()=>({operation:'delete'})};
function fixture(connected=true){
 let native=true,currentRevision='r1',sequence=0,pageReads=0;let receipt:DisclosureSelectionReceipt|null=null;
 const catalog=(revision=currentRevision):DisclosureCatalogOffer=>({id:'device',policyId:'device:v1',revision,title:'내 기록',total:1,pageSize:12,scope:{roomId:'room',roomEpoch:'epoch',actorId:'alice',connectionEpoch:'socket',visibility:'public'}});
 const confirmation=(selection:DisclosureSelectionReceipt):FormOffer<string>=>({id:'delete',instanceId:`delete:${selection.id}`,schemaVersion:'1',policyId:policy.id,baseVersion:selection.revision,editBinding:selection.id,title:'기록을 지울까요?',help:'이 기기의 판 기록을 지워요. 업적은 남아요.',purpose:'confirmation',retry:'new-offer',access:{kind:'disclosure-selection',selectionId:selection.id},submitLabel:'지우기',fields:[],binding:{actorId:'alice',roomId:'room',selectionId:selection.id},enabled:true,actions:[{id:'delete',label:'지우기',intent:'danger',target:{kind:'host',operationId:'device:delete'},basis:'current',completion:'lock'}]});
 function document(withAction=false,revision=currentRevision):TableDocument<string>{
 const form=withAction&&receipt?confirmation(receipt):null;
 const link:DisclosureFormAction|undefined=form&&receipt?{id:'delete-open',label:'기록 지우기',intent:'danger',selectionId:receipt.id,catalogId:'device',catalogRevision:receipt.revision,entryId:receipt.entryId,formId:form.id,formInstanceId:form.instanceId}:undefined;
 return{context:{session:'room',audience:context.audience,generation:'hand1',revision:String(++sequence)},participant:{id:'alice',name:'Alice',markers:[]},hand:[],facts:[],decision:{kind:'commands',id:'idle',commands:[]},offer:{id:'idle',actions:[]},disclosures:[catalog(revision)],disclosureContext:context,...(form&&link?{forms:[form],disclosureFormActions:[link]}:{}),shell:{roomCode:'room',header:{codeLabel:'room',connection:'open',connectionLabel:'연결됨',observerCount:0,observerLabel:'관전자 0명',requestCount:0,requestLabel:'참여 0건',actions:[{id:'device-open',purpose:'scores',label:'내 기록',enabled:true,intent:{kind:'open-disclosure',catalogId:'device'}}]},pages:[{id:'menu',title:'메뉴',actions:[]}],notices:[],effects:[]}};
 }
 const page=vi.fn<DisclosureReadPolicy['page']>(offer=>({catalogId:offer.id,revision:offer.revision,page:0,total:1,pageSize:12,entries:[{id:`summary:${++pageReads}`,title:'내 기록'}]}));
 const select=vi.fn<DisclosureReadPolicy['select']>((offer,entryId)=>({entryId,title:`내 기록 ${offer.revision}`,roster:[],cards:[],sections:[{kind:'content',id:'summary',title:'통계'}]}));
 const formTransport=vi.fn(),send=vi.fn(),session=createCardSession<string>({transport:send,formPolicies:[policy],formTransport,disclosurePolicies:[{id:'device:v1',page,select}],disclosureCurrent:()=>native,disclosureRetainedCurrent:()=>native,disclosureSelectionChanged:value=>{receipt=value;}});session.receive(document(),{connected});let callbacks:SurfaceCallbacks,view:ChoiceView;
 const planner:Planner=(_doc,_env,choices)=>{view=choices;const detail=choices.disclosure,form=choices.form,lease=form?.leaseId??detail?.leaseId;
 const nodes:PlannedNode[]=[{id:'root',parent:null,kind:'group',label:'테이블',arrangement:'overlay',box:{x:0,y:0,width:500,height:500}},{id:'base',parent:'root',kind:'group',label:'기본',inert:!!lease,box:{x:0,y:0,width:500,height:500}},{id:'open',parent:'base',kind:'command',label:'내 기록',enabled:true,shellActionId:'device-open',shellIntent:{kind:'open-disclosure',catalogId:'device'},box:{x:8,y:8,width:120,height:44}}];
 if(lease){nodes.push({id:'modal',parent:'root',kind:'group',semanticRole:'dialog',label:form?.offer.title??'내 기록',...(form?{formLeaseId:lease}:{modalLeaseId:lease}),box:{x:0,y:0,width:400,height:400}});
 if(form){nodes.push({id:'cancel',parent:'modal',kind:'command',label:'취소',enabled:true,formLeaseId:lease,formIntent:'close',box:{x:8,y:8,width:120,height:44}},{id:'submit',parent:'modal',kind:'command',label:'지우기',enabled:form.canSubmit,formLeaseId:lease,formIntent:'submit',formActionId:'delete',box:{x:8,y:60,width:120,height:44}},{id:'reset',parent:'modal',kind:'command',label:'다시',enabled:true,formLeaseId:lease,formIntent:'reset',box:{x:8,y:112,width:120,height:44}});}
 else if(detail){nodes.push({id:'viewer-back',parent:'modal',kind:'command',label:'뒤로',enabled:true,disclosureIntent:{kind:'back',leaseId:detail.leaseId},box:{x:8,y:60,width:120,height:44}});for(const entry of detail.selected?[]:detail.page?.entries??[])nodes.push({id:'viewer-entry',parent:'modal',kind:'command',label:entry.title,enabled:true,disclosureIntent:{kind:'entry',leaseId:detail.leaseId,entryId:entry.id},box:{x:8,y:112,width:120,height:44}});for(const [index,action] of (detail.formActions??[]).entries())nodes.push({id:'delete-open',parent:'modal',kind:'command',label:action.label,enabled:true,disclosureFormActionId:action.id,box:{x:8,y:8+index*52,width:120,height:44}});}}
 return{kind:'ready',layout:{width:500,height:500,recipe:'stacked',...(lease?{modalId:'modal'}:{}),nodes}};};
 const surface:SurfacePort={identity:{},environment:()=>environment,listen(next){callbacks=next;return()=>{};},measure:()=>()=>{},publish:vi.fn(),disarm:vi.fn(),invalidate:vi.fn(),fallback:vi.fn(),clear:vi.fn(),preserveModal:vi.fn(),preserveEditing:vi.fn()};const table=createCardTable({session,planner});table.attach(surface);
 function activate(nodeId:string){expect(surface.fallback).not.toHaveBeenCalled();const frame=table.inspect().frame;expect(frame).not.toBeNull();callbacks.intent({kind:'activate',nodeId,frameId:frame!.id,provenance:'direct'});expect(surface.fallback).not.toHaveBeenCalled();}
 function publish(withAction=true,revision=currentRevision){session.receive(document(withAction,revision),{connected});}
 function open(){activate('open');expect(receipt).not.toBeNull();publish();expect(view.disclosure?.formActions).toHaveLength(1);activate('delete-open');expect(view.form?.offer.purpose).toBe('confirmation');}
 return{session,table,surface,page,select,send,formTransport,activate,publish,open,get callbacks(){return callbacks!;},get receipt(){return receipt!;},get view(){return view!;},set native(value:boolean){native=value;},set revision(value:string){currentRevision=value;},dispose(){table.dispose();session.dispose();}};
}
test('selection registry opens zero-field confirmation while Cancel preserves frozen reader data without another read',()=>{
 const f=fixture();f.open();const selected=f.session.disclosures!.snapshot().selected,selection=f.receipt;expect(f.view.form?.offer.fields).toEqual([]);expect(f.view.disclosure).toBeUndefined();expect(f.session.disclosures!.snapshot().selected).toBe(selected);
 f.activate('cancel');expect(f.view.form).toBeUndefined();expect(f.view.disclosure?.selected).toBe(selected);expect(f.view.disclosure?.selection).toBe(selection);expect(f.page).toHaveBeenCalledTimes(1);expect(f.select).toHaveBeenCalledTimes(1);expect(f.formTransport).not.toHaveBeenCalled();expect(f.session.snapshot().operations).toEqual([]);f.dispose();
});
test('fresh disconnected local checkpoint submits once through host form transport and never game transport',async()=>{
 const f=fixture(false);f.open();expect(f.view.form?.canSubmit).toBe(true);f.activate('submit');f.activate('submit');await Promise.resolve();expect(f.formTransport).toHaveBeenCalledTimes(1);expect(f.formTransport.mock.calls[0][0]).toMatchObject({operationId:'device:delete',access:{kind:'disclosure-selection',selectionId:f.receipt.id},payload:{operation:'delete'}});expect(f.send).not.toHaveBeenCalled();expect(f.session.snapshot().operations).toEqual([]);f.dispose();
});
test('failed attempted operation blocks reset and reopen of the same exact offer',async()=>{
 const f=fixture();f.open();f.activate('submit');await Promise.resolve();const op=f.formTransport.mock.calls[0][0];expect(f.session.resolveForm(op.id,'failed','저장 실패')).toBe(true);expect(f.view.form?.canSubmit).toBe(false);
 f.activate('reset');expect(f.view.form?.canSubmit).toBe(false);f.activate('submit');f.activate('cancel');f.activate('delete-open');expect(f.view.form?.canSubmit).toBe(false);f.activate('submit');await Promise.resolve();expect(f.formTransport).toHaveBeenCalledTimes(1);f.dispose();
});
test('stored refresh waits for exact future revision and rereads singleton normally without another mutation',async()=>{
 const f=fixture();f.open();const oldSelection=f.receipt.id;f.activate('submit');await Promise.resolve();const op=f.formTransport.mock.calls[0][0];expect(f.session.resolveForm(op.id,'stored',undefined,{selectionId:oldSelection,catalogId:'device',revision:'r2'})).toBe(true);
 expect(f.view.form?.status).toBe('stored');expect(f.page).toHaveBeenCalledTimes(1);f.publish();expect(f.page).toHaveBeenCalledTimes(1);f.publish(false,'r3');expect(f.page).toHaveBeenCalledTimes(1);f.revision='r2';f.publish(false);
 expect(f.page).toHaveBeenCalledTimes(2);expect(f.select).toHaveBeenCalledTimes(2);expect(f.view.form).toBeUndefined();expect(f.view.disclosure?.selected?.title).toBe('내 기록 r2');expect(f.receipt.id).not.toBe(oldSelection);expect(f.formTransport).toHaveBeenCalledTimes(1);f.dispose();
});
test('actor revoke cancels a pending refresh before any later catalog publication',async()=>{
 const f=fixture();f.open();const selection=f.receipt.id;f.activate('submit');await Promise.resolve();const op=f.formTransport.mock.calls[0][0];expect(f.session.resolveForm(op.id,'stored',undefined,{selectionId:selection,catalogId:'device',revision:'r2'})).toBe(true);
 f.session.revoke();f.native=false;f.revision='r2';f.publish(false);expect(f.page).toHaveBeenCalledTimes(1);expect(f.view.form).toBeUndefined();expect(f.view.disclosure).toBeUndefined();expect(f.formTransport).toHaveBeenCalledTimes(1);f.dispose();
});
test('dismiss cancels confirmation first and reveals the same retained viewer',()=>{
 const f=fixture();f.open();const before=f.session.disclosures!.snapshot();f.callbacks.intent({kind:'dismiss',frameId:f.table.inspect().frame!.id});expect(f.view.form).toBeUndefined();expect(f.view.disclosure?.selected).toBe(before.selected);expect(f.view.disclosure?.selection).toBe(before.selection);expect(f.formTransport).not.toHaveBeenCalled();expect(f.select).toHaveBeenCalledTimes(1);f.dispose();
});
test('Cancel after stored outcome cancels deferred refresh rather than silently rereading later',async()=>{
 const f=fixture();f.open();const selection=f.receipt.id;f.activate('submit');await Promise.resolve();const op=f.formTransport.mock.calls[0][0];expect(f.session.resolveForm(op.id,'stored',undefined,{selectionId:selection,catalogId:'device',revision:'r2'})).toBe(true);f.activate('cancel');f.revision='r2';f.publish(false);expect(f.page).toHaveBeenCalledTimes(1);expect(f.select).toHaveBeenCalledTimes(1);expect(f.formTransport).toHaveBeenCalledTimes(1);f.dispose();
});
test('Back obtains new metadata before deselection so reselection can receive a fresh host capture',()=>{
 const f=fixture();f.open();const old=f.receipt;f.activate('cancel');f.activate('viewer-back');expect(f.view.disclosure?.selected).toBeUndefined();expect(f.page).toHaveBeenCalledTimes(2);expect(f.view.disclosure?.page?.entries[0].id).not.toBe(old.entryId);
 f.activate('viewer-entry');expect(f.receipt.id).not.toBe(old.id);expect(f.receipt.entryId).not.toBe(old.entryId);f.publish();f.activate('delete-open');expect(f.view.form?.offer.access?.selectionId).toBe(f.receipt.id);expect(f.formTransport).not.toHaveBeenCalled();f.dispose();
});
