import {describe,it,expect,vi} from 'vitest';
import {createCardSession} from './session';
import {createCardTable} from './runtime';
import type {SurfacePort,Planner} from './contracts';
import type {SessionSnapshot,TableDocument} from './contracts';
const action={kind:'play'};
export const document=(revision='1',generation='1'):TableDocument<typeof action>=>({context:{session:'s',audience:'a',generation,revision},participant:{id:'p',name:'Player',markers:[]},hand:[],facts:[],decision:{id:'d',kind:'commands',commands:['play']},offer:{id:`o${revision}`,actions:[{id:'play',kind:'command',label:'Play',intent:'primary',enabled:true,action}]}});

const offered=(session:{snapshot():SessionSnapshot<unknown>})=>{const item=session.snapshot().document?.offer.actions[0];return item?.kind==='command'?item.action:action;};
describe('foundation session admission',()=>{
  it('records before asynchronous send and deduplicates the offer',async()=>{const send=vi.fn();const session=createCardSession({transport:send});const doc=document();session.receive(doc);expect(session.admit(doc.context,doc.offer.id,'play',offered(session))).toBe(true);expect(session.snapshot().operations[0].status).toBe('queued');expect(send).not.toHaveBeenCalled();expect(session.admit(doc.context,doc.offer.id,'play',offered(session))).toBe(false);await Promise.resolve();expect(send.mock.calls[0][0].action).toBe(offered(session));expect(send.mock.calls[0][0].action).toEqual(action);expect(session.snapshot().operations[0].status).toBe('uncertain');});
  it('revocation cancels unsent operations and rejects old admissions',async()=>{const send=vi.fn();const session=createCardSession({transport:send});const doc=document();session.receive(doc);session.admit(doc.context,doc.offer.id,'play',offered(session));session.revoke();await Promise.resolve();expect(send).not.toHaveBeenCalled();expect(session.snapshot().document).toBe(null);expect(session.snapshot().operations).toEqual([]);expect(session.admit(doc.context,doc.offer.id,'play',offered(session))).toBe(false);});
  it('keeps uncertain operation receipts through view replacement and terminal outcomes immutable',async()=>{const session=createCardSession({transport:()=>{}});const doc=document();session.receive(doc);session.admit(doc.context,doc.offer.id,'play',offered(session));await Promise.resolve();session.receive(document('2'));expect(session.resolve('operation-1','accepted')).toBe(true);expect(session.resolve('operation-1','rejected')).toBe(false);expect(session.snapshot().operations[0].status).toBe('accepted');});
  it('requires fresh projection after reconnect and exact payload identity',()=>{const session=createCardSession({transport:()=>{}});const doc=document();session.receive(doc);expect(session.admit(doc.context,doc.offer.id,'play',{kind:'play'})).toBe(false);session.setConnected(false);session.setConnected(true);expect(session.admit(doc.context,doc.offer.id,'play',offered(session))).toBe(false);session.receive(doc);expect(session.admit(doc.context,doc.offer.id,'play',offered(session))).toBe(true);});
  it('reclaims terminal entries while preserving unresolved evidence and the current offer fence',async()=>{const session=createCardSession({transport:()=>{},maxOperations:1});const doc=document();session.receive(doc);session.admit(doc.context,doc.offer.id,'play',offered(session));await Promise.resolve();const next=document('2');session.receive(next);expect(session.admit(next.context,next.offer.id,'play',offered(session))).toBe(false);expect(session.snapshot().admissionBlocked).toBe('journal-full');session.resolve('operation-1','accepted');session.receive(next);expect(session.admit(next.context,next.offer.id,'play',offered(session))).toBe(true);await Promise.resolve();session.resolve('operation-2','accepted');expect(session.snapshot().operations).toHaveLength(1);expect(session.admit(next.context,next.offer.id,'play',offered(session))).toBe(false);session.receive(document('3'));expect(session.snapshot().admissionBlocked).toBeUndefined();});
  it('redacts tracking at audience replacement without sending old payload',async()=>{const send=vi.fn();const session=createCardSession({transport:send});const doc=document();session.receive(doc);session.admit(doc.context,doc.offer.id,'play',offered(session));session.receive({...document('1','2'),context:{...doc.context,audience:'other',generation:'2'}});await Promise.resolve();expect(send).not.toHaveBeenCalled();expect(session.snapshot().operations).toEqual([]);});
  it('does not send when uncertain notification synchronously revokes',async()=>{const send=vi.fn();const session=createCardSession({transport:send});const doc=document();session.receive(doc);session.subscribe(value=>{if(value.document&&value.operations.some(op=>op.status==='uncertain'))session.revoke();});session.admit(doc.context,doc.offer.id,'play',offered(session));await Promise.resolve();expect(send).not.toHaveBeenCalled();});
  it('hides old actor IDs and receipts while retaining internal receipt matching',async()=>{const session=createCardSession({transport:()=>{}});const doc=document();session.receive(doc);session.admit(doc.context,doc.offer.id,'play',offered(session));await Promise.resolve();expect(session.snapshot().operations[0].id).toBe('operation-1');session.receive({...document('2','2'),context:{...doc.context,audience:'different',generation:'2'}});expect(session.snapshot().operations).toEqual([]);expect(session.resolve('operation-1','accepted')).toBe(true);expect(session.snapshot().operations).toEqual([]);expect(session.dispose()).toEqual({unresolved:0});});

  it('publishes canonical immutable payloads independent of caller mutation',async()=>{const send=vi.fn();const session=createCardSession({transport:send});const source=document();const mutable={kind:'play',nested:{amount:10}};session.receive({...source,offer:{...source.offer,actions:[{...source.offer.actions[0],kind:'command',action:mutable}]}});const canonical=offered(session);session.admit(source.context,source.offer.id,'play',canonical);mutable.nested.amount=100;await Promise.resolve();expect(send.mock.calls[0][0].action).toBe(canonical);expect(send.mock.calls[0][0].action).toEqual({kind:'play',nested:{amount:10}});expect(Object.isFrozen(canonical)).toBe(true);});
  it('rejects exotic or accessor payloads without replacing current projection',()=>{const session=createCardSession<unknown>({transport:()=>{}});session.receive(document());const before=session.snapshot().document;for(const value of [new Date(),new Map(),{get secret(){throw new Error('must not execute');}},()=>{}]){const source=document();expect(()=>session.receive({...source,offer:{...source.offer,actions:[{...source.offer.actions[0],kind:'command',action:value}]}})).toThrow();expect(session.snapshot().document).toBe(before);}});

  it('bounds pathological reentrant notifications without recursive delivery',()=>{const session=createCardSession({transport:()=>{}});let calls=0,depth=0,maxDepth=0;session.subscribe(value=>{calls++;depth++;maxDepth=Math.max(maxDepth,depth);if(value.document)session.revoke();else session.receive(document(String(calls)));depth--;});session.receive(document());expect(calls).toBeLessThanOrEqual(33);expect(maxDepth).toBe(1);expect(session.snapshot().document).toBe(null);});
  it('rejects oversized and sparse arrays before cloning',()=>{const session=createCardSession<unknown>({transport:()=>{}});session.receive(document());const before=session.snapshot().document;for(const value of [new Array(1000000000),[1,,3]]){const source=document();expect(()=>session.receive({...source,offer:{...source.offer,actions:[{...source.offer.actions[0],kind:'command',action:value}]}})).toThrow();expect(session.snapshot().document).toBe(before);}});

  it('delivers terminal redaction to the runtime despite an earlier connectivity-loop subscriber',()=>{const session=createCardSession({transport:()=>{}});let armed=false,calls=0;session.subscribe(()=>{if(armed){calls++;session.setConnected(true);}});let visible:string|null=null;const planner:Planner=()=>({kind:'ready',layout:{width:500,height:500,recipe:'stacked',nodes:[{id:'root',parent:null,kind:'group',label:'Table',box:{x:0,y:0,width:500,height:500}},{id:'secret',parent:'root',kind:'text',label:'SECRET',box:{x:10,y:10,width:100,height:40}}]}});const surface:SurfacePort={identity:{},environment:()=>({width:500,height:500,revision:'1',fontRevision:'font-1',controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}},fontFamily:'sans-serif',textScale:1}),listen:()=>()=>{},measure:()=>()=>{},publish:()=>{visible='SECRET';},disarm:()=>{},invalidate:()=>{},fallback:()=>{visible=null;},clear:()=>{visible=null;}};const table=createCardTable({session,planner});table.attach(surface);session.receive(document());expect(visible).toBe('SECRET');armed=true;session.setConnected(false);expect(calls).toBeLessThanOrEqual(33);expect(session.snapshot().document).toBe(null);expect(table.inspect().frame).toBe(null);expect(visible).toBe(null);table.dispose();});

});

