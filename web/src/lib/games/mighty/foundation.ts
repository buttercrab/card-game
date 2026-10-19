import {exchangeContractDecision} from './exchangeContractDecision';
import {mightyBiddingPresentation,mightyPlayPresentation,mightyExchangePresentation} from './phasePresentation';
import {projectMightyHistoricalParticipantStatuses,projectMightyParticipantStatus,projectMightyStatusPresentation} from './participantStatus';
import {createMightyMotionTransition} from './recycle';
import type {TableClient} from '../../room/tableClient';
import {policyAllowsAction} from '../../room/actionPolicy';
import {capacityAllows} from '../../room/capacity';
import {recordedOrigin} from '../../room/recordedOrigin';
import type {RoomAction} from '../../generated/protocol';
import type {FigureAppearance,TableCard,TableDocument} from '../../table/foundation/contracts';
import type {CommandSpec} from '../../table/presentation';
import {projectMighty} from './presentation';
import {biddingDecision} from './bidding';
import {friendDecision} from './friendDecision';
import {cardKey,sealOf,cardLabel,deckSize,kittyCount} from './cards';
import {createMightyInformation} from './information';
import {projectMightyHistory} from './history';
import {sessionPreparation} from '../../room/sessionCore';
import type {Action,Card,Mighty,CurrentRoomView as RoomView,StateMsg} from './types';
import type {ConnectedCommandClient,ConnectedProjectionClient,ConnectedProjectionHistory} from '../../table/foundation/connected';
export type RoomCommand={kind:'room';stamp:string;op:'join'|'bot'|'ready'|'start';seat?:number;name?:string;ready?:boolean};
export type MightyCommand={kind:'game';version:number;seat:number;stamp:string;action:Action}|RoomCommand;
export const roomStamp=(client:Pick<ConnectedProjectionClient<Mighty>,'room'|'seat'|'viewerId'>)=>JSON.stringify([client.room?.id,client.room?.session_id,client.room?.seats,client.room?.ready,client.room?.in_hand,client.room?.showing,client.room?.hands_played,client.room?.participant_ids,client.seat,client.viewerId]);
const name=(room:RoomView,seat:number)=>{const person=room.seats[seat];return person&&person.kind!=='empty'?person.name:`${seat+1}번 자리`;};
/** Completed-hand records identify the outgoing hand; redeals are distinct scopes. */
export function mightyGeneration(room:RoomView,state:StateMsg|null,previousGeneration?:string):string{
    const done=room.showing&&!room.in_hand&&!!room.current_hand||room.showing&&state&&typeof state.view.phase==='object'&&'Done' in state.view.phase;
    const hand=done?room.current_hand?.number!==undefined?room.current_hand.number-1:Math.max(0,room.hands_played-1):room.hands_played;
    let redeals=room.showing?state?.view.redealt?.count??0:0,stamp:number|undefined;
    // The server clears its public redeal notice after bidding. Preserve the
    // observed public epoch in the canonical session context, not a UI store.
    if(room.showing&&previousGeneration){try{const previous=JSON.parse(previousGeneration);if(Array.isArray(previous)&&previous[0]===hand&&Number.isSafeInteger(previous[1])&&previous[1]>=0)redeals=Math.max(redeals,previous[1]);if(Array.isArray(previous)&&previous[0]===hand&&Number.isSafeInteger(previous[2])&&previous[2]>0)stamp=previous[2];}catch{/* A fresh or foreign context cannot supply an epoch. */}}
    return JSON.stringify([hand,redeals,...(stamp?[stamp]:[])]);
}
/** Only server-authorized state/commands enter the isolated connected root. */
export function mightyDocument(client:ConnectedProjectionClient<Mighty>,revision:number,graceReady=true,previousGeneration?:string,nativeNames=false,motionHistory?:ConnectedProjectionHistory<Mighty>):TableDocument<MightyCommand>|null{
    const room=client.room;if(!room||room.game!=='mighty')return null;
    const state=room.showing?client.game:null,me=client.seat;
    const scope=client.roomScope;
    const origin=room.current_hand&&scope?recordedOrigin(room.current_hand,scope.session_id):null;
    const restored=origin?.status!=='invalid'&&!state&&room.showing&&!room.in_hand&&room.current_hand&&scope?.domain==='room'&&scope.room_id===room.id&&scope.session_id===room.session_id&&scope.actor_id===client.viewerId&&scope.seat===me?projectMightyHistory({identity:{roomId:room.id,roomEpoch:scope.room_epoch,sessionId:origin?.status==='known'?origin.sessionId:scope.session_id,handNumber:room.current_hand.number},record:room.current_hand}):null;
    const history=restored?.status==='available'?restored:null;
    const historicalTeams=new Map(history?.roster.map(person=>[person.participantId,person.team])??[]);
    const authorized=me!==null&&state&&typeof state.view.viewer==='object'&&state.view.viewer.Seat===me;
    const players=room.seats.map((seat,index)=>({id:room.participant_ids?.[index]||`seat-${index}`,seat:index,label:name(room,index),kind:seat.kind==='bot'?'bot' as const:'human' as const}));
    const information=createMightyInformation({room,game:state,seat:me,participantIds:players.map(player=>player.id)},graceReady);
    const active=authorized&&typeof state.turn==='object'&&state.turn.Seat===me&&graceReady;
    const shown=state&&room.showing?projectMighty(state,{viewer:me,players,active:!!active}):null;
    const rawOffer=shown&&room.in_hand?{...shown.offer,actions:shown.offer.actions.filter(spec=>spec.kind==='command'&&!(typeof spec.action==='object'&&'Deal' in spec.action))}:{id:'lobby',actions:[]};
    const gameActions=rawOffer.actions.filter(spec=>spec.kind==='command').map(spec=>({...spec,enabled:spec.enabled&&capacityAllows(room,'can_play'),...(typeof spec.action==='object'&&('Play' in spec.action||'Discard' in spec.action)?{cardIds:[cardKey('Play' in spec.action?spec.action.Play.card:spec.action.Discard)]}:{}),kind:'command' as const,action:{kind:'game' as const,version:state!.version,seat:me!,stamp:roomStamp(client),action:spec.action}}));
    const roomActions:CommandSpec<MightyCommand>[]=[];
    const add=(id:string,label:string,command:Omit<RoomCommand,'kind'|'stamp'>)=>roomActions.push({id,label,intent:command.op==='ready'||command.op==='start'?'primary':'secondary',enabled:command.op!=='start'||capacityAllows(room,'can_start'),kind:'command',action:{kind:'room',stamp:roomStamp(client),...command}});
    if(!room.in_hand){
        const empty=room.seats.findIndex(seat=>seat.kind==='empty');
        if(!nativeNames&&me===null&&empty>=0)add('join','빈자리에 앉기',{op:'join',seat:empty,name:client.viewerName.trim()||'나'});
        if(me!==null&&room.seats[me]?.kind==='human'){
            if(!nativeNames&&empty>=0)add(`bot:${empty}`,'봇 추가',{op:'bot',seat:empty});
            const prep=sessionPreparation(room,me);
            if(!prep.solo&&!(prep.full&&!prep.pending&&prep.allReady))add('ready',prep.mineReady?'준비 취소':room.showing&&room.hands_played?'다음 판 준비':'준비하기',{op:'ready',ready:!prep.mineReady});
            if(prep.full&&!prep.pending&&(prep.solo||prep.allReady))add('start',room.hands_played?'다음 판':'시작',{op:'start'});
        }
    }
    const actions=[...gameActions,...roomActions];
    let decision:TableDocument<MightyCommand>['decision']={kind:'commands',id:'mighty-commands',commands:actions.map(item=>item.id)};
    if(shown&&state&&typeof state.view.phase==='object'&&'Bidding' in state.view.phase&&gameActions.length)decision=biddingDecision(rawOffer,room.rules);
    else if(shown&&state&&typeof state.view.phase==='object'&&'Exchange'in state.view.phase&&gameActions.some(item=>typeof item.action.action==='object'&&'CallFriend'in item.action.action))decision=friendDecision(rawOffer,state.view.hand,room.rules,state.view.phase.Exchange.contract,seat=>name(room,seat));
    else if(authorized&&gameActions.some(item=>typeof item.action.action==='object'&&('Play' in item.action.action||'Discard' in item.action.action))){
        const groups=new Map<string,string[]>();
        for(const spec of gameActions){const action=spec.action.action;if(typeof action==='object'&&('Play' in action||'Discard' in action)){const id=cardKey('Play' in action?action.Play.card:action.Discard);groups.set(id,[...(groups.get(id)??[]),spec.id]);}}
        const variants=[...groups].flatMap(([id,ids])=>ids.map(actionId=>({cardIds:[id],actionId})));
        const selected=new Set(variants.map(item=>item.actionId));
        const exchange=state&&typeof state.view.phase==='object'&&'Exchange'in state.view.phase?state.view.phase.Exchange:null;
        const count=exchange?kittyCount(room.rules)-(exchange.discards?.length??0):0;
        decision={kind:'card-selection',id:exchange?'mighty-discard':'mighty-play',...(exchange?{mode:'count' as const,count}:{mode:'one' as const,disambiguation:'choose-action' as const}),variants,commands:actions.filter(item=>!selected.has(item.id)).map(item=>item.id),submit:exchange?{prefix:'버리기',prompt:'버릴 카드를 고르세요'}:{prefix:'내기'}};
    }
    const exchangePhase=state&&typeof state.view.phase==='object'&&'Exchange'in state.view.phase?state.view.phase.Exchange:null;
    if(exchangePhase&&room.in_hand){
        const contractDecision=exchangeContractDecision(rawOffer,exchangePhase.contract,state!.notes.contracts);
        const cardGroup=decision.kind==='card-selection'&&decision.mode==='count'?(({commands,...group})=>group)(decision):null;
        if(contractDecision||cardGroup){const contractGroup=contractDecision?(({commands,...group})=>group)(contractDecision):null,grouped=new Set(contractGroup?.variants.map(row=>row.actionId)??[]);
            decision={kind:'composition',id:'mighty-exchange',commands:actions.filter(action=>!grouped.has(action.id)&&!cardGroup?.variants.some(row=>row.actionId===action.id)).map(action=>action.id),groups:[...(cardGroup?[cardGroup]:[]),...(contractGroup?[contractGroup]:[])]};
        }
    }
    const phase=state&&room.showing?state.view.phase:null;
    const contract=phase&&typeof phase==='object'?('Bidding' in phase?phase.Bidding.best?.[1]: 'Exchange' in phase?phase.Exchange.contract:'Play' in phase?phase.Play.contract:phase.Done.contract):history?.details.contract??null;
    const appearance=(seat:number):FigureAppearance=>({
        vacant:room.seats[seat]?.kind==='empty',
        bot:room.seats[seat]?.kind==='bot',
        offline:room.seats[seat]?.kind==='human'&&!room.seats[seat].connected,
        thinking:!!state&&typeof state.turn==='object'&&state.turn.Seat===seat,
        team:information.teams[seat]??historicalTeams.get(players[seat].id)??null,
        trumpSuit:contract?.trump??null,
    });
    const paintRaw=(raw:Card):TableCard=>{
        const visual='Normal' in raw?{kind:'standard' as const,suit:raw.Normal[0],rank:raw.Normal[1]}:{kind:'joker' as const,color:raw.Joker};
        const seal=sealOf(raw,room.rules,contract?.trump??null);
        return {id:cardKey(raw),label:cardLabel(raw),visual,...(seal?{emphasis:seal==='mighty'?'special' as const:seal}:{})};
    };
    const paint=(card:NonNullable<typeof shown>['cards'][number]):TableCard=>{
        const visual=card.visual!;
        const raw:Card=visual.kind==='standard'?{Normal:[visual.suit,visual.rank]}:{Joker:visual.color};
        return {...paintRaw(raw),id:card.id,label:card.label};
    };
    const hand=(shown?.cards??[]).filter(card=>card.zoneId==='own-hand'&&card.visual).map(paint);
    const completed=!!history||!!phase&&typeof phase==='object'&&'Done' in phase;
    const historicalPeople=completed&&room.current_hand&&scope?projectMightyHistoricalParticipantStatuses({record:room.current_hand,scope,identity:{roomId:room.id,roomEpoch:scope.room_epoch,sessionId:room.session_id??0,handNumber:room.current_hand.number}}):[];
    const originalPeople=new Map(historicalPeople.map(person=>[person.seat,person])),liveIds=new Set(players.filter(player=>room.seats[player.seat].kind!=='empty').map(player=>player.id));
    const originalOwner=(seat:number)=>{const person=originalPeople.get(seat);return person&&liveIds.has(person.id)?person.id:undefined;};
    const publicPlay=phase&&typeof phase==='object'?('Play' in phase?phase.Play:'Done' in phase?phase.Done:null):null;
    const played=publicPlay&&'plays' in publicPlay?publicPlay.plays.map(play=>({...paintRaw(play.card),label:`${players[play.seat].label} · ${cardLabel(play.card)}`,ownerId:players[play.seat].id})):[];
    const lastTrick=publicPlay?.tricks.at(-1);
    const publicPlays=[...(publicPlay&&'plays' in publicPlay?publicPlay.plays:[]),...(lastTrick?.plays??[])];
    const reveals=publicPlays.flatMap(play=>{const owner=completed?originalOwner(play.seat):players[play.seat].id;return owner&&owner!==(me===null?undefined:players[me].id)?[{participantId:owner,cardId:cardKey(play.card)}]:[];});
    const capturedCards=(lastTrick?.plays??[]).map(play=>{const card=paintRaw(play.card);if(!completed)return {...card,ownerId:players[play.seat].id};const person=originalPeople.get(play.seat),owner=originalOwner(play.seat);return {...card,label:`${person?.name??'이전 참가자'} · ${card.label}`,...(owner?{ownerId:owner}:{})};});
    const capturedLabel=lastTrick?`직전 트릭 · ${completed?originalPeople.get(lastTrick.winner)?.name??'이전 참가자':name(room,lastTrick.winner)}`:'직전 트릭';
    // Capture ownership is a public game fact, distinct from each played
    // card's provenance. Never retarget a historical winner to a new occupant.
    const collectedBy=lastTrick?(completed?originalOwner(lastTrick.winner):players[lastTrick.winner]?.id):undefined;
    const resultName=(index:number)=>room.current_hand&&room.current_hand.participant_ids[index]!==room.participant_ids?.[index]
        ? room.current_hand.names[index]||'이전 참가자' : name(room,index);
    const facts=phase&&typeof phase==='object'&&'Done' in phase?[{id:'result',label:'이번 판',value:phase.Done.payoffs.map((value,index)=>`${resultName(index)} ${value>=0?'+':''}${value}`).join(' · '),subject:'table' as const,essential:true}]:[];
    const transition=motionHistory?createMightyMotionTransition({client,...motionHistory,previousGeneration}):undefined;
    const generation=transition?.generation??mightyGeneration(room,state,previousGeneration);
    const kitty=kittyCount(room.rules);
    const bidding=phase&&typeof phase==='object'&&'Bidding' in phase;
    const exchange=phase&&typeof phase==='object'&&'Exchange' in phase?phase.Exchange:null;
    const returned=exchange?Math.max(0,Math.min(kitty,room.rules.hand_size+kitty-(state?.view.hand_sizes[exchange.declarer]??room.rules.hand_size+kitty))):publicPlay?kitty:0;
    const stockCount=completed?kitty:!phase||phase==='Dealing'?deckSize(room.rules):bidding?kitty:returned;
    const declarer=exchange?.declarer??publicPlay?.declarer;
    const stockReturn=!completed&&returned>0&&declarer!==undefined&&(me===null||authorized)?{destination:'stock',source:me===declarer?{kind:'hand' as const}:{kind:'participant' as const,id:players[declarer].id}}:undefined;
    const deals=me!==null&&!authorized?[]:bidding?[{id:`initial:${generation}`,source:'stock',cardIds:[],handCount:me===null?0:room.rules.hand_size,recipients:players.filter(player=>player.seat!==me).map(player=>({participantId:player.id,count:room.rules.hand_size}))}]
        :exchange&&kitty>0&&returned===0?[{id:`kitty:${generation}`,source:'stock',cardIds:[],handCount:me===exchange.declarer?kitty:0,recipients:me===exchange.declarer?[]:[{participantId:players[exchange.declarer].id,count:kitty}]}]:[];
    const bottom=me??0,otherSeats=Array.from({length:room.seats.length-(me===null?0:1)},(_,i)=>(bottom+i+1)%room.seats.length);
    const historicalStatuses=completed?new Map(historicalPeople.map(person=>[person.id,person.status])):null;
    const statuses=room.seats.map((_,seat)=>historicalStatuses?historicalStatuses.get(players[seat].id):projectMightyParticipantStatus(state,seat));
    const statusPresentation=projectMightyStatusPresentation(information.information,phase);
    return {presentation:phase&&typeof phase==='object'&&'Play'in phase?{...mightyPlayPresentation(room.rules),tableCollectionIds:['trick']}:exchangePhase&&(state?.view.hand_sizes[exchangePhase.declarer]??0)>room.rules.hand_size?mightyExchangePresentation(room.rules,(state!.view.hand_sizes[exchangePhase.declarer]-room.rules.hand_size),!exchangePhase.trump_changed&&state!.view.hand_sizes[exchangePhase.declarer]===room.rules.hand_size+kittyCount(room.rules),players[exchangePhase.declarer]?.id):bidding?{...mightyBiddingPresentation(room.rules),tableCollectionIds:[]}:{id:'mighty-table',schemaVersion:1,tableCollectionIds:[]},stage:!room.in_hand&&!room.showing?'waiting':'active',context:{session:`mighty:${room.id}:${room.session_id??0}`,audience:`${client.viewerId??'observer'}:${me??'watch'}`,generation,revision:String(revision)},
        information:information.information,scoreboard:information.scoreboard,...(statusPresentation?{statusPresentation}:{}),
        participant:{role:me===null?'observer':'player',id:me===null?'observer':players[me].id,name:me===null?(client.viewerName||'관전자'):players[me].label,markers:[],...(me===null?{}:{appearance:appearance(me),...(statuses[me]?{status:statuses[me]}:{})})},hand,
        opponents:otherSeats.map(seat=>({id:players[seat].id,name:players[seat].label,appearance:appearance(seat),handCount:state&&room.showing?state.view.hand_sizes[seat]??0:0,...(statuses[seat]?{status:statuses[seat]}:{})})),
        ...(transition?.recycle?{recycle:transition.recycle}:{}),deals,stockReturn,collections:[{id:'stock',...(!phase?{kind:'deck' as const}:{}),label:!phase?'덱':'키티',purpose:'stock' as const,...(bidding||publicPlay||completed?{relevance:'auxiliary' as const}:{}),cards:[],hiddenCount:stockCount},{id:'trick',kind:'trick',label:'현재 트릭',purpose:'play',cards:played},...(publicPlay?[{id:'captured',label:capturedLabel,purpose:'captured' as const,...(collectedBy?{collectedBy}:{}),cards:capturedCards}]:[])],reveals,facts,decision,offer:{id:JSON.stringify(room.in_hand&&state?['live-game',room.id,room.session_id,room.hands_played,client.viewerId,me,state.version]:['live-room',roomStamp(client)]),actions}};
}
export type PreparedMightyCommand={kind:'game';action:Action}|{kind:'room';action:Extract<RoomAction,{type:'join'|'add_bot'|'ready'|'start'}>};
/** Pure final semantic fence. Only the host's scoped capabilities may execute it. */
export function prepareMightyCommand(client:ConnectedCommandClient<Mighty>,command:MightyCommand):PreparedMightyCommand|null{
    if(client.status!=='open'||!client.room)return null;
    if(command.kind==='game'){
        const state=client.game;if(command.stamp!==roomStamp(client)||!client.room.in_hand||!state||state.version!==command.version||client.seat!==command.seat||typeof state.view.viewer!=='object'||state.view.viewer.Seat!==command.seat)return null;
        if(!capacityAllows(client.room,'can_play')||!policyAllowsAction(state,command.action,typeof state.turn==='object'&&state.turn.Seat===command.seat))return null;
        return {kind:'game',action:command.action};
    }
    if(roomStamp(client)!==command.stamp)return null;
    if(command.op==='join')return {kind:'room',action:{type:'join',name:command.name!,seat:command.seat??null,device:null}};
    if(command.op==='bot')return {kind:'room',action:{type:'add_bot',seat:command.seat!,level:'easy'}};
    if(command.op==='ready')return {kind:'room',action:{type:'ready',ready:!!command.ready}};
    return capacityAllows(client.room,'can_start')?{kind:'room',action:{type:'start'}}:null;
}
/** Legacy compatibility. The connected engine adapter uses prepare, never this fallback. */
export function sendMightyCommand(client:TableClient<Mighty>,command:MightyCommand,submitGame?:(action:Action)=>boolean,submitRoom?:(action:RoomAction)=>boolean):boolean{
    const candidate=prepareMightyCommand(client,command);if(!candidate)return false;
    if(candidate.kind==='game'){
        if(submitGame)return submitGame(candidate.action);
        client.act(candidate.action);return true;
    }
    if(submitRoom)return submitRoom(candidate.action);
    const action=candidate.action;
    if(action.type==='join')client.join(action.name,action.seat??undefined);
    else if(action.type==='add_bot')client.addBot(action.seat,action.level);
    else if(action.type==='ready')client.ready(action.ready);
    else client.start();
    return true;
}
