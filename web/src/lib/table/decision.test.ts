import { describe, expect, test, vi } from 'vitest';
import { DecisionController, availableOptions, initializeChoices, reconcileChoices, validateDecision, type DecisionSpec, type FiniteDecisionSpec } from './decision';
import type { ActionOffer, CommandSpec } from './presentation';
const action = (id:string, enabled=true): CommandSpec<{id:string}> => ({id,label:id,kind:'command',intent:id==='pass'?'quiet':'primary',enabled,action:{id}});
const offer = (): ActionOffer<{id:string}> => ({id:'offer:1',actions:[action('a1b2'),action('a2b1'),action('a2b2'),action('pass')]});
const finite = (): FiniteDecisionSpec => ({id:'bid',kind:'finite-choice',commands:['pass'],fields:[
  {id:'a',label:'Suit',options:[{id:'a1',label:'A',enabled:true},{id:'a2',label:'A',enabled:true}]},
  {id:'b',label:'Amount',options:[{id:'b1',label:'1',enabled:true},{id:'b2',label:'2',enabled:true}]}
],variants:[{tuple:{a:'a1',b:'b2'},actionId:'a1b2'},{tuple:{a:'a2',b:'b1'},actionId:'a2b1'},{tuple:{a:'a2',b:'b2'},actionId:'a2b2'}],initialValues:{a:'a1',b:'b2'},reconciliation:'preserve-compatible',submit:{unavailable:'disabled'}});

describe('finite decision relation',()=>{
  test('pins changed field and repairs incompatible earlier field',()=>{
    expect(reconcileChoices(finite(),offer(),{a:'a1',b:'b2'},'b','b1')).toEqual({a:'a2',b:'b1'});
  });
  test('declared option order, not variant insertion order, decides fallback',()=>{
    const spec=finite();
    const reversed={...spec,variants:[...spec.variants].reverse()};
    expect(reconcileChoices(reversed,offer(),{},'b','b2')).toEqual({a:'a1',b:'b2'});
  });
  test('fallback pins growing prefix before considering later old values',()=>{
    const spec:FiniteDecisionSpec={...finite(),fields:[...finite().fields,{id:'c',label:'Third',options:[{id:'c1',label:'1',enabled:true},{id:'c2',label:'2',enabled:true}]}],variants:[{tuple:{a:'a1',b:'b2',c:'c1'},actionId:'a1b2'},{tuple:{a:'a2',b:'b1',c:'c1'},actionId:'a2b1'},{tuple:{a:'a2',b:'b2',c:'c2'},actionId:'a2b2'}],initialValues:{a:'a1',b:'b2',c:'c1'}};
    expect(reconcileChoices(spec,offer(),{a:'missing',b:'b2',c:'c2'},'a','a2')).toEqual({a:'a2',b:'b2',c:'c2'});
    expect(reconcileChoices(spec,offer(),{a:'a1',b:'missing',c:'c2'},'a','a2')).toEqual({a:'a2',b:'b1',c:'c1'});
  });
  test('disabled initial action is structurally valid and replaced',()=>{
    const current=offer();
    const disabled={...current,actions:current.actions.map(a=>a.id==='a1b2'?{...a,enabled:false}:a)};
    expect(validateDecision(finite(),disabled)).toEqual([]);
    expect(initializeChoices(finite(),disabled)).toEqual({a:'a2',b:'b2'});
  });
  test('disabled default option repairs to an eligible alternative without invalidating structure',()=>{
    const spec=finite();
    const disabled:FiniteDecisionSpec={...spec,fields:spec.fields.map(f=>f.id==='a'?{...f,options:f.options.map(o=>o.id==='a1'?{...o,enabled:false}:o)}:f)};
    expect(validateDecision(disabled,offer())).toEqual([]);
    expect(initializeChoices(disabled,offer())).toEqual({a:'a2',b:'b2'});
    expect(availableOptions(disabled,offer())[0].options.map(o=>o.available)).toEqual([false,true]);
  });
  test('disabled option is unavailable even with enabled action; all-disabled is valid unavailable',()=>{
    const spec=finite();
    const disabled:FiniteDecisionSpec={...spec,fields:spec.fields.map(f=>f.id==='a'?{...f,options:f.options.map(o=>({...o,enabled:false}))}:f)};
    expect(validateDecision(disabled,offer())).toEqual([]);
    expect(initializeChoices(disabled,offer())).toBeNull();
    expect(availableOptions(disabled,offer())[1].options.every(o=>!o.available)).toBe(true);
    expect(reconcileChoices(disabled,offer(),spec.initialValues,'a','a1')).toBeNull();
  });
  test('duplicate labels preserve distinct option and action identity',()=>{
    const send=vi.fn();const controller=new DecisionController(send);const handle=controller.bind(finite(),offer(),'player');
    expect(controller.choose(handle,'a','a2')).toBe(true);
    expect(controller.snapshot(handle)?.selected?.id).toBe('a2b2');
    const token=controller.capture(handle,'a2b2');expect(token).not.toBeNull();controller.dispatch(token!);
    expect(send).toHaveBeenCalledWith({id:'a2b2'},'offer:1');
  });
  test('rejects ambiguous, incomplete, unknown and duplicate bindings',()=>{
    const spec=finite(), current=offer();
    expect(validateDecision({...spec,variants:[...spec.variants,{...spec.variants[0],actionId:'a2b2'}]},current)).toContain('ambiguous variant tuple');
    expect(validateDecision({...spec,variants:[{tuple:{a:'a1'},actionId:'a1b2'}]},current)).toContain('incomplete variant tuple');
    expect(validateDecision({...spec,commands:['missing']},current)).toContain('invalid command binding: missing');
    expect(validateDecision(spec,{...current,actions:[...current.actions,current.actions[0]]})).toContain('invalid action ids');
    expect(validateDecision({...spec,initialValues:{a:'a1',b:'b2',extra:'bad'}},current)).toContain('invalid initial tuple');
  });
  test('reset and preserve policies differ on replacement',()=>{
    expect(initializeChoices(finite(),offer(),{a:'a2',b:'b1'})).toEqual({a:'a2',b:'b1'});
    expect(initializeChoices({...finite(),reconciliation:'reset-to-defaults'},offer(),{a:'a2',b:'b1'})).toEqual({a:'a1',b:'b2'});
  });
});

