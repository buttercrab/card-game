import {describe,it,expect,vi} from 'vitest';
import {createCardTable} from './runtime';
import {createCardSession} from './session';
import type { CandidateLayout, Environment, Planner, SurfaceCallbacks, SurfacePort } from './contracts';
const env:Environment={width:500,height:500,revision:'1',fontRevision:'font-1',controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}},fontFamily:'sans-serif',textScale:1};
const action={play:true};
const doc=(revision='1',generation='1')=>({context:{session:'s',audience:'a',generation,revision},participant:{id:'p',name:'Player',markers:[]},hand:[],facts:[],decision:{id:'d',kind:'commands' as const,commands:['play']},offer:{id:`o${revision}`,actions:[{id:'play',kind:'command' as const,label:'Play',intent:'primary' as const,enabled:true,action}]}});
const layout:CandidateLayout={width:500,height:500,recipe:'stacked',nodes:[{id:'root',parent:null,kind:'group',box:{x:0,y:0,width:500,height:500},label:'Table'},{id:'play',parent:'root',kind:'command',box:{x:10,y:10,width:100,height:48},label:'Play',actionId:'play',enabled:true}]};
const planner:Planner=()=>({kind:'ready',layout});
function host(){let callbacks:SurfaceCallbacks|null=null;const release=vi.fn();const surface:SurfacePort={identity:{},environment:()=>env,listen(value){callbacks=value;return release;},measure:()=>()=>{},publish:vi.fn(),disarm:vi.fn(),invalidate:vi.fn(),fallback:vi.fn(),clear:vi.fn()};return{surface,release,get callbacks(){return callbacks!;}};}
describe('foundation runtime ownership',()=>{
  it('creates without DOM effects, rejects duplicate writer, releases ownership',()=>{const session=createCardSession({transport:()=>{}});session.receive(doc());const first=createCardTable({session,planner}),second=createCardTable({session,planner}),h=host();expect(first.inspect().resourceCount).toBe(0);first.attach(h.surface);expect(first.inspect().status).toBe('ready');expect(()=>second.attach(h.surface)).toThrow('writer');expect(h.surface.clear).not.toHaveBeenCalled();first.detach();expect(h.release).toHaveBeenCalledTimes(1);second.attach(h.surface);expect(second.inspect().status).toBe('ready');second.dispose();});
  it('ignores detached callbacks and foreign frames, session outlives mount',async()=>{const send=vi.fn(),session=createCardSession({transport:send});session.receive(doc());const table=createCardTable({session,planner}),h=host();table.attach(h.surface);const old=h.callbacks,frame=table.inspect().frame!;old.intent({kind:'activate',frameId:frame.id+1,nodeId:'play'});expect(session.snapshot().operations).toHaveLength(0);old.intent({kind:'activate',frameId:frame.id,nodeId:'play'});table.detach();old.intent({kind:'activate',frameId:frame.id,nodeId:'play'});await Promise.resolve();expect(send).toHaveBeenCalledTimes(1);expect(session.snapshot().operations[0].status).toBe('uncertain');table.attach(h.surface);old.environment({...env,revision:'old'});expect(table.inspect().frame?.environment.revision).toBe('1');table.dispose();old.intent({kind:'activate',frameId:frame.id,nodeId:'play'});expect(table.inspect().resourceCount).toBe(0);});
  it('cancels held gestures on geometry changes',()=>{const session=createCardSession({transport:()=>{}});session.receive(doc());const table=createCardTable({session,planner}),h=host();table.attach(h.surface);const frame=table.inspect().frame!;h.callbacks.intent({kind:'begin',frameId:frame.id,nodeId:'play'});h.callbacks.environment({...env,revision:'2'});h.callbacks.intent({kind:'activate',frameId:frame.id,nodeId:'play'});expect(session.snapshot().operations).toHaveLength(0);table.dispose();});
  it('never publishes invalid geometry and never retains a failed frame',()=>{const session=createCardSession({transport:()=>{}});session.receive(doc());const h=host();const table=createCardTable({session,planner:()=>({kind:'ready',layout:{...layout,nodes:[{...layout.nodes[0],box:{x:0,y:0,width:NaN,height:500}}]}})});table.attach(h.surface);expect(h.surface.publish).not.toHaveBeenCalled();expect(table.inspect().status).toBe('failed');expect(table.inspect().frame).toBe(null);table.dispose();});
  it('does not commit a frame revoked reentrantly during publish',()=>{const session=createCardSession({transport:()=>{}});session.receive(doc());const h=host();h.surface.publish=()=>session.revoke();const table=createCardTable({session,planner});table.attach(h.surface);expect(table.inspect().frame).toBe(null);expect(table.inspect().status).toBe('empty');table.dispose();});
  it('reclaims pending measurements and ignores late replies across scopes',()=>{const session=createCardSession({transport:()=>{}});session.receive(doc());const h=host(),cancel=vi.fn();let reply:((values:readonly {key:string;size:{width:number;height:number}}[])=>void)|null=null;h.surface.measure=(_requests,callback)=>{reply=callback;return cancel;};const needs:Planner=()=>({kind:'needs',requests:[{key:'a',text:'a',role:'body',width:null,environment:env}]});const table=createCardTable({session,planner:needs});table.attach(h.surface);expect(table.inspect().resourceCount).toBe(3);const late=reply!;session.receive(doc('2','2'));late([{key:'a',size:{width:3,height:3}}]);expect(table.inspect().cacheSize).toBe(0);table.detach();expect(cancel).toHaveBeenCalledTimes(2);expect(table.inspect().resourceCount).toBe(0);});
  it('bounds nonconverging measurement passes and publication failures',()=>{const session=createCardSession({transport:()=>{}});session.receive(doc());const h=host();h.surface.measure=(requests,reply)=>{reply(requests.map(request=>({key:request.key,size:{width:1,height:1}})));return()=>{};};const table=createCardTable({session,planner:()=>({kind:'needs',requests:[{key:'a',text:'a',role:'body',width:null,environment:env}]})});table.attach(h.surface);expect(table.inspect().status).toBe('failed');expect(table.inspect().resourceCount).toBe(1);table.dispose();const other=host();other.surface.publish=()=>{throw new Error('partial');};const failure=createCardTable({session,planner});failure.attach(other.surface);expect(failure.inspect().frame).toBe(null);expect(other.surface.fallback).toHaveBeenCalledWith('Frame publication failed');failure.dispose();});
  it('rejects copied frame identities between roots and cancelled current-frame activations',()=>{const session=createCardSession({transport:()=>{}});session.receive(doc());const first=createCardTable({session,planner}),second=createCardTable({session,planner}),a=host(),b=host();first.attach(a.surface);second.attach(b.surface);const foreign=first.inspect().frame!;b.callbacks.intent({kind:'activate',frameId:foreign.id,nodeId:'play'});expect(session.snapshot().operations).toHaveLength(0);const original=second.inspect().frame!;b.callbacks.intent({kind:'begin',frameId:original.id,nodeId:'play'});b.callbacks.environment({...env,revision:'new'});b.callbacks.intent({kind:'activate',frameId:second.inspect().frame!.id,nodeId:'play'});expect(session.snapshot().operations).toHaveLength(0);first.dispose();second.dispose();});
  it('bounds reentrant publication updates',()=>{const session=createCardSession({transport:()=>{}});session.receive(doc());const h=host();let count=0;h.surface.publish=()=>session.receive(doc(String(++count)));const table=createCardTable({session,planner});table.attach(h.surface);expect(count).toBeLessThanOrEqual(16);expect(table.inspect().status).toBe('failed');table.dispose();});
  it('clears writes performed after reentrant revocation and disables pending commands',()=>{const session=createCardSession({transport:()=>{}});session.receive(doc());const h=host();let privateVisible=false;h.surface.publish=()=>{session.revoke();privateVisible=true;};h.surface.clear=()=>{privateVisible=false;};const table=createCardTable({session,planner});table.attach(h.surface);expect(privateVisible).toBe(false);table.dispose();});

  it('fails partial measurement replies without publishing a partial frame',()=>{const session=createCardSession({transport:()=>{}});session.receive(doc());const h=host();h.surface.measure=(_requests,reply)=>{reply([]);return()=>{};};const table=createCardTable({session,planner:()=>({kind:'needs',requests:[{key:'a',text:'a',role:'body',width:null,environment:env}]})});table.attach(h.surface);expect(table.inspect().status).toBe('failed');expect(h.surface.publish).not.toHaveBeenCalled();expect(table.inspect().resourceCount).toBe(1);table.dispose();});

  it('cannot republish a private document after an earlier subscriber revokes it',()=>{const session=createCardSession({transport:()=>{}});session.subscribe(value=>{if(value.document)session.revoke();});const h=host(),table=createCardTable({session,planner});table.attach(h.surface);session.receive(doc());expect(table.inspect().frame).toBe(null);expect(h.surface.publish).not.toHaveBeenCalled();table.dispose();});
  it('terminates stalled measurement and rejects late callbacks after its deadline',()=>{vi.useFakeTimers();try{const session=createCardSession({transport:()=>{}});session.receive(doc());const h=host();let reply:((values:readonly {key:string;size:{width:number;height:number}}[])=>void)|null=null;h.surface.measure=(_requests,callback)=>{reply=callback;return()=>{};};const table=createCardTable({session,planner:()=>({kind:'needs',requests:[{key:'a',text:'a',role:'body',width:null,environment:env}]})});table.attach(h.surface);vi.advanceTimersByTime(500);expect(table.inspect().status).toBe('failed');expect(table.inspect().resourceCount).toBe(1);reply!([{key:'a',size:{width:10,height:10}}]);expect(table.inspect().cacheSize).toBe(0);table.dispose();}finally{vi.useRealTimers();}});

  it('bounds the whole candidate measurement chain to 500ms',()=>{vi.useFakeTimers();try{const session=createCardSession({transport:()=>{}});session.receive(doc());const h=host();let reply:((values:readonly {key:string;size:{width:number;height:number}}[])=>void)|null=null;h.surface.measure=(_requests,callback)=>{reply=callback;return()=>{};};const table=createCardTable({session,planner:()=>({kind:'needs',requests:[{key:'a',text:'a',role:'body',width:null,environment:env}]})});table.attach(h.surface);vi.advanceTimersByTime(300);reply!([{key:'a',size:{width:10,height:10}}]);expect(table.inspect().status).toBe('measuring');vi.advanceTimersByTime(200);expect(table.inspect().status).toBe('failed');expect(table.inspect().resourceCount).toBe(1);table.dispose();}finally{vi.useRealTimers();}});

  it('owns focus intent across compatible updates and resize, clearing on scope and detach',()=>{const session=createCardSession({transport:()=>{}});session.receive(doc());const h=host(),table=createCardTable({session,planner});table.attach(h.surface);h.callbacks.intent({kind:'focus',frameId:table.inspect().frame!.id,nodeId:'play'});session.receive(doc('2'));expect(table.inspect().frame?.focusId).toBe('play');h.callbacks.environment({...env,revision:'resize'});expect(table.inspect().frame?.focusId).toBe('play');h.callbacks.intent({kind:'focus',frameId:table.inspect().frame!.id,nodeId:null});expect(table.inspect().focusId).toBe(null);h.callbacks.intent({kind:'focus',frameId:table.inspect().frame!.id,nodeId:'play'});session.receive(doc('3','newscope'));expect(table.inspect().frame?.focusId).toBe(null);h.callbacks.intent({kind:'focus',frameId:table.inspect().frame!.id,nodeId:'play'});table.detach();expect(table.inspect().focusId).toBe(null);table.attach(h.surface);expect(table.inspect().frame?.focusId).toBe(null);table.dispose();});
  it('rejects foreign focus IDs and clears focus whose node disappears or disables',()=>{const session=createCardSession({transport:()=>{}});session.receive(doc());let enabled=true;const p:Planner=()=>({kind:'ready',layout:{...layout,nodes:layout.nodes.map(node=>node.kind==='command'?{...node,enabled}:node)}});const h=host(),table=createCardTable({session,planner:p});table.attach(h.surface);const id=table.inspect().frame!.id;h.callbacks.intent({kind:'focus',frameId:id+1,nodeId:'play'});expect(table.inspect().focusId).toBe(null);h.callbacks.intent({kind:'focus',frameId:id,nodeId:'root'});expect(table.inspect().focusId).toBe(null);h.callbacks.intent({kind:'focus',frameId:id,nodeId:'play'});enabled=false;h.callbacks.environment({...env,revision:'disabled'});expect(table.inspect().frame?.focusId).toBe(null);table.dispose();});

  it('preserves centrally recorded focus after choosing a finite option',()=>{const session=createCardSession({transport:()=>{}});const source=doc();session.receive({...source,decision:{id:'d',kind:'finite-choice',commands:[],fields:[{id:'rank',label:'Rank',options:[{id:'low',label:'Low',enabled:true},{id:'high',label:'High',enabled:true}]}],variants:[{tuple:{rank:'low'},actionId:'low'},{tuple:{rank:'high'},actionId:'high'}],initialValues:{rank:'low'},reconciliation:'preserve-compatible',submit:{unavailable:'disabled'}},offer:{id:'o1',actions:['low','high'].map(id=>({id,kind:'command',label:id,intent:'primary',enabled:true,action}))}});const p:Planner=()=>({kind:'ready',layout:{...layout,nodes:[layout.nodes[0],{...layout.nodes[1],id:'rank-high',kind:'choice',fieldId:'rank',optionId:'high',actionId:undefined}]}});const h=host(),table=createCardTable({session,planner:p});table.attach(h.surface);const id=table.inspect().frame!.id;h.callbacks.intent({kind:'focus',frameId:id,nodeId:'rank-high'});h.callbacks.intent({kind:'activate',frameId:id,nodeId:'rank-high'});expect(table.inspect().frame?.id).not.toBe(id);expect(table.inspect().frame?.focusId).toBe('rank-high');table.dispose();});

});

