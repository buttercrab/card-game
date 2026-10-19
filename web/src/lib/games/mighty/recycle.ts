import type {CommandScope} from '../../generated/protocol';
import type {ConnectedProjectionClient} from '../../table/foundation/connected';
import type {RecycleTransition} from '../../table/foundation/recycle';
import type {Mighty,StateMsg} from './types';

export interface MightyMotionTransitionInput {
 readonly client:ConnectedProjectionClient<Mighty>;
 readonly previous:StateMsg|null;
 readonly previousParticipantIds:readonly (string|null)[]|null;
 /** Required for observers, whose State has no private Game command window. */
 readonly previousRoomScope?:CommandScope|null;
 readonly previousGeneration?:string;
 readonly baseline:boolean;
 readonly roomEpoch:string;
 readonly connectionEpoch:string;
}
export interface MightyMotionTransition {readonly generation:string;readonly recycle?:RecycleTransition;}
// Read only admitted public fields. In particular, never traverse view.hand,
// Misdeal.hand, offers/commands/action payloads, records or historical caches.
const data=(object:unknown,key:string):unknown=>{
 if(!object||typeof object!=='object')return undefined;
 const descriptor=Object.getOwnPropertyDescriptor(object,key);return descriptor&&'value'in descriptor?descriptor.value:undefined;
};
const integer=(value:unknown,max=Number.MAX_SAFE_INTEGER):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;
const id=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=128;
function list(value:unknown,max:number):readonly unknown[]|null{
 if(!Array.isArray(value))return null;const length=data(value,'length');if(!integer(length,max))return null;
 const result:unknown[]=[];for(let index=0;index<length;index++){const entry=Object.getOwnPropertyDescriptor(value,String(index));if(!entry||!('value'in entry))return null;result.push(entry.value);}return result;
}
function generation(value:unknown):{hand:number;count:number;stamp?:number}|null{
 if(typeof value!=='string'||value.length>128)return null;
 try{const parts:unknown=JSON.parse(value);if(!Array.isArray(parts)||parts.length<2||parts.length>3||!integer(parts[0],0xffff_ffff)||!integer(parts[1])||parts.length===3&&(!integer(parts[2])||parts[2]===0))return null;return {hand:parts[0],count:parts[1],...(parts.length===3?{stamp:parts[2] as number}:{})};}catch{return null;}
}
const phase=(state:unknown,kind:string)=>data(data(data(state,'view'),'phase'),kind);
const nativeCount=(state:unknown):number=>{const count=data(data(data(state,'view'),'redealt'),'count');return integer(count)?count:0;};
function rulesShape(rules:unknown):{players:number;handSize:number;total:number;kitty:number}|null{
 const players=data(rules,'players'),handSize=data(rules,'hand_size'),lowest=data(rules,'lowest_rank'),deck=data(rules,'deck'),extras=list(data(rules,'extra_cards'),54);
 if(!integer(players,8)||players<2||!integer(handSize,54)||handSize<1||!integer(lowest,10)||lowest<2||typeof deck!=='string'||!['OneJoker','TwoJokers'].includes(deck)||!extras)return null;
 const seen=new Set<string>();
 for(const card of extras){const normal=list(data(card,'Normal'),2);if(!normal||normal.length!==2||typeof normal[0]!=='string'||!['Spade','Diamond','Heart','Club'].includes(normal[0])||!integer(normal[1],14)||normal[1]<2||normal[1]>=lowest)return null;const key=`${normal[0]}:${normal[1]}`;if(seen.has(key))return null;seen.add(key);}
 const total=4*(15-lowest)+extras.length+(deck==='TwoJokers'?2:1),kitty=total-players*handSize;
 return kitty>=0&&total<=54?{players,handSize,total,kitty}:null;
}
function viewer(state:unknown,seat:number|null):boolean{
 const value=data(data(state,'view'),'viewer');return seat===null?value==='Spectator':data(value,'Seat')===seat;
}
function scopeIdentity(scope:unknown,expected:unknown):boolean{
 return ['room_id','room_epoch','session_id','hand','actor_id','seat'].every(key=>data(scope,key)===data(expected,key));
}
function gameScope(state:unknown,expected:unknown):boolean{
 const scope=data(data(state,'command'),'scope');return data(scope,'domain')==='game'&&scopeIdentity(scope,expected)&&data(scope,'version')===data(state,'version');
}
function held(state:unknown,size:number):readonly number[]|null{
 const counts=list(data(data(state,'view'),'hand_sizes'),8);return counts&&counts.length===size&&counts.every(count=>integer(count,54))?counts as readonly number[]:null;
}
/** Mint a fresh presentation generation only from an observed public redeal.
 * The host's baseline fences its existing room/connection history capture;
 * native scopes and exact version/roster checks independently fence this hint.
 * Atomic Act+Chance is exactly two native game revisions. Missed/ambiguous
 * publications snap; no hidden card identity is matched across a redeal. */