describe('decision interaction lifetime',()=>{
  test('exact payload reference, offer id and intent survive dispatch',()=>{
    const current=offer(),send=vi.fn(),controller=new DecisionController(send);const handle=controller.bind(finite(),current,'player');
    const token=controller.capture(handle,'a1b2')!;
    expect(controller.isCurrent(token)).toBe(true);expect(controller.dispatch(token)).toBe(true);
    expect(send.mock.calls[0][0]).toBe((current.actions[0] as CommandSpec<{id:string}>).action);
    expect(controller.snapshot(handle)?.commands[0].intent).toBe('quiet');
    expect(controller.isCurrent(token)).toBe(false);expect(controller.dispatch(token)).toBe(false);expect(send).toHaveBeenCalledTimes(1);
  });
  test('same immutable input references reuse handle without resetting draft',()=>{
    const spec=finite(),current=offer(),controller=new DecisionController(vi.fn());const handle=controller.bind(spec,current,'player');
    controller.choose(handle,'a','a2');expect(controller.bind(spec,current,'player')).toBe(handle);
    expect(controller.snapshot(handle)?.values).toEqual({a:'a2',b:'b2'});
    const token=controller.capture(handle,'a2b2')!;
    controller.choose(handle,'a','a2');controller.setGuards(handle,{commands:false,submit:false});
    expect(controller.isCurrent(token)).toBe(true);
  });
  test('new offer object with same id invalidates old token and handle, preserving compatible draft',()=>{
    const controller=new DecisionController(vi.fn()),spec=finite();const handle=controller.bind(spec,offer(),'player');
    controller.choose(handle,'a','a2');const token=controller.capture(handle,'a2b2')!;
    const next=controller.bind(spec,offer(),'player');expect(next).not.toBe(handle);expect(controller.snapshot(handle)).toBeNull();
    expect(controller.dispatch(token)).toBe(false);expect(controller.snapshot(next)?.values).toEqual({a:'a2',b:'b2'});
  });
  test('scope replacement resets private draft and expires existing token',()=>{
    const controller=new DecisionController(vi.fn()),spec=finite(),current=offer();const handle=controller.bind(spec,current,'player');
    controller.choose(handle,'a','a2');const token=controller.capture(handle,'a2b2')!;const next=controller.bind(spec,current,'observer');
    expect(controller.dispatch(token)).toBe(false);expect(controller.snapshot(next)?.values).toEqual(spec.initialValues);
  });
  test('ABA changes cannot revive captured submit or command',()=>{
    const controller=new DecisionController(vi.fn());const handle=controller.bind(finite(),offer(),'player');
    const submit=controller.capture(handle,'a1b2')!,pass=controller.capture(handle,'pass')!;
    controller.choose(handle,'a','a2');controller.choose(handle,'a','a1');
    expect(controller.dispatch(submit)).toBe(false);expect(controller.dispatch(pass)).toBe(false);
  });
  test('foreign handles and tokens fail without affecting their owner',()=>{
    const first=new DecisionController(vi.fn()),second=new DecisionController(vi.fn());const handle=first.bind(finite(),offer(),'player');
    second.bind(finite(),offer(),'player');const token=first.capture(handle,'pass')!;
    expect(second.snapshot(handle)).toBeNull();expect(second.choose(handle,'a','a2')).toBe(false);
    expect(second.capture(handle,'pass')).toBeNull();expect(second.dispatch(token)).toBe(false);expect(first.dispatch(token)).toBe(true);
  });
  test('guards block classes independently and transitions invalidate held gestures',()=>{
    const controller=new DecisionController(vi.fn());const handle=controller.bind(finite(),offer(),'player');const token=controller.capture(handle,'pass')!;
    controller.setGuards(handle,{commands:false,submit:true});expect(controller.capture(handle,'a1b2')).toBeNull();expect(controller.choose(handle,'a','a2')).toBe(true);
    expect(controller.capture(handle,'pass')).not.toBeNull();expect(controller.dispatch(token)).toBe(false);
    controller.setGuards(handle,{commands:true,submit:false});expect(controller.capture(handle,'pass')).toBeNull();expect(controller.capture(handle,'a2b2')).not.toBeNull();
  });
  test('delayed choice edit rejects an obsolete draft revision including ABA',()=>{
    const controller=new DecisionController(vi.fn());const handle=controller.bind(finite(),offer(),'player');
    const revision=controller.snapshot(handle)!.draftRevision;
    controller.choose(handle,'a','a2',revision);controller.choose(handle,'a','a1');
    expect(controller.choose(handle,'b','b1',revision)).toBe(false);
    expect(controller.snapshot(handle)?.values).toEqual({a:'a1',b:'b2'});
  });
  test('geometry/focus invalidation expires gestures and delayed choices without clearing values',()=>{
    const controller=new DecisionController(vi.fn());const handle=controller.bind(finite(),offer(),'player');
    controller.choose(handle,'a','a2');const before=controller.snapshot(handle)!;
    const token=controller.capture(handle,'a2b2')!;
    expect(controller.invalidateGestures(handle)).toBe(true);
    expect(controller.isCurrent(token)).toBe(false);expect(controller.dispatch(token)).toBe(false);
    expect(controller.choose(handle,'b','b1',before.draftRevision)).toBe(false);
    expect(controller.snapshot(handle)?.values).toEqual(before.values);
    expect(controller.snapshot(handle)?.selected?.id).toBe('a2b2');
    const replacement=controller.bind(finite(),offer(),'player');
    expect(controller.invalidateGestures(handle)).toBe(false);
    controller.dispose();expect(controller.invalidateGestures(replacement)).toBe(false);
  });
  test('empty labels on bound commands and variants fail closed',()=>{
    for (const id of ['pass','a1b2']) {
      const current=offer();const bad={...current,actions:current.actions.map(action=>action.id===id?{...action,label:'  '}:action)};
      expect(validateDecision(finite(),bad)).toContain(`missing action label: ${id}`);
      const controller=new DecisionController(vi.fn());const handle=controller.bind(finite(),bad,'player');
      expect(controller.capture(handle,'pass')).toBeNull();expect(controller.capture(handle,'a1b2')).toBeNull();
      expect(controller.snapshot(handle)?.selected).toBeNull();
    }
    const current=offer();
    expect(validateDecision({id:'cmd',kind:'commands',commands:['pass']},{...current,actions:current.actions.map(action=>action.id==='pass'?{...action,label:''}:action)})).toContain('missing action label: pass');
  });
  test('disabled, unlisted, numeric and unselected actions never dispatch',()=>{
    const current=offer();const mixed:ActionOffer<{id:string}>={...current,actions:[...current.actions.map(a=>a.id==='pass'?{...a,enabled:false}:a),{id:'number',kind:'number',label:'Amount',intent:'primary',enabled:true,min:1,max:3,step:1,initial:1,createAction:vi.fn()}]};
    const controller=new DecisionController(vi.fn());const handle=controller.bind(finite(),mixed,'player');
    for (const id of ['pass','number','missing','a2b1']) expect(controller.capture(handle,id)).toBeNull();
  });
  test('invalid descriptor fails closed',()=>{
    const spec=finite(),controller=new DecisionController(vi.fn());const handle=controller.bind({...spec,variants:[...spec.variants,spec.variants[0]]},offer(),'player');
    expect(controller.snapshot(handle)?.errors.length).toBeGreaterThan(0);expect(controller.snapshot(handle)?.commands).toEqual([]);expect(controller.capture(handle,'pass')).toBeNull();
  });
  test('reentrant activation is blocked; later deliberate gesture is allowed',()=>{
    let controller:DecisionController<{id:string}>, handle:ReturnType<DecisionController<{id:string}>['bind']>;
    const send=vi.fn(()=>{expect(controller.capture(handle,'pass')).toBeNull();expect(controller.dispatch(queued)).toBe(false);});
    controller=new DecisionController(send);handle=controller.bind(finite(),offer(),'player');const queued=controller.capture(handle,'pass')!;
    expect(controller.dispatch(controller.capture(handle,'pass')!)).toBe(true);
    expect(controller.dispatch(controller.capture(handle,'pass')!)).toBe(true);expect(send).toHaveBeenCalledTimes(2);
  });
  test('transport exception consumes token and releases reentrant guard',()=>{
    const send=vi.fn(()=>{throw new Error('offline');}),controller=new DecisionController(send);const handle=controller.bind(finite(),offer(),'player');const token=controller.capture(handle,'pass')!;
    expect(()=>controller.dispatch(token)).toThrow('offline');expect(controller.dispatch(token)).toBe(false);expect(controller.capture(handle,'pass')).not.toBeNull();
  });
  test('disposal expires handles/tokens and refuses rebinding',()=>{
    const controller=new DecisionController(vi.fn());const handle=controller.bind(finite(),offer(),'player');const token=controller.capture(handle,'pass')!;controller.dispose();
    expect(controller.snapshot(handle)).toBeNull();expect(controller.dispatch(token)).toBe(false);expect(()=>controller.bind(finite(),offer(),'player')).toThrow('disposed');
  });
  test('commands-only and empty panels need no artificial selection',()=>{
    const controller=new DecisionController(vi.fn());const spec:DecisionSpec={id:'actions',kind:'commands',commands:['pass']};const handle=controller.bind(spec,offer(),'player');
    expect(controller.snapshot(handle)?.selected).toBeNull();expect(controller.dispatch(controller.capture(handle,'pass')!)).toBe(true);
    expect(validateDecision({...spec,commands:[]},offer())).toEqual([]);
  });
});

