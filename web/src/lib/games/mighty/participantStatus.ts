import type {InformationPanel,ParticipantStatus,StatusPresentation} from '../../table/foundation/contracts';
import {trumpLabel} from './cards';
import {recordedOrigin} from '../../room/recordedOrigin';
import {projectMightyHistory,type MightyHistoryIdentity} from './history';
import type {CommandScope} from '../../generated/protocol';
import type {PhaseView,StateMsg,Suit} from './types';
const data=(object:unknown,key:string):unknown=>{if(!object||typeof object!=='object')return undefined;const descriptor=Object.getOwnPropertyDescriptor(object,key);return descriptor&&'value'in descriptor?descriptor.value:undefined;};
const integer=(value:unknown,max:number):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;
function list(value:unknown,max:number):readonly unknown[]|null{if(!Array.isArray(value))return null;const length=data(value,'length');if(!integer(length,max))return null;const output:unknown[]=[];for(let index=0;index<length;index++){const entry=Object.getOwnPropertyDescriptor(value,String(index));if(!entry||!('value'in entry))return null;output.push(entry.value);}return output;}
type PublicTeam='declarer'|'friend'|'defense';
const text=(value:string)=>Object.freeze({kind:'text' as const,text:value});
function status(team:PublicTeam|null,points:number):ParticipantStatus|undefined{
 if(!team)return points>0?Object.freeze({purpose:'standing',value:text(`${points}점`),tone:'plain'}):undefined;
 return Object.freeze({purpose:'standing',value:text(team==='declarer'?'주공':team==='friend'?'프렌드':'야당'),tone:team==='declarer'?'gold':team==='friend'?'accent':'plain',...(points>0?{badges:Object.freeze([Object.freeze({text:`${points}점`,tone:'plain' as const})])}:{})});
}
function pointCount(value:unknown):number|null{
 const cards=list(value,54);if(!cards)return null;let points=0;
 for(const card of cards){const normal=list(data(card,'Normal'),2),joker=data(card,'Joker');
  if(normal&&normal.length===2&&typeof normal[0]==='string'&&['Spade','Heart','Diamond','Club'].includes(normal[0])&&integer(normal[1],14)&&normal[1]>=2){if(normal[1]>=10)points++;}
  else if(joker!=='Red'&&joker!=='Black')return null;
 }
 return points<=20?points:null;
}
/** No audience-private hand or no_friend inference enters a public role badge. */
function publicNoFriend(play:unknown,declarer:number):boolean{
 const call=data(play,'call');if(call==='Alone')return true;
 if(call==='FirstTrick'){const tricks=list(data(play,'tricks'),54);return !!tricks?.length&&data(tricks[0],'winner')===declarer;}
 if(data(call,'Seat')===declarer)return true;
 const called=data(call,'Card');if(!called)return false;
 const normal=list(data(called,'Normal'),2),joker=data(called,'Joker');
 const matches=(card:unknown)=>{const candidate=list(data(card,'Normal'),2);return normal&&normal.length===2&&candidate&&candidate.length===2?normal[0]===candidate[0]&&normal[1]===candidate[1]:!normal&&(joker==='Black'||joker==='Red')&&data(card,'Joker')===joker;};
 const contains=(plays:unknown)=>list(plays,8)?.some(played=>data(played,'seat')===declarer&&matches(data(played,'card')))===true;
 return contains(data(play,'plays'))||list(data(play,'tricks'),54)?.some(trick=>contains(data(trick,'plays')))===true;
}
/** A completed record is mapped by original participant identity, never by the
 * current occupant's seat. The explicit current identity fences stale scopes. */
export interface MightyHistoricalStatusInput {readonly record:unknown;readonly scope:CommandScope|null;readonly identity:MightyHistoryIdentity;}
export function projectMightyHistoricalParticipantStatuses(input:MightyHistoricalStatusInput):readonly Readonly<{id:string;name:string;seat:number;status:ParticipantStatus}>[]{
 const {record,scope,identity}=input;
 if(!scope||data(scope,'domain')!=='room'||data(scope,'room_id')!==identity.roomId||data(scope,'room_epoch')!==identity.roomEpoch||data(scope,'session_id')!==identity.sessionId||data(record,'number')!==identity.handNumber)return Object.freeze([]);
 const origin=recordedOrigin(record,identity.sessionId);if(origin.status==='invalid')return Object.freeze([]);
 const history=projectMightyHistory({record,identity:{...identity,sessionId:origin.status==='known'?origin.sessionId:identity.sessionId}});if(history.status!=='available')return Object.freeze([]);
 return Object.freeze(history.roster.map(person=>Object.freeze({id:person.participantId,name:person.name,seat:person.seat,status:status(person.team,history.details.points.find(points=>points.participantId===person.id)?.cards.length??0)!})));
}
export function projectMightyHistoricalParticipantStatus(input:MightyHistoricalStatusInput&{readonly participantId:string}):ParticipantStatus|undefined{
 if(typeof input.participantId!=='string'||!input.participantId||input.participantId.length>2048)return undefined;
 return projectMightyHistoricalParticipantStatuses(input).find(person=>person.id===input.participantId)?.status;
}
/** Original bidNote precedence: the current best bidder, otherwise a pass.
 * Play adds public roles/captured points; no private cards or cache are read. */
