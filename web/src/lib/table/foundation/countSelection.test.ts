import {expect,test,vi} from 'vitest';
import {availableCardIds,eligibleCardIds,selectedCardCommands,toggleCards,validateCardSelection} from './cardSelection';
import {createCardSession} from './session';
import type {TableDocument} from './contracts';
function document():TableDocument<{discard:string}>{
 const hand=Array.from({length:13},(_,i)=>({id:`c${i}`,label:`Card ${i}`,visual:{kind:'standard' as const,suit:'Spade' as const,rank:i+2}}));
 return {context:{session:'game',audience:'alice',generation:'1',revision:'1'},participant:{id:'alice',name:'Alice',markers:[]},hand,facts:[],
 decision:{kind:'card-selection',id:'discard',mode:'count',count:3,commands:[],variants:hand.map(card=>({cardIds:[card.id],actionId:card.id})),submit:{prefix:'Discard',prompt:'Choose cards to return'}},
 offer:{id:'offer',actions:hand.map((card,i)=>({kind:'command',id:card.id,label:`Discard ${i}`,intent:'primary',enabled:i!==12,action:{discard:card.id}}))}};
}
test('independent count selection compiles thirteen offered commands without enumerating 286 subsets',()=>{
 const doc=document(),spec=doc.decision;if(spec.kind!=='card-selection')throw Error();
 expect(validateCardSelection(spec,doc.offer,doc.hand.map(c=>c.id))).toEqual([]);expect(spec.variants).toHaveLength(13);
 let chosen:readonly string[]=[];for(const id of ['c2','c0','c1'])chosen=toggleCards(spec,doc.offer,chosen,id)!;
 expect(selectedCardCommands(spec,doc.offer,chosen)?.map(c=>c.action)).toEqual([{discard:'c0'},{discard:'c1'},{discard:'c2'}]);
 expect(availableCardIds(spec,doc.offer,chosen)).toEqual(['c0','c1','c2']);expect(eligibleCardIds(spec,doc.offer)).toHaveLength(12);
 expect(toggleCards(spec,doc.offer,chosen,'c3')).toBeNull();expect(toggleCards(spec,doc.offer,chosen,'c0')).toEqual(['c2','c1']);
 for(const invalid of [[],['c0'],['c0','c0','c1'],['c0','c1','c12'],['c0','c1','unknown'],['c0','c1','c2','c3']])expect(selectedCardCommands(spec,doc.offer,invalid)).toBeNull();
});
test('count selection rejects malformed cardinality and dependent variants',()=>{
 const doc=document(),spec=doc.decision;if(spec.kind!=='card-selection'||spec.mode!=='count')throw Error();
 for(const count of [0,-1,1.5,14,33])expect(validateCardSelection({...spec,count},doc.offer,doc.hand.map(c=>c.id)).length).toBeGreaterThan(0);
 expect(validateCardSelection({...spec,variants:[{cardIds:['c0','c1'],actionId:'c0'}]},doc.offer,doc.hand.map(c=>c.id))).toContain('count variant must contain one card');
});
test('one journal entry owns the exact enabled card set; native single-card admission cannot bypass its count',async()=>{
 const send=vi.fn(),batch=vi.fn(),session=createCardSession<{discard:string}>({transport:send,batchTransport:batch});session.receive(document());const doc=session.snapshot().document!;
 const action=doc.offer.actions[0];if(action.kind!=='command')throw Error();expect(session.admit(doc.context,doc.offer.id,action.id,action.action)).toBe(false);
 for(const selected of [[],['c0'],['c0','c0','c1'],['c0','c1','c12']])expect(session.admitCardSet(doc.context,doc.offer.id,selected)).toBe(false);
 expect(session.admitCardSet({...doc.context,revision:'stale'},doc.offer.id,['c0','c1','c2'])).toBe(false);
 const selected=['c2','c0','c1'];expect(session.admitCardSet(doc.context,doc.offer.id,selected)).toBe(true);selected[0]='c12';
 expect(session.admitCardSet(doc.context,doc.offer.id,['c3','c4','c5'])).toBe(false);expect(session.snapshot().operations).toHaveLength(1);await Promise.resolve();
 expect(send).not.toHaveBeenCalled();expect(batch).toHaveBeenCalledTimes(1);expect(batch.mock.calls[0][0].actions).toEqual([{discard:'c0'},{discard:'c1'},{discard:'c2'}]);expect(Object.isFrozen(batch.mock.calls[0][0].actions)).toBe(true);
 session.dispose();
});
test('revocation before transmission or during uncertain notification prevents the whole batch',async()=>{
 for(const stage of ['queued','uncertain']){const batch=vi.fn(),session=createCardSession({transport:()=>{},batchTransport:batch});session.receive(document());const doc=session.snapshot().document!;
 session.subscribe(snapshot=>{if(snapshot.operations.some(op=>op.status===stage))session.revoke();});session.admitCardSet(doc.context,doc.offer.id,['c0','c1','c2']);await Promise.resolve();expect(batch).not.toHaveBeenCalled();session.dispose();}
});
test('count decisions fail closed without batch transport',()=>{
 const session=createCardSession({transport:()=>{}});session.receive(document());const doc=session.snapshot().document!;expect(session.admitCardSet(doc.context,doc.offer.id,['c0','c1','c2'])).toBe(false);expect(session.snapshot().operations).toEqual([]);session.dispose();
});

