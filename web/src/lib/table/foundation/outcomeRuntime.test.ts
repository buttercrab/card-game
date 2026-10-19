import {expect,test,vi} from 'vitest';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import type {ChoiceView,Environment,Planner,SurfaceCallbacks,SurfacePort,TableDocument} from './contracts';
type Action={type:'start'|'ready';hand:number};
const environment:Environment={width:500,height:350,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
function document({revision='1',offer='hand-1-offer',enabled=true,name='Alice'}={}):TableDocument<Action>{return{
 context:{session:'table',audience:'alice:0',generation:'hand-1',revision},participant:{id:'alice',name,markers:[]},hand:[],facts:[],
 information:[{id:'settled-result',title:'이번 판 결과',fields:[{id:'winner',label:'결과',value:{kind:'text',text:'승리'}}]}],
 decision:{kind:'commands',id:'between-hands',commands:['next','ready']},offer:{id:offer,actions:[{id:'next',kind:'command',label:'다음 판',intent:'primary',enabled,action:{type:'start',hand:2}},{id:'ready',kind:'command',label:'준비',intent:'secondary',enabled:true,action:{type:'ready',hand:2}}]},
 outcome:{id:'settled-hand-1',informationId:'settled-result',continuationActionIds:['next']},
};}
function fixture(source=document()){
 const send=vi.fn(),session=createCardSession<Action>({transport:send});session.receive(source);const admit=vi.spyOn(session,'admitDecision');let callbacks:SurfaceCallbacks,latest:ChoiceView;
 const planner:Planner=(_doc,_env,view)=>{latest=view;return{kind:'ready',layout:{width:500,height:350,recipe:'stacked',nodes:[{id:'root',parent:null,kind:'group',label:'결과 테이블',box:{x:0,y:0,width:500,height:350}},
 ...view.commands.map((command,index)=>({id:`ordinary-${command.id}`,parent:'root',kind:'command' as const,label:command.label,actionId:command.id,enabled:command.enabled,box:{x:10+index*140,y:10,width:120,height:44}})),
 ...(view.outcomeCommands??[]).map((command,index)=>({id:`outcome-${command.id}`,parent:'root',kind:'command' as const,label:command.label,actionId:command.id,enabled:command.enabled,box:{x:10+index*140,y:80,width:120,height:44}})),
 ]}};};
 const surface:SurfacePort={identity:{},environment:()=>environment,listen(next){callbacks=next;return()=>{};},measure:()=>()=>{},publish:vi.fn(),disarm:vi.fn(),invalidate:vi.fn(),fallback:vi.fn(),clear:vi.fn()};
 const table=createCardTable({session,planner});table.attach(surface);
 const activate=(nodeId='outcome-next',frameId=table.inspect().frame!.id)=>callbacks.intent({kind:'activate',nodeId,frameId});
 const begin=(nodeId='outcome-next',frameId=table.inspect().frame!.id)=>callbacks.intent({kind:'begin',nodeId,frameId});
 return{session,table,surface,send,admit,activate,begin,get callbacks(){return callbacks!;},get view(){return latest!;},dispose(){table.dispose();session.dispose();}};
}
test('outcome commands have one presentation owner without creating a second action offer',()=>{
 const source=document(),f=fixture(source);expect(f.table.inspect().frame?.settled).toBe(true);expect(f.view.commands.map(command=>command.id)).toEqual(['ready']);expect(f.view.outcomeCommands?.map(command=>command.id)).toEqual(['next']);expect(f.table.inspect().frame!.nodes.filter(node=>node.actionId==='next')).toHaveLength(1);
 expect(f.session.snapshot().document!.offer.actions.map(action=>action.id)).toEqual(source.offer.actions.map(action=>action.id));expect(f.admit).not.toHaveBeenCalled();f.dispose();
});
test('fresh continuation enters the normal canonical ledger exactly once',async()=>{
 const f=fixture(),frame=f.table.inspect().frame!.id;f.activate('outcome-next',frame);f.activate('outcome-next',frame);f.activate();await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);expect(f.admit).toHaveBeenCalledTimes(1);
 const submission=f.send.mock.calls[0][0];expect(submission).toMatchObject({offerId:'hand-1-offer',actionId:'next',action:{type:'start',hand:2},context:{generation:'hand-1',revision:'1'}});expect(f.session.snapshot().operations).toEqual([expect.objectContaining({id:submission.id,offerId:'hand-1-offer',status:'uncertain'})]);expect(f.view.outcomeCommands?.[0].enabled).toBe(false);f.dispose();
});
test('disabled and offline continuation views never bypass ordinary command admission',async()=>{
 const disabled=fixture(document({enabled:false}));expect(disabled.view.outcomeCommands?.[0].enabled).toBe(false);disabled.activate();await Promise.resolve();expect(disabled.admit).not.toHaveBeenCalled();expect(disabled.send).not.toHaveBeenCalled();disabled.dispose();
 const f=fixture();f.session.setConnected(false);expect(f.view.outcomeCommands?.[0].enabled).toBe(false);f.activate();expect(f.admit).not.toHaveBeenCalled();f.session.setConnected(true);f.session.receive(document({revision:'2',offer:'reconnected'}));expect(f.view.outcomeCommands?.[0].enabled).toBe(true);f.begin();f.activate();await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);f.dispose();
});
test('held continuation gestures are cancelled on geometry changes and require a fresh press',async()=>{
 const f=fixture(),old=f.table.inspect().frame!.id;f.begin();f.callbacks.environment({...environment,revision:'resized'});f.activate('outcome-next',old);f.activate();expect(f.admit).not.toHaveBeenCalled();f.begin();f.activate();await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);f.dispose();
});
test('new authority cannot reuse a held result continuation gesture or its old frame',async()=>{
 const f=fixture(),old=f.table.inspect().frame!.id;f.begin();f.session.receive(document({revision:'2',offer:'next-authority'}));f.activate('outcome-next',old);f.activate();expect(f.admit).not.toHaveBeenCalled();f.begin();f.activate();await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);expect(f.send.mock.calls[0][0]).toMatchObject({offerId:'next-authority',context:{revision:'2'},actionId:'next'});f.dispose();
});
test('benign metadata revisions retain settled identity and cannot reopen an already accepted offer',async()=>{
 const f=fixture();const outcome=f.session.snapshot().document!.outcome;f.activate();await Promise.resolve();const operation=f.session.snapshot().operations[0];expect(f.session.resolve(operation.id,'accepted')).toBe(true);
 f.session.receive(document({revision:'2',name:'Alice · 새 표시 이름'}));expect(f.session.snapshot().document!.outcome).toEqual(outcome);expect(f.view.outcomeCommands?.map(command=>command.id)).toEqual(['next']);expect(f.view.outcomeCommands?.[0].enabled).toBe(false);f.activate();await Promise.resolve();expect(f.send).toHaveBeenCalledTimes(1);f.dispose();
});
test('canonical receive rejects invalid outcome references atomically against the prior document',()=>{
 const f=fixture(),before=f.session.snapshot().document!,base=document({revision:'2'});
 const shell:NonNullable<TableDocument<Action>['shell']>={roomCode:'room',header:{codeLabel:'room',connection:'open',connectionLabel:'연결됨',observerCount:0,observerLabel:'관전자 0명',requestCount:0,requestLabel:'참여 0건',actions:[{id:'shell-next',purpose:'operation',label:'다음 판',enabled:true,intent:{kind:'command',actionId:'next'},subjects:[{kind:'room',roomId:'room'}]}]},pages:[{id:'menu',title:'메뉴',actions:[]}],notices:[],effects:[]};
 const invalid:TableDocument<Action>[]=[{...base,information:[]},{...base,information:[...base.information!,...base.information!]},{...base,outcome:{...base.outcome!,continuationActionIds:['invented']}},{...base,shell},
 {...base,decision:{kind:'finite-choice',id:'choice',commands:['next','ready'],fields:[{id:'mode',label:'선택',options:[{id:'next-mode',label:'다음',enabled:true}]}],variants:[{tuple:{mode:'next-mode'},actionId:'next'}],initialValues:{mode:'next-mode'},reconciliation:'preserve-compatible',submit:{unavailable:'disabled'}}}];
 for(const value of invalid){expect(()=>f.session.receive(value)).toThrow();expect(f.session.snapshot().document).toBe(before);expect(f.table.inspect().frame!.context.revision).toBe('1');}
 let reads=0;const descriptor=Object.defineProperty({...base.outcome!},'informationId',{get(){reads++;return 'settled-result';},enumerable:true});expect(()=>f.session.receive({...base,outcome:descriptor})).toThrow();expect(reads).toBe(0);expect(f.session.snapshot().document).toBe(before);f.dispose();
});
test('canonical outcome and exact continuation payload own immutable copies of caller data',()=>{
 const ids=['next'],source={...document(),outcome:{id:'settled-hand-1',informationId:'settled-result',continuationActionIds:ids}},f=fixture(source),owned=f.session.snapshot().document!;
 expect(owned.outcome).not.toBe(source.outcome);expect(Object.isFrozen(owned.outcome)).toBe(true);expect(Object.isFrozen(owned.outcome!.continuationActionIds)).toBe(true);ids[0]='ready';expect(owned.outcome!.continuationActionIds).toEqual(['next']);
 const command=source.offer.actions[0];if(command.kind!=='command')throw Error('command');command.action.hand=999;expect(owned.offer.actions[0]).toMatchObject({action:{type:'start',hand:2}});f.dispose();
});

test('reauthorizing the same public settled outcome starts a fresh motion baseline',()=>{
 const f=fixture();f.session.receive(document({revision:'2'}),{connected:false});(f.surface.clear as ReturnType<typeof vi.fn>).mockClear();
 f.session.receive(document({revision:'3'}),{connected:true});expect(f.surface.clear).toHaveBeenCalledTimes(1);expect(f.table.inspect().frame?.context.revision).toBe('3');
 (f.surface.clear as ReturnType<typeof vi.fn>).mockClear();f.session.receive(document({revision:'4'}),{connected:true});expect(f.surface.clear).not.toHaveBeenCalled();f.dispose();
});