describe('native focus routing',()=>{
  it('focus leaving an older control does not cancel a newer pointer press',()=>{
    const send=vi.fn(),session=createCardSession({transport:send});session.receive(doc());
    const table=createCardTable({session,planner}),h=host();table.attach(h.surface);
    const frame=table.inspect().frame!;
    h.callbacks.intent({kind:'begin',frameId:frame.id,nodeId:'play'});
    h.callbacks.intent({kind:'cancel',nodeId:'previous-control'});
    h.callbacks.intent({kind:'activate',frameId:frame.id,nodeId:'play'});
    expect(session.snapshot().operations).toHaveLength(1);table.dispose();session.dispose();
  });
});


it('remeasures after detach and adapter replacement even when font generations alias',()=>{
  const session=createCardSession({transport:()=>{}});session.receive(doc());
  const h=host();let glyphWidth=10;
  const measure=vi.fn<SurfacePort['measure']>((requests,reply)=>{
    reply(requests.map(request=>({key:request.key,size:{width:glyphWidth,height:20}})));return()=>{};
  });
  h.surface.measure=measure;
  const measured:Planner=(_doc,environment,_choices,metrics)=>{
    const value=metrics.get('font-metric');
    if(!value)return{kind:'needs',requests:[{key:'font-metric',text:'a',role:'body',width:null,environment}]};
    return{kind:'ready',layout:{...layout,nodes:[layout.nodes[0],{id:'text',parent:'root',kind:'text',label:'a',box:{x:0,y:0,...value}}]}};
  };
  const table=createCardTable({session,planner:measured});table.attach(h.surface);
  expect(table.inspect().frame!.nodes[1].box.width).toBe(10);
  table.detach();glyphWidth=30;table.attach(h.surface);
  expect(measure).toHaveBeenCalledTimes(2);
  expect(table.inspect().frame!.nodes[1].box.width).toBe(30);
  table.detach();const replacement=host();replacement.surface.measure=measure;glyphWidth=50;
  table.attach(replacement.surface);
  expect(measure).toHaveBeenCalledTimes(3);
  expect(table.inspect().frame!.nodes[1].box.width).toBe(50);
  table.dispose();session.dispose();
});

