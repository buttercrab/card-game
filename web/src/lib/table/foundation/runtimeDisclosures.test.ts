import {expect,test,vi} from 'vitest';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import type {ChoiceView,Environment,PlannedNode,Planner,SurfaceCallbacks,SurfacePort,TableDocument} from './contracts';
import type {DisclosureCatalogOffer,DisclosureReadPolicy} from './disclosures';
const environment:Environment={width:500,height:500,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
const context={roomId:'room',roomEpoch:'epoch',actorId:'alice',connectionEpoch:'connection',audience:'alice:0'};
const catalog:DisclosureCatalogOffer={id:'history',policyId:'history:v1',revision:'r1',title:'지난 판',total:2,pageSize:12,scope:{roomId:'room',roomEpoch:'epoch',actorId:'alice',connectionEpoch:'connection',visibility:'public'}};
function document(revision='1',generation='hand1',grants=true):TableDocument<string>{return{
 context:{session:'room',audience:grants?context.audience:'public:alice',generation,revision},participant:{id:'alice',name:'Alice',markers:[]},hand:[],facts:[],decision:{kind:'commands',id:'play',commands:['play']},offer:{id:`offer-${revision}`,actions:[{id:'play',kind:'command',label:'내기',intent:'primary',enabled:true,action:'play'}]},
 ...(grants?{disclosures:[catalog],disclosureContext:context}:{}),
 shell:{roomCode:'room',header:{codeLabel:'room',connection:'open',connectionLabel:'연결됨',observerCount:0,observerLabel:'관전자 0명',requestCount:0,requestLabel:'참여 0건',actions:grants?[{id:'history-open',purpose:'scores',label:'지난 판',enabled:true,intent:{kind:'open-disclosure',catalogId:'history'}}]:[]},pages:[{id:'menu',title:'메뉴',actions:[]}],notices:[],effects:[]},
};}
function fixture(connected=true,measured=false){
 let native=true;const page=vi.fn<DisclosureReadPolicy['page']>(offer=>({catalogId:offer.id,revision:offer.revision,page:0,total:2,pageSize:12,entries:[{id:'row-a',title:'첫 판'},{id:'row-b',title:'둘째 판'}]}));
 const select=vi.fn<DisclosureReadPolicy['select']>((_offer,entryId)=>({entryId,title:'완료한 판',roster:[],cards:[],sections:[{id:'summary',kind:'content',title:'요약'},{id:'rounds',kind:'rounds',title:'라운드',rounds:[{id:'round7',title:'7',plays:[]}]}]}));
 const send=vi.fn(),session=createCardSession<string>({transport:send,disclosurePolicies:[{id:'history:v1',page,select}],disclosureRetainedCurrent:()=>native});session.receive(document(),{connected});const admit=vi.spyOn(session,'admit');let callbacks:SurfaceCallbacks,view:ChoiceView,leaseOverride:string|undefined;
 const planner:Planner=(_doc,_env,choices,metrics)=>{view=choices;if(measured&&choices.disclosure){const prefix=choices.disclosure.selected?.entryId??'list';const keys=Array.from({length:300},(_,index)=>`${prefix}:${index}`),missing=keys.filter(key=>!metrics.has(key));if(missing.length)return{kind:'needs',requests:missing.map(key=>({key,text:key,role:'body',width:100,environment:_env}))};}const disclosure=choices.disclosure,box={x:0,y:0,width:100,height:44};const nodes:PlannedNode[]=[{id:'root',parent:null,kind:'group',label:'테이블',arrangement:'overlay',box:{x:0,y:0,width:500,height:500}},{id:'base',parent:'root',kind:'group',label:'기본',inert:!!disclosure,box:{x:0,y:0,width:500,height:500}},{id:'play',parent:'base',kind:'command',label:'내기',actionId:'play',enabled:true,box},{id:'open',parent:'base',kind:'command',label:'지난 판',enabled:true,shellActionId:'history-open',shellIntent:{kind:'open-disclosure',catalogId:'history'},box}];
 if(disclosure){nodes.push({id:'viewer',parent:'root',kind:'group',semanticRole:'dialog',label:'지난 판',modalLeaseId:disclosure.leaseId,box:{x:0,y:0,width:400,height:400}});
 const binding={leaseId:leaseOverride??disclosure.leaseId};nodes.push({id:'close',parent:'viewer',kind:'command',label:'닫기',enabled:true,disclosureIntent:{kind:'close',...binding},box},{id:'back',parent:'viewer',kind:'command',label:'뒤로',enabled:true,disclosureIntent:{kind:'back',...binding},box});
 if(disclosure.selected){nodes.push({id:'tab-rounds',parent:'viewer',kind:'command',label:'라운드',enabled:true,disclosureIntent:{kind:'section',...binding,entryId:disclosure.selected.entryId,sectionId:'rounds'},box});}
 else for(const entry of disclosure.page?.entries??[])nodes.push({id:entry.id,parent:'viewer',kind:'command',label:entry.title,enabled:true,disclosureIntent:{kind:'entry',...binding,entryId:entry.id},box});}
 const counters=new Map<string,number>();for(let i=0;i<nodes.length;i++){const node=nodes[i];if(node.kind!=='command')continue;const offset=counters.get(node.parent!)??0;counters.set(node.parent!,offset+1);nodes[i]={...node,box:{x:8,y:8+offset*52,width:120,height:44}};}
 return{kind:'ready',layout:{width:500,height:500,recipe:'stacked',...(disclosure?{modalId:'viewer'}:{}),nodes}};};
 const surface:SurfacePort={identity:{},environment:()=>environment,listen(next){callbacks=next;return()=>{};},measure(requests,reply){reply(requests.map(request=>({key:request.key,size:{width:80,height:20}})));return()=>{};},publish:vi.fn(),disarm:vi.fn(),invalidate:vi.fn(),fallback:vi.fn(),clear:vi.fn(),preserveModal:vi.fn()};
 const table=createCardTable({session,planner});table.attach(surface);expect(surface.fallback).not.toHaveBeenCalled();
 const activate=(nodeId:string,frameId=table.inspect().frame!.id)=>{callbacks.intent({kind:'activate',nodeId,frameId,provenance:'direct'});expect(surface.fallback).not.toHaveBeenCalled();};
 return{session,table,surface,send,admit,page,select,activate,get view(){return view!;},get callbacks(){return callbacks!;},set native(value:boolean){native=value;},set leaseOverride(value:string|undefined){leaseOverride=value;},dispose(){table.dispose();session.dispose();}};
}
function open(f:ReturnType<typeof fixture>){f.activate('open');expect(f.view.disclosure?.page?.entries).toHaveLength(2);f.activate('row-a');expect(f.view.disclosure?.selected?.entryId).toBe('row-a');return f.view.disclosure!;}
test('canonical shell opens a read-only modal and section/Back/close never touch the command journal',()=>{
 const f=fixture(),detail=open(f);expect(f.table.inspect().frame?.modalId).toBe('viewer');expect(f.surface.preserveModal).toHaveBeenLastCalledWith(detail.leaseId);
 f.activate('play');expect(f.admit).not.toHaveBeenCalled();f.activate('tab-rounds');expect(f.view.disclosure?.sectionId).toBe('rounds');expect(f.view.disclosure?.leaseId).toBe(detail.leaseId);
 f.activate('back');expect(f.view.disclosure?.selected).toBeUndefined();expect(f.view.disclosure?.page).toBeDefined();f.activate('back');expect(f.view.disclosure).toBeUndefined();expect(f.session.disclosures?.snapshot()).toEqual({});expect(f.session.snapshot().operations).toEqual([]);expect(f.send).not.toHaveBeenCalled();f.dispose();
});
test('held frames and bindings cannot close or navigate a later record view',()=>{
 const f=fixture();f.activate('open');const listFrame=f.table.inspect().frame!.id;f.activate('row-a');const detailFrame=f.table.inspect().frame!.id,detail=f.view.disclosure!;
 f.activate('close',listFrame);expect(f.view.disclosure?.leaseId).toBe(detail.leaseId);f.activate('tab-rounds',listFrame);expect(f.view.disclosure?.sectionId).toBe('summary');f.activate('back');f.activate('row-b');
 expect(f.view.disclosure?.selected?.entryId).toBe('row-b');f.activate('close',detailFrame);expect(f.view.disclosure?.selected?.entryId).toBe('row-b');f.leaseOverride=detail.leaseId;f.callbacks.environment({...environment,revision:'stale-binding'});expect(f.surface.fallback).toHaveBeenCalledWith(expect.stringContaining('Disclosure control escapes its lease: close'));expect(f.table.inspect().frame).toBeNull();expect(f.session.disclosures?.snapshot().selected?.entryId).toBe('row-b');expect(f.admit).not.toHaveBeenCalled();f.dispose();
});
test('a fresh authorized connected-false public checkpoint permits read-only disclosure navigation',()=>{
 const f=fixture(false);open(f);f.activate('tab-rounds');expect(f.view.disclosure?.sectionId).toBe('rounds');f.activate('play');expect(f.admit).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.page).toHaveBeenCalledTimes(1);expect(f.select).toHaveBeenCalledTimes(1);f.dispose();
});
test('explicit public reseat retention preserves the exact modal lease through redaction and neutral shell, then reattaches',()=>{
 const f=fixture(),detail=open(f),selected=detail.selected;(f.surface.clear as ReturnType<typeof vi.fn>).mockClear();f.session.revokeGameView();
 expect(f.surface.clear).toHaveBeenCalled();for(const args of (f.surface.clear as ReturnType<typeof vi.fn>).mock.calls)expect(args[0]).toBe(detail.leaseId);
 f.session.receive(document('2','public-shell',false),{connected:false});expect(f.view.disclosure?.selected).toBe(selected);expect(f.view.disclosure?.leaseId).toBe(detail.leaseId);expect(f.view.disclosure?.page).toBeUndefined();expect(f.view.disclosure?.canReturnToCatalog).toBe(false);
 for(const args of (f.surface.clear as ReturnType<typeof vi.fn>).mock.calls)expect(args[0]).toBe(detail.leaseId);
 f.activate('back');expect(f.view.disclosure?.selected).toBe(selected);expect(f.page).toHaveBeenCalledTimes(1);f.session.receive(document('3','hand2'));expect(f.view.disclosure?.selected).toBe(selected);expect(f.view.disclosure?.leaseId).toBe(detail.leaseId);
 f.activate('back');expect(f.view.disclosure?.selected).toBeUndefined();expect(f.view.disclosure?.page).toBeDefined();expect(f.session.snapshot().operations).toEqual([]);expect(f.admit).not.toHaveBeenCalled();f.dispose();
});
test('native identity loss and default full revoke clear the retained viewer and modal preservation',()=>{
 for(const mode of ['native','revoke']){const f=fixture();open(f);f.session.revokeGameView();f.session.receive(document('2','public-shell',false),{connected:false});
 if(mode==='native'){f.native=false;f.callbacks.environment({...environment,revision:'identity-loss'});}else f.session.revoke();
 expect(f.session.disclosures?.snapshot()).toEqual({});expect(f.table.inspect().frame?.modalId).toBeUndefined();expect(f.surface.preserveModal).toHaveBeenLastCalledWith(null);expect(f.send).not.toHaveBeenCalled();expect(f.admit).not.toHaveBeenCalled();f.dispose();}
});

