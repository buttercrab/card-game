import {expect,test} from 'vitest';
import {captureAssistance,cloneAssistanceData,createAssistanceSnapshot,inspectAssistance,resolveAssistanceIntent,sameAssistanceGameScope,validateAssistance,type AssistanceBindings,type AssistanceProjection} from './assistance';
function fixture(){
    const scope={context:{session:'session',audience:'alice:0',generation:'hand1',revision:'r1'},roomId:'room',roomEpoch:'epoch',connectionEpoch:'connection',actorId:'alice',seat:0,gameVersion:7};
    const authority={scope,connected:true,activeTurn:true,ownHandAuthorized:true};
    const option={id:'clap',text:'👏',label:'박수'};
    const bindings:AssistanceBindings={authority,handIds:['ace','two'],actions:[{id:'play-ace',label:'에이스 내기',cardIds:['ace']}],participantIds:['alice','bob'],reactionOptions:[option]};
    const projection:AssistanceProjection={scope,offerId:'offer',tools:[{id:'hint',kind:'request-advice',label:'도움말',enabled:true,shortcut:'H'},{id:'reaction',kind:'send-reaction',label:'반응',enabled:true,shortcut:'R',options:[option]}],advice:{id:'advice',label:'에이스 내기',actionId:'play-ace',cardIds:['ace']},guidance:'무늬를 따라 내세요',inspections:[{cardId:'two',reason:'무늬를 따라야 해요'}],reactions:[{eventId:'event1',participantId:'bob',text:'👏'}]};
    return {scope,authority,bindings,projection};
}
test('exact offered assistance operations are frozen, bounded and distinct from game submissions',()=>{
    const f=fixture(),snapshot=createAssistanceSnapshot(f.projection,f.bindings);
    const hint=captureAssistance(snapshot,f.authority,'hint')!;
    expect(resolveAssistanceIntent(snapshot,f.authority,hint)).toEqual({kind:'request-advice',scope:f.scope});
    const reaction=captureAssistance(snapshot,f.authority,'reaction','clap')!;
    expect(resolveAssistanceIntent(snapshot,f.authority,reaction)).toEqual({kind:'send-reaction',scope:f.scope,optionId:'clap',text:'👏'});
    expect(Object.isFrozen(snapshot.bindings.actions[0].cardIds)).toBe(true);
    f.scope.context.revision='mutated';
    expect(snapshot.projection.scope.context.revision).toBe('r1');
    expect(captureAssistance(snapshot,snapshot.bindings.authority,'reaction','injected')).toBeNull();
    expect(captureAssistance(snapshot,snapshot.bindings.authority,'hint','clap')).toBeNull();
});
test('every authority replacement revokes captured input and presentation-only changes cannot activate old tools',()=>{
    const f=fixture(),snapshot=createAssistanceSnapshot(f.projection,f.bindings),intent=captureAssistance(snapshot,f.authority,'hint')!;
    for(const scope of [{...f.scope,roomEpoch:'new'},{...f.scope,connectionEpoch:'new'},{...f.scope,actorId:'bob'},{...f.scope,seat:1},{...f.scope,gameVersion:8},{...f.scope,context:{...f.scope.context,revision:'r2'}},{...f.scope,context:{...f.scope.context,generation:'new'}}]){
        expect(resolveAssistanceIntent(snapshot,{...f.authority,scope},intent)).toBeNull();
    }
    for(const revoked of [{connected:false},{activeTurn:false},{ownHandAuthorized:false}])expect(resolveAssistanceIntent(snapshot,{...f.authority,...revoked},intent)).toBeNull();
    expect(sameAssistanceGameScope(f.scope,{...f.scope,context:{...f.scope.context,revision:'r2'}})).toBe(true);
});
test('advice binds exact label and card set; unoffered/private/unknown presentations fail closed',()=>{
    const f=fixture();
    for(const advice of [{...f.projection.advice!,actionId:'fabricated'},{...f.projection.advice!,cardIds:['two']},{...f.projection.advice!,label:'fabricated'}])expect(validateAssistance({...f.projection,advice},f.bindings).length).toBeGreaterThan(0);
    expect(validateAssistance({...f.projection,reactions:[{eventId:'e',participantId:'stranger',text:'👏'}]},f.bindings).length).toBeGreaterThan(0);
    expect(validateAssistance({...f.projection,reactions:[{eventId:'e',participantId:'bob',text:'injection'}]},f.bindings).length).toBeGreaterThan(0);
    expect(validateAssistance(f.projection,{...f.bindings,authority:{...f.authority,ownHandAuthorized:false,activeTurn:false}}).length).toBeGreaterThan(0);
});
test('blocked-card inspection is read-only data with no operation or draft payload',()=>{
    const f=fixture(),snapshot=createAssistanceSnapshot(f.projection,f.bindings);
    expect(inspectAssistance(snapshot,f.authority,'two')).toEqual({cardId:'two',reason:'무늬를 따라야 해요'});
    expect(inspectAssistance(snapshot,f.authority,'ace')).toBeNull();
    expect(inspectAssistance(snapshot,{...f.authority,activeTurn:false},'two')).toBeNull();
    expect(captureAssistance(snapshot,f.authority,'two')).toBeNull();
    expect(validateAssistance({...f.projection,inspections:[{cardId:'ace',reason:'fabricated refusal'}]},f.bindings).length).toBeGreaterThan(0);
});
test('admission rejects accessors without executing them, functions, cycles and oversized data',()=>{
    const f=fixture();let reads=0;
    const evil=Object.defineProperty({...f.projection},'offerId',{get(){reads++;return 'offer';}});
    expect(validateAssistance(evil,f.bindings).length).toBeGreaterThan(0);expect(reads).toBe(0);
    const snapshot=createAssistanceSnapshot(f.projection,f.bindings);
    const evilAuthority=Object.defineProperty({...f.authority},'connected',{get(){reads++;return true;}});
    expect(captureAssistance(snapshot,evilAuthority,'hint')).toBeNull();expect(reads).toBe(0);
    expect(()=>cloneAssistanceData({callback:()=>true})).toThrow();
    const cyclic:{self?:unknown}={};cyclic.self=cyclic;expect(()=>cloneAssistanceData(cyclic)).toThrow();
    expect(()=>cloneAssistanceData('x'.repeat(8193))).toThrow();
    expect(()=>cloneAssistanceData(new Date())).toThrow();
});