// Card selection uses the same committed-frame input and session admission path.
import {cardDocument,type CardProofAction} from './cardFixtures';
const cardPlanner:Planner=(document,_environment,choices)=>({kind:'ready',layout:{...layout,nodes:[layout.nodes[0],
  ...document.hand.slice(0,3).map((card,index)=>({id:`card-${index}`,parent:'root',kind:'card' as const,label:card.label,cardId:card.id,entityId:card.id,zoneId:'hand',ownerId:document.participant.id,visual:card.visual,...(card.emphasis?{emphasis:card.emphasis}:{}),enabled:choices.cards?.available.includes(card.id),checked:choices.cards?.selected.includes(card.id),box:{x:10+index*100,y:10,width:88,height:124}})),
  {id:'submit',parent:'root',kind:'command',label:choices.selected!.label,enabled:choices.selected!.enabled,actionId:choices.selected!.id,box:{x:10,y:200,width:250,height:48}},
]}});
it.each([{label:'missing',entityId:undefined},{label:'foreign',entityId:'foreign'}])('never paints checked selection for a $label own-card identity',({entityId})=>{
  const poisoned:Planner=(...args)=>{const result=cardPlanner(...args);if(result.kind!=='ready')return result;return {...result,layout:{...result.layout,nodes:result.layout.nodes.map(node=>node.id==='card-1'?{...node,entityId,checked:true}:node)}};};
  const session=createCardSession<CardProofAction>({transport:()=>{}});session.receive(cardDocument('discard'));
  const h=host(),table=createCardTable({session,planner:poisoned});table.attach(h.surface);
  expect(table.inspect().frame!.nodes.find(node=>node.id==='card-1')!.checked).toBe(false);
  h.callbacks.intent({kind:'activate',frameId:table.inspect().frame!.id,nodeId:'card-1'});
  expect(table.inspect().frame!.nodes.find(node=>node.id==='card-1')!.checked).toBe(false);
  expect(session.snapshot().operations).toHaveLength(0);table.dispose();session.dispose();
});
it('retains a card draft across mounts but resets on replacement and revocation',()=>{
  const session=createCardSession<CardProofAction>({transport:()=>{}});session.receive(cardDocument('discard'));
  const h=host(),table=createCardTable({session,planner:cardPlanner});table.attach(h.surface);
  h.callbacks.intent({kind:'activate',frameId:table.inspect().frame!.id,nodeId:'card-1'});
  expect(table.inspect().frame!.nodes.find(node=>node.id==='card-1')!.checked).toBe(true);
  table.detach();table.attach(h.surface);
  expect(table.inspect().frame!.nodes.find(node=>node.id==='card-1')!.checked).toBe(true);
  const old=table.inspect().frame!.id;session.receive(cardDocument('discard',{revision:2}));
  h.callbacks.intent({kind:'activate',frameId:old,nodeId:'card-0'});
  expect(table.inspect().frame!.nodes.filter(node=>node.checked)).toHaveLength(0);
  session.revoke();expect(table.inspect().frame).toBe(null);table.dispose();session.dispose();
});
it('dispatches only the exact complete card command, never an incomplete or stale set',async()=>{
  const send=vi.fn(),session=createCardSession<CardProofAction>({transport:send});session.receive(cardDocument('discard'));
  const h=host(),table=createCardTable({session,planner:cardPlanner});table.attach(h.surface);
  const activate=(nodeId:string)=>h.callbacks.intent({kind:'activate',frameId:table.inspect().frame!.id,nodeId});
  activate('submit');expect(session.snapshot().operations).toHaveLength(0);
  for(const id of ['card-2','card-0'])activate(id);
  activate('submit');expect(session.snapshot().operations).toHaveLength(0);
  activate('card-1');const complete=table.inspect().frame!.id;
  activate('submit');await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0].action).toEqual({DiscardCards:['card-0','card-1','card-2']});
  h.callbacks.intent({kind:'activate',frameId:complete,nodeId:'submit'});expect(session.snapshot().operations).toHaveLength(1);
  table.dispose();session.dispose();
});

