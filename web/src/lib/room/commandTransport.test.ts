import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createCommandTransport,type CommandContext,type RecoveryRecord,type ScopedMessage} from './commandTransport';
import type {CommandReceipt,CommandScope} from '../generated/protocol';
const scope:CommandScope={domain:'game',room_id:'test',room_epoch:'a'.repeat(32),session_id:1,hand:0,version:2,seat:0,actor_id:'actor'};
const context=(next_sequence=1,actor:string|null='actor',connection=1):CommandContext=>({connected:true,connection,actor,window:{scope:{...scope,actor_id:actor??'actor'},next_sequence}});
const receipt=(record:RecoveryRecord,outcome:CommandReceipt['outcome'],savedScope:CommandScope|null=record.expected):CommandReceipt=>({operation_id:record.operation_id,sequence:record.sequence,scope:savedScope,outcome,durability:'persisted'});
function fixture(initial:unknown=[]){
  let saved=structuredClone(initial),fail=false,failSend=false;
  const sent:ScopedMessage<unknown>[]=[],resolved:[string,string][]=[],order:string[]=[];
  const transport=createCommandTransport<unknown>({room:'test',nonce:()=>`nonce-${sent.length}`,send:message=>{order.push('send');sent.push(message);return !failSend;},store:{read:()=>saved,write:value=>{order.push('save');if(fail)throw Error('quota');saved=structuredClone(value);}}});
  transport.onResolution((id,status)=>resolved.push([id,status]));
  return{transport,sent,resolved,order,get saved(){return saved as RecoveryRecord[];},set fail(value:boolean){fail=value;},set failSend(value:boolean){failSend=value;}};
}
beforeEach(()=>vi.useFakeTimers());
afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});
describe('scoped browser command transport',()=>{
  it('keeps a fresh submission pending without reporting recovery, then notifies after bounded silence',async()=>{
    const f=fixture();f.transport.update(context());
    const changes:{pending:number;recovering:number;ready:boolean}[]=[];
    f.transport.subscribe(value=>changes.push(value));
    expect(f.transport.submit('local',scope,{privateCard:'secret'})).toBe(true);
    expect(f.transport.snapshot()).toMatchObject({ready:false,pending:1,recovering:0});
    expect(changes.at(-1)).toMatchObject({ready:false,pending:1,recovering:0});
    await vi.advanceTimersByTimeAsync(1499);
    expect(f.transport.snapshot().recovering).toBe(0);
    expect(f.sent.map(message=>message.type)).toEqual(['submit']);
    const before=changes.length;
    await vi.advanceTimersByTimeAsync(1);
    expect(changes.length).toBeGreaterThan(before);
    expect(changes.at(-1)).toMatchObject({ready:false,pending:1,recovering:1});
    expect(Object.isFrozen(changes.at(-1))).toBe(true);
    expect(f.sent.map(message=>message.type)).toEqual(['submit','query_operation']);
    const record=f.saved[0];
    f.transport.receive(receipt(record,{status:'unavailable',reason:'unknown'},null));
    expect(f.transport.snapshot()).toMatchObject({pending:1,recovering:1});
    expect(f.sent.map(message=>message.type)).toEqual(['submit','query_operation','cancel_operation']);
    f.transport.receive(receipt(record,{status:'rejected',reason:'cancelled',error:null}));
    expect(changes.at(-1)).toMatchObject({pending:0,recovering:0});
    expect(f.resolved).toEqual([['local','rejected']]);
    expect(JSON.stringify(f.saved)).not.toContain('secret');f.transport.dispose();
  });
  it('reports disconnected and restored owned uncertainty while never replaying its action',()=>{
    const f=fixture();f.transport.update(context());f.transport.submit('local',scope,{privateCard:'secret'});
    f.transport.update({...context(),connected:false,window:null});
    expect(f.transport.snapshot()).toMatchObject({ready:false,pending:1,recovering:1});
    expect(f.sent.map(message=>message.type)).toEqual(['submit']);
    f.transport.update(context(1,'actor',2));
    expect(f.transport.snapshot()).toMatchObject({ready:false,pending:1,recovering:1});
    expect(f.sent.map(message=>message.type)).toEqual(['submit','query_operation']);
    const saved=f.saved;f.transport.dispose();
    const restored=fixture(saved);restored.transport.update(context());
    expect(restored.transport.snapshot()).toMatchObject({ready:false,pending:1,recovering:1});
    expect(restored.sent.map(message=>message.type)).toEqual(['query_operation']);
    restored.transport.receive(receipt(saved[0],{status:'accepted',version:3}));
    expect(restored.transport.snapshot()).toMatchObject({pending:0,recovering:0});
    expect(restored.resolved).toEqual([]);restored.transport.dispose();
  });

  it('saves only immutable recovery metadata before sending and waits for a fresh command window',()=>{
    const f=fixture();f.transport.update(context());const expected={...scope};
    expect(f.transport.submit('local-1',expected,{privateCard:'secret-card'})).toBe(true);
    expect(f.order).toEqual(['save','send']);expect(JSON.stringify(f.saved)).not.toContain('secret');
    expected.version=900;expect(f.saved[0].expected.version).toBe(2);
    expect(f.transport.submit('local-2',scope,{})).toBe(false);
    const record=f.saved[0];f.transport.receive(receipt(record,{status:'accepted',version:3}));
    expect(f.resolved).toEqual([['local-1','accepted']]);expect(f.saved).toEqual([]);
    expect(f.transport.snapshot().ready).toBe(false);
    f.transport.update({...context(2),window:{scope:{...scope,version:3},next_sequence:2}});
    expect(f.transport.snapshot().ready).toBe(true);f.transport.dispose();
  });
  it('reconnect queries then cancels an unknown operation without retransmitting an action',()=>{
    const f=fixture();f.transport.update(context());f.transport.submit('local-1',scope,{private:'payload'});const record=f.saved[0];
    f.transport.update({...context(),connected:false,actor:null,window:null});f.transport.update(context(1,'actor',2));
    expect(f.sent.map(message=>message.type)).toEqual(['submit','query_operation']);
    f.transport.receive(receipt(record,{status:'unavailable',reason:'unknown'},null));
    expect(f.sent.at(-1)).toEqual({type:'cancel_operation',...record});
    f.transport.receive(receipt(record,{status:'rejected',reason:'cancelled',error:null}));
    expect(f.resolved).toEqual([['local-1','rejected']]);expect(f.sent.filter(message=>message.type==='submit')).toHaveLength(1);f.transport.dispose();
  });
  it('reload recovers saved identity without retaining or regenerating the original action',()=>{
    const f=fixture();f.transport.update(context());f.transport.submit('old-local',scope,{private:'secret'});const record=f.saved[0];f.transport.dispose();
    const fresh=fixture(f.saved);fresh.transport.update(context(2));
    expect(fresh.sent).toEqual([{type:'query_operation',operation_id:record.operation_id,sequence:1}]);
    fresh.transport.receive(receipt(record,{status:'accepted',version:3}));
    expect(fresh.saved).toEqual([]);expect(fresh.resolved).toEqual([]);expect(fresh.transport.snapshot().ready).toBe(true);fresh.transport.dispose();
  });
  it('a cancellation preflight rejection does not resolve the original action',()=>{
    const f=fixture();f.transport.update(context());f.transport.submit('local',scope,{});const record=f.saved[0];
    for(const reason of ['actor_mismatch','stale_scope','sequence_gap','sequence_conflict','capacity'] as const){
      f.transport.receive(receipt(record,{status:'rejected',reason,error:null},null));
      expect(f.transport.snapshot().pending).toBe(1);expect(f.resolved).toEqual([]);
    }f.transport.dispose();
  });
  it('foreign actors cannot query or resolve another actor recovery record',()=>{
    const f=fixture();f.transport.update(context());f.transport.submit('local',scope,{});const record=f.saved[0];
    f.transport.update(context(1,'other',2));expect(f.transport.snapshot().pending).toBe(0);
    f.transport.receive(receipt(record,{status:'accepted',version:3}));expect(f.resolved).toEqual([]);expect(f.sent).toHaveLength(1);
    f.transport.update(context(1,'actor',3));expect(f.sent.at(-1)?.type).toBe('query_operation');f.transport.dispose();
  });
  it('another room epoch fences old uncertainty without claiming an outcome',()=>{
    const f=fixture();f.transport.update(context());f.transport.submit('local',scope,{});
    f.transport.update({...context(),window:{scope:{...scope,room_epoch:'b'.repeat(32)},next_sequence:1}});
    expect(f.resolved).toEqual([['local','unavailable']]);expect(f.transport.snapshot().ready).toBe(true);f.transport.dispose();
  });
  it('a pruned receipt proves a permanent fence without inventing the historical outcome',()=>{
    const f=fixture();f.transport.update(context());f.transport.submit('local',scope,{});const record=f.saved[0];
    f.transport.update({...context(),window:null});
    f.transport.receive(receipt(record,{status:'unavailable',reason:'pruned'},null));
    expect(f.resolved).toEqual([['local','unavailable']]);expect(f.saved).toEqual([]);f.transport.dispose();
  });
  it('storage failure prevents any action transmission',()=>{
    const f=fixture();f.transport.update(context());f.fail=true;
    expect(f.transport.submit('local',scope,{secret:true})).toBe(false);expect(f.sent).toEqual([]);
    expect(f.transport.snapshot()).toMatchObject({ready:false,storageError:true});f.transport.dispose();
  });
  it('corrupt recovery metadata fails closed',()=>{
    for(const initial of [{},[{operation_id:'1:x',sequence:1,expected:{...scope,version:Infinity}}],Array(129).fill(null)]){
      const f=fixture(initial);f.transport.update(context());expect(f.transport.submit('local',scope,{})).toBe(false);
      expect(f.transport.snapshot().storageError).toBe(true);expect(f.sent).toEqual([]);f.transport.dispose();
    }
  });
  it('mismatched receipt identity and scope cannot resolve an operation',()=>{
    const f=fixture();f.transport.update(context());f.transport.submit('local',scope,{});const record=f.saved[0];
    f.transport.receive({...receipt(record,{status:'accepted',version:3}),sequence:2});
    f.transport.receive(receipt(record,{status:'accepted',version:3},{...scope,actor_id:'other'}));
    f.transport.receive({...receipt(record,{status:'accepted',version:3}),operation_id:'1:foreign'});
    expect(f.resolved).toEqual([]);expect(f.transport.snapshot().pending).toBe(1);f.transport.dispose();
  });
  it('a lost receipt is queried at a bounded interval and disposal cancels recovery work',async()=>{
    const f=fixture();f.transport.update(context());f.transport.submit('local',scope,{});
    await vi.advanceTimersByTimeAsync(1500);expect(f.sent.at(-1)?.type).toBe('query_operation');
    const count=f.sent.length;f.transport.dispose();await vi.advanceTimersByTimeAsync(9000);expect(f.sent).toHaveLength(count);expect(vi.getTimerCount()).toBe(0);
  });
  it('reports the global record cap even when every retained record belongs to another actor',()=>{
    const records=Array.from({length:128},(_,index)=>({operation_id:`1:foreign-${index}`,sequence:1,expected:{...scope,actor_id:`other-${index}`}}));
    const f=fixture(records);f.transport.update(context());
    expect(f.transport.snapshot()).toMatchObject({ready:false,pending:0,capacity:true});
    expect(f.transport.submit('local',scope,{})).toBe(false);expect(f.sent).toEqual([]);f.transport.dispose();
  });

  it('owns a primitive scope copy from a reactive proxy window',()=>{
    const f=fixture();const next=context();
    f.transport.update({...next,window:new Proxy(next.window!,{})});
    expect(f.transport.submit('local',scope,{})).toBe(true);f.transport.dispose();
  });
  it('keeps an accepted sequence floor through missing reconnect windows',()=>{
    const f=fixture();f.transport.update(context());f.transport.submit('local',scope,{});const record=f.saved[0];
    f.transport.receive(receipt(record,{status:'accepted',version:3}));
    f.transport.update({...context(),connected:false,actor:null,window:null});
    f.transport.update(context(1,'actor',2));
    expect(f.transport.snapshot().ready).toBe(false);expect(f.transport.submit('new',scope,{})).toBe(false);
    f.transport.update(context(2,'actor',2));expect(f.transport.snapshot().ready).toBe(true);f.transport.dispose();
  });

  it('known-not-sent rejection does not reserve the unconsumed sequence forever',()=>{
    const f=fixture();f.transport.update(context());f.failSend=true;
    expect(f.transport.submit('local',scope,{})).toBe(false);expect(f.saved).toEqual([]);
    expect(f.resolved).toEqual([['local','rejected']]);
    f.transport.update({...context(),connected:false,window:null,actor:null});
    f.transport.update(context(1,'actor',2));f.failSend=false;
    expect(f.transport.snapshot().ready).toBe(true);expect(f.transport.submit('new',scope,{})).toBe(true);
    f.transport.dispose();
  });

  it('admits an authenticated observer join in the room domain and recovers its original owner',()=>{
    const f=fixture();const roomScope:CommandScope={...scope,domain:'room',version:12,seat:null};
    f.transport.update({...context(),window:null,roomWindow:{scope:roomScope,next_sequence:1}});
    expect(f.transport.submitRoom('join',roomScope,{type:'join',name:'A',seat:0,device:null})).toBe(true);
    expect(f.sent[0].type).toBe('submit_room');const record=f.saved[0];
    f.transport.update({...context(2),roomWindow:{scope:{...roomScope,seat:0,version:13},next_sequence:2}});
    f.transport.receive(receipt(record,{status:'accepted',version:13}));
    expect(f.resolved).toEqual([['join','accepted']]);expect(f.saved).toEqual([]);f.transport.dispose();
  });
  it('separates room and game versions and waits for shared sequence agreement',()=>{
    const f=fixture();const roomScope:CommandScope={...scope,domain:'room'};
    f.transport.update({...context(),roomWindow:{scope:roomScope,next_sequence:2}});
    expect(f.transport.snapshot().ready).toBe(false);
    f.transport.update({...context(),roomWindow:{scope:roomScope,next_sequence:1}});
    expect(f.transport.submitRoom('wrong',scope,{type:'start'})).toBe(false);
    expect(f.transport.submit('wrong',roomScope,{})).toBe(false);
    expect(f.transport.submitRoom('room',roomScope,{type:'start'})).toBe(true);f.transport.dispose();
  });

});

