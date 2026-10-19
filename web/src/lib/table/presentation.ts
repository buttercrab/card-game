import type { CardVisual, CardEmphasis } from '../cardTypes';

/** Semantic presentation supplied by a game, independent of its renderer. */
export type ActionIntent = 'primary' | 'secondary' | 'quiet' | 'danger';
interface ActionBase {
  /** Stable semantic identity within an offer, not the label or array index. */
  readonly id: string;
  readonly label: string;
  readonly intent: ActionIntent;
  readonly enabled: boolean;
  readonly reason?: string;
}
export type ActionSpec<A> = ActionBase & (
  | { readonly kind: 'command'; readonly action: A; readonly cardIds?:readonly string[] }
  | { readonly kind: 'number'; readonly inputLabel?: string; readonly min: number; readonly max: number; readonly step: number; readonly initial: number; readonly createAction: (value: number) => A }
);
export type CommandSpec<A> = Extract<ActionSpec<A>, {kind:'command'}>;
export interface ActionOffer<A> {
  /** Change on state version/phase or when any offered parameter changes. */
  readonly id: string;
  readonly actions: readonly ActionSpec<A>[];
}
export interface ZoneSpec {
  readonly id: string;
  readonly label: string;
  readonly kind: 'hand' | 'table' | 'pile' | 'reserve';
  readonly ownerId?: string;
}
export interface CardSpec {
  /** Card identity survives movement between zones. */
  readonly id: string;
  readonly zoneId: string;
  readonly label: string;
  readonly face: 'up' | 'down';
  readonly rank?: string;
  readonly suit?: string;
  /** Explicit standard/joker artwork; custom assets retain their opaque artKey. */
  readonly visual?: CardVisual;
  readonly emphasis?: CardEmphasis;
  readonly twoJokers?: boolean;
  /** Public visual tilt, in degrees; never a game-rule parameter. */
  readonly rotation?: number;
  /** Opaque asset key interpreted by the renderer, never a module path. */
  readonly artKey?: string;
  readonly enabled?: boolean;
  readonly reason?: string;
  readonly selected?: boolean;
}
export interface PlayerSpec {
  readonly id: string;
  readonly seat: number;
  readonly name: string;
  readonly kind: 'human' | 'bot' | 'observer';
  readonly counters?: readonly { readonly label: string; readonly value: number; readonly unit?: string }[];
  readonly badges?: readonly string[];
}
export interface GamePresentation<A> {
  readonly id: string;
  readonly zones: readonly ZoneSpec[];
  readonly cards: readonly CardSpec[];
  readonly players: readonly PlayerSpec[];
  readonly offer: ActionOffer<A>;
  readonly status?: string;
}
export interface PresentationContext {
  readonly viewer: number | null;
  readonly players: readonly { readonly id: string; readonly seat: number; readonly label: string; readonly kind?: PlayerSpec['kind'] }[];
  readonly active: boolean;
}
export type GamePresenter<State, A> = (state: State, context: PresentationContext) => GamePresentation<A>;

export interface ActionRefusal {
  ok: false;
  code: 'stale_offer' | 'unknown_action' | 'disabled' | 'invalid_number' | 'invalid_range' | 'invalid_step';
  reason: string;
}
export type ActionResolution<A> = { ok: true; action: A } | ActionRefusal;
export type ActionValidation<A> =
  | { ok: true; kind: 'command'; spec: Extract<ActionSpec<A>, {kind:'command'}> }
  | { ok: true; kind: 'number'; spec: Extract<ActionSpec<A>, {kind:'number'}>; value: number }
  | ActionRefusal;
const refused = (code: ActionRefusal['code'], reason: string) => ({ok:false as const,code,reason});

/** Resolve against the current offer at submission. This validates parameters,
 * not game legality; the authoritative game/server must still accept the action. */