it('disposal remains terminal when requested during the overflow redaction broadcast',()=>{
  const session=createCardSession({transport:()=>{}});let armed=false;
  session.subscribe(snapshot=>{
    if(!armed)return;
    if(snapshot.document===null)session.dispose();
    else session.setConnected(true);
  });
  session.receive(document());armed=true;session.setConnected(false);
  session.receive(document('new'));
  expect(session.snapshot().document).toBe(null);
  expect(session.snapshot().connected).toBe(false);
  expect(session.subscribe(()=>{throw new Error('disposed subscriber');})).toBeTypeOf('function');
});

it('ordinary reentrant disposal delivers final redaction before releasing listeners',()=>{
  const session=createCardSession({transport:()=>{}});let armed=false,visible='empty';
  session.subscribe(()=>{if(armed)session.dispose();});
  const surface:SurfacePort={identity:{},environment:()=>({width:500,height:500,revision:'1',fontRevision:'font-1',controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}},fontFamily:'sans-serif',textScale:1}),listen:()=>()=>{},measure:()=>()=>{},publish:()=>{visible='SECRET';},clear:()=>{visible='empty';},disarm:()=>{},invalidate:()=>{},fallback:()=>{visible='fallback';}};
  const planner:Planner=()=>({kind:'ready',layout:{width:500,height:500,recipe:'stacked',nodes:[{id:'root',parent:null,kind:'group',label:'',box:{x:0,y:0,width:500,height:500}}]}});
  session.receive(document());const table=createCardTable({session,planner});table.attach(surface);
  expect(visible).toBe('SECRET');armed=true;session.setConnected(false);
  expect(session.snapshot().document).toBe(null);expect(table.inspect().frame).toBe(null);expect(visible).toBe('empty');
  table.dispose();
});

