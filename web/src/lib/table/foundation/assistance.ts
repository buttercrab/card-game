import {cardDecision} from '../decisionCore';
import type {ViewContext} from './contracts';

/** Captured at receive/offer time. Never rebind private advice to a new audience. */
export interface AssistanceScope {
    readonly context: ViewContext;
    readonly roomId: string;
    readonly roomEpoch: string;
    readonly connectionEpoch: string;
    readonly actorId: string;
    readonly seat: number | null;
    readonly gameVersion: number | null;
}
export interface AssistanceAuthority {
    readonly scope: AssistanceScope;
    readonly connected: boolean;
    readonly activeTurn: boolean;
    readonly ownHandAuthorized: boolean;
}
export interface ReactionOption { readonly id: string; readonly text: string; readonly label: string; }
export interface AssistanceBindings {
    readonly authority: AssistanceAuthority;
    readonly handIds: readonly string[];
    /** Enabled, exact current GAME command references, not reconstructed actions. */
    readonly actions: readonly {readonly id:string;readonly label:string;readonly cardIds:readonly string[]}[];
    readonly participantIds: readonly string[];
    readonly reactionOptions: readonly ReactionOption[];
}
export type AssistanceTool = {
    readonly id: string; readonly label: string; readonly enabled: boolean;
} & ({readonly kind:'request-advice'; readonly shortcut:'H'} | {readonly kind:'send-reaction'; readonly shortcut:'R'; readonly options:readonly ReactionOption[]});
export interface AdvicePresentation { readonly id:string; readonly label:string; readonly actionId:string; readonly cardIds:readonly string[]; }
export interface InspectionPresentation { readonly cardId:string; readonly reason:string; }
/** Already-active records from the connection's ONE existing TTL owner. */
export interface ReactionPresentation { readonly eventId:string; readonly participantId:string; readonly text:string; }
export interface AssistanceProjection {
    readonly scope:AssistanceScope;
    readonly offerId:string;
    readonly tools:readonly AssistanceTool[];
    readonly guidance?:string;
    readonly advice?:AdvicePresentation;
    readonly inspections:readonly InspectionPresentation[];
    readonly reactions:readonly ReactionPresentation[];
}
export interface AssistanceSnapshot {readonly projection:AssistanceProjection; readonly bindings:AssistanceBindings;}
export interface AssistanceIntent {readonly scope:AssistanceScope;readonly offerId:string;readonly toolId:string;readonly optionId?:string;}
/** Ephemeral send permission only: no server-accepted claim, receipt or retry. */
export type AssistanceOperation = {readonly kind:'request-advice';readonly scope:AssistanceScope} |
    {readonly kind:'send-reaction';readonly scope:AssistanceScope;readonly optionId:string;readonly text:string};

