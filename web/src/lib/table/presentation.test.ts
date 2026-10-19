import { describe, expect, test, vi } from 'vitest';
import { commandSpecs, commandAction, commandForPayload, commandsForPayloads, resolveCommand, resolveAction, validateAction, type ActionOffer, type ActionSpec, type CommandSpec } from './presentation';

type Action = {type:'bet';amount:number} | {type:'fold'};
const numeric = (patch: Partial<Extract<ActionSpec<Action>,{kind:'number'}>> = {}): ActionSpec<Action> => ({id:'bet',label:'베팅',kind:'number',intent:'primary',enabled:true,min:100,max:500,step:25,initial:100,createAction:amount=>({type:'bet',amount}),...patch});
const offer = (action: ActionSpec<Action> = numeric()): ActionOffer<Action> => ({id:'hand:flop:7',actions:[action]});

describe('current action resolution', () => {
  test('batch payload lookup preserves nested key order independence, array order, exact references and disabled aliases',()=>{
    const command:CommandSpec<unknown>={id:'nested',label:'선택',kind:'command',intent:'quiet',enabled:false,action:{Play:{flag:true,cards:[{Normal:['Spade',14]},null,false,3]}}};
    const query={Play:{cards:[{Normal:['Spade',14]},null,false,3],flag:true}},wrong={Play:{cards:[{Normal:[14,'Spade']},null,false,3],flag:true}};
    const factory=vi.fn(()=>({type:'fold' as const}));
    const source:ActionOffer<unknown>={id:'batch',actions:[numeric({createAction:factory}),command]};
    expect(commandsForPayloads(source,[query,wrong,{foreign:true}])).toEqual([command,null,null]);
    expect(commandsForPayloads(source,[query])[0]).toBe(command);
    expect(commandsForPayloads({...source,actions:[command,{...command,id:'alias',enabled:true,action:query}]},[query])).toEqual([null]);
    expect(factory).not.toHaveBeenCalled();
  });
  test('batch indexing does not broaden legacy non-JSON, sparse, accessor or prototype equality',()=>{
    const source=(action:unknown):ActionOffer<unknown>=>({id:'legacy',actions:[{id:'a',label:'A',kind:'command',intent:'quiet',enabled:true,action}]});
    const nullPrototype=Object.assign(Object.create(null),{nested:[1,2]});
    const date=new Date(0),sparse=Array(1),cycle:any={};cycle.self=cycle;
    const hidden=Object.defineProperty({a:1},'ignored',{value:7}),symbol={a:1,[Symbol('ignored')]:7};
    for(const [action,queries] of [[nullPrototype,[{nested:[1,2]}]],[date,[date,new Date(0)]],[sparse,[[7],Array(1)]],[cycle,[cycle]],[hidden,[{a:1}]],[symbol,[{a:1}]],[undefined,[undefined,null]],[NaN,[NaN,0]],[-0,[-0,0]]] as [unknown,unknown[]][]){
      const offer=source(action),expected=queries.map(query=>commandForPayload(offer,query));expect(commandsForPayloads(offer,queries)).toEqual(expected);
    }
    let calls=0;const accessor=source({get value(){calls++;return 7;}});
    expect(commandsForPayloads(accessor,[{value:7},{value:8}])).toEqual([accessor.actions[0],null]);
    expect(calls).toBe(2); // Key preflight did not invoke a getter; original lookup did.
    const changing:any={id:'a',label:'A',intent:'quiet',enabled:true,action:{a:1}};let kinds=0;Object.defineProperty(changing,'kind',{get(){kinds++;return 'command';}});
    expect(commandsForPayloads({id:'accessor',actions:[changing]},[{a:1},{a:2}])).toEqual([changing,null]);expect(kinds).toBe(2);
  });
  test('outer query accessors retain one-read fallback semantics and sparse/prototype arrays stay legacy',()=>{
    const command:CommandSpec<unknown>={id:'a',label:'A',kind:'command',intent:'quiet',enabled:true,action:{a:1}},offer={id:'o',actions:[command]};
    let reads=0;const queries:unknown[]=[];Object.defineProperty(queries,'0',{enumerable:true,get(){return {a:++reads};}});
    expect(commandsForPayloads(offer,queries)).toEqual([command]);expect(reads).toBe(1);
    const sparse=Array(2);sparse[1]={a:1};const result=commandsForPayloads(offer,sparse);expect(Object.hasOwn(result,0)).toBe(false);expect(result[1]).toBe(command);
    const inherited=Object.setPrototypeOf([{a:1}],Object.create(Array.prototype));expect(commandsForPayloads(offer,inherited)).toEqual([command]);
  });
  test('batch and payload lengths/key counts are checked before descriptor copies or child reads',()=>{
    const command:CommandSpec<unknown>={id:'a',label:'A',kind:'command',intent:'quiet',enabled:true,action:{a:1}},offer={id:'o',actions:[command]};
    let actionKeys=0;const actionDescriptors:PropertyKey[]=[];
    const many=Array(4097).fill(numeric());many[0]=command;
    const actions=new Proxy(many,{ownKeys(target){actionKeys++;return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){actionDescriptors.push(key);return Reflect.getOwnPropertyDescriptor(target,key);}});
    expect(commandsForPayloads({id:'many',actions},[{a:1}])).toEqual([command]);expect(actionKeys).toBe(0);expect(actionDescriptors).toEqual(['length']);
    let queryKeys=0;const queryDescriptors:PropertyKey[]=[];
    const queries=new Proxy(Array(4097).fill({a:1}),{ownKeys(target){queryKeys++;return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){queryDescriptors.push(key);return Reflect.getOwnPropertyDescriptor(target,key);}});
    expect(commandsForPayloads(offer,queries).every(result=>result===command)).toBe(true);expect(queryKeys).toBe(0);expect(queryDescriptors).toEqual(['length']);
    let arrayKeys=0;const arrayDescriptors:PropertyKey[]=[];
    const largeArray=new Proxy(Array(10001).fill(0),{ownKeys(target){arrayKeys++;return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){arrayDescriptors.push(key);return Reflect.getOwnPropertyDescriptor(target,key);}});
    const arrayCommand={...command,action:largeArray};expect(commandsForPayloads({id:'array',actions:[arrayCommand]},[largeArray])).toEqual([arrayCommand]);expect(arrayKeys).toBe(0);expect(arrayDescriptors).toEqual(['length']);
    let objectKeys=0,objectDescriptors=0;const largeObject=new Proxy(Object.fromEntries(Array.from({length:10001},(_,i)=>[`field${i}`,i])),{ownKeys(target){objectKeys++;return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){objectDescriptors++;return Reflect.getOwnPropertyDescriptor(target,key);}});
    const objectCommand={...command,action:largeObject};expect(commandsForPayloads({id:'object',actions:[objectCommand]},[largeObject])).toEqual([objectCommand]);expect(objectKeys).toBe(1);expect(objectDescriptors).toBe(0);
  });
  test('one key-work/encoded-byte budget includes all queries, while1201 tiny native payloads stay indexed',()=>{
    let largeVisits=0;const payload=new Proxy({value:'x'.repeat(6000)},{ownKeys(target){largeVisits++;return Reflect.ownKeys(target);}}),command:CommandSpec<unknown>={id:'large',label:'A',kind:'command',intent:'quiet',enabled:true,action:payload};
    expect(commandsForPayloads({id:'bytes',actions:[command]},Array(400).fill(payload)).every(result=>result===command)).toBe(true);
    expect(largeVisits).toBeGreaterThan(1);expect(largeVisits).toBeLessThan(100); // Aggregate exhaustion, then exact-reference legacy fallback.
    let tinyVisits=0;const actions:CommandSpec<unknown>[]=Array.from({length:1201},(_,count)=>({id:String(count),label:'A',kind:'command',intent:'quiet',enabled:false,action:new Proxy({Raise:{trump:'Spade',count}},{ownKeys(target){tinyVisits++;return Reflect.ownKeys(target);}})}));
    expect(commandsForPayloads({id:'native',actions},actions.map(action=>action.action))).toEqual(actions);expect(tinyVisits).toBe(2402);
  });
  test('command selectors return exact current descriptors and exclude numeric factories', () => {
    const command: ActionSpec<Action> = {id:'fold',label:'폴드',kind:'command',intent:'quiet',enabled:false,reason:'대기 중',action:{type:'fold'}};
    const current: ActionOffer<Action> = {id:'hand:7',actions:[numeric(),command]};
    expect(commandSpecs(current)).toEqual([command]);
    expect(commandAction(current,action=>action.type==='fold')).toBe(command);
    expect(commandForPayload(current,{type:'fold'})).toBe(command);
    expect(commandForPayload(current,{type:'bet',amount:100})).toBeNull();
    expect(commandForPayload({...current,actions:[command,{...command,id:'fold-copy'}]},{type:'fold'})).toBeNull();
  });
  test('command payload equality is structural and returns the offered reference', () => {
    type Payload = {Play:{card:{Normal:[string,number]};flag:boolean}};
    const command: ActionSpec<Payload> = {id:'play',label:'내기',kind:'command',intent:'primary',enabled:true,action:{Play:{card:{Normal:['Spade',14]},flag:true}}};
    expect(commandForPayload({id:'v7',actions:[command]},{Play:{flag:true,card:{Normal:['Spade',14]}}})).toBe(command);
    expect(commandForPayload({id:'v7',actions:[command]},{Play:{flag:false,card:{Normal:['Spade',14]}}})).toBeNull();
  });
  test('command resolution rejects stale/disabled/removed commands and never invokes numeric factories', () => {
    const createAction = vi.fn((amount:number):Action=>({type:'bet',amount}));
    const current = offer(numeric({createAction}));
    expect(resolveCommand(current,current.id,'bet')).toMatchObject({ok:false,code:'unknown_action'});
    expect(createAction).not.toHaveBeenCalled();
    const command = offer({id:'fold',label:'폴드',kind:'command',intent:'quiet',enabled:true,action:{type:'fold'}});
    expect(resolveCommand(command,'old','fold')).toMatchObject({ok:false,code:'stale_offer'});
    expect(resolveCommand({...command,actions:[]},command.id,'fold')).toMatchObject({ok:false,code:'unknown_action'});
    expect(resolveCommand({...command,actions:command.actions.map(spec=>({...spec,enabled:false}))},command.id,'fold')).toMatchObject({ok:false,code:'disabled'});
  });
  test('render-time validation never invokes a factory, submission invokes it once', () => {
    const createAction = vi.fn((amount:number):Action=>({type:'bet',amount}));
    const current = offer(numeric({createAction}));
    expect(validateAction(current,current.id,'bet',200)).toMatchObject({ok:true,kind:'number',value:200});
    expect(validateAction(current,current.id,'bet',201)).toMatchObject({ok:false,code:'invalid_step'});
    expect(createAction).not.toHaveBeenCalled();
    expect(resolveAction(current,current.id,'bet',200)).toEqual({ok:true,action:{type:'bet',amount:200}});
    expect(createAction).toHaveBeenCalledExactlyOnceWith(200);
  });
  test('returns the exact command payload without pretending to validate game rules', () => {
    const action: Action = {type:'fold'};
    expect(resolveAction(offer({id:'fold',label:'폴드',kind:'command',intent:'quiet',enabled:true,action}),'hand:flop:7','fold')).toEqual({ok:true,action});
  });
  test('stale offers and removed/ambiguous identities never invoke the action producer', () => {
    const createAction = vi.fn((amount:number):Action=>({type:'bet',amount}));
    const current = offer(numeric({createAction}));
    expect(resolveAction(current,'old','bet',200)).toMatchObject({ok:false,code:'stale_offer'});
    expect(resolveAction(current,current.id,'missing',200)).toMatchObject({ok:false,code:'unknown_action'});
    expect(resolveAction({...current,actions:[...current.actions,...current.actions]},current.id,'bet',200)).toMatchObject({ok:false,code:'unknown_action'});
    expect(createAction).not.toHaveBeenCalled();
  });
  test('disabled descriptions retain their explanation', () => {
    expect(resolveAction(offer(numeric({enabled:false,reason:'내 차례가 아니에요.'})),'hand:flop:7','bet',200)).toMatchObject({ok:false,code:'disabled',reason:'내 차례가 아니에요.'});
  });
  test('accepts bounds and initial value but rejects nonfinite, unsafe, outside-range and off-step values', () => {
    const current = offer();
    for (const amount of [100,125,500]) expect(resolveAction(current,current.id,'bet',amount)).toEqual({ok:true,action:{type:'bet',amount}});
    expect(resolveAction(current,current.id,'bet')).toEqual({ok:true,action:{type:'bet',amount:100}});
    for (const amount of [NaN,Infinity,-Infinity]) expect(resolveAction(current,current.id,'bet',amount)).toMatchObject({ok:false,code:'invalid_number'});
    for (const amount of [99,501]) expect(resolveAction(current,current.id,'bet',amount)).toMatchObject({ok:false,code:'invalid_range'});
    expect(resolveAction(current,current.id,'bet',101)).toMatchObject({ok:false,code:'invalid_step'});
    const huge = offer(numeric({min:0,max:Number.MAX_VALUE,step:1}));
    expect(resolveAction(huge,huge.id,'bet',Number.MAX_SAFE_INTEGER+1)).toMatchObject({ok:false,code:'invalid_number'});
  });
  test('supports fractional increments anchored to min, with rounding tolerance', () => {
    const current = offer(numeric({min:.1,max:1,step:.1,initial:.1}));
    expect(resolveAction(current,current.id,'bet',.3)).toEqual({ok:true,action:{type:'bet',amount:.3}});
    expect(resolveAction(current,current.id,'bet',.35)).toMatchObject({ok:false,code:'invalid_step'});
  });
  test('invalid offered ranges and increments never create an action', () => {
    for (const patch of [{min:600,max:500},{min:NaN},{max:Infinity}]) expect(resolveAction(offer(numeric(patch)),'hand:flop:7','bet',100)).toMatchObject({ok:false,code:'invalid_range'});
    for (const step of [0,-1,NaN,Infinity]) expect(resolveAction(offer(numeric({step})),'hand:flop:7','bet',100)).toMatchObject({ok:false,code:'invalid_step'});
  });
});
