import {expect,test,vi} from 'vitest';
import {applyDomainPressure,domainPressureActions,domainPressureDocument,initialDomainPressure,isPressureMeld,type DomainPressureState,type DomainPressureAction} from './domainPressure';
import {createCardSession} from './session';
import {validateTableDecision} from './decisions';
import {selectedCardAction} from './cardSelection';
const ids=(state:DomainPressureState)=>[...state.stock,...state.discard,...state.hands.flat(),...state.melds.flatMap(meld=>meld.cards)].map(card=>card.id).sort();
function step(state:DomainPressureState,action:DomainPressureAction){
 const before=JSON.stringify(state),next=applyDomainPressure(state,{generation:state.generation,revision:state.revision},state.actor,action);
 expect(JSON.stringify(state)).toBe(before);expect(ids(next)).toEqual(ids(state));expect(new Set(ids(next)).size).toBe(ids(next).length);return next;
}
function canonical(state:DomainPressureState,viewer:0|1=0){const doc=domainPressureDocument(state,viewer);expect(validateTableDecision(doc)).toEqual([]);const session=createCardSession({transport:()=>{}});session.receive(doc);expect(session.snapshot().document).not.toBeNull();session.dispose();return doc;}

test('Hulla draw → exact meld → explicit add target → discard → draw → add → empty-hand round end',()=>{
 let state=initialDomainPressure('hulla');canonical(state);state=step(state,{kind:'draw'});let doc=canonical(state);
 expect(doc.decision.kind).toBe('card-selection');if(doc.decision.kind!=='card-selection')throw new Error('Expected card selection');
 expect(selectedCardAction(doc.decision,doc.offer,['Club:5','Club:3','Club:4'])?.action).toEqual({kind:'meld',cardIds:['Club:3','Club:4','Club:5']});
 state=step(state,{kind:'meld',cardIds:['Club:5','Club:3','Club:4']});doc=canonical(state);
 const adds=domainPressureActions(state).filter(action=>action.kind==='add'&&action.cardId==='Club:6');expect(adds).toHaveLength(2);
 for(const add of adds)expect(doc.offer.actions.find(action=>action.kind==='command'&&JSON.stringify(action.action)===JSON.stringify(add))).toBeDefined();
 state=step(state,{kind:'add',cardId:'Club:6',targetId:'meld:1'});canonical(state);
 state=step(state,{kind:'discard',cardId:'Heart:10'});canonical(state);expect(state.phase).toBe('draw');
 state=step(state,{kind:'draw'});canonical(state);
 state=step(state,{kind:'add',cardId:'Heart:8',targetId:'public:hearts'});canonical(state);
 state=step(state,{kind:'add',cardId:'Heart:9',targetId:'public:hearts'});canonical(state);
 expect(state.phase).toBe('done');expect(state.winner).toBe(0);expect(domainPressureActions(state)).toEqual([]);
});

test('Hulla rejects stale, malformed run, wrong target, duplicate selection and discard-before-draw without mutation',()=>{
 let state=initialDomainPressure('hulla');const before=JSON.stringify(state);
 expect(()=>applyDomainPressure(state,{generation:state.generation,revision:0},0,{kind:'discard',cardId:'Club:3'})).toThrow();expect(JSON.stringify(state)).toBe(before);
 state=step(state,{kind:'draw'});const drawn=JSON.stringify(state);
 for(const action of [{kind:'meld',cardIds:['Club:3','Club:5','Heart:9']},{kind:'meld',cardIds:['Club:3','Club:3','Club:4']},{kind:'add',cardId:'Heart:9',targetId:'public:clubs'}] as const)expect(()=>applyDomainPressure(state,{generation:state.generation,revision:state.revision},0,action)).toThrow();
 expect(()=>applyDomainPressure(state,{generation:state.generation,revision:0},0,{kind:'discard',cardId:'Heart:10'})).toThrow();expect(JSON.stringify(state)).toBe(drawn);
 expect(isPressureMeld([state.hands[0][0],state.hands[0][1]])).toBe(false);
});

test('One Card wild suit declaration → matching play → attack → counterattack → exact batch draw',()=>{
 let state=initialDomainPressure('one-card');let doc=canonical(state);
 expect(domainPressureActions(state).filter(action=>action.kind==='play'&&action.cardId==='Spade:8')).toHaveLength(4);
 state=step(state,{kind:'play',cardId:'Spade:8',suit:'Heart'});canonical(state,1);expect(state.effectiveSuit).toBe('Heart');
 state=step(state,{kind:'play',cardId:'Heart:5'});canonical(state);
 state=step(state,{kind:'play',cardId:'Heart:2'});canonical(state,1);expect(state.penalty).toBe(2);
 state=step(state,{kind:'play',cardId:'Diamond:2'});doc=canonical(state);expect(state.penalty).toBe(4);
 expect(doc.offer.actions).toHaveLength(1);expect(doc.offer.actions[0]).toMatchObject({action:{kind:'draw'},label:'페널티 4장 받기'});
 const before=state.hands[0].length;state=step(state,{kind:'draw'});canonical(state,1);expect(state.hands[0]).toHaveLength(before+4);expect(state.penalty).toBe(0);expect(state.actor).toBe(1);
 state=step(state,{kind:'draw'});canonical(state); // Peer cannot match Diamond 2 with Spade 9.
 state=step(state,{kind:'play',cardId:'Diamond:5'});canonical(state,1);
 state=step(state,{kind:'play',cardId:'Diamond:9'});canonical(state);
 state=step(state,{kind:'draw'});canonical(state,1);
 state=step(state,{kind:'play',cardId:'Spade:9'});canonical(state);
 expect(state.winner).toBe(1);expect(state.phase).toBe('done');
});