it('recovers an accepted name-adoption tag without retaining a name or action',()=>{
 const roomScope={...scope,domain:'room' as const},roomContext={...context(),window:null,roomWindow:{scope:roomScope,next_sequence:1}};
 const first=fixture();first.transport.update(roomContext);expect(first.transport.submitRoom('form-name',roomScope,{type:'rename',name:'never persisted'},'adopt-name')).toBe(true);
 const record=first.saved[0];expect(record.completion).toBe('adopt-name');expect(JSON.stringify(first.saved)).not.toContain('never persisted');expect(Object.keys(record).sort()).toEqual(['completion','expected','operation_id','sequence']);first.transport.dispose();
 const next=fixture([record]),events:unknown[]=[];next.transport.onCompletion(event=>events.push(event));next.transport.update({...roomContext,connection:2,roomWindow:{scope:{...roomScope,version:3},next_sequence:2}});
 expect(next.sent.map(message=>message.type)).toEqual(['query_operation']);next.transport.receive(receipt(record,{status:'accepted',version:3}));expect(events).toEqual([{record,status:'accepted',recovered:true}]);expect(next.resolved).toEqual([]);expect(next.saved).toEqual([]);next.transport.dispose();
});
it('only explicit room name commands can acquire the bounded completion tag',()=>{
 const roomScope={...scope,domain:'room' as const};const f=fixture();f.transport.update({...context(),window:null,roomWindow:{scope:roomScope,next_sequence:1}});
 expect(f.transport.submitRoom('not-name',roomScope,{type:'start'},'adopt-name')).toBe(false);expect(f.saved).toEqual([]);expect(f.sent).toEqual([]);f.transport.dispose();
 for(const record of [{operation_id:'1:x',sequence:1,expected:scope,completion:'adopt-name'},{operation_id:'1:x',sequence:1,expected:roomScope,completion:'arbitrary'}]){const broken=fixture([record]);expect(broken.transport.snapshot().storageError).toBe(true);broken.transport.dispose();}
});

