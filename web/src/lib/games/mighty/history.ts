import {cloneAssistanceData} from '../../table/foundation/assistance';
import type {TableCard} from '../../table/foundation/contracts';
import {SUITS,cardKey,cardLabel,contractLabel,deckCards,isPoint,leadLabel,mightyCard,sealOf} from './cards';
import {ledgerLines} from './ledger';
import {validateMightyEditorRules} from './ruleValidation';
import type {Card,Contract,HandValue,Lead,Rules} from './types';

export interface MightyHistoryIdentity {readonly roomId:string;readonly roomEpoch:string;readonly sessionId:number;readonly handNumber:number;}
export interface MightyHistoricalPerson {readonly id:string;readonly participantId:string;readonly seat:number;readonly name:string;readonly team:'declarer'|'friend'|'defense';readonly payoff:number;}
export interface MightyHistoricalPlay {readonly id:string;readonly participantId:string;readonly order:number;readonly card:TableCard;readonly powered:boolean;readonly leader:boolean;readonly winner:boolean;readonly jokerLead?:{readonly value:Lead;readonly label:string};}
export interface MightyHistoricalRound {readonly id:string;readonly number:number;readonly label:string;readonly lead:Lead;readonly leadLabel:string;readonly winnerId:string;readonly points:number;readonly plays:readonly MightyHistoricalPlay[];}
export type MightyHistoricalCell={readonly kind:'blank';readonly columnId:string}|{readonly kind:'card';readonly columnId:string;readonly play:MightyHistoricalPlay};
export interface MightyHistoricalMatrix {readonly columns:readonly {readonly id:string;readonly label:string}[];readonly rows:readonly {readonly participantId:string;readonly cells:readonly MightyHistoricalCell[]}[];}
export interface MightyHistoricalDetails {
 readonly contract:Contract;readonly contractLabel:string;readonly teamPoints:number;readonly made:boolean;readonly run:boolean;readonly scoring:readonly string[];
 readonly points:readonly {readonly participantId:string;readonly cards:readonly TableCard[]}[];
 readonly discards:{readonly kind:'public';readonly cards:readonly TableCard[]}|{readonly kind:'hidden';readonly explanation:string};
}
export interface MightyHistoricalCompletion {readonly identity:MightyHistoryIdentity;readonly contract:Contract;readonly teamPoints:number;readonly made:boolean;readonly alone:boolean;readonly participants:readonly {readonly participantId:string;readonly seat:number;readonly role:'declarer'|'friend'|'defense';readonly won:boolean;readonly payoff:number;readonly tookWithMighty:boolean}[];}
export type MightyHistoryProjection={readonly status:'available';readonly id:string;readonly title:string;readonly identity:MightyHistoryIdentity;readonly rules:Rules;readonly roster:readonly MightyHistoricalPerson[];readonly rounds:readonly MightyHistoricalRound[];readonly matrix:MightyHistoricalMatrix;readonly details:MightyHistoricalDetails;readonly completion:MightyHistoricalCompletion}|
 {readonly status:'unavailable';readonly id:string;readonly title:string;readonly reason:'summary-only'|'unknown-rules'|'malformed';readonly message:string};
