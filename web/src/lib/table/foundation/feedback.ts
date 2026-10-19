import type {ViewContext,TableCard} from './contracts';
import {copyFormData} from './forms';
export type FeedbackMood='lobby'|'bidding'|'play'|'result';
export type FeedbackCueKind='declarer'|'friend'|'mighty'|'joker'|'call'|'misdeal'|'answer';
export type FeedbackKind='reaction'|'error'|'refusal'|'clock'|'shuffle'|'bid'|'card'|'heavy'|'sweep'|'score'|'turn'|'result'|'cue'|'call'|'contract'|'run'|'resolve'|'tag'|'friend'|'answer';
export interface FeedbackScope {readonly session:string;readonly audience:string;readonly generation:string;readonly roomEpoch:string;readonly connectionEpoch:string;}
export interface FeedbackClock {readonly id:string;readonly participantId:string;readonly deadline:number;readonly total:number;readonly local:boolean;}
export interface FeedbackEvent {readonly id:string;readonly kind:FeedbackKind;readonly participantId?:string;readonly label?:string;readonly amount?:number;readonly positive?:boolean;readonly cue?:FeedbackCueKind;readonly publicCards?:readonly TableCard[];readonly milestone:{readonly kind:'visible'}|{readonly kind:'arrival';readonly entityIds:readonly string[]};}
export interface FeedbackProjection {readonly scope:FeedbackScope;readonly stateId:string;readonly events:readonly FeedbackEvent[];readonly mood:FeedbackMood;readonly clock?:FeedbackClock;}
export interface FeedbackView {readonly cues:readonly {readonly id:string;readonly participantId:string;readonly label?:string;readonly cue?:FeedbackCueKind}[];readonly clock?:FeedbackClock;readonly disclosures?:readonly {readonly eventId:string;readonly participantId?:string;readonly title:string;readonly cards:readonly TableCard[]}[];}
export interface FeedbackSink {emit(event:FeedbackEvent):()=>void;mood(mood:FeedbackMood):()=>void;}
export interface MotionSettlement {readonly frameId:number;readonly eventId?:string;readonly entityIds:readonly string[];readonly outcome:'arrived'|'snapped'|'revoked';}
export interface FeedbackArrival {readonly eventId:string;readonly entityIds:readonly string[];}
const kinds:readonly string[]=['reaction','error','refusal','clock','shuffle','bid','card','heavy','sweep','score','turn','result','cue','call','contract','run','resolve','tag','friend','answer'];
const cueKinds:readonly string[]=['declarer','friend','mighty','joker','call','misdeal','answer'];
const text=(value:unknown,max=500):value is string=>typeof value==='string'&&value.length>0&&value.length<=max;
const exact=(value:object,allowed:readonly string[])=>Object.keys(value).every(key=>allowed.includes(key));
/** Own the bounded semantic transition; identities must be authorized by the
 * same canonical document, not rebound through a later seat lookup. */
