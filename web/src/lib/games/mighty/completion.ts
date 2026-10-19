import {recordedOrigin} from '../../room/recordedOrigin';
import type {CommandScope} from '../../generated/protocol';
import {cloneAssistanceData} from '../../table/foundation/assistance';
import {projectMightyHistory} from './history';
import {completionKey,storeCompletion,type CompletionStorage,type CompletionWrite} from './completionStore';
import type {CurrentRoomView as RoomView} from './types';
import type {HandRecord} from './stats';
export interface MightyCompletionInput {
 readonly room:RoomView|null;readonly scope:CommandScope|null;readonly actorId:string|null;readonly seat:number|null;readonly keepsRecord:boolean;
}
export type MightyCompletionCandidate={readonly status:'eligible';readonly hand:HandRecord;readonly alone:boolean;readonly tookWithMighty:boolean}|{readonly status:'ineligible'|'unsupported';readonly message?:string};
/** Current authenticated participant only. Historical browsing never calls this.
 * The original recorded participant index, never the current seat index, selects
 * role and payoff. Clock is host supplied and not part of completion identity. */
export function mightyCompletionCandidate(input:MightyCompletionInput,at:number):MightyCompletionCandidate {
 try {
  if(!Number.isSafeInteger(at)||at<0)return {status:'unsupported',message:'기록 시간을 확인할 수 없어요.'};
  // Only the current record enters the working set; a room may retain many
  // archives. Read own data descriptors so rejected accessors are never run.
  const pick=(value:unknown,keys:readonly string[]):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw Error();const out:Record<string,unknown>={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!('value'in d))throw Error();Object.defineProperty(out,key,{value:d.value,enumerable:true,writable:true});}return out;};
  const source=pick(input,['room','scope','actorId','seat','keepsRecord']);
  if(source.room!==null)source.room=pick(source.room,['id','game','in_hand','showing','current_hand','session_id','participant_ids','hands_played']);
  const {room,scope,actorId,seat,keepsRecord}=cloneAssistanceData(source) as unknown as MightyCompletionInput;
  if(typeof keepsRecord!=='boolean'||scope&&scope.domain!=='room'&&scope.domain!=='game')return {status:'unsupported'};
  if(!keepsRecord||!room||room.game!=='mighty'||room.in_hand||!room.showing||!room.current_hand||!scope||!actorId||seat===null||scope.actor_id!==actorId||scope.seat!==seat||scope.room_id!==room.id||scope.session_id!==room.session_id||room.participant_ids?.[seat]!==actorId||room.current_hand.number!==room.hands_played)return {status:'ineligible'};
  // ResetScores changes the live session but preserves the displayed result.
  // Its producer-stamped origin, rather than the current command session,
  // owns completion identity. Legacy records cannot prove that origin.
  const origin=recordedOrigin(room.current_hand,scope.session_id);
  if(origin.status!=='known')return {status:'unsupported',message:'이번 판의 원래 세션을 확인할 수 없어 기기에 저장하지 않았어요.'};
  const history=projectMightyHistory({identity:{roomId:room.id,roomEpoch:scope.room_epoch,sessionId:origin.sessionId,handNumber:room.current_hand.number},record:room.current_hand});
  if(history.status!=='available')return {status:'unsupported',message:'이번 판의 공개 기록을 확인할 수 없어 기기에 저장하지 않았어요.'};
  const result=history.completion,participant=result.participants.find(person=>person.participantId===actorId);
  if(!participant)return {status:'ineligible'};
  return cloneAssistanceData({status:'eligible',hand:{key:completionKey({...result.identity,actorId}),at,role:participant.role,won:participant.won,payoff:participant.payoff,contract:result.contract,teamPoints:result.teamPoints},alone:result.alone,tookWithMighty:participant.tookWithMighty});
 }catch{return {status:'unsupported',message:'이번 판의 기록을 확인할 수 없어요.'};}
}
/** Explicit host bookkeeping boundary. Does not depend on rendering or motion. */
export function recordMightyCompletion(input:MightyCompletionInput,at:number,storage?:CompletionStorage):CompletionWrite|Exclude<MightyCompletionCandidate,{status:'eligible'}> {
 const candidate=mightyCompletionCandidate(input,at);return candidate.status==='eligible'?storeCompletion(candidate,storage):candidate;
}