/** Plain-data boundary shared with pure game projections. Getters are never invoked. */
export function cloneAssistanceData<T>(value:T):T {
    const ancestors=new Set<object>();let budget=0;
    function copy(value:unknown,depth:number):unknown {
        if(++budget>32768||depth>48)throw new Error('Assistance data budget exceeded');
        if(value===null||value===undefined||typeof value==='boolean')return value;
        if(typeof value==='string'){if(value.length>8192)throw new Error('Assistance text budget exceeded');return value;}
        if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('Assistance number must be finite');return value;}
        if(typeof value!=='object'||ancestors.has(value))throw new Error('Assistance requires inert data');
        const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
        if(prototype!==(array?Array.prototype:Object.prototype)&&!(prototype===null&&!array))throw new Error('Assistance requires plain data');
        const keys=Reflect.ownKeys(value),descriptors=Object.getOwnPropertyDescriptors(value);
        if(keys.some(key=>typeof key!=='string'||!('value' in descriptors[key])))throw new Error('Assistance accessors are unsupported');
        ancestors.add(value);
        try {
            if(array){const length=descriptors.length.value as number;if(length>8192||keys.some(key=>key!=='length'&&(!/^\d+$/.test(String(key))||Number(key)>=length)))throw new Error('Invalid assistance array');
                return Object.freeze(Array.from({length},(_,index)=>{const descriptor=descriptors[index];if(!descriptor)throw new Error('Sparse assistance array');return copy(descriptor.value,depth+1);}));}
            const out:Record<string,unknown>={};for(const key of keys as string[])Object.defineProperty(out,key,{value:copy(descriptors[key].value,depth+1),enumerable:true});return Object.freeze(out);
        }finally{ancestors.delete(value);}
    }
    return copy(value,0) as T;
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v:Record<string,unknown>,allowed:readonly string[])=>Object.keys(v).every(key=>allowed.includes(key));
const id=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=2048;
const text=(v:unknown):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=500;
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const list=(v:unknown,max:number):v is unknown[]=>Array.isArray(v)&&v.length<=max;
const unique=(v:readonly unknown[])=>new Set(v).size===v.length;
const ids=(v:unknown,max:number):v is string[]=>list(v,max)&&v.every(id)&&unique(v);
function validScope(v:unknown):v is AssistanceScope {
    if(!object(v)||!keys(v,['context','roomId','roomEpoch','connectionEpoch','actorId','seat','gameVersion']))return false;
    const c=v.context;return object(c)&&keys(c,['session','audience','generation','revision'])&&[c.session,c.audience,c.generation,c.revision,v.roomId,v.roomEpoch,v.connectionEpoch,v.actorId].every(id)
        &&(v.seat===null||count(v.seat)&&(v.seat as number)<32)&&(v.gameVersion===null||count(v.gameVersion));
}
function validAuthority(v:unknown):v is AssistanceAuthority {
    return object(v)&&keys(v,['scope','connected','activeTurn','ownHandAuthorized'])&&validScope(v.scope)&&[v.connected,v.activeTurn,v.ownHandAuthorized].every(flag=>typeof flag==='boolean')
        &&(!v.ownHandAuthorized||v.connected===true&&v.scope.seat!==null&&v.scope.gameVersion!==null)&&(!v.activeTurn||v.connected===true&&v.ownHandAuthorized===true);
}
const validOption=(v:unknown):v is ReactionOption=>object(v)&&keys(v,['id','text','label'])&&id(v.id)&&text(v.text)&&text(v.label);
const sameOption=(a:ReactionOption,b:ReactionOption)=>a.id===b.id&&a.text===b.text&&a.label===b.label;
export function sameAssistanceScope(a:AssistanceScope,b:AssistanceScope):boolean {
    return a.roomId===b.roomId&&a.roomEpoch===b.roomEpoch&&a.connectionEpoch===b.connectionEpoch&&a.actorId===b.actorId&&a.seat===b.seat&&a.gameVersion===b.gameVersion
        &&a.context.session===b.context.session&&a.context.audience===b.context.audience&&a.context.generation===b.context.generation&&a.context.revision===b.context.revision;
}
/** Private advice survives presentation-only revisions, never game/audience replacement. */
export function sameAssistanceGameScope(a:AssistanceScope,b:AssistanceScope):boolean {
    return sameAssistanceScope({...a,context:{...a.context,revision:b.context.revision}},b);
}
function issues(p:unknown,b:unknown):string[] {
    const errors:string[]=[];
    if(!object(b)||!keys(b,['authority','handIds','actions','participantIds','reactionOptions'])||!validAuthority(b.authority)||!ids(b.handIds,104)||!list(b.actions,1024)||!b.actions.every(a=>object(a)&&keys(a,['id','label','cardIds'])&&id(a.id)&&text(a.label)&&ids(a.cardIds,104))||!unique(b.actions.map(a=>(a as {id:string}).id))||!ids(b.participantIds,288)||
        !list(b.reactionOptions,32)||!b.reactionOptions.every(validOption)||!unique(b.reactionOptions.map(o=>o.id))||!unique(b.reactionOptions.map(o=>o.text)))return ['Invalid assistance bindings'];
    const bindings=b as unknown as AssistanceBindings,authority=bindings.authority;
    if(!authority.ownHandAuthorized&&(bindings.handIds.length||bindings.actions.length))errors.push('Unauthorized private assistance bindings');
    if(bindings.actions.some(action=>action.cardIds.some(card=>!bindings.handIds.includes(card))))errors.push('Invalid action card binding');
    if(!object(p)||!keys(p,['scope','offerId','tools','guidance','advice','inspections','reactions'])||!validScope(p.scope)||!sameAssistanceScope(p.scope,authority.scope)||!id(p.offerId)||!list(p.tools,4)||
        !list(p.inspections,104)||!list(p.reactions,33))return [...errors,'Invalid assistance projection'];
    const tools=p.tools as unknown[];
    if(!unique(tools.map(tool=>object(tool)?tool.id:undefined)))errors.push('Duplicate assistance tools');
    for(const tool of tools){
        if(!object(tool)||!keys(tool,['id','label','enabled','kind','shortcut',...(tool.kind==='send-reaction'?['options']:[])])||!id(tool.id)||!text(tool.label)||typeof tool.enabled!=='boolean'||
            !(tool.kind==='request-advice'&&tool.shortcut==='H'||tool.kind==='send-reaction'&&tool.shortcut==='R')){errors.push('Invalid assistance tool');continue;}
        if(tool.enabled&&(!authority.connected||tool.kind==='request-advice'&&!authority.activeTurn))errors.push('Unavailable assistance tool');
        if(tool.kind==='send-reaction'&&(!list(tool.options,32)||!tool.options.every(validOption)||!unique(tool.options.map(o=>o.id))||tool.options.some(option=>!bindings.reactionOptions.some(allowed=>sameOption(option,allowed)))))errors.push('Unapproved reaction option');
    }
    if(p.guidance!==undefined&&(!text(p.guidance)||!authority.ownHandAuthorized))errors.push('Invalid novice guidance');
    if(p.advice!==undefined){const a=p.advice;if(!object(a)||!keys(a,['id','label','actionId','cardIds'])||!id(a.id)||!text(a.label)||!id(a.actionId)||!ids(a.cardIds,104)||!authority.activeTurn||
        !bindings.actions.some(action=>action.id===a.actionId&&action.label===a.label&&action.cardIds.length===(a.cardIds as readonly string[]).length&&action.cardIds.every(card=>(a.cardIds as readonly string[]).includes(card))))errors.push('Invalid private advice');}
    if(!unique(p.inspections.map(value=>object(value)?value.cardId:undefined))||p.inspections.some(value=>!object(value)||!keys(value,['cardId','reason'])||!id(value.cardId)||!text(value.reason)||!authority.activeTurn||!bindings.handIds.includes(value.cardId)||bindings.actions.some(action=>action.cardIds.includes(value.cardId as string))))errors.push('Invalid card inspection');
    if(!unique(p.reactions.map(value=>object(value)?value.eventId:undefined))||!unique(p.reactions.map(value=>object(value)?value.participantId:undefined))||p.reactions.some(value=>!object(value)||!keys(value,['eventId','participantId','text'])||!id(value.eventId)||!id(value.participantId)||!bindings.participantIds.includes(value.participantId)||!bindings.reactionOptions.some(option=>option.text===value.text)))errors.push('Invalid participant reaction');
    return errors;
}
export function validateAssistance(projection:AssistanceProjection,bindings:AssistanceBindings):readonly string[] {
    try{return Object.freeze(issues(cloneAssistanceData(projection),cloneAssistanceData(bindings)));}catch{return Object.freeze(['Assistance requires bounded inert data']);}
}
/** Own and freeze both the projection and canonical bindings before exposure. */
export function createAssistanceSnapshot(projection:AssistanceProjection,bindings:AssistanceBindings):AssistanceSnapshot {
    const copy=cloneAssistanceData({projection,bindings}),errors=issues(copy.projection,copy.bindings);
    if(errors.length)throw new Error(errors.join('; '));return copy;
}
function current(snapshot:AssistanceSnapshot|null,authority:AssistanceAuthority):snapshot is AssistanceSnapshot {
    try {return !!snapshot&&!validateAssistance(snapshot.projection,snapshot.bindings).length&&validAuthority(cloneAssistanceData(authority))&&authority.connected&&sameAssistanceScope(snapshot.projection.scope,authority.scope)
        &&snapshot.bindings.authority.connected===authority.connected&&snapshot.bindings.authority.activeTurn===authority.activeTurn&&snapshot.bindings.authority.ownHandAuthorized===authority.ownHandAuthorized;}catch{return false;}
}
export function captureAssistance(snapshot:AssistanceSnapshot|null,authority:AssistanceAuthority,toolId:string,optionId?:string):AssistanceIntent|null {
    try { snapshot=cloneAssistanceData(snapshot);authority=cloneAssistanceData(authority); } catch { return null; }
    if(!current(snapshot,authority))return null;
    const tool=snapshot.projection.tools.find(tool=>tool.id===toolId&&tool.enabled);if(!tool)return null;
    if(tool.kind==='request-advice'?optionId!==undefined:!tool.options.some(option=>option.id===optionId))return null;
    return cloneAssistanceData({scope:snapshot.projection.scope,offerId:snapshot.projection.offerId,toolId,...(optionId!==undefined?{optionId}:{})});
}
export function resolveAssistanceIntent(snapshot:AssistanceSnapshot|null,authority:AssistanceAuthority,intent:AssistanceIntent):AssistanceOperation|null {
    try {
        snapshot=cloneAssistanceData(snapshot);authority=cloneAssistanceData(authority);
        const captured=cloneAssistanceData(intent);if(!object(captured)||!keys(captured as unknown as Record<string,unknown>,['scope','offerId','toolId','optionId'])||!validScope(captured.scope)||!id(captured.offerId)||!id(captured.toolId)||
            captured.optionId!==undefined&&!id(captured.optionId)||!current(snapshot,authority)||captured.offerId!==snapshot.projection.offerId||!sameAssistanceScope(captured.scope,snapshot.projection.scope))return null;
        const valid=captureAssistance(snapshot,authority,captured.toolId,captured.optionId);if(!valid)return null;
        const tool=snapshot.projection.tools.find(tool=>tool.id===captured.toolId)!;
        if(tool.kind==='request-advice')return cloneAssistanceData({kind:'request-advice',scope:snapshot.projection.scope});
        const option=tool.options.find(option=>option.id===captured.optionId)!;return cloneAssistanceData({kind:'send-reaction',scope:snapshot.projection.scope,optionId:option.id,text:option.text});
    }catch{return null;}
}
/** An inspect result has no action, operation or selection payload. */
export function inspectAssistance(snapshot:AssistanceSnapshot|null,authority:AssistanceAuthority,cardId:string):InspectionPresentation|null {
    try { snapshot=cloneAssistanceData(snapshot);authority=cloneAssistanceData(authority); } catch { return null; }
    if(!current(snapshot,authority))return null;return snapshot.projection.inspections.find(item=>item.cardId===cardId)??null;
}

