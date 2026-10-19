import {cardKey,deckSize} from './cards';
import {recordedOrigin} from '../../room/recordedOrigin';
import type {ConnectedOutcomeContext} from '../../table/foundation/connected';
import type {TableDocument} from '../../table/foundation/contracts';
import {createMightyOutcome} from './outcome';
import {projectMightyHistory} from './history';
import type {MightyCommand} from './foundation';
import type {Mighty} from './types';
/** Restored public results can precede the audience-specific live State packet. */
export function projectMightyOutcome({client,document,roomScope,earnedTitles}:ConnectedOutcomeContext<Mighty,MightyCommand>):(NonNullable<ReturnType<typeof createMightyOutcome>>&{collections?:TableDocument<MightyCommand>['collections'];reveals?:TableDocument<MightyCommand>['reveals']})|null{
 const room=client.room;if(!room)return null;
 const result=createMightyOutcome({room,scope:roomScope,continuationActionIds:document.decision.commands.filter(id=>document.offer.actions.some(action=>action.id===id&&action.kind==='command'&&action.action.kind==='room'&&['ready','start'].includes(action.action.op))),earnedTitles});
 if(!result)return null;
 const nextCollections=(document.collections??[]).map(collection=>collection.purpose==='stock'?{...collection,kind:'deck' as const,availability:'next-deal' as const,hiddenCount:deckSize(room.rules),cards:[],label:'다음 판 덱'}:collection);
 const settled={...result,collections:nextCollections};
 if(client.game&&typeof client.game.view.phase==='object'&&'Done' in client.game.view.phase)return settled;
 const origin=recordedOrigin(room.current_hand,roomScope.session_id);if(origin.status==='invalid')return settled;
 // Strict public current-record validation is shared with replay, but live
 // physical entities retain cardKey identity; archive play IDs stay in replay.
 const history=projectMightyHistory({identity:{roomId:room.id,roomEpoch:roomScope.room_epoch,sessionId:origin.status==='known'?origin.sessionId:roomScope.session_id,handNumber:room.current_hand!.number},record:room.current_hand});
 if(history.status!=='available')return settled;
 const last=history.rounds.at(-1);if(!last)return settled;
 const people=new Set([...(document.participant.role==='player'?[document.participant.id]:[]),...(document.opponents??[]).filter(person=>!person.appearance?.vacant).map(person=>person.id)]);
 const roster=new Map(history.roster.map(person=>[person.id,person]));
 const cards=last.plays.map(play=>{const person=roster.get(play.participantId);const visual=play.card.visual;return {...play.card,id:cardKey(visual.kind==='standard'?{Normal:[visual.suit,visual.rank]}:{Joker:visual.color}),label:`${person?.name||'이전 참가자'} · ${play.card.label}`,...(person&&people.has(person.participantId)?{ownerId:person.participantId}:{})};});
 const winner=roster.get(last.winnerId),collectedBy=winner&&people.has(winner.participantId)?winner.participantId:undefined;
 const local=document.participant.role==='observer'?null:document.participant.id;
 const reveals=cards.flatMap(card=>card.ownerId&&card.ownerId!==local?[{participantId:card.ownerId,cardId:card.id}]:[]);
 const collections:TableDocument<MightyCommand>['collections']=[...nextCollections.filter(collection=>collection.purpose!=='captured'),{id:'captured',label:`직전 트릭 · ${roster.get(last.winnerId)?.name||'이전 참가자'}`,purpose:'captured',...(collectedBy?{collectedBy}:{}),cards}];
 return {...result,collections,reveals};
}