test('One Card ordinary draw ends turn and last legal card ends round',()=>{
 let state=initialDomainPressure('one-card');const count=state.hands[0].length;state=step(state,{kind:'draw'});expect(state.hands[0]).toHaveLength(count+1);expect(state.actor).toBe(1);canonical(state,1);
 const base=initialDomainPressure('one-card');
 // Separate explicit near-end scenario preserves every original card in a zone.
 state={...base,hands:[[base.hands[0][1]],base.hands[1]],stock:[...base.stock,base.hands[0][0],base.hands[0][2]]};canonical(state);
 state=step(state,{kind:'play',cardId:'Heart:2'});canonical(state);expect(state.winner).toBe(0);expect(state.phase).toBe('done');
});

test('One Card rejects missing suit, off-turn, invalid declaration, stale revision and ordinary play under attack',()=>{
 let state=initialDomainPressure('one-card');const before=JSON.stringify(state);
 expect(()=>applyDomainPressure(state,{generation:state.generation,revision:0},0,{kind:'play',cardId:'Spade:8'})).toThrow();
 expect(()=>applyDomainPressure(state,{generation:state.generation,revision:0},1,{kind:'play',cardId:'Heart:5'})).toThrow();
 expect(()=>applyDomainPressure(state,{generation:state.generation,revision:0},0,{kind:'play',cardId:'Club:5',suit:'Heart'})).toThrow();expect(JSON.stringify(state)).toBe(before);
 state=step(state,{kind:'play',cardId:'Heart:2'});
 expect(()=>applyDomainPressure(state,{generation:state.generation,revision:state.revision},1,{kind:'play',cardId:'Heart:5'})).toThrow();
 expect(()=>applyDomainPressure(state,{generation:state.generation,revision:0},1,{kind:'draw'})).toThrow();
});

test('canonical session queues exactly offered action and stale admission cannot mutate the domain',async()=>{
 let state=initialDomainPressure('hulla');const transport=vi.fn(submission=>{state=applyDomainPressure(state,{generation:Number(submission.context.generation),revision:Number(submission.context.revision)},0,submission.action);});
 const session=createCardSession<DomainPressureAction>({transport});session.receive(domainPressureDocument(state));let doc=session.snapshot().document!,draw=doc.offer.actions[0];if(draw.kind!=='command')throw new Error('Command');
 expect(session.admit(doc.context,doc.offer.id,draw.id,draw.action)).toBe(true);await Promise.resolve();expect(state.revision).toBe(1);expect(transport).toHaveBeenCalledTimes(1);
 const old=doc;session.receive(domainPressureDocument(state));expect(session.admit(old.context,old.offer.id,draw.id,draw.action)).toBe(false);expect(state.revision).toBe(1);session.dispose();
});

test('authorized documents expose stock counts and own hand only, never peer identities or hidden order',()=>{
 const state=initialDomainPressure('one-card'),first=canonical(state),second=canonical(state,1);
 expect(first.opponents![0].handCount).toBe(3);expect(JSON.stringify(first)).not.toContain('Diamond:2');expect(JSON.stringify(second)).not.toContain('Spade:8');
 const reordered={...state,stock:[...state.stock].reverse()};expect(domainPressureDocument(reordered)).toEqual(first);
 expect(first.collections!.find(zone=>zone.id==='stock')).toMatchObject({cards:[],hiddenCount:6});
});

