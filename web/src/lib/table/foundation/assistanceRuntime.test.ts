import {expect,test,vi} from 'vitest';
import {createAssistanceSnapshot,type AssistanceBindings,type AssistanceProjection,type AssistanceOperation} from './assistance';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import type {Environment,Planner,PlannedNode,SurfaceCallbacks,SurfacePort,TableDocument} from './contracts';
const environment:Environment={width:500,height:700,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
const reactions=[{id:'clap',text:'👏',label:'박수'},{id:'smile',text:'🙂',label:'웃음'}];
function document({revision='1',advice=false,spectator=false,offer='tools-1'}={}):TableDocument<string>{
 const context={session:'room',audience:spectator?'watcher':'alice:0',generation:'hand1',revision};
 const scope={context,roomId:'room',roomEpoch:'epoch',connectionEpoch:'connection1',actorId:spectator?'watcher':'alice',seat:spectator?null:0,gameVersion:spectator?null:7};
 const bindings:AssistanceBindings={authority:{scope,connected:true,activeTurn:!spectator,ownHandAuthorized:!spectator},handIds:spectator?[]:['ace','two'],actions:spectator?[]:[{id:'play',label:'에이스 내기',cardIds:['ace']}],participantIds:['alice','bob'],reactionOptions:reactions};
 const projection:AssistanceProjection={scope,offerId:offer,tools:[...(!spectator?[{id:'hint',kind:'request-advice' as const,label:'힌트',enabled:true,shortcut:'H' as const}]:[]),{id:'reaction',kind:'send-reaction',label:'반응',enabled:true,shortcut:'R',options:reactions}],inspections:spectator?[]:[{cardId:'two',reason:'기루다를 따라야 해요.'}],reactions:[],...(!spectator?{guidance:'같은 무늬를 따라 내세요.'}:{}),...(advice&&!spectator?{advice:{id:'advice1',label:'에이스 내기',actionId:'play',cardIds:['ace']}}:{})};
 return {context,...(spectator?{shell:{roomCode:'room',header:{codeLabel:'room',connection:'open' as const,connectionLabel:'연결됨',observerCount:1,observerLabel:'1명',requestCount:0,requestLabel:'0건',actions:[]},notices:[],effects:[],pages:[{id:'people' as const,title:'함께 있는 사람',actions:[],anonymousObservers:0,people:[{id:'alice',name:'Alice',kind:'human' as const,mine:false,status:'플레이 중'},{id:'bob',name:'Bob',kind:'human' as const,mine:false,status:'플레이 중'},{id:'watcher',name:'Watcher',kind:'observer' as const,mine:true,status:'관전 중'}]}]}}:{}),participant:{id:spectator?'watcher':'alice',name:'Alice',markers:[],...(spectator?{role:'observer' as const}:{})},opponents:[{id:'bob',name:'Bob',handCount:0}],hand:spectator?[]:[{id:'ace',label:'스페이드 에이스',visual:{kind:'standard',suit:'Spade',rank:14}},{id:'two',label:'하트 2',visual:{kind:'standard',suit:'Heart',rank:2}}],facts:[],decision:spectator?{id:'watch',kind:'commands',commands:[]}:{id:'play',kind:'card-selection',commands:[],mode:'one',variants:[{cardIds:['ace'],actionId:'play'}],submit:{prefix:'내기'}},offer:{id:`game-${revision}`,actions:spectator?[]:[{id:'play',kind:'command',label:'에이스 내기',intent:'primary',enabled:true,action:'play'}]},assistance:createAssistanceSnapshot(projection,bindings)};
}
const planner:Planner=(doc,_environment,view)=>{
 const nodes:PlannedNode[]=[{id:'root',parent:null,kind:'group',label:'테이블',box:{x:0,y:0,width:500,height:700}}];
 const button=(id:string,y:number,assistanceIntent:PlannedNode['assistanceIntent'],x=10)=>nodes.push({id,parent:'root',kind:'command',label:id,enabled:true,assistanceIntent,box:{x,y,width:120,height:44}});
 for(const tool of view.assistance?.projection.tools??[])button(tool.id,10,tool.kind==='request-advice'?{kind:'tool',toolId:tool.id}:{kind:'toggle-reactions'},tool.kind==='request-advice'?10:150);
 for(const [index,card] of doc.hand.entries())nodes.push({id:`card-${card.id}`,parent:'root',kind:'card',label:card.label,...(index===1?(view.assistance?.projection.inspections.some(item=>item.cardId===card.id)?{inspectCardId:card.id}:{}):{cardId:card.id}),enabled:index===0||!!view.assistance?.projection.inspections.some(item=>item.cardId===card.id),visual:card.visual,checked:view.cards?.selected.includes(card.id),box:{x:10+index*100,y:80,width:88,height:124}});
 if(view.assistance?.projection.guidance)nodes.push({id:'guidance',parent:'root',kind:'text',label:view.assistance.projection.guidance,box:{x:10,y:520,width:400,height:24}});
 if(view.assistance?.adviceOpen){nodes.push({id:'advice-text',parent:'root',kind:'text',label:view.assistance.projection.advice!.label,box:{x:10,y:220,width:300,height:24}});button('dismiss-advice',250,{kind:'dismiss-advice'});}
 if(view.assistance?.inspection){nodes.push({id:'inspection-text',parent:'root',kind:'text',label:view.assistance.inspection.reason,box:{x:10,y:310,width:400,height:24}});button('dismiss-inspection',340,{kind:'dismiss-inspection'});}
 if(view.assistance?.reactionsOpen){button('clap',410,{kind:'tool',toolId:'reaction',optionId:'clap'});button('unknown',410,{kind:'tool',toolId:'reaction',optionId:'injected'},150);button('close-palette',470,{kind:'close-reactions'});}
 return {kind:'ready',layout:{width:500,height:700,recipe:'stacked',nodes}};
};
function fixture(initial=document()){
 const invoke=vi.fn<(operation:AssistanceOperation)=>boolean>(()=>true),send=vi.fn(),session=createCardSession<string>({transport:send});session.receive(initial);const admit=vi.spyOn(session,'admit');let callbacks:SurfaceCallbacks;
 const surface:SurfacePort={identity:{},environment:()=>environment,listen(next){callbacks=next;return()=>{};},measure:()=>()=>{},publish:vi.fn(),disarm:vi.fn(),invalidate:vi.fn(),fallback:vi.fn(),clear:vi.fn()};
 const table=createCardTable({session,planner,assistance:{invoke}});table.attach(surface);
 if(!table.inspect().frame)throw new Error(JSON.stringify({runtime:table.inspect(),fallback:(surface.fallback as ReturnType<typeof vi.fn>).mock.calls}));
 const activate=(nodeId:string,frameId=table.inspect().frame!.id)=>callbacks.intent({kind:'activate',frameId,nodeId});
 const shortcut=(key:'H'|'R',frameId=table.inspect().frame!.id)=>callbacks.intent({kind:'shortcut',frameId,key});
 return{session,table,invoke,send,admit,activate,shortcut,get callbacks(){return callbacks!;},dispose(){table.dispose();session.dispose();}};
}
test('H invokes only captured ephemeral advice authority; stale frames and replaced tools cannot submit',async()=>{
 const f=fixture(),old=f.table.inspect().frame!.id;f.shortcut('H');expect(f.invoke).toHaveBeenCalledTimes(1);expect(f.invoke.mock.calls[0][0]).toMatchObject({kind:'request-advice',scope:{actorId:'alice',gameVersion:7}});
 f.session.receive(document({revision:'2',offer:'replacement'}));f.shortcut('H',old);f.activate('hint',old);expect(f.invoke).toHaveBeenCalledTimes(1);
 f.table.detach();f.shortcut('H',old);await Promise.resolve();expect(f.admit).not.toHaveBeenCalled();expect(f.send).not.toHaveBeenCalled();expect(f.session.snapshot().operations).toEqual([]);f.dispose();
});
test('advice dismissal and reopening use the existing advice without requesting or selecting a command',()=>{
 const f=fixture(document({advice:true}));f.shortcut('H');expect(f.table.inspect().frame!.nodes.some(node=>node.id==='advice-text')).toBe(true);f.activate('dismiss-advice');expect(f.table.inspect().frame!.nodes.some(node=>node.id==='advice-text')).toBe(false);
 f.shortcut('H');expect(f.table.inspect().frame!.nodes.some(node=>node.id==='advice-text')).toBe(true);expect(f.invoke).not.toHaveBeenCalled();expect(f.admit).not.toHaveBeenCalled();expect(f.table.inspect().frame!.nodes.filter(node=>node.checked)).toEqual([]);f.dispose();
});
test('blocked-card inspection explains refusal without ordinary admission or changing selection',()=>{
 const f=fixture();f.activate('card-two');expect(f.table.inspect().frame!.nodes.find(node=>node.id==='inspection-text')?.label).toBe('기루다를 따라야 해요.');expect(f.table.inspect().frame!.nodes.filter(node=>node.checked)).toEqual([]);expect(f.invoke).not.toHaveBeenCalled();expect(f.admit).not.toHaveBeenCalled();
 f.activate('dismiss-inspection');expect(f.table.inspect().frame!.nodes.some(node=>node.id==='inspection-text')).toBe(false);f.dispose();
});
test('spectators can use the exact offered reaction palette, never injected options or private advice',()=>{
 const f=fixture(document({spectator:true}));f.shortcut('H');expect(f.invoke).not.toHaveBeenCalled();f.shortcut('R');expect(f.table.inspect().frame!.nodes.some(node=>node.id==='clap')).toBe(true);
 f.activate('unknown');expect(f.invoke).not.toHaveBeenCalled();f.activate('clap');expect(f.invoke).toHaveBeenCalledTimes(1);expect(f.invoke.mock.calls[0][0]).toMatchObject({kind:'send-reaction',optionId:'clap',text:'👏',scope:{seat:null,actorId:'watcher'}});expect(f.admit).not.toHaveBeenCalled();expect(f.session.snapshot().operations).toEqual([]);f.dispose();
});
test('session rejects self-consistent assistance that invents document cards, command bindings or context',()=>{
 for(const change of ['card','command','context']){const value=document(),snapshot=value.assistance!;const bindings={...snapshot.bindings,actions:snapshot.bindings.actions.map(action=>({...action,cardIds:[...action.cardIds]}))},projection={...snapshot.projection};
  if(change==='card'){bindings.handIds=['ace','two','invented'];}
  if(change==='command'){bindings.actions=[{id:'invented',label:'조작',cardIds:['ace']}];}
  if(change==='context'){const scope={...snapshot.projection.scope,context:{...value.context,audience:'other'}};projection.scope=scope;bindings.authority={...bindings.authority,scope};}
  const assistance=createAssistanceSnapshot(projection,bindings),session=createCardSession<string>({transport:()=>{}});expect(()=>session.receive({...value,assistance})).toThrow();expect(session.snapshot().document).toBeNull();session.dispose();
 }
});
test('disconnect clears private advice and inspection and cannot invoke retained tools',()=>{
 const f=fixture(document({advice:true}));f.shortcut('H');expect(f.table.inspect().frame!.nodes.map(node=>node.id)).toEqual(expect.arrayContaining(['advice-text','guidance','hint','reaction']));
 f.session.setConnected(false);expect(f.table.inspect().frame!.nodes.some(node=>['advice-text','inspection-text','guidance','hint','reaction'].includes(node.id))).toBe(false);
 f.shortcut('H');f.shortcut('R');f.activate('card-two');expect(f.invoke).not.toHaveBeenCalled();expect(f.admit).not.toHaveBeenCalled();f.dispose();
});
test('reentrant ephemeral invocation revocation cannot restore the old private frame or admit gameplay',()=>{
 const f=fixture(),frame=f.table.inspect().frame!.id;f.invoke.mockImplementationOnce(operation=>{expect(Object.isFrozen(operation.scope.context)).toBe(true);f.session.revoke();return true;});
 f.shortcut('H',frame);expect(f.invoke).toHaveBeenCalledTimes(1);expect(f.table.inspect().frame).toBeNull();f.shortcut('H',frame);expect(f.invoke).toHaveBeenCalledTimes(1);expect(f.admit).not.toHaveBeenCalled();expect(f.session.snapshot().operations).toEqual([]);f.dispose();
});
