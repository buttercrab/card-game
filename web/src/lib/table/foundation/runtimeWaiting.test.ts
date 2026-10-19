import {expect,test,vi} from 'vitest';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import {NAME_POLICY,namedJoinForm,type NameCommand} from './nameForms';
import type {ChoiceView,Environment,PlannedNode,Planner,SurfaceCallbacks,SurfacePort,TableDocument} from './contracts';
import type {RoomShell,RoomShellAction} from './roomShell';
const environment:Environment={width:500,height:500,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
type Action=NameCommand|{kind:'setup';revision:string};
function document(revision='1',occupant='',confirm=false,join=false,stage:'waiting'|'active'='waiting'):TableDocument<Action>{
 const subject={kind:'seat' as const,seat:1,...(occupant?{participantId:occupant}:{})};
 const form=namedJoinForm({roomId:'room',actorId:'alice',seat:1,name:'Alice',nameMax:20,currentScope:{domain:'room',room_id:'room',room_epoch:'epoch',actor_id:'alice',seat:null,session_id:1,hand:0,version:1}});
 const action:RoomShellAction={id:'setup-ref',purpose:'operation',label:join?'이름 정하고 앉기':'2번 자리 · 보통 봇 앉히기',enabled:true,intent:join?{kind:'open-form',formId:form.id}:{kind:'command',actionId:'setup-command'},...(join?{}:{subjects:[subject]}),...(confirm?{confirmation:{title:'봇을 앉힐까요?',message:'선택한 자리에 봇을 앉혀요.',confirmLabel:'앉히기'}}:{})};
 const shell:RoomShell={roomCode:'room',header:{codeLabel:'room',connection:'open',connectionLabel:'연결됨',observerCount:0,observerLabel:'관전자 0명',requestCount:0,requestLabel:'참여 0건',actions:[]},pages:[{id:'menu',title:'메뉴',actions:[]},{id:'manage',title:'자리 관리',actions:[]}],notices:[],effects:[],seats:[{seat:1,...(occupant?{participantId:occupant}:{}),name:occupant||'빈자리',kind:occupant?'bot':'empty',actions:[],setupActionId:action.id,setupLabel:join?action.label:'봇 추가'}],management:[{subject,title:'2번 자리',actions:[action]}]};
 return{stage,context:{session:'room',audience:'alice',generation:'waiting',revision},participant:{id:'alice',name:'Alice',role:join?'observer':'player',markers:[]},hand:[],facts:[],decision:{kind:'commands',id:'waiting',commands:join?[]:['setup-command']},offer:{id:`setup-offer-${revision}`,actions:join?[]:[{id:'setup-command',kind:'command',label:action.label,intent:'secondary',enabled:true,action:{kind:'setup',revision}}]},...(join?{forms:[form]}:{}),shell};
}
function fixture(source=document()){
 const send=vi.fn(),session=createCardSession<Action>({transport:send,formPolicies:[NAME_POLICY]});session.receive(source);const admit=vi.spyOn(session,'admitDecision');let callbacks:SurfaceCallbacks,view:ChoiceView;
 const planner:Planner=(doc,_env,choices)=>{view=choices;const confirmation=choices.shellCommandConfirmation,form=choices.form,information=choices.informationOpen,modal=!!(confirmation||form||information);const action=doc.shell!.management![0].actions[0],nodes:PlannedNode[]=[{id:'root',parent:null,kind:'group',label:'대기 테이블',arrangement:'overlay',box:{x:0,y:0,width:500,height:500}},{id:'base',parent:'root',kind:'group',label:'자리',inert:modal,box:{x:0,y:0,width:500,height:500}},{id:'setup',parent:'base',kind:'command',label:doc.shell!.seats![0].setupLabel!,shellActionId:action.id,shellIntent:action.intent,enabled:true,box:{x:8,y:8,width:160,height:70}}];
 if(doc.information?.length||doc.facts.length||doc.scoreboard)nodes.push({id:'information-open',parent:'base',kind:'command',label:'상황 보기',localIntent:'toggle-information',enabled:true,box:{x:8,y:100,width:160,height:60}});
 if(modal){nodes.push({id:'dialog',parent:'root',kind:'group',semanticRole:'dialog',label:confirmation?.title??form?.offer.title??'상황 보기',...(form?{formLeaseId:form.leaseId}:{}),box:{x:0,y:0,width:400,height:400}});
 if(information)nodes.push({id:'information-close',parent:'dialog',kind:'command',label:'닫기',enabled:true,localIntent:'toggle-information',box:{x:8,y:8,width:160,height:44}},{id:'information-title',parent:'dialog',kind:'text',label:doc.information?.[0]?.title??'상태',role:'body',box:{x:8,y:70,width:250,height:60}});
 if(confirmation)for(const [index,item] of confirmation.actions.entries())nodes.push({id:item.purpose==='confirm'?'confirm':'cancel',parent:'dialog',kind:'command',label:item.label,shellActionId:item.id,shellIntent:item.intent,enabled:item.enabled,box:{x:8,y:8+index*60,width:160,height:44}});
 if(form){const field=form.offer.fields[0];if(field.kind!=='text')throw Error('text fixture');nodes.push({id:'editor',parent:'dialog',kind:'editor',label:field.label,role:'select',enabled:true,editor:{leaseId:form.leaseId,fieldId:field.id,fieldLeaseId:form.fieldLeases?.[field.id],kind:'text',value:String(form.values[field.id]),maxCodeUnits:field.maxCodeUnits},box:{x:8,y:8,width:250,height:48}},{id:'submit',parent:'dialog',kind:'command',label:'앉기',enabled:form.canSubmit,formIntent:'submit',formLeaseId:form.leaseId,box:{x:8,y:70,width:160,height:44}},{id:'form-cancel',parent:'dialog',kind:'command',label:'취소',enabled:true,formIntent:'close',formLeaseId:form.leaseId,box:{x:8,y:130,width:160,height:44}});}}
 return{kind:'ready',layout:{width:500,height:500,recipe:'stacked',...(modal?{modalId:'dialog'}:{}),nodes}};};
 const surface:SurfacePort={identity:{},environment:()=>environment,listen(next){callbacks=next;return()=>{};},measure:()=>()=>{},publish:vi.fn(),disarm:vi.fn(),invalidate:vi.fn(),fallback:vi.fn(),clear:vi.fn()};const table=createCardTable({session,planner});table.attach(surface);
 const activate=(nodeId='setup',frameId=table.inspect().frame!.id)=>{callbacks.intent({kind:'activate',nodeId,frameId});expect(surface.fallback).not.toHaveBeenCalled();};
 return{session,table,surface,send,admit,activate,get view(){return view!;},get callbacks(){return callbacks!;},dispose(){table.dispose();session.dispose();}};
}
test('waiting seat setup admits its exact canonical command once through the ordinary session ledger',async()=>{
 const f=fixture();f.activate();f.activate();await Promise.resolve();expect(f.admit).toHaveBeenCalledTimes(1);expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0]).toMatchObject({offerId:'setup-offer-1',actionId:'setup-command',action:{kind:'setup',revision:'1'}});expect(f.session.snapshot().operations).toHaveLength(1);f.dispose();
});
test('stage ownership prevents a forged setup node activating the same management command during active play',()=>{
 const f=fixture(document('1','',false,false,'active'));f.activate();expect(f.admit).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();f.dispose();
});
test('unknown or foreign-seat setup refs reject atomically at canonical ingress',()=>{
 const f=fixture(),prior=f.session.snapshot().document!;const next=document('2'),seat=next.shell!.seats![0];
 for(const replacement of [{...seat,setupActionId:'unknown'},{...seat,seat:2}]){const value={...next,shell:{...next.shell!,seats:[replacement]}};expect(()=>f.session.receive(value)).toThrow();expect(f.session.snapshot().document).toBe(prior);}
 f.dispose();
});
test.each(['revision','subject'])('held activation and old frame cannot cross waiting %s replacement',async mode=>{
 const f=fixture(),held=f.table.inspect().frame!.id;f.callbacks.intent({kind:'begin',nodeId:'setup',frameId:held});f.session.receive(document('2',mode==='subject'?'replacement':''));f.activate('setup',held);f.activate();expect(f.admit).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();
 const fresh=f.table.inspect().frame!.id;f.callbacks.intent({kind:'begin',nodeId:'setup',frameId:fresh});f.activate();await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0].context.revision).toBe('2');f.dispose();
});
test('setup confirmation Cancel and Back send nothing; fresh confirmation uses the exact canonical command',async()=>{
 const f=fixture(document('1','',true));f.activate();expect(f.view.shellCommandConfirmation?.title).toBe('봇을 앉힐까요?');f.activate('cancel');expect(f.view.shellCommandConfirmation).toBeUndefined();expect(f.admit).not.toHaveBeenCalled();f.activate();expect(f.table.back()).toBe(true);expect(f.view.shellCommandConfirmation).toBeUndefined();f.activate();f.activate('confirm');await Promise.resolve();expect(f.admit).toHaveBeenCalledTimes(1);expect(f.send).toHaveBeenCalledTimes(1);f.dispose();
});
test('observer setup opens canonical native name form and sends no command until explicit submit',async()=>{
 const f=fixture(document('1','',false,true));f.activate();expect(f.view.form?.offer.policyId).toBe(NAME_POLICY.id);expect(f.view.form?.values).toEqual({'name:text':'Alice'});expect((f.surface.publish as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0].nodes.find((node:PlannedNode)=>node.id==='editor').editor.value).toBe('Alice');expect(f.admit).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();f.activate('submit');await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0]).toMatchObject({action:{kind:'room',action:{type:'join',name:'Alice',seat:1},expected:{actor_id:'alice',seat:null,version:1}}});expect(f.session.snapshot().operations).toHaveLength(1);f.dispose();
});
function informationDocument(revision='1'):TableDocument<Action>{return{...document(revision),information:[{id:'current-status',title:`현재 대기 상태 ${revision}`,fields:[{id:'rules',label:'규칙',value:{kind:'text',text:'현재 테이블의 규칙'}}]}]};}
test('waiting current information is a readonly local modal; underlying setup cannot submit',()=>{
 const f=fixture(informationDocument());f.activate('information-open');expect(f.view.informationOpen).toBe(true);expect(f.table.inspect().frame?.modalId).toBe('dialog');expect(f.table.inspect().frame?.nodes.find(node=>node.id==='information-title')?.label).toBe('현재 대기 상태 1');f.activate('setup');expect(f.admit).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.session.snapshot().operations).toEqual([]);
 f.activate('information-close');expect(f.view.informationOpen).toBe(false);expect(f.table.inspect().focusId).toBe('information-open');expect(f.session.snapshot().document?.context.revision).toBe('1');f.dispose();
});
test('Back and dismiss close current information and return focus without commands or rereads',()=>{
 const f=fixture(informationDocument());for(const method of ['back','dismiss']){f.activate('information-open');expect(f.view.informationOpen).toBe(true);if(method==='back')expect(f.table.back()).toBe(true);else f.callbacks.intent({kind:'dismiss',frameId:f.table.inspect().frame!.id});expect(f.view.informationOpen).toBe(false);expect(f.table.inspect().focusId).toBe('information-open');}
 expect(f.admit).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.session.snapshot().operations).toEqual([]);f.dispose();
});
test('current information follows compatible current metadata while stale close frames cannot close newer modal',()=>{
 const f=fixture(informationDocument());f.activate('information-open');const old=f.table.inspect().frame!.id;f.session.receive(informationDocument('2'));expect(f.view.informationOpen).toBe(true);expect(f.table.inspect().frame?.nodes.find(node=>node.id==='information-title')?.label).toBe('현재 대기 상태 2');f.activate('information-close',old);expect(f.view.informationOpen).toBe(true);f.activate('setup');expect(f.admit).not.toHaveBeenCalled();f.dispose();
});
test('scope replacement or full revoke retires current-information state and held controls cannot resurrect it',()=>{
 for(const mode of ['scope','revoke']){const f=fixture(informationDocument());f.activate('information-open');const held=f.table.inspect().frame!.id;f.callbacks.intent({kind:'begin',nodeId:'information-close',frameId:held});
 if(mode==='revoke')f.session.revoke();const next=informationDocument('2');f.session.receive({...next,context:{...next.context,audience:'bob'}});expect(f.view.informationOpen).toBe(false);f.activate('information-close',held);expect(f.view.informationOpen).toBe(false);expect(f.table.inspect().frame?.modalId).toBeUndefined();expect(f.admit).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();f.dispose();}
});
test('held opener from an older waiting revision cannot toggle the new current-information surface',()=>{
 const f=fixture(informationDocument()),old=f.table.inspect().frame!.id;f.callbacks.intent({kind:'begin',nodeId:'information-open',frameId:old});f.session.receive(informationDocument('2'));f.activate('information-open',old);f.activate('information-open');expect(f.view.informationOpen).toBe(false);
 f.callbacks.intent({kind:'begin',nodeId:'information-open',frameId:f.table.inspect().frame!.id});f.activate('information-open');expect(f.view.informationOpen).toBe(true);expect(f.admit).not.toHaveBeenCalled();f.dispose();
});
