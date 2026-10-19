import type {CommandScope} from '../generated/protocol';

/** Native receive-time authority. Deliberately independent of renderer frame context. */
export interface NativeEphemeralScope {
  readonly connectionEpoch:string;
  readonly command:CommandScope;
  readonly gameVersion:number;
}
export interface NativeAdvice<A> {readonly scope:NativeEphemeralScope;readonly action:A;}
export interface NativeReaction {
  readonly eventId:string;readonly participantId:string;readonly text:string;
  readonly roomId:string;readonly roomEpoch:string;readonly connectionEpoch:string;
}
export interface NativeAdviceAuthority<A> {
  readonly connectionEpoch:string;readonly publicationReady:boolean;readonly connected:boolean;
  readonly actorId:string|null;readonly seat:number|null;readonly roomId:string;
  readonly participantId:string|null;readonly command:CommandScope|null;
  readonly gameVersion:number|null;readonly viewerSeat:number|null;readonly turnSeat:number|null;
  readonly legal:readonly A[];
}
/** Own JSON-shaped packet data; inspect descriptors before accessing values. */
export function ownEphemeralData<T>(input:T):T {
  let budget=0;const active=new Set<object>();
  function copy(value:unknown,depth:number):unknown {
    if(++budget>16384||depth>40)throw Error('Ephemeral data budget');
    if(value===null||value===undefined||typeof value==='boolean')return value;
    if(typeof value==='string'){if(value.length>8192)throw Error('Ephemeral text budget');return value;}
    if(typeof value==='number'&&Number.isFinite(value))return value;
    if(typeof value!=='object'||active.has(value))throw Error('Ephemeral data must be inert');
    const array=Array.isArray(value),proto=Object.getPrototypeOf(value);
    if(proto!==(array?Array.prototype:Object.prototype)&&!(proto===null&&!array))throw Error('Ephemeral data must be plain');
    const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(value);
    if(keys.some(key=>typeof key!=='string'||!('value' in descriptors[key])))throw Error('Ephemeral accessors');
    active.add(value);
    try {
      if(array){const length=descriptors.length.value as number;if(length>4096||keys.some(key=>key!=='length'&&(!/^\d+$/.test(String(key))||Number(key)>=length)))throw Error('Ephemeral array');return Object.freeze(Array.from({length},(_,i)=>{if(!descriptors[i])throw Error('Ephemeral sparse array');return copy(descriptors[i].value,depth+1);}));}
      const result:Record<string,unknown>={};for(const key of keys as string[])Object.defineProperty(result,key,{value:copy(descriptors[key].value,depth+1),enumerable:true});return Object.freeze(result);
    }finally{active.delete(value);}
  }
  return copy(input,0) as T;
}
const string=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=2048;
const natural=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export function sameNativeCommand(a:CommandScope,b:CommandScope):boolean {
  return a.domain===b.domain&&a.room_id===b.room_id&&a.room_epoch===b.room_epoch&&a.session_id===b.session_id&&a.hand===b.hand&&a.version===b.version&&a.seat===b.seat&&a.actor_id===b.actor_id;
}
function validAuthority<A>(a:NativeAdviceAuthority<A>):boolean {
  const c=a.command;
  const closed=!!c&&Object.keys(c).every(key=>['domain','room_id','room_epoch','session_id','hand','version','seat','actor_id'].includes(key));
  return closed&&a.publicationReady===true&&a.connected===true&&string(a.connectionEpoch)&&string(a.actorId)&&a.participantId===a.actorId&&natural(a.seat)&&a.seat!<32&&a.viewerSeat===a.seat&&a.turnSeat===a.seat&&natural(a.gameVersion)&&!!c&&
    c.domain==='game'&&string(c.room_epoch)&&c.room_id===a.roomId&&c.actor_id===a.actorId&&c.seat===a.seat&&c.version===a.gameVersion&&natural(c.session_id)&&natural(c.hand)&&Array.isArray(a.legal);
}
/** Call only while receiving the private packet, never when projecting a view. */
export function captureNativeAdvice<A>(authority:NativeAdviceAuthority<A>,version:number,action:A):NativeAdvice<A>|null {
  try {
    const a=ownEphemeralData(authority),candidate=ownEphemeralData(action);
    if(!validAuthority(a)||version!==a.gameVersion||!a.legal.some(legal=>JSON.stringify(legal)===JSON.stringify(candidate)))return null;
    return ownEphemeralData({scope:{connectionEpoch:a.connectionEpoch,command:a.command!,gameVersion:version},action:candidate});
  }catch{return null;}
}
export function nativeAdviceCurrent<A>(advice:NativeAdvice<A>|null,authority:NativeAdviceAuthority<A>):boolean {
  try {const a=ownEphemeralData(authority),hint=ownEphemeralData(advice);return !!hint&&validAuthority(a)&&hint.scope.connectionEpoch===a.connectionEpoch&&hint.scope.gameVersion===a.gameVersion&&sameNativeCommand(hint.scope.command,a.command!)&&a.legal.some(legal=>JSON.stringify(legal)===JSON.stringify(hint.action));}catch{return false;}
}
export function captureNativeReaction(input:NativeReaction,approved:readonly string[]):NativeReaction|null {
  try {const record=ownEphemeralData(input),palette=ownEphemeralData(approved);return Object.keys(record).every(key=>['eventId','participantId','text','roomId','roomEpoch','connectionEpoch'].includes(key))&&[record.eventId,record.participantId,record.roomId,record.roomEpoch,record.connectionEpoch].every(string)&&palette.includes(record.text)?record:null;}catch{return null;}
}
