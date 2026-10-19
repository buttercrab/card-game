import type {ConnectedOutcomeContext} from '../../table/foundation/connected';
import type {InformationPanel} from '../../table/foundation/contracts';
import {copyFormData} from '../../table/foundation/forms';
import type {OutcomeDescriptor} from '../../table/foundation/outcome';
import type {PokerCommand} from './foundation';
import type {Poker} from './types';
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Public frozen settlement only; current seats never rename old participants. */
export function createPokerOutcome({client,document,roomScope}:ConnectedOutcomeContext<Poker,PokerCommand>):{outcome:OutcomeDescriptor;information:InformationPanel}|null{
 try{
  const room=client.room;if(!room||room.game!=='poker'||room.in_hand||!room.showing||!room.current_hand||roomScope.domain!=='room'||roomScope.room_id!==room.id||roomScope.session_id!==room.session_id||roomScope.actor_id!==client.viewerId||roomScope.seat!==client.seat)return null;
  const saved=copyFormData(room.current_hand),count=saved.participant_ids.length;
  if(saved.number!==room.hands_played||!Number.isSafeInteger(saved.number)||saved.number<1||count<2||count>8||new Set(saved.participant_ids).size!==count||saved.participant_ids.some(id=>typeof id!=='string'||!id)||saved.names.length!==count||saved.names.some(name=>typeof name!=='string'||name.length>128)||saved.payoffs.length!==count||saved.payoffs.some(value=>!Number.isSafeInteger(value))||!record(saved.view)||saved.view.over!==true||saved.view.viewer!==null||!Array.isArray(saved.view.payoffs)||saved.view.payoffs.length!==count||saved.view.payoffs.some((value,index)=>value!==saved.payoffs[index]))return null;
  const me=saved.participant_ids.indexOf(roomScope.actor_id),payoff=me<0?null:saved.payoffs[me];
  const information:InformationPanel={id:'poker-outcome',title:'판 종료',summary:{text:'매 판 독립적인 플레이 칩',tone:'muted'},...(payoff===null?{}:{primary:{label:'이번 판',value:{kind:'text',text:`${payoff>0?'+':''}${payoff}칩`}}}),fields:[
   ...(payoff===null?[{id:'participation',label:'참여',value:{kind:'text' as const,text:'이번 판에 참여하지 않았어요'}}]:[]),
   ...saved.names.map((name,index)=>({id:`payoff:${index}`,label:name||'이전 참가자',value:{kind:'number' as const,value:saved.payoffs[index]}})),
  ]};
  const continuationActionIds=document.decision.commands.filter(id=>document.offer.actions.some(action=>action.id===id&&action.kind==='command'&&action.action.kind==='room'&&['ready','start'].includes(action.action.action.type)));
  return {outcome:{id:JSON.stringify(['poker-outcome',room.id,roomScope.room_epoch,roomScope.session_id,roomScope.hand,saved.number]),informationId:information.id,continuationActionIds},information};
 }catch{return null;}
}