export function createMightyMotionTransition(input:MightyMotionTransitionInput):MightyMotionTransition{
 const client=data(input,'client'),room=data(client,'room'),next=data(client,'game'),previous=data(input,'previous');
 const hand=data(room,'hands_played'),showing=data(room,'showing'),inHand=data(room,'in_hand');
 const done=!!phase(next,'Done')||showing===true&&inHand===false&&!!data(room,'current_hand');
 const recorded=data(data(room,'current_hand'),'number');
 const handNumber=done&&integer(recorded,0xffff_ffff)&&recorded>0?recorded-1:integer(hand,0xffff_ffff)?hand:0;
 const prior=generation(data(input,'previousGeneration')),baseline=data(input,'baseline')!==false;
 const carry=!baseline&&prior?.hand===handNumber?prior:null;
 const count=Math.max(showing===true?nativeCount(next):0,carry?.count??0);
 const fallback=Object.freeze({generation:JSON.stringify([handNumber,count,...(carry?.stamp?[carry.stamp]:[])])});
 try{
  const currentScope=data(client,'roomScope'),seat=data(client,'seat'),actor=data(client,'viewerId'),roomEpoch=data(input,'roomEpoch'),connection=data(input,'connectionEpoch');
  const shape=rulesShape(data(room,'rules')),ids=list(data(room,'participant_ids'),8),oldIds=list(data(input,'previousParticipantIds'),8);
  if(baseline||!previous||!prior||!integer(hand,0xffff_ffff)||prior.hand!==handNumber||showing!==true||inHand!==true||data(room,'game')!=='mighty'||!shape||!ids||!oldIds||ids.length!==shape.players||ids.length!==oldIds.length||ids.some((value,index)=>!id(value)||value!==oldIds[index])||new Set(ids).size!==ids.length||!id(actor)||!id(roomEpoch)||!id(connection)||!(seat===null||integer(seat,shape.players-1))||seat!==null&&ids[seat]!==actor)return fallback;
  if(!id(data(room,'id'))||!integer(data(room,'session_id'),0xffff_ffff)||!integer(data(currentScope,'version'))||data(currentScope,'domain')!=='room'||data(currentScope,'room_id')!==data(room,'id')||data(currentScope,'room_epoch')!==roomEpoch||data(currentScope,'session_id')!==data(room,'session_id')||data(currentScope,'hand')!==handNumber||data(currentScope,'actor_id')!==actor||data(currentScope,'seat')!==seat)return fallback;
  const version=data(next,'version'),previousVersion=data(previous,'version');
  if(!integer(version)||!integer(previousVersion)||prior.stamp!==undefined&&prior.stamp>previousVersion||prior.count<nativeCount(previous)||version-previousVersion!==2||carry?.stamp===version||!viewer(next,seat as number|null)||!viewer(previous,seat as number|null))return fallback;
  if(seat===null){const oldScope=data(input,'previousRoomScope');if(data(oldScope,'domain')!=='room'||!integer(data(oldScope,'version'))||!scopeIdentity(oldScope,currentScope)||data(oldScope,'version')!==data(previous,'room_version'))return fallback;}
  else if(!gameScope(next,currentScope)||!gameScope(previous,currentScope))return fallback;
  if(data(currentScope,'version')!==data(next,'room_version')||data(room,'room_version')!==data(next,'room_version'))return fallback;
  const bidding=phase(next,'Bidding'),oldBidding=phase(previous,'Bidding'),exchange=phase(previous,'Exchange');
  const passed=list(data(bidding,'passed'),8),hasBid=list(data(bidding,'has_bid'),8);
  if(!bidding||data(bidding,'best')!==null||!integer(data(bidding,'to_act'),shape.players-1)||!passed||passed.length!==shape.players||passed.some(value=>value!==false)||!hasBid||hasBid.length!==shape.players||hasBid.some(value=>value!==false)||!integer(data(data(next,'view'),'first_bidder'),shape.players-1))return fallback;
  const oldRedealt=data(data(previous,'view'),'redealt');
  if(oldRedealt!==null&&(!integer(data(oldRedealt,'count'))||data(oldRedealt,'count')===0))return fallback;
  const redealt=data(data(next,'view'),'redealt'),nextCount=data(redealt,'count'),why=data(redealt,'why');
  if(!integer(nextCount)||nextCount<1)return fallback;
  const misdeal=data(why,'Misdeal'),misdealSeat=data(misdeal,'seat');
  if(why!=='AllPassed'&&(!misdeal||!integer(misdealSeat,shape.players-1)))return fallback;
  const oldCounts=held(previous,shape.players),newCounts=held(next,shape.players);
  if(!oldCounts||!newCounts||newCounts.some(value=>value!==shape.handSize))return fallback;
  if(oldBidding){
   if(nextCount!==nativeCount(previous)+1||oldCounts.some(value=>value!==shape.handSize))return fallback;
  }else if(exchange){
   const declarer=data(exchange,'declarer');
   if(nextCount!==1||!misdeal||misdealSeat!==declarer||!integer(declarer,shape.players-1)||oldCounts.some((value,index)=>value!==shape.handSize+(index===declarer?shape.kitty:0))||data(data(data(room,'rules'),'misdeal'),'declarer')!==true)return fallback;
  }else return fallback;
  const oldStock=oldBidding?shape.kitty:0;
  if(oldStock+oldCounts.reduce((sum,value)=>sum+value,0)!==shape.total||shape.kitty+newCounts.reduce((sum,value)=>sum+value,0)!==shape.total||newCounts.reduce((sum,value)=>sum+value,0)>64)return fallback;
  const nextGeneration=JSON.stringify([handNumber,count,version]);
  return Object.freeze({generation:nextGeneration,recycle:Object.freeze({id:JSON.stringify(['mighty-recycle',data(room,'id'),roomEpoch,connection,data(currentScope,'session_id'),handNumber,actor,version]),source:'stock',previousGeneration:data(input,'previousGeneration') as string,totalCount:shape.total})});
 }catch{return fallback;}
}
