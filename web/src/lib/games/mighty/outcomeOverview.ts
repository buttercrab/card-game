import type {CommandScope} from '../../generated/protocol';
import {recordedOrigin} from '../../room/recordedOrigin';
import {ownOutcomeOverview} from '../../table/foundation/outcomeOverview';
import {ownDisclosureData} from '../../table/foundation/disclosures';
import type {DisclosureDocument} from '../../table/foundation/disclosureTypes';
import {createMightyHistoryDisclosure} from './historyDisclosure';
import type {CurrentRoomView as RoomView} from './types';
function field(value:unknown,key:string,optional=false):unknown{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid current outcome source');
 const descriptor=Object.getOwnPropertyDescriptor(value,key);if(!descriptor&&optional)return undefined;
 if(!descriptor||!('value'in descriptor))throw Error('Outcome accessors refused');return descriptor.value;
}
const integer=(value:unknown,min=0,max=0xffffffff):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min&&value<=max;
const identity=(value:unknown):value is string=>typeof value==='string'&&!!value.trim()&&value.length<=128;
/** Only the current producer-stamped PUBLIC record is selected before decoding.
 * A current command scope is supplied by the authenticated host; no private game
 * packet, archive, storage, live roster name or inferred record is accepted. */
export function createMightyOutcomeOverview(input:{readonly room:RoomView|null;readonly scope:CommandScope|null}):DisclosureDocument|null{
 try{
  const room=field(input,'room'),rawScope=field(input,'scope');if(!room||!rawScope)return null;
  const selectedScope:Record<string,unknown>={};for(const key of ['domain','room_id','room_epoch','session_id','hand','version','seat','actor_id'])selectedScope[key]=field(rawScope,key);
  const scope=ownDisclosureData(selectedScope),id=field(room,'id'),session=field(room,'session_id'),hands=field(room,'hands_played');
  if(field(room,'game')!=='mighty'||field(room,'in_hand')!==false||field(room,'showing')!==true||!identity(id)||!integer(session)||!integer(hands,1)||scope.domain!=='room'||scope.room_id!==id||scope.session_id!==session||!identity(scope.room_epoch)||!identity(scope.actor_id)||!integer(scope.hand)||!integer(scope.version,0,Number.MAX_SAFE_INTEGER)||!(scope.seat===null||integer(scope.seat,0,7)))return null;
  const version=field(room,'room_version',true);if(version!==undefined&&(!integer(version,0,Number.MAX_SAFE_INTEGER)||version!==scope.version))return null;
  if(scope.seat!==null){const raw=field(room,'participant_ids'),participants=ownDisclosureData(raw);if(!Array.isArray(participants)||participants.length>8||participants[scope.seat as number]!==scope.actor_id)return null;}
  const record=field(room,'current_hand');if(!record||field(record,'number')!==hands)return null;
  const origin=recordedOrigin(record,session);if(origin.status!=='known')return null;
  const entryId=JSON.stringify(['mighty-outcome',id,scope.room_epoch,origin.sessionId,hands]);
  const disclosure=createMightyHistoryDisclosure({entryId,source:{identity:{roomId:id,roomEpoch:scope.room_epoch as string,sessionId:origin.sessionId,handNumber:hands},record}});
  const matrix=disclosure.sections.find(section=>section.kind==='matrix');if(!matrix||matrix.kind!=='matrix')return null;
  const referenced=new Set(matrix.rows.flatMap(row=>row.cells.flatMap(cell=>cell?[cell.cardId]:[])));
  return ownOutcomeOverview({entryId,title:'이번 판 전체 라운드',roster:disclosure.roster,cards:disclosure.cards.filter(card=>referenced.has(card.id)),sections:[matrix]});
 }catch{return null;}
}