// These compile fixtures keep unsupported mixed capabilities outside the public union.
// @ts-expect-error commands-only decisions cannot carry finite-choice fields
const mixedCommands: DecisionSpec = {kind:'commands',id:'bad',commands:[],fields:[]};
// @ts-expect-error numeric decisions remain unsupported in the first production slice
const numericDecision: DecisionSpec = {kind:'number',id:'bad',commands:[],numberAction:'bet'};
void mixedCommands; void numericDecision;

test('eligibility indexes observe caller edits on each invocation and fail closed on malformed relations',()=>{
  const first={id:'one',label:'One',enabled:true},second={id:'two',label:'Two',enabled:true};
  const firstAction={...action('one')},secondAction={...action('two')};
  const current={id:'mutable',actions:[firstAction,secondAction]};
  const spec:FiniteDecisionSpec={id:'mutable',kind:'finite-choice',commands:[],fields:[{id:'value',label:'Value',options:[first,second]}],variants:[{tuple:{value:'one'},actionId:'one'},{tuple:{value:'two'},actionId:'two'}],initialValues:{value:'one'},reconciliation:'preserve-compatible',submit:{unavailable:'disabled'}};
  expect(availableOptions(spec,current)[0].options.map(option=>option.available)).toEqual([true,true]);
  firstAction.enabled=false;expect(initializeChoices(spec,current)).toEqual({value:'two'});
  second.enabled=false;expect(availableOptions(spec,current)[0].options.map(option=>option.available)).toEqual([false,false]);expect(initializeChoices(spec,current)).toBeNull();
  firstAction.enabled=true;first.id='changed';
  expect(validateDecision(spec,current)).toContain('incomplete variant tuple');expect(availableOptions(spec,current)[0].options.every(option=>!option.available)).toBe(true);
});

