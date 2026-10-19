import type {RoomActionOf} from './types';
import {MAX_COMMAND_BATCH,type ClientMsg,type CommandReceipt,type CommandScope,type CommandWindow} from '../generated/protocol';

/** Payload-free recovery capability. Never stores cards, actions or seat tokens. */
export type RecoveryCompletion = 'adopt-name';
export interface RecoveryRecord { readonly operation_id: string; readonly sequence: number; readonly expected: CommandScope; readonly completion?:RecoveryCompletion; }
export interface CommandCompletion {readonly record:RecoveryRecord;readonly status:CommandResolution;readonly recovered:boolean;}
export interface RecoveryStore { read(): unknown; write(records: readonly RecoveryRecord[]): void; }
export interface CommandContext { readonly connected: boolean; readonly connection: number; readonly actor: string | null; readonly window: CommandWindow | null; readonly roomWindow?: CommandWindow | null; }
/** Derived from the generated room protocol; only the game's action is generic. */
export type ScopedMessage<A,S=unknown> =
  | (Omit<Extract<ClientMsg,{type:'submit'}>,'action'> & {action:A})
  | (Omit<Extract<ClientMsg,{type:'submit_batch'}>,'actions'> & {actions:readonly A[]})
  | (Omit<Extract<ClientMsg,{type:'submit_room'}>,'action'> & {action:RoomActionOf<S>})
  | Extract<ClientMsg,{type:'query_operation'|'cancel_operation'}>;
export type CommandResolution = 'accepted' | 'rejected' | 'unavailable';
export interface RecoverySnapshot { readonly ready: boolean; readonly pending: number; /** Owned requests requiring recovery, excluding a fresh local submission. */ readonly recovering: number; readonly storageError: boolean; readonly capacity: boolean; }
interface Pending { record:RecoveryRecord; localId?:string; request?:'submit'|'query'|'cancel'; }
const validId=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=128&&/^[a-zA-Z0-9_:\-./]+$/.test(value);
const integer=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>=0;
const equalScope=(a:CommandScope,b:CommandScope)=>(a.domain??'game')===(b.domain??'game')&&a.room_id===b.room_id&&a.room_epoch===b.room_epoch&&a.session_id===b.session_id&&a.hand===b.hand&&a.version===b.version&&a.seat===b.seat&&a.actor_id===b.actor_id;
function ownRecord(value:unknown,room:string):RecoveryRecord {
  const record=value as RecoveryRecord, scope=record?.expected;
  if (!scope || !validId(record.operation_id) || !integer(record.sequence) || record.sequence < 1 ||
      !record.operation_id.startsWith(`${record.sequence}:`) || record.operation_id === `${record.sequence}:` ||
      scope.room_id !== room || !validId(scope.actor_id) ||
      !(typeof scope.room_epoch === 'string' && /^[0-9a-f]{32}$/i.test(scope.room_epoch)) ||
      ![scope.session_id, scope.hand, scope.version].every(integer) ||
      !(scope.seat === null || integer(scope.seat)) ||
      !['game','room'].includes(scope.domain ?? 'game') ||
      scope.session_id > 0xffffffff || scope.hand > 0xffffffff ||
      record.completion!==undefined&&(record.completion!=='adopt-name'||scope.domain!=='room')) {
    throw new Error('Invalid recovery metadata');
  }
  return Object.freeze({operation_id:record.operation_id,sequence:record.sequence,expected:Object.freeze({room_id:room,room_epoch:scope.room_epoch,session_id:scope.session_id,hand:scope.hand,version:scope.version,seat:scope.seat,actor_id:scope.actor_id,domain:scope.domain??'game'}),...(record.completion?{completion:record.completion}:{})});
}
/** One browser-session owner for admission envelopes and uncertainty recovery.
 * The only action transmission is submit(). Recovery queries or cancels the
 * original identity; it never reconstructs or replaces a game action. */