test('record navigation retires prior metric working sets instead of retaining archive text',()=>{const f=fixture(true,true);f.activate('open');expect(f.table.inspect().cacheSize).toBe(300);f.activate('row-a');expect(f.table.inspect().cacheSize).toBe(300);f.activate('back');expect(f.table.inspect().cacheSize).toBe(300);f.activate('row-b');expect(f.table.inspect().cacheSize).toBe(300);expect(f.view.disclosure?.selected?.entryId).toBe('row-b');f.dispose();});

test.each(['close','dismiss','back'] as const)('disclosure %s restores the opener after detail navigation and refresh',mode=>{
 const f=fixture();open(f);f.activate('tab-rounds');
 f.callbacks.intent({kind:'focus',nodeId:'back',frameId:f.table.inspect().frame!.id});
 f.callbacks.environment({...environment,revision:'refreshed'});expect(f.table.inspect().frame?.focusId).toBe('back');
 f.session.receive(document('2'));expect(f.table.inspect().frame?.focusId).toBe('back');
 if(mode==='close')f.activate('close');
 else if(mode==='dismiss')f.callbacks.intent({kind:'dismiss',frameId:f.table.inspect().frame!.id});
 else {f.table.back();expect(f.view.disclosure?.page).toBeDefined();f.table.back();}
 expect(f.view.disclosure).toBeUndefined();expect(f.table.inspect().frame?.focusId).toBe('open');expect(f.send).not.toHaveBeenCalled();f.dispose();
});
test('disclosure cannot restore an opener retired by a new scope, even when its node ID is reused',()=>{
 const f=fixture();open(f);f.session.receive(document('2','hand2'));f.activate('close');expect(f.table.inspect().frame?.focusId).toBeNull();f.dispose();
});
test.each(['removed','disabled','restored'] as const)('disclosure cannot restore a retired shell opener (%s)',mode=>{
 const f=fixture();open(f);const next=document('2');f.session.receive({...next,shell:{...next.shell!,header:{...next.shell!.header,actions:mode==='disabled'?next.shell!.header.actions.map(action=>({...action,enabled:false})):[]}}});
 if(mode==='restored')f.session.receive(document('3'));
 f.activate('close');expect(f.table.inspect().frame?.focusId).toBeNull();f.dispose();
});