test('controller owns and freezes nested catalogue metadata and artwork',()=>{
 const visual={kind:'standard' as const,suit:'Spade' as const,rank:14};
 const catalogue={title:'Cards',openLabel:'Other',featuredIds:['a1'],groups:[{id:'all',label:'All',optionIds:['a1','a2']}]};
 const spec:FiniteDecisionSpec={...finite(),fields:finite().fields.map((field,index)=>index?field:{...field,catalogue,options:field.options.map(option=>({...option,visual}))})};
 const controller=new DecisionController(vi.fn()),handle=controller.bind(spec,offer(),'player');
 visual.rank=99;catalogue.featuredIds[0]='invented';catalogue.groups[0].optionIds[0]='invented';
 const snapshot=controller.snapshot(handle)!;if(snapshot.spec.kind!=='finite-choice')throw Error();
 const field=snapshot.spec.fields[0];
 expect(field.catalogue?.featuredIds).toEqual(['a1']);expect(field.catalogue?.groups?.[0].optionIds).toEqual(['a1','a2']);
 expect(field.options[0].visual).toMatchObject({rank:14});expect(snapshot.errors).toEqual([]);
 expect(Object.isFrozen(field.options[0].visual)).toBe(true);expect(Object.isFrozen(field.catalogue?.groups?.[0].optionIds)).toBe(true);
 expect(()=>{(field.catalogue!.featuredIds as string[])[0]='invented';}).toThrow();
});