it.each(['disconnect','actor','connection','scope','sequence','dispose'] as const)('never hands a recorded name to a %s replacement during notification',change=>{
 const roomScope={...scope,domain:'room' as const},original={...context(),window:null,roomWindow:{scope:roomScope,next_sequence:1}},f=fixture();f.transport.update(original);let changed=false;
 f.transport.subscribe(value=>{if(changed||!value.pending)return;changed=true;
  if(change==='dispose'){f.transport.dispose();return;}
  f.transport.update({...original,...(change==='disconnect'?{connected:false}:change==='actor'?{actor:'other'}:change==='connection'?{connection:2}:{}),roomWindow:{scope:{...roomScope,...(change==='scope'?{version:3}:{})},next_sequence:change==='sequence'?2:1}});
 });
 expect(f.transport.submitRoom('name',roomScope,{type:'rename',name:'private intended name'},'adopt-name')).toBe(false);expect(f.sent.filter(message=>message.type==='submit_room')).toEqual([]);
 expect(f.saved).toEqual([]);
 if(change!=='dispose'){f.transport.update(original);expect(f.transport.snapshot().ready).toBe(true);expect(f.transport.submitRoom('fresh',roomScope,{type:'rename',name:'fresh'},'adopt-name')).toBe(true);expect(f.sent.filter(message=>message.type==='submit_room')).toHaveLength(1);}
 else{const fresh=fixture(f.saved);fresh.transport.update(original);expect(fresh.transport.snapshot().ready).toBe(true);expect(fresh.transport.submitRoom('fresh',roomScope,{type:'rename',name:'fresh'},'adopt-name')).toBe(true);fresh.transport.dispose();}
 f.transport.dispose();
});