test('real foundation runtime measures and dispatches draw then selected meld through one canonical session',async()=>{
 const {createCardTable}=await import('./index');
 let state=initialDomainPressure('hulla');
 const session=createCardSession<DomainPressureAction>({transport(submission){state=applyDomainPressure(state,{generation:Number(submission.context.generation),revision:Number(submission.context.revision)},0,submission.action);session.resolve(submission.id,'accepted');session.receive(domainPressureDocument(state));}});
 session.receive(domainPressureDocument(state));
 const environment:import('./contracts').Environment={width:1440,height:900,revision:'1',fontRevision:'1',fontFamily:'sans-serif',textScale:1,controls:{command:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:16,paddingY:10,minHeight:44,pulse:1},choice:{fontSize:16,lineHeight:20,fontWeight:600,paddingX:14,paddingY:8,minHeight:44,pulse:1.08}}};
 let callbacks:import('./contracts').SurfaceCallbacks;
 const surface:import('./contracts').SurfacePort={identity:{},environment:()=>environment,listen(value){callbacks=value;return()=>{};},measure(requests,reply){reply(requests.map(request=>({key:request.key,size:{width:request.width??request.text.length*8,height:request.width===null?24:Math.max(24,Math.ceil(request.text.length*8/request.width)*24)}})));return()=>{};},publish(){},disarm(){},invalidate(){},fallback(){},clear(){}};
 const table=createCardTable({session});table.attach(surface);expect(table.inspect().status).toBe('ready');
 const activate=(nodeId:string)=>{const frameId=table.inspect().frame!.id;callbacks.intent({kind:'begin',frameId,nodeId});callbacks.intent({kind:'activate',frameId,nodeId});};
 activate(table.inspect().frame!.nodes.find(node=>node.actionId===JSON.stringify({kind:'draw'}))!.id);await Promise.resolve();expect(state.phase).toBe('arrange');
 for(const cardId of ['Club:3','Club:4','Club:5'])activate(table.inspect().frame!.nodes.find(node=>node.cardId===cardId)!.id);
 const submit=table.inspect().frame!.nodes.find(node=>node.kind==='command'&&node.actionId?.includes('"kind":"meld"'))!;
 expect(submit).toBeDefined();activate(submit.id);await Promise.resolve();expect(state.melds.at(-1)!.cards.map(card=>card.id)).toEqual(['Club:3','Club:4','Club:5']);
 table.dispose();session.dispose();
});

test.each(['hulla','one-card'] as const)('%s restart uses a new epoch, admits a fresh offer and rejects every old-epoch command',async kind=>{
 let state=initialDomainPressure(kind,11);const session=createCardSession<DomainPressureAction>({transport(submission){state=applyDomainPressure(state,{generation:Number(submission.context.generation),revision:Number(submission.context.revision)},0,submission.action);session.resolve(submission.id,'accepted');}});
 session.receive(domainPressureDocument(state));const old=session.snapshot().document!;const binding=old.offer.actions.find(action=>action.kind==='command'&&action.action.kind==='draw');if(binding?.kind!=='command')throw new Error('Expected draw');
 expect(session.admit(old.context,old.offer.id,binding.id,binding.action)).toBe(true);await Promise.resolve();expect(state.revision).toBe(1);
 state=initialDomainPressure(kind,12);const before=JSON.stringify(state);
 expect(()=>applyDomainPressure(state,{generation:11,revision:0},0,binding.action)).toThrow();expect(JSON.stringify(state)).toBe(before);
 session.receive(domainPressureDocument(state));const fresh=session.snapshot().document!,draw=fresh.offer.actions.find(action=>action.kind==='command'&&action.action.kind==='draw');if(draw?.kind!=='command')throw new Error('Expected draw');
 expect(fresh.context.generation).toBe('12');expect(fresh.offer.id).not.toBe(old.offer.id);
 expect(session.admit(old.context,old.offer.id,binding.id,binding.action)).toBe(false);
 expect(session.admit(fresh.context,fresh.offer.id,draw.id,draw.action)).toBe(true);await Promise.resolve();expect(state.revision).toBe(1);expect(state.generation).toBe(12);session.dispose();
});

test('Hulla reachable empty stock terminates explicitly as a draw instead of deadlocking',()=>{
 let state=initialDomainPressure('hulla');
 for(const action of [{kind:'draw'},{kind:'discard',cardId:'Heart:10'},{kind:'draw'},{kind:'discard',cardId:'Heart:8'}] as const)state=step(state,action);
 expect(state.stock).toHaveLength(0);expect(state.phase).toBe('done');expect(state.winner).toBeNull();expect(state.outcome).toBe('stock-exhausted');expect(domainPressureActions(state)).toEqual([]);
 expect(canonical(state).facts.find(fact=>fact.id==='status')!.value).toContain('무승부');
});

test('One Card reachable unpaid penalty with empty stock terminates explicitly without losing cards',()=>{
 let state=initialDomainPressure('one-card');for(let draw=0;draw<6;draw++)state=step(state,{kind:'draw'});
 expect(state.phase).toBe('play');expect(state.stock).toHaveLength(0);
 state=step(state,{kind:'play',cardId:'Heart:2'});state=step(state,{kind:'play',cardId:'Diamond:2'});
 expect(state.phase).toBe('done');expect(state.penalty).toBe(4);expect(state.winner).toBeNull();expect(state.outcome).toBe('stock-exhausted');expect(domainPressureActions(state)).toEqual([]);
 expect(canonical(state).facts.find(fact=>fact.id==='status')!.value).toContain('덱 부족');
});

for(const kind of ['hulla','one-card'] as const)test(`${kind} keeps static variant explanations in information and current state essential`,()=>{
 const document=canonical(initialDomainPressure(kind));
 expect(document.facts.find(fact=>fact.id==='variant')?.essential).not.toBe(true);
 expect(document.facts.find(fact=>fact.id==='variant')?.value).toContain('덱 부족');
 expect(document.facts.find(fact=>fact.id==='status')?.essential).toBe(true);
});