it('owns separate local scoreboard state without admitting a server operation',async()=>{
 const send=vi.fn(),session=createCardSession({transport:send});
 const source={...doc(),scoreboard:{id:'scores',title:'점수판',columns:[{id:'score',label:'점수'}],rows:[{participantId:'p',values:[0]}]}};
 session.receive(source);
 const localPlanner:Planner=(_doc,_env,choices)=>({kind:'ready',layout:{...layout,nodes:[layout.nodes[0],{...layout.nodes[1],id:'disclosure',actionId:undefined,localIntent:'toggle-scoreboard',checked:!!choices.scoreboardOpen}]}});
 const h=host(),table=createCardTable({session,planner:localPlanner});table.attach(h.surface);
 const initial=table.inspect().frame!;
 h.callbacks.intent({kind:'activate',frameId:initial.id,nodeId:'disclosure'});
 expect(table.inspect().frame!.nodes[1].checked).toBe(true);
 h.callbacks.intent({kind:'activate',frameId:initial.id,nodeId:'disclosure'});
 expect(table.inspect().frame!.nodes[1].checked).toBe(true);
 session.receive({...source,context:{...source.context,revision:'2'}});
 expect(table.inspect().frame!.nodes[1].checked).toBe(true);
 session.setConnected(false);
 h.callbacks.intent({kind:'activate',frameId:table.inspect().frame!.id,nodeId:'disclosure'});
 expect(table.inspect().frame!.nodes[1].checked).toBe(false);
 await Promise.resolve();expect(send).not.toHaveBeenCalled();expect(session.snapshot().operations).toHaveLength(0);
 session.revoke();expect(table.inspect().frame).toBe(null);table.dispose();session.dispose();
});
it('copies and freezes progress geometry before publishing a committed frame',()=>{
 const segments=[{x:0,width:20,tone:'gold' as const}],session=createCardSession({transport:()=>{}});session.receive(doc());
 const h=host(),table=createCardTable({session,planner:()=>({kind:'ready',layout:{...layout,nodes:[layout.nodes[0],{id:'progress',parent:'root',kind:'progress',label:'20%',progressPaint:{segments,target:80},box:{x:10,y:10,width:200,height:16}}]}})});
 table.attach(h.surface);const paint=table.inspect().frame!.nodes[1].progressPaint!;
 segments[0].width=99;expect(paint.segments[0].width).toBe(20);expect(Object.isFrozen(paint)).toBe(true);expect(Object.isFrozen(paint.segments)).toBe(true);expect(Object.isFrozen(paint.segments[0])).toBe(true);table.dispose();session.dispose();
});

