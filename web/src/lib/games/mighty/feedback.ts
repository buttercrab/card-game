import type {TableClient} from '../../room/tableClient';
import type {ConnectedCommandClient} from '../../table/foundation/connected';
import type {TableDocument} from '../../table/foundation/contracts';
import type {FeedbackEvent,FeedbackProjection} from '../../table/foundation/feedback';
import {cloneAssistanceData} from '../../table/foundation/assistance';
import {cardKey,cardLabel,isPoint} from './cards';
import type {MightyCommand} from './foundation';
import type {Mighty,Played,StateMsg} from './types';
import {redealtBetween,roundOf} from './table/narration';
import {handView,phaseOf,tagsOf,weight} from './table/view';

export interface MightyFeedbackInput {
 readonly document:TableDocument<MightyCommand>;
 readonly client:ConnectedCommandClient<Mighty>;
 readonly previous:StateMsg|null;
 /** Captured together with previous, never looked up after a seat replacement. */
 readonly previousParticipantIds:readonly (string|null)[]|null;
 readonly connectionEpoch:string;readonly roomEpoch:string;
 readonly clock:TableClient<Mighty>['clock'];readonly baseline:boolean;
}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const turn=(state:StateMsg)=>typeof state.turn==='object'?state.turn.Seat:null;
/** Pure semantic transitions; the runtime owns commitment, effect deduplication and milestones. */
export function createMightyFeedback(source:MightyFeedbackInput):FeedbackProjection|null {
 try {
  const input=cloneAssistanceData(source),{client,document}=input,room=client.room,next=client.game;
  if(!room||room.game!=='mighty'||client.status!=='open'||!client.viewerId||!input.connectionEpoch||!input.roomEpoch||
   document.context.session!==`mighty:${room.id}:${room.session_id??0}`||document.context.audience!==`${client.viewerId}:${client.seat??'watch'}`)return null;
  const viewerMatches=(state:StateMsg)=>client.seat===null?state.view.viewer==='Spectator':typeof state.view.viewer==='object'&&state.view.viewer.Seat===client.seat;
  if(room.showing&&(!next||!viewerMatches(next)))return null;
  if(next?.command&&(next.command.scope.room_epoch!==input.roomEpoch||next.command.scope.actor_id!==client.viewerId||next.command.scope.seat!==client.seat||next.command.scope.room_id!==room.id||next.command.scope.version!==next.version))return null;
  if(client.seat===null?!room.observers?.some(person=>person.id===client.viewerId):room.participant_ids?.[client.seat]!==client.viewerId)return null;
  const ids=room.participant_ids??[];
  const participant=(seat:number|null|undefined)=>seat===null||seat===undefined?undefined:ids[seat]??undefined;
  const phase=next&&room.showing?phaseOf(next.view.phase):null;
  const mood=phase?.done?'result':phase?.play?'play':phase?.bidding||phase?.exchange?'bidding':'lobby';
  const scope={session:document.context.session,audience:document.context.audience,generation:document.context.generation,roomEpoch:input.roomEpoch,connectionEpoch:input.connectionEpoch};
  const stateId=JSON.stringify([scope,room.showing?next?.version??null:null]);
  const events:FeedbackEvent[]=[];
  const visible={kind:'visible' as const};
  const presentedCards=new Set((document.collections??[]).flatMap(collection=>collection.cards.map(card=>card.id)));
  const milestone=(cardIds:readonly string[])=>cardIds.length&&cardIds.every(id=>presentedCards.has(id))?{kind:'arrival' as const,entityIds:cardIds}:visible;
  const emit=(key:string,event:Omit<FeedbackEvent,'id'>)=>events.push({id:JSON.stringify([stateId,key]),...event});
  const prev=input.previous;
  const freshDeal=!!next&&!!phaseOf(next.view.phase).bidding&&(!prev||!!phaseOf(prev.view.phase).done);
  if(freshDeal&&!prev&&!input.baseline&&input.previousParticipantIds&&same(input.previousParticipantIds,ids))emit('deal',{kind:'shuffle',milestone:visible});
  // A fresh mount, superseded packet, different viewer or replaced human is a baseline.
  const transition=!!next&&room.showing&&!!prev&&!input.baseline&&next.version>prev.version&&viewerMatches(prev)&&
   !!input.previousParticipantIds&&same(input.previousParticipantIds,ids)&&
   (!next.command||!prev.command||next.command.scope.room_epoch===prev.command.scope.room_epoch&&next.command.scope.session_id===prev.command.scope.session_id&&(next.command.scope.hand===prev.command.scope.hand||freshDeal)&&next.command.scope.actor_id===prev.command.scope.actor_id);
  if(transition&&next&&prev){
   const before=phaseOf(prev.view.phase),after=phaseOf(next.view.phase),a=roundOf(prev.view.phase),b=roundOf(next.view.phase);
   const redealt=redealtBetween(prev,next);
   if((after.bidding&&!before.bidding)||redealt)emit('deal',{kind:'shuffle',milestone:visible});
   if(redealt&&next.view.redealt?.why!=='AllPassed'&&next.view.redealt?.why.Misdeal){
    const {seat,hand}=next.view.redealt.why.Misdeal;
    const publicCards=hand.map((card,index)=>({id:JSON.stringify(['misdeal',stateId,index,cardKey(card)]),label:cardLabel(card),visual:'Normal' in card?{kind:'standard' as const,suit:card.Normal[0],rank:card.Normal[1]}:{kind:'joker' as const,color:card.Joker}}));
    emit('misdeal',{kind:'cue',cue:'misdeal',participantId:participant(seat),label:'딜미스',publicCards,milestone:visible});
   }
   if(before.bidding&&after.bidding&&!redealt){
    const best=after.bidding.best;
    if(best&&!same(before.bidding.best,best))emit('bid',{kind:'bid',participantId:participant(best[0]),amount:next.view.bids.filter(bid=>bid.contract!==null).length,milestone:visible});
    else for(let seat=0;seat<after.bidding.passed.length;seat++)if(after.bidding.passed[seat]&&!before.bidding.passed[seat])emit(`pass:${seat}`,{kind:'bid',participantId:participant(seat),amount:0,label:'패스',milestone:visible});
   }
   if(after.exchange&&!before.exchange)emit('declarer',{kind:'cue',cue:'declarer',participantId:participant(after.exchange.declarer),milestone:visible});
   if(before.exchange&&after.play)emit('friend-call',{kind:'call',participantId:participant(after.play.declarer),milestone:visible});
   if(a&&b){
    const old=new Set([...a.tricks.flatMap(trick=>trick.plays),...a.plays].map(play=>`${play.seat}:${cardKey(play.card)}`));
    const contexts=[...b.tricks.map(trick=>({plays:trick.plays,lead:trick.lead,taker:trick.winner})),...(after.play?[{plays:after.play.plays,lead:after.play.lead,taker:after.play.leading}]:[])];
    for(const context of contexts)for(const play of context.plays){
     const key=`${play.seat}:${cardKey(play.card)}`;if(old.has(key))continue;old.add(key);
     const at=milestone([cardKey(play.card)]),who=participant(play.seat);
     emit(`card:${key}`,{kind:'card',participantId:who,milestone:at});
     const heavy=weight(play as Played,context.plays[0]?.seat===play.seat,context.lead,(after.play??after.done)?.contract.trump??null,context.taker,next.view.rules.deck==='TwoJokers');
     if(heavy){emit(`heavy:${key}`,{kind:'heavy',participantId:who,milestone:at});if(heavy==='mighty'||heavy==='joker')emit(`special:${key}`,{kind:'cue',cue:heavy,participantId:who,label:heavy==='mighty'?'마이티':'조커',milestone:at});}
    }
    for(let index=a.tricks.length;index<b.tricks.length;index++){
     const trick=b.tricks[index],at=milestone(trick.plays.map(play=>cardKey(play.card))),who=participant(trick.winner),points=trick.plays.filter(play=>isPoint(play.card)).length;
     emit(`sweep:${index}`,{kind:'sweep',participantId:who,milestone:at});if(points)emit(`score:${index}`,{kind:'score',participantId:who,amount:points,milestone:at});
    }
    if(b.friend!==null&&a.friend===null){
     emit('friend',{kind:'friend',cue:'friend',participantId:participant(b.friend),milestone:visible});
     emit('answer',{kind:'answer',cue:'answer',participantId:participant((after.play??after.done)?.declarer),milestone:visible});
    }
    if(after.play?.called_joker&&!a.called_joker&&after.play.plays[0])emit('joker-call',{kind:'cue',cue:'call',participantId:participant(after.play.plays[0].seat),label:'조커콜',milestone:visible});
   }
   const oldHand=handView(prev.view,client.seat),newHand=handView(next.view,client.seat);
   const oldTags=tagsOf(oldHand,prev.view.rules.hand_size,before.play?before.play.trick_no+1:0,false).map(tag=>tag.text);
   const newTags=tagsOf(newHand,next.view.rules.hand_size,after.play?after.play.trick_no+1:0,false).map(tag=>tag.text);
   for(const label of newTags.filter(tag=>!oldTags.includes(tag)))emit(`tag:${label}`,{kind:label==='공약 확정'?'resolve':'tag',label,milestone:visible});
   if(client.seat!==null&&room.in_hand&&turn(next)===client.seat&&turn(prev)!==client.seat)emit('turn',{kind:'turn',participantId:client.viewerId,milestone:visible});
   if(after.done&&!before.done){const mine=client.seat===null||client.seat===after.done.declarer||client.seat===after.done.friend,made=after.done.team_points>=after.done.contract.count;emit('result',{kind:'result',positive:mine?made:!made,milestone:visible});}
  }
  const clock=input.clock,clockParticipant=clock?participant(clock.seat):undefined;
  // A large catch-up is a visual baseline, not a burst of historical sounds.
  return cloneAssistanceData({scope,stateId,events:events.length<=64?events:[],mood,...(clock&&clockParticipant&&room.in_hand&&Number.isFinite(clock.deadline)&&Number.isFinite(clock.total)&&clock.total>0?{clock:{id:JSON.stringify([scope,clockParticipant,next?.version??null,clock.total]),participantId:clockParticipant,deadline:clock.deadline,total:clock.total,local:client.seat===clock.seat}}:{})});
 }catch{return null;}
}