export function ownFeedback(input:FeedbackProjection,context:ViewContext,participants:readonly string[],entities:readonly string[]):FeedbackProjection {
 const value=copyFormData(input),fail=():never=>{throw Error('Invalid committed feedback');};
 if(!value||typeof value!=='object'||!exact(value,['scope','stateId','events','mood','clock'])||!value.scope||!exact(value.scope,['session','audience','generation','roomEpoch','connectionEpoch'])||Object.keys(value.scope).length!==5||!Object.values(value.scope).every(part=>text(part,2048))||value.scope.session!==context.session||value.scope.audience!==context.audience||value.scope.generation!==context.generation||!text(value.stateId,2048)||!['lobby','bidding','play','result'].includes(value.mood)||!Array.isArray(value.events)||value.events.length>64||new Set(value.events.map(event=>event.id)).size!==value.events.length)return fail();
 for(const event of value.events){if(!event||!exact(event,['id','kind','participantId','label','amount','positive','cue','milestone','publicCards'])||!text(event.id,2048)||!kinds.includes(event.kind)||event.participantId!==undefined&&!participants.includes(event.participantId)||event.label!==undefined&&!text(event.label)||event.amount!==undefined&&(!Number.isSafeInteger(event.amount)||event.amount<0||event.amount>104)||event.positive!==undefined&&typeof event.positive!=='boolean'||event.cue!==undefined&&!cueKinds.includes(event.cue)||!event.milestone)return fail();
  if(event.publicCards!==undefined){if(event.kind!=='cue'||event.cue!=='misdeal'||!Array.isArray(event.publicCards)||event.publicCards.length>104||new Set(event.publicCards.map((card:TableCard)=>card.id)).size!==event.publicCards.length||event.publicCards.some((card:TableCard)=>!card||!exact(card,['id','label','visual'])||!text(card.id,2048)||!text(card.label)||!card.visual||!(card.visual.kind==='standard'&&exact(card.visual,['kind','suit','rank'])&&['Spade','Heart','Diamond','Club'].includes(card.visual.suit)&&Number.isInteger(card.visual.rank)&&card.visual.rank>=2&&card.visual.rank<=14||card.visual.kind==='joker'&&exact(card.visual,['kind','color'])&&['Black','Red'].includes(card.visual.color))))return fail();}
  if(event.milestone.kind==='visible'){if(!exact(event.milestone,['kind']))return fail();}
  else if(event.milestone.kind!=='arrival'||!exact(event.milestone,['kind','entityIds'])||!Array.isArray(event.milestone.entityIds)||!event.milestone.entityIds.length||event.milestone.entityIds.length>104||new Set(event.milestone.entityIds).size!==event.milestone.entityIds.length||event.milestone.entityIds.some((id:string)=>!entities.includes(id)))return fail();
 }
 const clock=value.clock;if(clock!==undefined&&(!clock||typeof clock!=='object'||!exact(clock,['id','participantId','deadline','total','local'])||!text(clock.id,2048)||!participants.includes(clock.participantId)||!Number.isFinite(clock.deadline)||!Number.isFinite(clock.total)||clock.total<=0||clock.total>86400000||typeof clock.local!=='boolean'))return fail();
 return value;
}
/** One bounded lifetime owner for committed cues, audio cancellation and the
 * monotonic deadline. Clock paint never creates a new authority/input frame. */