it('copies and freezes public collection resources at session ingress',()=>{
  const session=createCardSession({transport:()=>{}});const source=document();
  const collections=[{id:'public',label:'Original',cards:[{id:'public-card',label:'Public card',visual:{kind:'standard' as const,suit:'Spade' as const,rank:2}}]}];
  session.receive({...source,collections});collections[0].label='Changed';collections[0].cards[0].label='Changed card';
  const stored=session.snapshot().document!.collections!;
  expect(stored[0].label).toBe('Original');expect(stored[0].cards[0].label).toBe('Public card');expect(Object.isFrozen(stored[0].cards[0])).toBe(true);session.dispose();
});

it('owns only bounded public reveal references and rejects foreign, private or mixed hints',()=>{
    const session=createCardSession({transport:()=>{}});
    const reveals=[{participantId:'other',cardId:'shown',accidentalPrivateHand:['SECRET']}];
    const source={...document(),opponents:[{id:'other',name:'Other',handCount:9}],collections:[{id:'play',label:'Public',purpose:'play' as const,cards:[{id:'shown',label:'Shown',visual:{kind:'standard' as const,rank:2,suit:'Spade' as const}}]}],reveals};
    session.receive(source);reveals[0].cardId='changed';
    expect(session.snapshot().document!.reveals).toEqual([{participantId:'other',cardId:'shown'}]);
    expect(Object.isFrozen(session.snapshot().document!.reveals![0])).toBe(true);
    for(const invalid of [
        {...source,reveals:[{participantId:'other',cardId:'private'}]},
        {...source,reveals:[{participantId:'foreign',cardId:'shown'}]},
        {...source,reveals:[{participantId:'other',cardId:'shown'},{participantId:'other',cardId:'shown'}]},
        {...source,reveals:[{participantId:'other',cardId:'shown'}],deals:[{id:'deal',source:'stock',cardIds:['shown']}]},
    ])expect(()=>session.receive(invalid)).toThrow();
    session.dispose();
});