export function validateAction<A>(offer: ActionOffer<A>, expectedOfferId: string, actionId: string, value?: number): ActionValidation<A> {
  if (offer.id !== expectedOfferId) return refused('stale_offer', '선택지가 바뀌었어요. 다시 확인해주세요.');
  const matches = offer.actions.filter(action => action.id === actionId);
  if (matches.length !== 1) return refused('unknown_action', '현재 선택지에서 이 행동을 찾을 수 없어요.');
  const spec = matches[0];
  if (!spec.enabled) return refused('disabled', spec.reason || '지금은 이 행동을 선택할 수 없어요.');
  if (spec.kind === 'command') return {ok:true,kind:'command',spec};
  if (!Number.isFinite(spec.min) || !Number.isFinite(spec.max) || spec.max < spec.min) return refused('invalid_range', '선택지의 숫자 범위를 확인할 수 없어요.');
  if (!Number.isFinite(spec.step) || spec.step <= 0) return refused('invalid_step', '선택지의 숫자 간격을 확인할 수 없어요.');
  const number = value ?? spec.initial;
  if (typeof number !== 'number' || !Number.isFinite(number)) return refused('invalid_number', '유효한 숫자를 입력해주세요.');
  if (number < spec.min || number > spec.max) return refused('invalid_range', `${spec.min}부터 ${spec.max}까지 입력해주세요.`);
  if (Number.isInteger(spec.min) && Number.isInteger(spec.step) && !Number.isSafeInteger(number)) return refused('invalid_number', '정확하게 표현할 수 있는 정수를 입력해주세요.');
  const steps = (number - spec.min) / spec.step;
  const nearest = Math.round(steps);
  const tolerance = Math.min(1e-7, Number.EPSILON * Math.max(1, Math.abs(steps)) * 8);
  if (!Number.isSafeInteger(nearest) || Math.abs(steps - nearest) > tolerance) return refused('invalid_step', `${spec.min}부터 ${spec.step} 간격으로 입력해주세요.`);
  return {ok:true,kind:'number',spec,value:number};
}

/** Instantiate a typed payload only when the user submits it. */
export function resolveAction<A>(offer: ActionOffer<A>, expectedOfferId: string, actionId: string, value?: number): ActionResolution<A> {
  const validation = validateAction(offer, expectedOfferId, actionId, value);
  if (!validation.ok) return validation;
  return {ok:true,action:validation.kind === 'command' ? validation.spec.action : validation.spec.createAction(validation.value)};
}

export function commandSpecs<A>(offer: ActionOffer<A>): readonly CommandSpec<A>[] {
  return offer.actions.filter((spec): spec is CommandSpec<A> => spec.kind === 'command');
}

/** Select an exact offered command. Ambiguous matches are not a fallback. */
export function commandAction<A>(offer: ActionOffer<A>, predicate: (action: A) => boolean): CommandSpec<A> | null {
  const matches = commandSpecs(offer).filter(spec => predicate(spec.action));
  return matches.length === 1 ? matches[0] : null;
}

/** Value equality for JSON-style action payloads; object key order is irrelevant. */
function samePayload(a: unknown, b: unknown): boolean {
  if (Object.is(a,b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value,index)=>samePayload(value,b[index]));
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const plain = (value: object) => Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null;
  if (!plain(a) || !plain(b)) return false;
  const left = a as Record<string,unknown>;
  const right = b as Record<string,unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key=>Object.hasOwn(right,key)&&samePayload(left[key],right[key]));
}
export function commandForPayload<A>(offer: ActionOffer<A>, payload: A): CommandSpec<A> | null {
  return commandAction(offer, action=>samePayload(action,payload));
}

/** Candidate key for inert JSON data only. The existing equality remains the
 * final authority. Exotic data or exhausted indexing budgets use old lookup. */