export function createFeedbackCoordinator(options:{sink:FeedbackSink;onChange():void;onClock?(id:string,fraction:number,seconds:number|null):void;now?:()=>number;schedule?:(run:()=>void,ms:number)=>unknown;cancel?:(handle:unknown)=>void}) {
 const now=options.now??(()=>performance.now()),schedule=options.schedule??((run,ms)=>setTimeout(run,ms)),cancel=options.cancel??(handle=>clearTimeout(handle as ReturnType<typeof setTimeout>));
 type Effect={event:FeedbackEvent;until:number;cancel:()=>void;committed:boolean;presented:boolean};
 let scope:FeedbackScope|null=null,baseline:string|null=null,projection:FeedbackProjection|null=null,disposed=false,epoch=0,timerGeneration=0,timer:unknown=null,moodRelease:(()=>void)|null=null,currentMood:FeedbackMood|null=null,currentFrame=0,preparedFrame=0,preparedEpoch=0;
 const seen=new Set<string>(),pending=new Map<string,FeedbackEvent>(),active=new Map<string,Effect>(),eligible=new Set<string>(),committedArrivals=new Set<string>(),settlements:MotionSettlement[]=[];
 const clockTicks=new Set<string>();
 const identity=(value:FeedbackScope)=>JSON.stringify([value.session,value.audience,value.roomEpoch,value.connectionEpoch]);
 const visual=(event:FeedbackEvent)=>!!event.publicCards?.length||!!(event.participantId&&(event.label||event.cue));
 const safe=(run:()=>void)=>{try{run();}catch{/* Optional feedback never blocks canonical lifecycle. */}};
 function notify(){safe(options.onChange);}
 function stop(){timerGeneration++;const old=timer;timer=null;if(old!==null)safe(()=>cancel(old));}
 function releaseAll(){const oldTimer=timer;timer=null;timerGeneration++;const effects=[...active.values()],release=moodRelease;active.clear();pending.clear();eligible.clear();committedArrivals.clear();settlements.length=0;seen.clear();currentFrame=0;preparedFrame=0;clockTicks.clear();moodRelease=null;currentMood=null;if(oldTimer!==null)safe(()=>cancel(oldTimer));for(const effect of effects)safe(effect.cancel);if(release)safe(release);}
 function remember(id:string){seen.add(id);while(seen.size>256)seen.delete(seen.values().next().value!);}
 function emit(event:FeedbackEvent,internal=false){if(disposed)return;const token=epoch,key=JSON.stringify([internal?'clock':'event',event.id]);if(active.has(key))return;
  while(active.size>=64){const first=active.keys().next().value!,old=active.get(first)!;active.delete(first);safe(old.cancel);if(token!==epoch||disposed)return;}
  const effect:Effect={event,until:event.publicCards?.length?Infinity:now()+(event.cue==='misdeal'?4000:1500),cancel:()=>{},committed:false,presented:false};active.set(key,effect);
  let release=()=>{};try{const returned=options.sink.emit(event);if(typeof returned==='function')release=returned;}catch{}
  if(disposed||epoch!==token||active.get(key)!==effect){safe(release);if(active.get(key)===effect)active.delete(key);return;}effect.cancel=release;effect.committed=true;if(!internal&&visual(event))notify();
 }
 function queuePulse(ms=0){const token=epoch;stop();if(disposed||epoch!==token||!projection)return;const generation=timerGeneration;let arming=true;const run=()=>{if(disposed||timerGeneration!==generation)return;timer=null;pulse();};try{const handle=schedule(()=>{if(arming)queueMicrotask(run);else run();},ms);arming=false;if(disposed||epoch!==token||timerGeneration!==generation)safe(()=>cancel(handle));else timer=handle;}catch{arming=false;if(epoch===token)timer=null;}}
 function pulse(){if(disposed)return;const token=epoch,time=now();let changed=false;
  const expired=[...active.entries()].filter(([,effect])=>effect.until<=time);for(const [key] of expired)active.delete(key);for(const [,effect] of expired){safe(effect.cancel);changed=changed||visual(effect.event);}if(disposed||epoch!==token)return;
  const clock=currentFrame?projection?.clock:undefined;if(clock){const left=Math.max(0,clock.deadline-time),seconds=left>0?Math.ceil(left/1000):null;safe(()=>options.onClock?.(clock.id,Math.max(0,Math.min(1,left/clock.total)),seconds!==null&&seconds<=5?seconds:null));if(disposed||epoch!==token)return;
   const key=`${clock.id}:${seconds}`;if(clock.local&&seconds!==null&&seconds<=5&&!clockTicks.has(key)){clockTicks.add(key);while(clockTicks.size>256)clockTicks.delete(clockTicks.values().next().value!);emit({id:key,kind:'clock',amount:seconds,participantId:clock.participantId,milestone:{kind:'visible'}},true);if(disposed||epoch!==token)return;}
  }
  if(changed){notify();if(disposed||epoch!==token)return;}if([...active.values()].some(effect=>Number.isFinite(effect.until))||clock&&clock.deadline>time)queuePulse(50);
 }
 function applySettlement(report:MotionSettlement){if(disposed||report.frameId!==currentFrame||preparedEpoch!==epoch)return;const token=epoch;
  for(const [id,event] of [...pending]){if(!eligible.has(id)||report.eventId!==undefined&&report.eventId!==id||event.milestone.kind!=='arrival'||!event.milestone.entityIds.every(entity=>report.entityIds.includes(entity)))continue;pending.delete(id);committedArrivals.delete(id);remember(id);if(report.outcome!=='revoked')emit(event);if(disposed||epoch!==token)return;}queuePulse();
 }
 return {
  receive(next:FeedbackProjection|null){if(disposed)return;const token=++epoch;currentFrame=0;preparedFrame=0;eligible.clear();settlements.length=0;
   if(!next){scope=null;baseline=null;projection=null;releaseAll();if(epoch===token&&!disposed)notify();return;}
   const nextBaseline=identity(next.scope),bootstrap=baseline!==nextBaseline,sourceChanged=projection?.stateId!==next.stateId;if(bootstrap||scope?.generation!==next.scope.generation){scope=null;projection=null;releaseAll();if(disposed||epoch!==token)return;}
   scope=next.scope;baseline=nextBaseline;projection=next;if(bootstrap&&next.clock)clockTicks.add(`${next.clock.id}:${Math.ceil(Math.max(0,next.clock.deadline-now())/1000)}`);
   if(currentMood!==next.mood){const prior=moodRelease;moodRelease=null;currentMood=next.mood;if(prior)safe(prior);if(disposed||epoch!==token)return;let release=()=>{};try{const returned=options.sink.mood(next.mood);if(typeof returned==='function')release=returned;}catch{}if(disposed||epoch!==token){safe(release);return;}moodRelease=release;}
   const currentIds=new Set(next.events.map(event=>event.id));
   // An unseen public fan cannot outlive the source that offered it. Retire
   // ownership before optional release callbacks, which may reenter receive.
   const superseded=[...active.entries()].filter(([,effect])=>sourceChanged&&effect.event.publicCards?.length&&!effect.presented&&!currentIds.has(effect.event.id));
   for(const [key] of superseded)active.delete(key);
   for(const [,effect] of superseded)safe(effect.cancel);
   if(disposed||epoch!==token)return;
   for(const id of pending.keys())if(sourceChanged&&!currentIds.has(id)&&!committedArrivals.has(id)){pending.delete(id);remember(id);}
   for(const event of next.events){if(seen.has(event.id)||pending.has(event.id)||active.has(JSON.stringify(['event',event.id])))continue;if(bootstrap||pending.size>=128){remember(event.id);continue;}pending.set(event.id,event);}queuePulse();notify();
  },
  prepareFrame(frameId:number,entities:readonly string[]):readonly FeedbackArrival[]{if(disposed||!projection)return [];preparedFrame=frameId;preparedEpoch=epoch;currentFrame=0;eligible.clear();settlements.length=0;const arrivals:FeedbackArrival[]=[];
   for(const [id,event] of pending){if(event.milestone.kind==='visible')eligible.add(id);else if(event.milestone.entityIds.every(entity=>entities.includes(entity))){eligible.add(id);arrivals.push({eventId:id,entityIds:event.milestone.entityIds});}else{pending.delete(id);committedArrivals.delete(id);remember(id);}}return Object.freeze(arrivals);},
  published(frameId:number){if(disposed||frameId!==preparedFrame||preparedEpoch!==epoch||!projection)return;currentFrame=frameId;const token=epoch;for(const id of eligible)if(pending.get(id)?.milestone.kind==='arrival')committedArrivals.add(id);
   for(const [id,event] of [...pending])if(eligible.has(id)&&event.milestone.kind==='visible'){pending.delete(id);remember(id);emit(event);if(disposed||epoch!==token)return;}
   const reports=settlements.splice(0);for(const report of reports){applySettlement(report);if(disposed||epoch!==token)return;}queuePulse();},
  /** The caller acknowledges only public fans proved visible in this exact
   * published frame. Pending measurement must not consume their display time. */
  presented(frameId:number,eventIds:readonly string[]){
   if(disposed||!projection||!currentFrame||frameId!==currentFrame||frameId!==preparedFrame||preparedEpoch!==epoch||!Array.isArray(eventIds)||eventIds.length>64)return;
   const token=epoch,ids=new Set(eventIds),time=now();
   if(disposed||epoch!==token||frameId!==currentFrame||frameId!==preparedFrame||preparedEpoch!==epoch)return;let changed=false;
   for(const [key,effect] of active){
    if(key!==JSON.stringify(['event',effect.event.id])||!effect.committed||effect.presented||!effect.event.publicCards?.length||!ids.has(effect.event.id))continue;
    effect.presented=true;effect.until=time+4000;changed=true;
   }
   if(changed)queuePulse();
  },
  settle(report:MotionSettlement){if(disposed)return;if(currentFrame===report.frameId){applySettlement(report);return;}if(!currentFrame&&report.frameId===preparedFrame&&preparedEpoch===epoch&&settlements.length<128)settlements.push(report);},
  view():FeedbackView{return {cues:[...active.values()].filter(effect=>effect.committed&&effect.event.participantId&&(effect.event.label||effect.event.cue)).map(({event})=>({id:event.id,participantId:event.participantId!,...(event.label?{label:event.label}:{}),...(event.cue?{cue:event.cue}:{})})),...(projection?.clock?{clock:projection.clock}:{}),disclosures:[...active.values()].filter(effect=>effect.committed&&effect.event.publicCards?.length).map(({event})=>({eventId:event.id,participantId:event.participantId,title:event.label??'공개된 카드',cards:event.publicCards!}))};},
  local(event:FeedbackEvent){if(!disposed&&projection&&currentFrame){emit(event);queuePulse();}},
  dismiss(eventId:string){const key=JSON.stringify(['event',eventId]),effect=active.get(key);if(effect){active.delete(key);safe(effect.cancel);if(!disposed){notify();queuePulse();}}},
  dispose(){if(disposed)return;disposed=true;epoch++;scope=null;baseline=null;projection=null;releaseAll();},
  inspect(){return {pending:pending.size,active:active.size,timers:Number(timer!==null),ledger:seen.size};},
 };
}
