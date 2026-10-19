import {nativeAdviceCurrent,type NativeAdvice,type NativeReaction} from '../../room/ephemeral';
import {readActionPolicy} from '../../room/actionPolicy';
import {CATALOG} from '../../catalog';
import type {ConnectedCommandClient} from '../../table/foundation/connected';
import type {TableDocument} from '../../table/foundation/contracts';
import {cloneAssistanceData,createAssistanceSnapshot,type AssistanceAuthority,type AssistanceBindings,type AssistanceScope,type AssistanceSnapshot,type ReactionOption,type ReactionPresentation} from '../../table/foundation/assistance';
import {cardKey,kittyCount} from './cards';
import {refusalText} from './ledger';
import {tipFor} from './table/narration';
import {handView} from './table/view';
import type {Action,Mighty} from './types';
import {roomStamp,type MightyCommand} from './foundation';

export interface MightyAssistanceInput {
    readonly document:TableDocument<MightyCommand>;
    readonly client:ConnectedCommandClient<Mighty>;
    readonly roomEpoch:string;
    readonly connectionEpoch:string;
    readonly publicationReady:boolean;
    readonly graceReady:boolean;
    readonly preferences:{readonly hints:boolean;readonly tips:boolean};
    readonly nativeHint?:NativeAdvice<Action>|null;
    /** Receive-time participant identity; active records from the ONE existing TTL owner. */
    readonly nativeReactions?:readonly NativeReaction[];
}
const descriptions:Readonly<Record<string,string>>={'👏':'박수','😂':'크게 웃기','😮':'놀라기','😭':'울기','🔥':'불타오르기','🙏':'부탁과 감사','👍':'좋아요','😎':'멋져요','🤔':'생각 중','😅':'머쓱해요','🎉':'축하해요','💪':'힘내요'};
export const mightyReactionOptions:readonly ReactionOption[]=Object.freeze(CATALOG.reactions.map((text,index)=>Object.freeze({id:`reaction:${index}`,text,label:descriptions[text]??text})));
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const actionCards=(action:Action):readonly string[]=>typeof action==='object'&&action!==null&&('Play' in action||'Discard' in action)?[cardKey('Play' in action?action.Play.card:action.Discard)]:[];
/** Actual canonical Mighty adapter, not a separate rule evaluator or dispatch owner. */
export function createMightyAssistance(source:MightyAssistanceInput):AssistanceSnapshot|null {
    try {
        const input=cloneAssistanceData(source),{client,document}=input,room=client.room,state=client.game;
        if(!room||room.game!=='mighty'||client.status!=='open'||input.publicationReady!==true||!client.viewerId||typeof input.preferences.hints!=='boolean'||typeof input.preferences.tips!=='boolean')return null;
        if(client.seat===null?!room.observers?.some(person=>person.id===client.viewerId):room.participant_ids?.[client.seat]!==client.viewerId||document.participant.role!=='player'||document.participant.id!==client.viewerId)return null;
        if(document.context.session!==`mighty:${room.id}:${room.session_id??0}`||document.context.audience!==`${client.viewerId}:${client.seat??'watch'}`)return null;
        const validViewer=!!state&&(client.seat===null?state.view.viewer==='Spectator':typeof state.view.viewer==='object'&&state.view.viewer.Seat===client.seat);
        // A foreign/private state must not supply even advisory information.
        if(room.showing&&(!state||!validViewer))return null;
        const ownHandAuthorized=room.showing&&!!state&&client.seat!==null&&validViewer;
        const policy=state?readActionPolicy(state):null;
        const activeTurn=ownHandAuthorized&&room.in_hand&&input.graceReady===true&&typeof state!.turn==='object'&&state!.turn.Seat===client.seat;
        if(state?.command&&(state.command.scope.room_epoch!==input.roomEpoch||state.command.scope.actor_id!==client.viewerId||state.command.scope.seat!==client.seat))return null;
        // Check native receipt authority BEFORE attaching any current presentation context.
        const receivedHint=input.nativeHint&&nativeAdviceCurrent(input.nativeHint,{connectionEpoch:input.connectionEpoch,publicationReady:input.publicationReady,connected:client.status==='open',actorId:client.viewerId,seat:client.seat,roomId:room.id,participantId:client.seat===null?null:room.participant_ids?.[client.seat]??null,command:state?.command?.scope??null,gameVersion:state?.version??null,viewerSeat:validViewer?client.seat:null,turnSeat:state&&typeof state.turn==='object'?state.turn.Seat:null,legal:policy?.legal??[]})?input.nativeHint:null;
        const scope:AssistanceScope={context:{...document.context},roomId:room.id,roomEpoch:input.roomEpoch,connectionEpoch:input.connectionEpoch,actorId:client.viewerId,seat:client.seat,gameVersion:state&&room.showing?state.version:null};
        const authority:AssistanceAuthority={scope,connected:true,activeTurn,ownHandAuthorized};
        const handIds=ownHandAuthorized?document.hand.map(card=>card.id):[];
        if(handIds.some(id=>!state!.view.hand.some(card=>cardKey(card)===id)))return null;
        const actions=ownHandAuthorized?document.offer.actions.flatMap(command=>{
            if(command.kind!=='command'||!command.enabled||command.action.kind!=='game'||command.action.version!==state!.version||command.action.seat!==client.seat||command.action.stamp!==roomStamp(client))return [];
            const action=command.action.action;
            if(![...(policy?.legal??[]),...(policy?.out_of_turn??[])].some(legal=>same(legal,action)))return [];
            return [{id:command.id,label:command.label,cardIds:actionCards(action)}];
        }):[];
        const participantIds=[...(document.participant.role==='observer'?[]:[document.participant.id]),...(document.opponents??[]).filter(person=>!person.appearance?.vacant).map(person=>person.id),...(room.observers??[]).map(person=>person.id)];
        const people=[...new Set(participantIds)];
        const bindings:AssistanceBindings={authority,handIds,actions,participantIds:people,reactionOptions:mightyReactionOptions};
        let advice:AssistanceSnapshot['projection']['advice'];
        if(input.preferences.hints&&activeTurn&&receivedHint){
            const match=document.offer.actions.find(command=>command.kind==='command'&&command.enabled&&command.action.kind==='game'&&same(command.action.action,receivedHint!.action)&&actions.some(action=>action.id===command.id));
            if(match){const binding=actions.find(action=>action.id===match.id)!;advice={id:JSON.stringify(['advice',scope.roomEpoch,scope.connectionEpoch,scope.actorId,scope.gameVersion,match.id]),label:binding.label,actionId:match.id,cardIds:binding.cardIds};}
        }
        const hand=ownHandAuthorized?handView(state!.view,client.seat):null;
        const misdeal=ownHandAuthorized&&!activeTurn&&!!policy?.out_of_turn.includes('Misdeal');
        const toDiscard=hand?.exchange?kittyCount(room.rules)-(hand.exchange.discards?.length??0):0;
        const guidance=input.preferences.tips&&hand?tipFor(hand,room.rules,activeTurn,!!misdeal,toDiscard)??undefined:undefined;
        const hasCardActions=activeTurn&&!!policy?.legal.some(action=>typeof action==='object'&&('Play' in action||'Discard' in action));
        const inspections=hasCardActions?document.hand.filter(card=>!actions.some(action=>action.cardIds.includes(card.id))).map(card=>{
            const note=state!.notes.unplayable.find(note=>cardKey(note.card)===card.id);
            return {cardId:card.id,reason:note?refusalText(note.why):'지금은 낼 수 없는 카드예요'};
        }):[];
        const reactions:ReactionPresentation[]=[];
        for(const record of input.nativeReactions??[]){
            if(record.roomId===scope.roomId&&record.roomEpoch===scope.roomEpoch&&record.connectionEpoch===scope.connectionEpoch&&people.includes(record.participantId)&&mightyReactionOptions.some(option=>option.text===record.text)&&
                !reactions.some(prior=>prior.participantId===record.participantId||prior.eventId===record.eventId))reactions.push({eventId:record.eventId,participantId:record.participantId,text:record.text});
        }
        // Hinted-card decoration is separate from the engine's selection draft.
        // Advice labels retain projectMighty's exact actionLabel wording.
        return createAssistanceSnapshot({scope,offerId:JSON.stringify(['mighty-assistance',scope,document.offer.id,input.preferences.hints]),tools:[
            ...(input.preferences.hints&&activeTurn?[{id:'advice',kind:'request-advice' as const,label:'봇이라면 뭘 할지 보기',enabled:!!policy?.legal.length,shortcut:'H' as const}]:[]),
            {id:'reactions',kind:'send-reaction',label:'반응 보내기',enabled:true,shortcut:'R',options:mightyReactionOptions},
        ],...(guidance?{guidance}:{}),...(advice?{advice}:{}),inspections,reactions},bindings);
    }catch{return null;}
}