it('direct AT activation admits successive fresh offers without consuming the prior cancellation fence',async()=>{
 const send=vi.fn();const session=createCardSession({transport(submission){send(submission);session.resolve(submission.id,'accepted');}});
 session.receive(doc());const table=createCardTable({session,planner}),h=host();table.attach(h.surface);
 const activate=()=>h.callbacks.intent({kind:'activate',provenance:'direct',frameId:table.inspect().frame!.id,nodeId:'play'});
 activate();await Promise.resolve();expect(send).toHaveBeenCalledTimes(1);
 session.receive(doc('2'));activate();await Promise.resolve();expect(send).toHaveBeenCalledTimes(2);
 activate();await Promise.resolve();expect(send).toHaveBeenCalledTimes(2);
 // Direct provenance grants no authority over an obsolete frame or revoked root.
 const old=table.inspect().frame!;session.receive(doc('3'));h.callbacks.intent({kind:'activate',provenance:'direct',frameId:old.id,nodeId:'play'});
 session.revoke();h.callbacks.intent({kind:'activate',provenance:'direct',frameId:old.id,nodeId:'play'});await Promise.resolve();expect(send).toHaveBeenCalledTimes(2);
 table.dispose();session.dispose();
});


it('card drafts survive presentation-only publications but never changed offer authority',()=>{
 const source=cardDocument('discard'),session=createCardSession<CardProofAction>({transport:()=>{}});session.receive(source);
 const h=host(),table=createCardTable({session,planner:cardPlanner});table.attach(h.surface);
 h.callbacks.intent({kind:'activate',frameId:table.inspect().frame!.id,nodeId:'card-1'});
 const frame=table.inspect().frame!.id;
 const presentation={...source,context:{...source.context,revision:'display-only'},participant:{...source.participant,name:'New display name'}};
 session.receive(presentation);expect(table.inspect().frame!.nodes.find(node=>node.id==='card-1')!.checked).toBe(true);
 h.callbacks.intent({kind:'activate',frameId:frame,nodeId:'card-0'});expect(table.inspect().frame!.nodes.filter(node=>node.checked)).toHaveLength(1);
 const changed={...presentation,context:{...source.context,revision:'changed-binding'},offer:{...source.offer,actions:source.offer.actions.map(action=>action.kind==='command'?{...action,action:{DiscardCards:['different']}}:action)}};
 session.receive(changed);expect(table.inspect().frame!.nodes.filter(node=>node.checked)).toHaveLength(0);
 table.dispose();session.dispose();
});