test('choice-strip presentation is closed and independently immutable in controller ownership',()=>{
 const spec={...finite(),presentation:{kind:'choice-strips' as const}},controller=new DecisionController(()=>{}),handle=controller.bind(spec,offer(),'scope');
 expect(validateDecision(spec,offer())).toEqual([]);expect(controller.snapshot(handle)!.spec).toMatchObject({presentation:{kind:'choice-strips'}});
 expect(Object.isFrozen(controller.snapshot(handle)!.spec.presentation)).toBe(true);expect(controller.snapshot(handle)!.spec.presentation).not.toBe(spec.presentation);
 for(const presentation of [null,{kind:'selects'},{kind:'choice-strips',width:100},{get kind(){throw Error('must not invoke');}}])expect(validateDecision({...finite(),presentation} as never,offer())).toContain('invalid finite presentation');
 expect(validateDecision({id:'commands',kind:'commands',commands:['pass'],presentation:{kind:'choice-strips'}} as never,offer())).toContain('incompatible finite presentation');
});
test('explicit strips show downstream options only for the chosen offered prefix, including disabled rows',()=>{
 const spec={...finite(),presentation:{kind:'choice-strips' as const}};
 expect(availableOptions(spec,offer(),{a:'a1',b:'b2'}).map(field=>field.options.map(option=>option.id))).toEqual([['a1','a2'],['b2']]);
 expect(availableOptions(spec,offer(),{a:'a2',b:'b1'})[1].options.map(option=>option.id)).toEqual(['b1','b2']);
 expect(availableOptions(finite(),offer(),{a:'a1',b:'b2'})[1].options.map(option=>option.id)).toEqual(['b1','b2']);
 const disabled={...offer(),actions:offer().actions.map(action=>({...action,enabled:false}))};expect(availableOptions(spec,disabled,null)[1].options.map(option=>[option.id,option.available])).toEqual([['b2',false]]);
 const controller=new DecisionController(()=>{}),handle=controller.bind(spec,offer(),'s');expect(controller.snapshot(handle)!.fields[1].options.map(option=>option.id)).toEqual(['b2']);controller.choose(handle,'a','a2');expect(controller.snapshot(handle)!.fields[1].options.map(option=>option.id)).toEqual(['b1','b2']);
});
test('dependent strip availability cannot borrow another parent’s enabled tuple or retarget it',()=>{
 const spec:FiniteDecisionSpec={id:'bid',kind:'finite-choice',presentation:{kind:'choice-strips'},commands:[],fields:[{id:'trump',label:'Trump',options:[{id:'Spade',label:'Spade',enabled:true},{id:'Heart',label:'Heart',enabled:true}]},{id:'count',label:'Count',options:[{id:'14',label:'14',enabled:true},{id:'15',label:'15',enabled:true}]}],variants:[{tuple:{trump:'Spade',count:'14'},actionId:'s14'},{tuple:{trump:'Spade',count:'15'},actionId:'s15'},{tuple:{trump:'Heart',count:'14'},actionId:'h14'}],initialValues:{trump:'Spade',count:'15'},reconciliation:'preserve-compatible',submit:{unavailable:'disabled'}},offered={id:'offer',actions:[action('s14',false),action('s15'),action('h14')]},current={trump:'Spade',count:'15'};
 expect(availableOptions(spec,offered,current)[1].options.map(option=>[option.id,option.available])).toEqual([['14',false],['15',true]]);expect(reconcileChoices(spec,offered,current,'count','14')).toBeNull();expect(reconcileChoices(spec,offered,current,'trump','Heart')).toEqual({trump:'Heart',count:'14'});
 const controller=new DecisionController(()=>{}),handle=controller.bind(spec,offered,'s');expect(controller.choose(handle,'count','14')).toBe(false);expect(controller.snapshot(handle)!.values).toEqual(current);
 const grace={...offered,actions:offered.actions.map(action=>({...action,enabled:false}))};expect(availableOptions(spec,grace,null)[1].options.map(option=>[option.id,option.available])).toEqual([['14',false],['15',false]]);expect(reconcileChoices(spec,grace,current,'count','14')).toBeNull();
 const legacy={...spec,presentation:undefined};expect(reconcileChoices(legacy,offered,current,'count','14')).toEqual({trump:'Heart',count:'14'});
});