it('awaiting state preserves canonical presentation while fencing stale admissions and queued transmission',async()=>{
    const send=vi.fn(),session=createCardSession({transport:send});session.receive(document());const doc=session.snapshot().document!;
    session.awaitState();expect(session.snapshot().document).toBe(doc);expect(session.snapshot().connected).toBe(true);expect(session.snapshot().admissionBlocked).toBe('awaiting-state');
    expect(session.admit(doc.context,doc.offer.id,'play',offered(session))).toBe(false);
    session.receive(document('2'));const next=session.snapshot().document!;expect(session.snapshot().admissionBlocked).toBeUndefined();
    expect(session.admit(next.context,next.offer.id,'play',offered(session))).toBe(true);session.awaitState();session.receive(document('3'));await Promise.resolve();expect(send).not.toHaveBeenCalled();expect(session.snapshot().operations[0].status).toBe('cancelled');session.dispose();
});

it('redacts and cancels an unsent operation when uncertainty notification disconnects synchronously',async()=>{
  const send=vi.fn(),session=createCardSession({transport:send});const doc=document();let armed=true;
  session.receive(doc);session.subscribe(snapshot=>{if(armed&&snapshot.operations.some(op=>op.status==='uncertain')){armed=false;session.setConnected(false);}});
  session.admit(doc.context,doc.offer.id,'play',offered(session));await Promise.resolve();
  expect(send).not.toHaveBeenCalled();expect(session.snapshot().operations[0].status).toBe('cancelled');
  expect(session.resolve('operation-1','accepted')).toBe(false);session.dispose();
});

it('publishes fresh canonical state and admission connectivity as one notification',()=>{
  const session=createCardSession<typeof action>({transport:()=>{}});session.setConnected(false);
  const updates:SessionSnapshot<typeof action>[]=[];session.subscribe(value=>updates.push(value));
  session.receive(document(),{connected:true});expect(updates).toHaveLength(1);
  expect(updates[0].document?.context.revision).toBe('1');expect(updates[0].connected).toBe(true);
  session.receive(document('2'),{connected:false});expect(updates).toHaveLength(2);
  expect(updates[1].document?.context.revision).toBe('2');expect(updates[1].connected).toBe(false);session.dispose();
});

it('admits only public captured winners and owns their immutable provenance separately from card owners',()=>{
 const session=createCardSession({transport:()=>{}}),source=document(),captured={id:'captured',label:'Previous trick',purpose:'captured' as const,collectedBy:'p',cards:[]};
 session.receive({...source,collections:[captured]});captured.collectedBy='foreign';expect(session.snapshot().document!.collections![0].collectedBy).toBe('p');expect(Object.isFrozen(session.snapshot().document!.collections![0])).toBe(true);
 const before=session.snapshot().document;for(const zone of [{...captured,collectedBy:''},{...captured,collectedBy:'foreign'},{...captured,purpose:'play' as const,collectedBy:'p'}]){expect(()=>session.receive({...document('2'),collections:[zone]})).toThrow(/winner/);expect(session.snapshot().document).toBe(before);}session.dispose();
});
it('rejects captured winner accessors and inherited winner properties without executing them',()=>{
 const session=createCardSession({transport:()=>{}});session.receive(document());const before=session.snapshot().document,read=vi.fn(()=> 'p');
 const accessor={id:'captured',label:'Previous',purpose:'captured' as const,cards:[]};Object.defineProperty(accessor,'collectedBy',{get:read,enumerable:true});
 const inherited=Object.assign(Object.create({collectedBy:'p'}),{id:'captured',label:'Previous',purpose:'captured',cards:[]});
 for(const zone of [accessor,inherited]){expect(()=>session.receive({...document('2'),collections:[zone]})).toThrow(/winner/);expect(session.snapshot().document).toBe(before);}expect(read).not.toHaveBeenCalled();session.dispose();
});