test('default planner and runtime own count feedback, confirmation and one batch admission',async()=>{
 const {createCardTable}=await import('./runtime');
 const batch=vi.fn(),session=createCardSession<{discard:string}>({transport:()=>{throw Error('single path forbidden');},batchTransport:batch});session.receive(document());
 let callbacks:import('./contracts').SurfaceCallbacks;
 const environment:import('./contracts').Environment={width:768,height:1024,fontRevision:'1',revision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:15,lineHeight:18,fontWeight:600,paddingX:14,paddingY:8,minHeight:40,pulse:1.08}}};
 const table=createCardTable({session});table.attach({identity:{},environment:()=>environment,listen(next){callbacks=next;return()=>{};},measure(requests,reply){reply(requests.map(r=>{const natural=r.text.length*8,width=r.width??natural;return{key:r.key,size:{width:Math.min(natural,width),height:Math.max(1,Math.ceil(natural/Math.max(1,width)))*20}};}));return()=>{};},publish(){},disarm(){},invalidate(){},fallback(reason){throw Error(reason);},clear(){}});
 const activate=(id:string)=>callbacks!.intent({kind:'activate',frameId:table.inspect().frame!.id,nodeId:id});
 expect(table.inspect().status).toBe('ready');expect(table.inspect().frame!.nodes.find(n=>n.localIntent==='submit-card-set')?.enabled).toBe(false);
 for(const id of ['c2','c0','c1']){const card=table.inspect().frame!.nodes.find(n=>n.cardId===id)!;activate(card.id);}
 const frame=table.inspect().frame!,submit=frame.nodes.find(n=>n.localIntent==='submit-card-set')!;
 expect(submit).toMatchObject({label:'Discard',enabled:true});expect(submit.actionId).toBeUndefined();expect(frame.nodes.some(n=>n.label==='Choose cards to return · 3/3')).toBe(true);
 expect(frame.nodes.find(n=>n.cardId==='c3')).toMatchObject({enabled:false,unavailable:false});
 activate(submit.id);await Promise.resolve();expect(batch).toHaveBeenCalledTimes(1);expect(batch.mock.calls[0][0].actions).toEqual([{discard:'c0'},{discard:'c1'},{discard:'c2'}]);
 callbacks!.intent({kind:'activate',frameId:frame.id,nodeId:submit.id});expect(batch).toHaveBeenCalledTimes(1);table.dispose();session.dispose();
});


test('card-set admission rejects accessors and non-data array methods without executing them',()=>{
 const session=createCardSession({transport:()=>{},batchTransport:()=>{}});session.receive(document());const doc=session.snapshot().document!;let invoked=false;
 const accessor=['c0','c1','c2'];Object.defineProperty(accessor,'1',{enumerable:true,get(){invoked=true;return 'c1';}});
 expect(session.admitCardSet(doc.context,doc.offer.id,accessor)).toBe(false);expect(invoked).toBe(false);
 const overridden=['c0','c1','c2'];Object.defineProperty(overridden,'includes',{enumerable:true,value:()=>{invoked=true;return true;}});
 expect(session.admitCardSet(doc.context,doc.offer.id,overridden)).toBe(false);expect(invoked).toBe(false);expect(session.snapshot().operations).toEqual([]);session.dispose();
});