export interface MightyHistoryInput {readonly identity:MightyHistoryIdentity;readonly record:unknown;}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:readonly string[]):v is Record<string,unknown>=>object(v)&&Object.keys(v).length===keys.length&&keys.every(key=>Object.hasOwn(v,key));
const integer=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max;
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const array=(v:unknown,max:number):v is unknown[]=>Array.isArray(v)&&v.length<=max;
const canonical=(v:unknown):string=>JSON.stringify(v,(_key,value)=>object(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0)):value);
function card(v:unknown):v is Card{return exact(v,['Normal'])&&Array.isArray(v.Normal)&&v.Normal.length===2&&SUITS.includes(v.Normal[0])&&integer(v.Normal[1],2,14)||exact(v,['Joker'])&&(v.Joker==='Black'||v.Joker==='Red');}
function lead(v:unknown):v is Lead{return exact(v,['Suit'])&&SUITS.includes(v.Suit as never)||exact(v,['Color'])&&(v.Color==='Black'||v.Color==='Red');}
function contract(v:unknown):v is Contract{return exact(v,['trump','count'])&&(v.trump===null||SUITS.includes(v.trump as never))&&integer(v.count,0,255);}
function score(value:unknown,expected:Contract,points:number):value is HandValue{
 if(!exact(value,['contract','team_points','made','steps','value'])||!contract(value.contract)||canonical(value.contract)!==canonical(expected)||value.team_points!==points||typeof value.made!=='boolean'||value.made!==(points>=expected.count)||!integer(value.value,-1e9,1e9)||!array(value.steps,32))return false;
 const fields:Record<string,readonly string[]>={OverTen:['points','total'],OverMin:['points','min','total'],OverBid:['points','contract','total'],BidBonus:['points','contract','bonus','total'],BothOver:['points','contract','n','total'],Short:['contract','short','total'],PaysBack:['contract','n','short','total'],BackRun:['rule','total'],Doubled:['why','total']};
 return value.steps.every(step=>{
  if(!object(step)||Object.keys(step).length!==1)return false;const kind=Object.keys(step)[0],part=step[kind],keys=fields[kind];if(!keys||!exact(part,keys))return false;
  return keys.every(key=>key==='why'?['NoTrump','Alone','Run','FullContract'].includes(part[key] as string):key==='rule'?part.rule==='Never'||part.rule==='DefenceReachesBid'||exact(part.rule,['TeamAtMost'])&&integer(part.rule.TeamAtMost,0,255)||exact(part.rule,['ShortBy'])&&integer(part.rule.ShortBy,0,255):integer(part[key],-1e9,1e9));
 });
}
/** One bounded PUBLIC server record. No live client/cache or archive list is accepted. */
export function projectMightyHistory(source:MightyHistoryInput):MightyHistoryProjection {
 let id='mighty-history:unavailable',title='지난 판';
 const unavailable=(reason:'summary-only'|'unknown-rules'|'malformed'):MightyHistoryProjection=>Object.freeze({status:'unavailable',id,title,reason,message:reason==='summary-only'?'요약만 남아 있어 라운드 기록을 볼 수 없어요.':reason==='unknown-rules'?'이 기록의 규칙을 지원하지 않아 재생할 수 없어요.':'기록을 안전하게 읽을 수 없어 재생할 수 없어요.'});
 try {
  const {identity,record}=cloneAssistanceData(source);
  if(!exact(identity,['roomId','roomEpoch','sessionId','handNumber'])||!text(identity.roomId,128)||!text(identity.roomEpoch,128)||!integer(identity.sessionId,0,Number.MAX_SAFE_INTEGER)||!integer(identity.handNumber,1,Number.MAX_SAFE_INTEGER))return unavailable('malformed');
  id=JSON.stringify(['mighty-history',identity.roomId,identity.roomEpoch,identity.sessionId,identity.handNumber]);title=`${identity.handNumber}판 기록`;
  if(!object(record)||!Object.hasOwn(record,'view')||record.view===null)return unavailable('summary-only');
  const recordKeys=['number','names','participant_ids','payoffs','rules','view',...(Object.hasOwn(record,'session_id')?['session_id']:[])];
  // A catalog's containing period may authorize legacy replay identity. A
  // producer-supplied origin always wins: disagreement is never repaired.
  if(!exact(record,recordKeys)||record.number!==identity.handNumber||Object.hasOwn(record,'session_id')&&(!integer(record.session_id,0,0xffffffff)||record.session_id!==identity.sessionId)||new TextEncoder().encode(JSON.stringify(record)).byteLength>131072)return unavailable('malformed');
  let rules:Rules;try{rules=validateMightyEditorRules(record.rules);}catch{return unavailable('unknown-rules');}
  const n=rules.players;
  if(n>8||rules.hand_size>54||!array(record.names,8)||record.names.length!==n||!record.names.every(name=>text(name,128))||!array(record.participant_ids,8)||record.participant_ids.length!==n||!record.participant_ids.every(value=>text(value,2048))||new Set(record.participant_ids).size!==n||!array(record.payoffs,8)||record.payoffs.length!==n||!record.payoffs.every(value=>integer(value,-1e9,1e9)))return unavailable('malformed');
  const view=record.view;
  // Public recorded views must never accept a seat's privileged Done/hand payload.
  if(!exact(view,['viewer','rules','first_bidder','hand','hand_sizes','points_taken','phase','bids','redealt'])||view.viewer!=='Spectator'||!Array.isArray(view.hand)||view.hand.length!==0||canonical(view.rules)!==canonical(rules)||!exact(view.phase,['Done']))return unavailable('malformed');
  if(!integer(view.first_bidder,0,n-1)||!array(view.hand_sizes,8)||![0,n].includes(view.hand_sizes.length)||!view.hand_sizes.every(size=>integer(size,0,54))||!array(view.points_taken,8)||![0,n].includes(view.points_taken.length)||!view.points_taken.every(cards=>array(cards,54)&&cards.every(card))||!array(view.bids,256)||!view.bids.every(bid=>exact(bid,['seat','contract'])&&integer(bid.seat,0,n-1)&&(bid.contract===null||contract(bid.contract))))return unavailable('malformed');
  if(view.redealt!==null&&(!exact(view.redealt,['why','count'])||!integer(view.redealt.count,1,Number.MAX_SAFE_INTEGER)||!(view.redealt.why==='AllPassed'||exact(view.redealt.why,['Misdeal'])&&exact(view.redealt.why.Misdeal,['seat','hand'])&&integer(view.redealt.why.Misdeal.seat,0,n-1)&&array(view.redealt.why.Misdeal.hand,54)&&view.redealt.why.Misdeal.hand.every(card))))return unavailable('malformed');
  const done=view.phase.Done;
  if(!exact(done,['declarer','contract','call','friend','team_points','payoffs','value','tricks','discards'])||!integer(done.declarer,0,n-1)||!(done.friend===null||integer(done.friend,0,n-1)&&done.friend!==done.declarer)||!contract(done.contract)||!(done.call==='Alone'||done.call==='FirstTrick'||done.call==='LastTrick'||exact(done.call,['Seat'])&&integer(done.call.Seat,0,n-1)||exact(done.call,['Card'])&&card(done.call.Card))||!integer(done.team_points,0,20)||!score(done.value,done.contract,done.team_points)||!array(done.tricks,54)||done.tricks.length>rules.hand_size||canonical(done.payoffs)!==canonical(record.payoffs))return unavailable('malformed');
  if(done.call==='Alone'&&done.friend!==null||exact(done.call,['Seat'])&&done.friend!==done.call.Seat)return unavailable('malformed');
  const declarer=done.declarer,friend=done.friend,agreement=done.contract,value=done.value;
  const names=record.names,participantIds=record.participant_ids,payoffs=record.payoffs;
  const roster:MightyHistoricalPerson[]=names.map((name,seat)=>({id:JSON.stringify([id,'person',seat]),participantId:participantIds[seat] as string,seat,name:name as string,team:seat===declarer?'declarer':seat===friend?'friend':'defense',payoff:payoffs[seat] as number}));
  const paint=(raw:Card,key:string):TableCard=>{
   const seal=sealOf(raw,rules,agreement.trump);return {id:key,label:cardLabel(raw),visual:'Normal'in raw?{kind:'standard',suit:raw.Normal[0],rank:raw.Normal[1]}:{kind:'joker',color:raw.Joker},...(seal?{emphasis:seal==='mighty'?'special':seal}:{})};
  };
  const deck=new Set(deckCards(rules).map(cardKey));
  if(exact(done.call,['Card'])&&!deck.has(cardKey(done.call.Card)))return unavailable('malformed');
  const physical=new Set<string>();let count=0;
  const take=(value:unknown):value is Card=>{if(!card(value)||!deck.has(cardKey(value))||physical.has(cardKey(value))||++count>54)return false;physical.add(cardKey(value));return true;};
  const rounds:MightyHistoricalRound[]=[];
  for(let index=0;index<done.tricks.length;index++){
   const trick=done.tricks[index];if(!exact(trick,['plays','lead','winner'])||!lead(trick.lead)||!integer(trick.winner,0,n-1)||!array(trick.plays,8)||trick.plays.length>n)return unavailable('malformed');
   const seats=new Set<number>(),roundId=JSON.stringify([id,'round',index]);const plays:MightyHistoricalPlay[]=[];
   for(let order=0;order<trick.plays.length;order++){
    const play=trick.plays[order];if(!exact(play,['seat','card','powered'])||!integer(play.seat,0,n-1)||seats.has(play.seat)||typeof play.powered!=='boolean'||!take(play.card))return unavailable('malformed');seats.add(play.seat);
    const playId=JSON.stringify([roundId,'play',order]);plays.push({id:playId,participantId:roster[play.seat].id,order,card:paint(play.card,`${playId}:card`),powered:play.powered,leader:order===0,winner:play.seat===trick.winner,...(order===0&&'Joker'in play.card?{jokerLead:{value:trick.lead,label:leadLabel(trick.lead)}}:{})});
   }
   rounds.push({id:roundId,number:index+1,label:`${index+1}라운드`,lead:trick.lead,leadLabel:leadLabel(trick.lead),winnerId:roster[trick.winner].id,points:trick.plays.filter(play=>object(play)&&card(play.card)&&isPoint(play.card)).length,plays});
  }
  let discards:MightyHistoricalDetails['discards'];
  if(!rules.reveal_discards){if(done.discards!==null&&(!Array.isArray(done.discards)||done.discards.length))return unavailable('malformed');discards={kind:'hidden',explanation:'버린 카드는 주공만 알아요. 이 공개 기록에는 저장하지 않았어요.'};}
  else {if(!array(done.discards,54))return unavailable('malformed');const cards:TableCard[]=[];for(let i=0;i<done.discards.length;i++){const raw=done.discards[i];if(!take(raw))return unavailable('malformed');cards.push(paint(raw,JSON.stringify([id,'discard',i])));}discards={kind:'public',cards};}
  const completion:MightyHistoricalCompletion={identity,contract:agreement,teamPoints:done.team_points,made:value.made,alone:done.call==='Alone',participants:roster.map(person=>({participantId:person.participantId,seat:person.seat,role:person.team,won:person.team==='defense'?!value.made:value.made,payoff:person.payoff,tookWithMighty:rounds.some(round=>round.winnerId===person.id&&round.plays.some(play=>play.participantId===person.id&&play.card.visual.kind==='standard'&&cardKey({Normal:[play.card.visual.suit,play.card.visual.rank]})===cardKey(mightyCard(agreement.trump))))}))};
  const columns=rounds.map(round=>({id:round.id,label:round.label}));
  const matrix:MightyHistoricalMatrix={columns,rows:roster.map(person=>({participantId:person.id,cells:rounds.map(round=>{const play=round.plays.find(play=>play.participantId===person.id);return play?{kind:'card' as const,columnId:round.id,play}:{kind:'blank' as const,columnId:round.id};})}))};
  return cloneAssistanceData({status:'available',id,title,identity,rules,roster,rounds,matrix,completion,details:{contract:agreement,contractLabel:contractLabel(agreement),teamPoints:done.team_points,made:value.made,run:done.team_points===20,scoring:ledgerLines(value),points:roster.map(person=>({participantId:person.id,cards:rounds.filter(round=>round.winnerId===person.id).flatMap(round=>round.plays.filter(play=>play.card.visual.kind==='standard'&&play.card.visual.rank>=10).map(play=>play.card))})),discards}});
 }catch{return unavailable('malformed');}
}
