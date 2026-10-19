import {expect,test} from 'vitest';
import {presetRules} from './catalog';
import {createMightyMotionTransition,type MightyMotionTransitionInput} from './recycle';
import type {Mighty,StateMsg,PhaseView} from './types';
import type {ConnectedProjectionClient} from '../../table/foundation/connected';
import type {CommandScope} from '../../generated/protocol';
const ids=['p0','p1','p2','p3','p4'];
const bidding=():PhaseView=>({Bidding:{to_act:0,best:null,passed:Array(5).fill(false),has_bid:Array(5).fill(false)}});
function scope(domain:'room'|'game',version:number,seat:number|null=0):CommandScope{return {domain,room_id:'live',room_epoch:'epoch',session_id:1,hand:0,actor_id:seat===null?'watcher':'p0',seat,version};}
function state(version:number,roomVersion:number,phase:PhaseView=bidding(),count=0,seat:number|null=0):StateMsg{
 return {version,room_version:roomVersion,...(seat===null?{}:{command:{scope:scope('game',version,seat),next_sequence:1}}),view:{viewer:seat===null?'Spectator':{Seat:seat},first_bidder:0,phase,hand_sizes:Array(5).fill(10),redealt:count?{count,why:{Misdeal:{seat:2,hand:[]}}}:null}} as StateMsg;
}
type Writable<T>={-readonly[K in keyof T]:T[K]};
type Fixture=Writable<Omit<MightyMotionTransitionInput,'client'>>&{client:Writable<ConnectedProjectionClient<Mighty>>};
function input():Fixture{
 const rules=structuredClone(presetRules('default'));rules.deck='OneJoker';rules.players=5;rules.hand_size=10;rules.lowest_rank=2;rules.extra_cards=[];rules.misdeal.declarer=true;
 const room={id:'live',game:'mighty',session_id:1,room_version:21,hands_played:0,showing:true,in_hand:true,rules,participant_ids:[...ids]};
 return {client:{room,game:state(12,21,bidding(),1),seat:0,viewerId:'p0',viewerName:'P0',roomScope:scope('room',21)} as unknown as Writable<ConnectedProjectionClient<Mighty>>,previous:state(10,20),previousParticipantIds:[...ids],previousRoomScope:scope('room',20),previousGeneration:'[0,0]',baseline:false,roomEpoch:'epoch',connectionEpoch:'connection'};
}
const next=(value:MightyMotionTransitionInput)=>value.client.game!;
test('known native Bidding redeal emits exact counted53 hint with stable scoped event identity',()=>{
 const value=input(),result=createMightyMotionTransition(value);expect(result.generation).toBe('[0,1,12]');expect(result.recycle).toMatchObject({source:'stock',previousGeneration:'[0,0]',totalCount:53});expect(createMightyMotionTransition(value)).toEqual(result);expect(JSON.stringify(result)).not.toMatch(/hand_sizes|Normal|Misdeal|next_sequence|expected|action/);
});
test('Exchange count reset1 after a previous redeal mints a new stamp and survives notice clearing',()=>{
 const value=input();value.previousGeneration='[0,1,12]';value.previous=state(15,20,{Exchange:{declarer:2,contract:{trump:'Heart',count:17},trump_changed:false,discards:null}});value.previous.view.hand_sizes[2]=13;value.client.game=state(17,21,bidding(),1);
 const fresh=createMightyMotionTransition(value);expect(fresh.generation).toBe('[0,1,17]');expect(fresh.recycle).toBeDefined();
 const cleared={...value,previousGeneration:fresh.generation,previous:next(value),client:{...value.client,game:state(18,21,{Exchange:{declarer:2,contract:{trump:'Heart',count:17},trump_changed:false,discards:null}})}};
 expect(createMightyMotionTransition(cleared)).toEqual({generation:fresh.generation});
 const repeated={...value,previousGeneration:fresh.generation,previous:next(value),client:{...value.client,game:state(19,21,bidding(),2)}};expect(createMightyMotionTransition(repeated).generation).toBe('[0,2,19]');
});
test('AllPassed reuses the same count proof without a public thrown hand',()=>{
 const value=input();next(value).view.redealt={why:'AllPassed',count:1};expect(createMightyMotionTransition(value).recycle).toBeDefined();
});
test('duplicate, ordinary, baseline, missing history and missed publications do not mint or replay',()=>{
 const value=input(),fresh=createMightyMotionTransition(value),duplicate={...value,previousGeneration:fresh.generation,previous:next(value)};
 expect(createMightyMotionTransition(duplicate)).toEqual({generation:fresh.generation});
 expect(createMightyMotionTransition({...value,baseline:true}).recycle).toBeUndefined();expect(createMightyMotionTransition({...value,previous:null}).recycle).toBeUndefined();expect(createMightyMotionTransition({...value,previousGeneration:undefined}).recycle).toBeUndefined();
 next(value).version=14;next(value).command!.scope.version=14;expect(createMightyMotionTransition(value).recycle).toBeUndefined();
 next(value).version=11;next(value).command!.scope.version=11;next(value).view.redealt=null;expect(createMightyMotionTransition({...value,previousGeneration:'[0,1,10]'})).toEqual({generation:'[0,1,10]'});
});
test('foreign epoch actor session hand seat viewer roster or mutable count partitions refuse',()=>{
 const mutations:((value:Fixture)=>void)[]=[
  value=>{value.client.roomScope!.room_epoch='foreign';},value=>{value.previous!.command!.scope.room_epoch='foreign';},value=>{value.previous!.command!.scope.actor_id='foreign';},value=>{value.previous!.command!.scope.session_id=9;},value=>{value.previous!.command!.scope.hand=9;},value=>{value.previous!.command!.scope.seat=2;},value=>{value.previous!.view.viewer={Seat:2};},value=>{value.client.room!.participant_ids![2]='replacement';},value=>{value.client.room!.participant_ids![2]='p1';},value=>{value.previous!.view.hand_sizes[2]=9;},value=>{next(value).view.hand_sizes[2]=9;},value=>{next(value).room_version=22;},value=>{next(value).view.redealt!.count=3;},
 ];for(const mutate of mutations){const value=input();mutate(value);expect(createMightyMotionTransition(value).recycle).toBeUndefined();}
});
test('observer requires separately captured native Room scope and same spectator viewer',()=>{
 const value=input();Object.assign(value.client,{seat:null,viewerId:'watcher',roomScope:scope('room',21,null)});value.client.game=state(12,21,bidding(),1,null);value.previous=state(10,20,bidding(),0,null);value.previousRoomScope=scope('room',20,null);
 expect(createMightyMotionTransition(value).recycle?.totalCount).toBe(53);expect(createMightyMotionTransition({...value,previousRoomScope:undefined}).recycle).toBeUndefined();value.previousRoomScope.room_epoch='foreign';expect(createMightyMotionTransition(value).recycle).toBeUndefined();
});
test('private hand, thrown hand, opaque command payload and unrelated caches are never read',()=>{
 const value=input();let calls=0;const trap={enumerable:true,get(){calls++;throw Error('private read');}};
 for(const item of [value.previous!.view,next(value).view])Object.defineProperty(item,'hand',trap);
 Object.defineProperty((next(value).view.redealt!.why as {Misdeal:unknown}).Misdeal!,'hand',trap);Object.defineProperty(next(value),'legal',trap);Object.defineProperty(value.client.room!,'archives',trap);Object.defineProperty(next(value).command!,'payload',trap);
 expect(createMightyMotionTransition(value).recycle).toBeDefined();expect(calls).toBe(0);
});
test('malformed generation and count-only sources never infer unsupported fresh motion',()=>{
 for(const generation of ['invalid','[0,-1]','[0,1,2,3]','[1,0]','x'.repeat(129)])expect(createMightyMotionTransition({...input(),previousGeneration:generation}).recycle).toBeUndefined();
 const value=input();next(value).view.phase={Exchange:{declarer:0,contract:{trump:'Spade',count:14},trump_changed:false,discards:null}};expect(createMightyMotionTransition(value).recycle).toBeUndefined();
});

test('future generation stamps, absent observer markers and coercive deck objects refuse without callbacks',()=>{
 const value=input();expect(createMightyMotionTransition({...value,previousGeneration:'[0,1,99]'}).recycle).toBeUndefined();
 let calls=0;Object.assign(value.client.room!.rules,{deck:{toString(){calls++;return 'OneJoker';}}});expect(createMightyMotionTransition(value).recycle).toBeUndefined();expect(calls).toBe(0);
 const observer=input();Object.assign(observer.client,{seat:null,viewerId:'watcher',roomScope:scope('room',21,null),game:state(12,21,bidding(),1,null)});observer.previous=state(10,20,bidding(),0,null);observer.previousRoomScope=scope('room',20,null);delete observer.previous.room_version;delete (observer.previousRoomScope as Partial<CommandScope>).version;expect(createMightyMotionTransition(observer).recycle).toBeUndefined();
});