/** Shared canonical ownership: a game projection cannot invent a command,
 * playable-card binding or participant after document admission. */
export function ownDocumentAssistance<A>(input:AssistanceSnapshot,document:import('./contracts').TableDocument<A>):AssistanceSnapshot {
 const owned=cloneAssistanceData(input),value=createAssistanceSnapshot(owned.projection,owned.bindings),{projection,bindings}=value,scope=projection.scope,c=document.context;
 const participants=new Set([...(document.participant.role==='observer'?[]:[document.participant.id]),...(document.opponents??[]).filter(person=>!person.appearance?.vacant).map(person=>person.id),...(document.shell?.pages??[]).flatMap(page=>page.people?.map(person=>person.id)??[])]);
 if(!sameAssistanceScope(scope,{...scope,context:c})||document.shell&&scope.roomId!==document.shell.roomCode||bindings.participantIds.some(id=>!participants.has(id))||!participants.has(scope.actorId)||document.participant.role!=='observer'&&scope.actorId!==document.participant.id||bindings.authority.ownHandAuthorized&&document.participant.role==='observer')throw Error('Foreign assistance document');
 const handIds=document.hand.map(card=>card.id);if(bindings.authority.ownHandAuthorized&&(handIds.length!==bindings.handIds.length||handIds.some(id=>!bindings.handIds.includes(id))))throw Error('Foreign assistance hand');
 for(const action of bindings.actions){const canonical=document.offer.actions.find(command=>command.id===action.id&&command.enabled&&command.label===action.label);if(!canonical)throw Error('Unknown assistance action');
  const variants=cardDecision(document.decision)?.variants.filter(variant=>variant.actionId===action.id)??[];
  if(action.cardIds.some(id=>!handIds.includes(id))||variants.length&&!variants.some(variant=>variant.cardIds.length===action.cardIds.length&&variant.cardIds.every(id=>action.cardIds.includes(id)))||canonical.kind==='command'&&canonical.cardIds!==undefined&&(canonical.cardIds.length!==action.cardIds.length||canonical.cardIds.some(id=>!action.cardIds.includes(id)))||!variants.length&&action.cardIds.length&&!(canonical.kind==='command'&&canonical.cardIds))throw Error('Foreign assistance card binding');
 }
 return value;
}