export function projectMightyParticipantStatus(state:StateMsg|null,seat:number):ParticipantStatus|undefined{
 const view=data(state,'view'),phase=data(view,'phase'),play=data(phase,'Play');
 const exchange=data(phase,'Exchange');
 if(exchange){
  const sizes=list(data(view,'hand_sizes'),8),declarer=data(exchange,'declarer');
  if(!sizes||sizes.length<2||sizes.some(size=>!integer(size,54))||!integer(seat,sizes.length-1)||!integer(declarer,sizes.length-1))return undefined;
  return seat===declarer?status('declarer',0):undefined;
 }
 if(play){
  const taken=list(data(view,'points_taken'),8),declarer=data(play,'declarer'),friend=data(play,'friend');
  if(!taken||taken.length<2||!integer(seat,taken.length-1)||!integer(declarer,taken.length-1)||!(friend===null||integer(friend,taken.length-1)&&friend!==declarer))return undefined;
  const points=pointCount(taken[seat]);if(points===null)return undefined;
  const known=friend!==null||publicNoFriend(play,declarer),team=seat===declarer?'declarer':seat===friend?'friend':known?'defense':null;
  return status(team,points);
 }
 // Done cannot safely use a live seat index after an occupant replacement.
 // Call the historical helper with the current original participant ID instead.
 const bidding=data(phase,'Bidding'),passed=list(data(bidding,'passed'),8);
 if(!bidding||!passed||passed.length<2||!integer(seat,passed.length-1)||passed.some(value=>typeof value!=='boolean'))return undefined;
 const raw=data(bidding,'best');
 if(raw!==null){const best=list(raw,2),contract=best?.[1],trump=data(contract,'trump'),count=data(contract,'count');
  if(!best||best.length!==2||!integer(best[0],passed.length-1)||!integer(count,255)||!(trump===null||typeof trump==='string'&&['Spade','Heart','Diamond','Club'].includes(trump)))return undefined;
  if(best[0]===seat)return Object.freeze({purpose:'announcement',tone:'plain',value:Object.freeze({kind:'inline',values:Object.freeze([Object.freeze(trump===null?{kind:'text' as const,text:trumpLabel(null)}:{kind:'suit' as const,suit:trump as Suit,label:trumpLabel(trump as Suit)}),Object.freeze({kind:'number' as const,value:count})])})});
 }
 return passed[seat]?Object.freeze({purpose:'announcement',value:Object.freeze({kind:'text',text:'패스'}),tone:'muted',muted:true}):undefined;
}
/** Reference existing canonical information; the engine owns arrangement. */
export function projectMightyStatusPresentation(information:readonly InformationPanel[],phase:PhaseView|null):StatusPresentation|undefined{
 const phaseName=phase==='Dealing'?'Dealing':data(phase,'Bidding')?'Bidding':data(phase,'Exchange')?'Exchange':data(phase,'Play')?'Play':null;
 if(!phaseName)return undefined;
 const panels=list(information,4),matches=panels?.filter(panel=>data(panel,'id')==='mighty-status');if(matches?.length!==1)return undefined;
 const panel=matches[0],fields=list(data(panel,'fields'),12);if(!fields)return undefined;
 const wanted=phaseName==='Bidding'?[data(data(phase,'Bidding'),'best')===null?'minimum':'bidder']:phaseName==='Play'?['declarer','friend','round']:[];
 const fieldIds=wanted.filter(id=>fields.filter(field=>data(field,'id')===id).length===1);
 const primary=!!data(panel,'primary'),summary=!!data(panel,'summary'),progress=!!data(panel,'progress');
 if(!fieldIds.length&&!primary&&!summary&&!progress)return undefined;
 return Object.freeze({informationId:'mighty-status',fieldIds:Object.freeze(fieldIds),...(primary?{primary:true}:{}),...(summary?{summary:true}:{}),...(progress?{progress:true}:{})});
}