interface PayloadKeyBudget {nodes:number;bytes:number;}
function payloadKey(input:unknown,budget:PayloadKeyBudget):string|null {
  const ancestors=new Set<object>();let nodes=0,characters=0;
  // Conservative UTF-8 JSON upper bound: each UTF-16 unit needs at most6
  // encoded bytes;32 covers each tagged node/key's structural punctuation.
  // Charge BEFORE building keys, so ALL commands+queries share the1MiB bound.
  const charge=(characters=0)=>{budget.bytes-=32+characters*6;if(budget.bytes<0)throw Error('Payload key bytes');};
  const text=(value:string)=>{characters+=value.length;if(characters>100000)throw Error('Payload key text');charge(value.length);return value;};
  const visit=(value:unknown,depth:number):unknown=>{
    if(++nodes>10000||--budget.nodes<0||depth>64)throw Error('Payload key work');
    if(value===null){charge();return ['null'];}
    if(typeof value==='string')return ['string',text(value)];
    if(typeof value==='boolean'){charge();return ['boolean',value];}
    if(typeof value==='number'&&Number.isFinite(value))return ['number',text(Object.is(value,-0)?'-0':String(value))];
    if(typeof value!=='object'||!value||ancestors.has(value))throw Error('Non-JSON payload');
    charge();const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
    if(array?prototype!==Array.prototype:prototype!==Object.prototype&&prototype!==null)throw Error('Non-JSON payload');
    // Arrays reject excessive length before enumeration. Objects need one own
    // key-list preflight; no whole descriptor map is copied before the cap.
    const length=array?Object.getOwnPropertyDescriptor(value,'length')?.value:undefined;
    if(array&&(!Number.isSafeInteger(length)||length<0||length>Math.min(10000-nodes,budget.nodes)))throw Error('Payload key work');
    const keys=Reflect.ownKeys(value);
    if(array?keys.length!==length+1:keys.length>Math.min(10000-nodes,budget.nodes))throw Error('Payload key work');
    ancestors.add(value);
    try{
      if(array){
        const items=[];
        for(let i=0;i<length;i++){const field=Object.getOwnPropertyDescriptor(value,String(i));if(!field||!('value'in field)||!field.enumerable)throw Error('Non-data payload');items.push(visit(field.value,depth+1));}
        return ['array',items];
      }
      if(keys.some(key=>typeof key!=='string'))throw Error('Non-data payload');
      return ['object',(keys as string[]).sort().map(key=>{text(key);const field=Object.getOwnPropertyDescriptor(value,key);if(!field||!('value'in field)||!field.enumerable)throw Error('Non-data payload');return [key,visit(field.value,depth+1)];})];
    }finally{ancestors.delete(value);}
  };
  try{return JSON.stringify(visit(input,0));}catch{return null;}
}
/** Snapshot the small dense data array without evaluating an index accessor.
 * Count preflight precedes own-key enumeration and per-index descriptors. */
function payloadBatch(input:unknown):readonly unknown[]|null {
  try{
    if(!Array.isArray(input))return null;
    const length=Object.getOwnPropertyDescriptor(input,'length')?.value;
    if(!Number.isSafeInteger(length)||length<0||length>4096||Object.getPrototypeOf(input)!==Array.prototype)return null;
    if(Reflect.ownKeys(input).length!==length+1)return null;
    const values=[];
    for(let i=0;i<length;i++){const field=Object.getOwnPropertyDescriptor(input,String(i));if(!field||!('value'in field)||!field.enumerable)return null;values.push(field.value);}
    return values;
  }catch{return null;}
}

/** Batch equivalent of commandForPayload for one unchanged, call-local offer.
 * Inert payloads are indexed once; duplicate aliases stay ambiguous. No index
 * survives this call. Unsupported/over-budget data keeps the old lookup. */
export function commandsForPayloads<A>(offer:ActionOffer<A>,payloads:readonly A[]):readonly(CommandSpec<A>|null)[]{
  const fallback=()=>payloads.map(payload=>commandForPayload(offer,payload));
  const queries=payloadBatch(payloads);if(!queries)return fallback();
  const raw=Object.getOwnPropertyDescriptor(offer,'actions');
  if(!raw||!('value'in raw))return fallback();
  const actions=payloadBatch(raw.value);if(!actions)return fallback();
  const index=new Map<string,CommandSpec<A>|null>(),budget:PayloadKeyBudget={nodes:65536,bytes:1048576};
  for(const spec of actions){
    if(!spec||typeof spec!=='object')return fallback();
    const kind=Object.getOwnPropertyDescriptor(spec,'kind');if(!kind||!('value'in kind))return fallback();
    if(kind.value!=='command')continue;
    const action=Object.getOwnPropertyDescriptor(spec,'action');if(!action||!('value'in action))return fallback();
    const key=payloadKey(action.value,budget);if(key===null)return fallback();
    index.set(key,index.has(key)?null:spec as CommandSpec<A>);
  }
  const keys:string[]=[];
  for(const query of queries){const key=payloadKey(query,budget);if(key===null)return fallback();keys.push(key);}
  return queries.map((payload,i)=>{const command=index.get(keys[i]);return command&&samePayload(command.action,payload)?command:null;});
}

/** A command control never instantiates a numeric action implicitly. */
export function resolveCommand<A>(offer: ActionOffer<A>, expectedOfferId: string, actionId: string): ActionResolution<A> {
  const validation = validateAction(offer,expectedOfferId,actionId);
  if (!validation.ok) return validation;
  if (validation.kind !== 'command') return refused('unknown_action','이 선택지는 명령 버튼으로 실행할 수 없어요.');
  return {ok:true,action:validation.spec.action};
}