it('disposing a never-handed name removes only that record and retains earlier uncertainty',()=>{
 const older:RecoveryRecord={operation_id:'7:older',sequence:7,expected:{...scope,actor_id:'earlier'}};const f=fixture([older]),roomScope={...scope,domain:'room' as const};f.transport.update({...context(),window:null,roomWindow:{scope:roomScope,next_sequence:1}});
 f.transport.subscribe(value=>{if(value.pending)f.transport.dispose();});expect(f.transport.submitRoom('new',roomScope,{type:'rename',name:'not sent'},'adopt-name')).toBe(false);expect(f.saved).toEqual([older]);expect(f.sent).toEqual([]);
});

it('sends a bounded atomic batch once and retains only recovery metadata',()=>{
 const f=fixture();f.transport.update(context());
 expect(f.transport.submitBatch('batch',scope,[{Discard:'secret-a'},{Discard:'secret-b'}])).toBe(true);
 expect(f.sent).toHaveLength(1);expect(f.sent[0]).toMatchObject({type:'submit_batch',actions:[{Discard:'secret-a'},{Discard:'secret-b'}]});expect(f.sent[0]).not.toHaveProperty('action');
 expect(f.order).toEqual(['save','send']);expect(JSON.stringify(f.saved)).not.toContain('secret');
 f.transport.update({...context(),connection:2});expect(f.sent.at(-1)?.type).toBe('query_operation');expect(f.sent.filter(m=>m.type==='submit_batch')).toHaveLength(1);f.transport.dispose();
});
it('rejects empty or oversized batches before spending sequence or persistence',()=>{
 const f=fixture();f.transport.update(context());for(const actions of [[],Array(33).fill('Pass')])expect(f.transport.submitBatch('bad',scope,actions)).toBe(false);
 expect(f.sent).toEqual([]);expect(f.saved).toEqual([]);expect(f.order).toEqual([]);f.transport.dispose();
});