export function createCommandTransport<A,S=unknown>(options:{room:string; send:(message:ScopedMessage<A,S>)=>boolean; store:RecoveryStore; nonce?:()=>string}) {
  let context:CommandContext={connected:false,connection:0,actor:null,window:null};
  let storageError=false,disposed=false,timer:ReturnType<typeof setTimeout>|undefined;
  const pending:Pending[]=[], floors=new Map<string,number>();
  let stored:readonly RecoveryRecord[]=[];
  const listeners=new Set<(snapshot:RecoverySnapshot)=>void>();
  const resolutions=new Set<(id:string,status:CommandResolution)=>void>();
  const completions=new Set<(completion:CommandCompletion)=>void>();
  const key=(scope:CommandScope)=>JSON.stringify([scope.actor_id,scope.room_epoch]);
  try {
    const records=options.store.read();
    if(!Array.isArray(records)||records.length>128)throw new Error('Invalid recovery journal');
    for(const value of records){const record=ownRecord(value,options.room);if(pending.some(item=>item.record.operation_id===record.operation_id&&item.record.expected.actor_id===record.expected.actor_id&&item.record.expected.room_epoch===record.expected.room_epoch))throw new Error('Duplicate recovery record');pending.push({record});}
    stored=pending.map(item=>item.record);
  } catch {storageError=true;}
  const windows=()=>[context.window,context.roomWindow].filter((window):window is CommandWindow=>!!window&&window.scope.actor_id===context.actor);
  const owned=()=>pending.filter(item=>item.record.expected.actor_id===context.actor);
  const snapshot=():RecoverySnapshot=>{
    const records=owned(),count=records.length;
    const recovering=records.filter(item=>item.request!=='submit').length;
    return Object.freeze({ready:!disposed&&!storageError&&pending.length<128&&context.connected&&count===0&&windows().every(window=>window.next_sequence>(floors.get(key(window.scope))??0))&&new Set(windows().map(window=>window.next_sequence)).size<=1,pending:count,recovering,storageError,capacity:pending.length>=128});
  };
  const notify=()=>{const value=snapshot();for(const listener of [...listeners]){try{listener(value);}catch{/* A consumer cannot stall recovery. */}}};
  const save=(records:readonly RecoveryRecord[]=pending.map(item=>item.record))=>{try{options.store.write(records);stored=records;return true;}catch{storageError=true;notify();return false;}};
  const forgetUnsent=(item:Pending)=>{
    if(pending.includes(item)){finish(item,'rejected',false);return;}
    // dispose intentionally preserves genuine uncertainty. This submission has
    // not crossed the send boundary, so remove only its latest stored record.
    if(stored.includes(item.record))save(stored.filter(record=>record!==item.record));
  };
  const finish=(item:Pending,status:CommandResolution,fenced=true)=>{
    const at=pending.indexOf(item);if(at<0)return;
    pending.splice(at,1);
    if(fenced)floors.set(key(item.record.expected),Math.max(floors.get(key(item.record.expected))??0,item.record.sequence));
    save();
    if(!owned().length){clearTimeout(timer);timer=undefined;}
    if(item.localId&&context.actor===item.record.expected.actor_id)for(const listener of [...resolutions]){try{listener(item.localId,status);}catch{/* Receipt consumers are isolated. */}}
    if(item.record.completion&&context.actor===item.record.expected.actor_id)for(const listener of [...completions]){try{listener(Object.freeze({record:item.record,status,recovered:!item.localId}));}catch{/* Completion consumers cannot change the command outcome. */}}
    notify();
  };
  const send=(message:ScopedMessage<A,S>)=>{try{return options.send(message);}catch{return true;/* It may have reached the socket; remain uncertain. */}};
  const query=(item:Pending)=>{item.request='query';if(!send({type:'query_operation',operation_id:item.record.operation_id,sequence:item.record.sequence}))item.request=undefined;};
  const reconcile=()=>{
    if(disposed||storageError||!context.connected||!context.actor)return;
    for(const item of owned()){
      const current=context.roomWindow??context.window;
      if(current&&current.scope.room_epoch!==item.record.expected.room_epoch){finish(item,'unavailable');continue;}
      if(!item.request)query(item);
    }
    if(owned().length&&!timer)timer=setTimeout(()=>{timer=undefined;for(const item of owned())item.request=undefined;reconcile();notify();},1500);
  };
  const submit=(localId:string,expected:CommandScope,action:A|RoomActionOf<S>|readonly A[],domain:'game'|'room',completion?:RecoveryCompletion,batch=false):boolean=>{
      const window=domain==='game'?context.window:context.roomWindow;
      if(disposed||!snapshot().ready||!window||context.actor!==expected.actor_id||(expected.domain??'game')!==domain||!equalScope(window.scope,expected)||pending.length>=128)return false;
      if(batch&&(!Array.isArray(action)||action.length<1||action.length>MAX_COMMAND_BATCH))return false;
      const sequence=window.next_sequence;
      if(!integer(sequence)||sequence<1)return false;
      const operation_id=`${sequence}:${(options.nonce??(()=>crypto.randomUUID()))()}`;
      if(completion!==undefined&&(completion!=='adopt-name'||domain!=='room'||!action||typeof action!=='object'||!('type' in action)||!['join','rename'].includes(String(action.type))))return false;
      const record=ownRecord({operation_id,sequence,expected,...(completion?{completion}:{})},options.room);
      const item:Pending={record,localId,request:'submit'};
      const connection=context.connection;
      pending.push(item);
      if(!save()){pending.pop();return false;}
      notify();
      // Subscribers can synchronously replace the actor/socket/window or
      // dispose this owner. A recorded intent is not permission to hand its
      // private payload to a different connection after notification.
      const current=domain==='game'?context.window:context.roomWindow;
      if(disposed||context.connection!==connection||!context.connected||context.actor!==record.expected.actor_id||
        !current||!equalScope(current.scope,record.expected)||current.next_sequence!==sequence||!pending.includes(item)){
        forgetUnsent(item);
        return false;
      }
      if(!send(domain==='game'?(batch?{type:'submit_batch',operation_id,sequence,expected:record.expected,actions:action as readonly A[]}:{type:'submit',operation_id,sequence,expected:record.expected,action:action as A}):{type:'submit_room',operation_id,sequence,expected:record.expected,action:action as RoomActionOf<S>})){
        forgetUnsent(item);return false;
      }
      // Silence after send is uncertainty too: recovery starts without waiting
      // for a state message or a reconnect to happen.
      reconcile();
      // This owner retains only the immutable metadata. No action survives send.
      return true;
  };
  return {
    snapshot,
    subscribe(listener:(snapshot:RecoverySnapshot)=>void){listeners.add(listener);listener(snapshot());return()=>{listeners.delete(listener);};},
    onResolution(listener:(id:string,status:CommandResolution)=>void){resolutions.add(listener);return()=>{resolutions.delete(listener);};},
    onCompletion(listener:(completion:CommandCompletion)=>void){completions.add(listener);return()=>{completions.delete(listener);};},
    update(next:CommandContext){
      if(disposed)return;
      const changed=context.connection!==next.connection||context.actor!==next.actor||!next.connected;
      context={...next,window:next.window?{scope:{...next.window.scope},next_sequence:next.window.next_sequence}:null,roomWindow:next.roomWindow?{scope:{...next.roomWindow.scope},next_sequence:next.roomWindow.next_sequence}:null};
      if(changed)for(const item of pending)item.request=undefined;
      const current=windows();
      if(current.length)for(const [id,floor] of floors)if(current.every(window=>id!==key(window.scope)||window.next_sequence>floor))floors.delete(id);
      if(!context.connected||!owned().length){clearTimeout(timer);timer=undefined;}
      reconcile();notify();
    },
    submit(localId:string,expected:CommandScope,action:A){return submit(localId,expected,action,'game');},
    submitBatch(localId:string,expected:CommandScope,actions:readonly A[]){return submit(localId,expected,actions,'game',undefined,true);},
    submitRoom(localId:string,expected:CommandScope,action:RoomActionOf<S>,completion?:RecoveryCompletion){return submit(localId,expected,action,'room',completion);},
    receive(receipt:CommandReceipt){
      if(disposed||!context.connected||!context.actor)return;
      const item=owned().find(item=>item.record.operation_id===receipt.operation_id&&item.record.sequence===receipt.sequence);
      if(!item)return;
      if(receipt.scope&&equalScope(receipt.scope,item.record.expected)&&['accepted','rejected'].includes(receipt.outcome.status)){
        finish(item,receipt.outcome.status as 'accepted'|'rejected');return;
      }
      // A pruned receipt is itself an authenticated permanent sequence fence;
      // it does not tell us whether the historical action was accepted.
      if(receipt.outcome.status==='unavailable'&&receipt.outcome.reason==='pruned'){
        finish(item,'unavailable');return;
      }
      const window=context.roomWindow??context.window;
      if(window&&window.scope.room_epoch===item.record.expected.room_epoch&&window.next_sequence>item.record.sequence){finish(item,'unavailable');return;}
      if(receipt.outcome.status==='unavailable'&&receipt.outcome.reason==='unknown'&&item.request!=='cancel'){
        item.request='cancel';
        if(!send({type:'cancel_operation',operation_id:item.record.operation_id,sequence:item.record.sequence,expected:item.record.expected}))item.request=undefined;
      }
      reconcile();notify();
    },
    dispose(){disposed=true;clearTimeout(timer);timer=undefined;listeners.clear();resolutions.clear();completions.clear();pending.length=0;floors.clear();}
  };
}
