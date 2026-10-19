import {recordedOrigin} from '../../room/recordedOrigin';
import {sessionPreparation} from '../../room/sessionCore';
import type {CommandScope} from '../../generated/protocol';
import type {InformationPanel,InformationValue} from '../../table/foundation/contracts';
import type {OutcomeDescriptor} from '../../table/foundation/outcome';
import {copyFormData} from '../../table/foundation/forms';
import type {CurrentRoomView as RoomView,Suit} from './types';
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
/** Read required public fields without visiting unrelated replay properties. */
const own=(value:unknown,key:string):unknown=>{
 if(!record(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw Error('Invalid public result record');
 const field=Object.getOwnPropertyDescriptor(value,key);if(!field||!('value' in field))throw Error('Invalid public result field');return field.value;
};
const integer=(value:unknown,min:number,max:number):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max;
const suits:readonly Suit[]=['Spade','Diamond','Heart','Club'];
const suitNames:Record<Suit,string>={Spade:'스페이드',Diamond:'다이아몬드',Heart:'하트',Club:'클로버'};
const text=(value:string):InformationValue=>({kind:'text',text:value});
export interface MightyOutcomeInput {
 readonly room:RoomView;
 /** Current authenticated room scope, never an archive's guessed scope. */
 readonly scope:CommandScope;
 readonly continuationActionIds:readonly string[];
 /** Only confirmed new device awards supplied by the bookkeeping owner. */
 readonly earnedTitles?:readonly string[];
}
/** Public current-hand result only. Historical names/payoffs never resolve
 * through current seats, and private live hands/discards are never consulted. */
export function createMightyOutcome(input:MightyOutcomeInput):{outcome:OutcomeDescriptor;information:InformationPanel}|null {
 try{
  const {room}=input,scope=copyFormData(input.scope);
  const current=own(room,'current_hand');
  if(room.game!=='mighty'||room.in_hand||!room.showing||!current||scope.domain!=='room'||scope.room_id!==room.id||scope.session_id!==room.session_id||!scope.room_epoch||!scope.actor_id||!integer(scope.hand,0,0xffffffff))return null;
  const origin=recordedOrigin(current,scope.session_id);if(origin.status==='invalid')return null;
  const rawDone=own(own(own(current,'view'),'phase'),'Done');
  const saved=copyFormData({number:own(current,'number'),participant_ids:own(current,'participant_ids'),names:own(current,'names'),payoffs:own(current,'payoffs')});
  const done=copyFormData({declarer:own(rawDone,'declarer'),friend:own(rawDone,'friend'),contract:own(rawDone,'contract'),call:own(rawDone,'call'),team_points:own(rawDone,'team_points'),payoffs:own(rawDone,'payoffs')});
  if(!Array.isArray(saved.participant_ids)||!Array.isArray(saved.names)||!Array.isArray(saved.payoffs))return null;
  const count=saved.participant_ids.length,payoffValues=saved.payoffs;
  if(!integer(saved.number,1,0xffffffff)||saved.number!==room.hands_played||!integer(count,2,8)||new Set(saved.participant_ids).size!==count||saved.participant_ids.some(id=>typeof id!=='string'||!id||id.length>2048)||saved.names.length!==count||saved.names.some(name=>typeof name!=='string'||name.length>128)||saved.payoffs.length!==count||saved.payoffs.some(value=>!Number.isSafeInteger(value)))return null;
  if(!integer(done.declarer,0,count-1)||!(done.friend===null||integer(done.friend,0,count-1)&&done.friend!==done.declarer)||!record(done.contract)||!(done.contract.trump===null||suits.includes(done.contract.trump as Suit))||!integer(done.contract.count,0,255)||!integer(done.team_points,0,20)||!Array.isArray(done.payoffs)||done.payoffs.length!==count||done.payoffs.some((value,index)=>value!==payoffValues[index]))return null;
  const call=done.call;
  const calledCard=record(call)&&Object.keys(call).length===1&&record(call.Card)?call.Card:null;
  const validCard=!!calledCard&&Object.keys(calledCard).length===1&&(Array.isArray(calledCard.Normal)&&calledCard.Normal.length===2&&suits.includes(calledCard.Normal[0])&&integer(calledCard.Normal[1],2,14)||calledCard.Joker==='Black'||calledCard.Joker==='Red');
  if(!(call==='Alone'||call==='FirstTrick'||call==='LastTrick'||record(call)&&Object.keys(call).length===1&&integer(call.Seat,0,count-1)||validCard))return null;
  if(call==='Alone'&&done.friend!==null||record(call)&&Object.hasOwn(call,'Seat')&&done.friend!==call.Seat)return null;
  const continuationActionIds=copyFormData(input.continuationActionIds),awards=copyFormData(input.earnedTitles??[]);
  if(!Array.isArray(continuationActionIds)||continuationActionIds.length>8||continuationActionIds.some(id=>typeof id!=='string'||!id||id.length>2048)||new Set(continuationActionIds).size!==continuationActionIds.length||!Array.isArray(awards)||awards.length>12||awards.some(title=>typeof title!=='string'||!title.trim()||title.length>100))return null;
  const me=saved.participant_ids.indexOf(scope.actor_id),personal=me<0?null:saved.payoffs[me],made=done.team_points>=done.contract.count;
  const role=me===done.declarer?'주공':me===done.friend?'프렌드':'야당';
  const trump=done.contract.trump as Suit|null;
  const fields:InformationPanel['fields'][number][]=[
   {id:'contract',label:'공약',value:{kind:'inline',values:[trump?{kind:'suit',suit:trump,label:suitNames[trump]}:{kind:'text',text:'노기루다'},{kind:'number',value:done.contract.count}]}},
   {id:'points',label:'획득',value:{kind:'number',value:done.team_points}},
   {id:'declarer',label:'주공',value:text(saved.names[done.declarer]||'이전 참가자')},
   {id:'friend',label:'프렌드',value:text(done.friend===null?(done.call==='Alone'?'노프렌드':'없음'):saved.names[done.friend]||'이전 참가자')},
  ];
  if(scope.seat!==null){
   const prep=sessionPreparation(room,scope.seat);
   if(prep.waiting){
    if(prep.waiting.length<=500)fields.push({id:'preparation',label:'다음 판',value:text(prep.waiting)});
    else for(let index=0;index<prep.awaited.length;index+=4)fields.push({id:index?`preparation:${index}`:'preparation',label:'준비 대기',value:{kind:'inline',values:prep.awaited.slice(index,index+4).map(name=>({kind:'text' as const,text:`${name}님 준비 기다리는 중`}))}});
   }
   if(!prep.full)fields.push({id:'vacancy',label:'자리',value:text('빈 자리를 채우면 이어갈 수 있어요')});
  }
  if(personal===null)fields.push({id:'participation',label:'참여',value:text('이번 판에 참여하지 않았어요')});
  if(me>=0)awards.slice(8).forEach((title,index)=>fields.push({id:`award:${index}`,label:'새 업적',value:text(title)}));
  const information:InformationPanel={id:'mighty-outcome',title:done.team_points===20?'런':made?'여당 승리':'야당 승리',fields,
   ...(personal===null?{}:{primary:{label:'이번 판',value:text(`${personal>0?'+':''}${personal}점`)},summary:{text:role,tone:personal<0?'danger' as const:personal>0?'accent' as const:'muted' as const}}),
   ...(me>=0&&awards.length?{badges:awards.slice(0,8).map(title=>({text:title,tone:'accent' as const}))}:{}),
  };
  return {outcome:{id:JSON.stringify(['mighty-outcome',scope.room_id,scope.room_epoch,origin.status==='known'?origin.sessionId:scope.session_id,scope.hand,saved.number]),informationId:information.id,continuationActionIds,compactFieldIds:['contract','points']},information};
 }catch{return null;}
}
