import {projectPokerParticipantStatus,projectPokerStatusPresentation} from './participantStatus';
import {readActionPolicy,policyAllowsAction} from '../../room/actionPolicy';
import {capacityAllows,capacityAllowsRoomAction} from '../../room/capacity';
import type {PokerAction,PokerCard,PokerSuit} from '../../generated/protocol';
import type {RoomActionOf} from '../../room/types';
import {sessionPreparation} from '../../room/sessionCore';
import type {ConnectedCommandClient,ConnectedProjectionClient} from '../../table/foundation/connected';
import type {FigureAppearance,InformationPanel,InformationValue,TableCard,TableDocument} from '../../table/foundation/contracts';
import type {CommandSpec} from '../../table/presentation';
import type {Poker,CurrentRoomView as RoomView,StateMsg} from './types';

export type PokerRoomCommand={kind:'room';stamp:string;action:RoomActionOf<Poker['settings']>};
export type PokerCommand={kind:'game';version:number;seat:number;stamp:string;action:PokerAction}|PokerRoomCommand;
const suits:Record<PokerSuit,'Club'|'Diamond'|'Heart'|'Spade'>={clubs:'Club',diamonds:'Diamond',hearts:'Heart',spades:'Spade'};
const suitLabels:Record<PokerSuit,string>={clubs:'클로버',diamonds:'다이아몬드',hearts:'하트',spades:'스페이드'};
const streets={preflop:'프리플롭',flop:'플롭',turn:'턴',river:'리버'};
const text=(value:string):InformationValue=>({kind:'text',text:value});
const number=(value:number):InformationValue=>({kind:'number',value});
export const pokerRoomStamp=(client:ConnectedProjectionClient<Poker>)=>JSON.stringify([client.room?.id,client.room?.session_id,client.room?.seats,client.room?.ready,client.room?.in_hand,client.room?.showing,client.room?.hands_played,client.room?.participant_ids,client.seat,client.viewerId]);
/** A new settled occupant receives the explicitly public projection, never
 * the previous occupant's seat packet. Public settlement grants no command. */
export const pokerViewerMatches=(game:StateMsg,seat:number|null)=>game.view.viewer===seat||game.view.viewer===null&&game.view.over&&game.turn==='Over'&&!game.legal.length&&!game.out_of_turn.length&&game.view.players.every(player=>!player.hole||player.shown);
export function pokerGeneration(room:RoomView,game:StateMsg|null):string{
    return String(room.showing&&(!room.in_hand&&!!room.current_hand||game?.view.over)?(room.current_hand?.number!==undefined?room.current_hand.number-1:Math.max(0,room.hands_played-1)):room.hands_played);
}
const paint=(card:PokerCard,ownerId?:string):TableCard=>({id:`poker:${card.suit}:${card.rank}`,label:`${suitLabels[card.suit]} ${card.rank}`,visual:{kind:'standard',rank:card.rank,suit:suits[card.suit]},...(ownerId?{ownerId}:{})});
const actionId=(action:PokerAction)=>action.type==='raise_to'?`poker:raise:${action.amount}`:`poker:${action.type}`;
const actionLabel=(action:PokerAction,game:StateMsg)=>action.type==='raise_to'?`레이즈 총 ${action.amount}`:action.type==='call'?`콜 ${game.notes.to_call}`:action.type==='check'?'체크':action.type==='fold'?'폴드':action.type==='all_in'?'올인':'공개';

/** Projection consumes authorized wire state, never raw deck or client-calculated legality. */
export function pokerDocument(client:ConnectedProjectionClient<Poker>,revision:number,graceReady=true,nativeNames=false):TableDocument<PokerCommand>|null{
    const room=client.room;if(!room||room.game!=='poker')return null;
    const me=client.seat;
    const state=room.showing?client.game:null;
    // An old seat-specific packet must never be repurposed as an observer view.
    if(state&&!pokerViewerMatches(state,me))return null;
    const view=state?.view;
    const stamp=pokerRoomStamp(client);
    const players=room.seats.map((person,index)=>({id:room.participant_ids?.[index]||`seat:${index}`,name:person.kind==='empty'?`${index+1}번 자리`:person.name}));
    const appearance=(index:number):FigureAppearance=>({vacant:room.seats[index].kind==='empty',bot:room.seats[index].kind==='bot',offline:room.seats[index].kind==='human'&&!room.seats[index].connected,thinking:!!state&&typeof state.turn==='object'&&state.turn.Seat===index});
    const actions:CommandSpec<PokerCommand>[]=[];
    if(room.in_hand&&state&&me!==null){
        const onTurn=typeof state.turn==='object'&&state.turn.Seat===me;
        const policy=readActionPolicy(state),available=new Set((onTurn?[...policy.legal,...policy.out_of_turn]:policy.out_of_turn).map(action=>JSON.stringify(action)));
        const legal=onTurn?[...state.legal,...state.out_of_turn]:state.out_of_turn;
        for(const action of legal){
            if(action.type==='deal'||action.type==='reveal'||actions.some(item=>item.id===actionId(action)))continue;
            actions.push({id:actionId(action),label:actionLabel(action,state),kind:'command',intent:action.type==='fold'?'quiet':action.type==='raise_to'||action.type==='all_in'?'primary':'secondary',enabled:graceReady&&capacityAllows(room,'can_play')&&available.has(JSON.stringify(action)),action:{kind:'game',version:state.version,seat:me,stamp,action}});
        }
    }
    const roomAction=(id:string,label:string,action:RoomActionOf<Poker['settings']>)=>actions.push({id,label,kind:'command',intent:'secondary',enabled:capacityAllowsRoomAction(room,action),action:{kind:'room',stamp,action}});
    if(!room.in_hand){
        const empty=room.seats.findIndex(person=>person.kind==='empty');
        if(!nativeNames&&me===null&&empty>=0)roomAction('join','빈자리에 앉기',{type:'join',name:client.viewerName.trim()||'나',seat:empty,device:null});
        if(me!==null&&room.seats[me]?.kind==='human'){
            if(!nativeNames&&empty>=0)roomAction(`bot:${empty}`,'봇 추가',{type:'add_bot',seat:empty,level:'easy'});
            const prep=sessionPreparation(room,me);
            if(!prep.solo)roomAction('ready',prep.mineReady?'준비 취소':'준비하기',{type:'ready',ready:!prep.mineReady});
            if(prep.full&&!prep.pending&&(prep.solo||prep.allReady))roomAction('start',room.hands_played?'새 독립 판':'시작',{type:'start'});
        }
    }
    const raises=actions.filter(item=>item.action.kind==='game'&&item.action.action.type==='raise_to');
    let decision:TableDocument<PokerCommand>['decision']={kind:'commands',id:'poker:commands',commands:actions.map(action=>action.id)};
    if(raises.length){
        const amounts=raises.map(item=>item.action.kind==='game'&&item.action.action.type==='raise_to'?String(item.action.action.amount):'');
        decision={kind:'finite-choice',id:'poker:raise',commands:actions.filter(action=>!raises.includes(action)).map(action=>action.id),fields:[{id:'amount',label:'레이즈 후 이번 스트리트 총액',options:amounts.map(amount=>({id:amount,label:amount,enabled:true}))}],variants:raises.map((action,index)=>({tuple:{amount:amounts[index]},actionId:action.id})),initialValues:{amount:amounts[0]},reconciliation:'preserve-compatible',submit:{unavailable:'disabled',presentationLabel:{prefix:'확정'}}};
    }
    const match=(index:number)=>!view?.over||!!room.current_hand&&room.current_hand.participant_ids[index]===room.participant_ids?.[index];
    const resultName=(index:number)=>view?.over?room.current_hand?.names[index]||`이전 참가자 ${index+1}`:players[index]?.name??`${index+1}번 자리`;
    const fields:InformationPanel['fields'][number][]=[{id:'policy',label:'방식',value:text('독립 판 · 플레이 칩 · 매 판 시작 칩 초기화')}];
    if(view){
        fields.push({id:'street',label:'스트리트',value:text(streets[view.street])},{id:'dealer',label:'딜러 버튼',value:text(resultName(view.dealer))},{id:'current-bet',label:'현재 총 베팅',value:number(view.current_bet)});
        for(const person of view.players)fields.push({id:`chips:${person.seat}`,label:resultName(person.seat),value:{kind:'inline',values:[{kind:'number',value:person.stack},{kind:'text',text:'남음 · 판 기여'},{kind:'number',value:person.contributed},{kind:'text',text:`· 스트리트 ${person.street_bet}${person.folded?' · 폴드':''}${person.all_in?' · 올인':''}`}]}});
        if(view.over){
            for(const [index,pot] of view.pots.entries())fields.push({id:`award:${index}`,label:index?'사이드 팟 '+index:'메인 팟',value:text(`${pot.amount} · ${pot.winners.map(resultName).join(' / ')}`)});
            for(const [index,refund] of view.refunds.entries())if(refund)fields.push({id:`refund:${index}`,label:'반환',value:text(`${resultName(index)} ${refund}`)});
        }
    }
    const start=me??0;
    const others=Array.from({length:players.length-(me===null?0:1)},(_,offset)=>(start+offset+1)%players.length);
    // Occupying a seat does not inherit that seat's private finished cards.
    // This also scrubs an older seat packet paired with replacement metadata.
    const ownAuthorized=me!==null&&view?.viewer===me&&(!view.over||!!room.current_hand&&room.current_hand.participant_ids[me]===client.viewerId&&room.participant_ids?.[me]===client.viewerId);
    const own=ownAuthorized?view?.players.find(player=>player.seat===me):undefined;
    const publicOwner=(seat:number)=>{const id=view?.over?room.current_hand?.participant_ids[seat]:players[seat]?.id;return id&&players.some((player,index)=>room.seats[index].kind!=='empty'&&player.id===id)?id:undefined;};
    const collections:NonNullable<TableDocument<PokerCommand>['collections']>=[{id:'poker:board',label:'커뮤니티 카드',purpose:'play',cards:(view?.board??[]).map(card=>paint(card))},...(view?.players??[]).filter(player=>(player.seat!==me||!ownAuthorized)&&player.shown&&player.hole).map(player=>({id:`poker:shown:${player.seat}`,label:`${resultName(player.seat)} · 공개한 홀 카드`,cards:player.hole!.map(card=>paint(card,publicOwner(player.seat)))}))];
    const information:InformationPanel[]=[{id:'poker:status',title:'상황판',summary:{text:!view?'참가자를 기다려요':view.over?'판 종료':me!==null&&view.actor===me?'내 차례':view.actor!==null?`${resultName(view.actor)} 차례`:'카드 공개 중',tone:view&&!view.over&&me!==null&&view.actor===me?'accent':'muted'},...(view?{primary:{label:'팟',value:number(view.pot)}}:{}),fields:fields.slice(0,12)},...Array.from({length:Math.ceil(Math.max(0,fields.length-12)/12)},(_,index)=>({id:`poker:details:${index}`,title:'팟과 반환 상세',fields:fields.slice(12+index*12,24+index*12)}))];
    const statuses=room.seats.map((_,seat)=>projectPokerParticipantStatus(state,seat));
    const statusPresentation=projectPokerStatusPresentation(information,view??null);
    return {stage:!room.in_hand&&!room.showing?'waiting':'active',context:{session:`poker:${room.id}:${room.session_id??0}`,audience:`${client.viewerId??'observer'}:${me??'watch'}`,generation:pokerGeneration(room,state),revision:String(revision)},
        participant:{role:me===null?'observer':'player',id:me===null?'observer':players[me].id,name:me===null?(client.viewerName||'관전자'):players[me].name,markers:[],...(me===null?{}:{appearance:appearance(me),...(statuses[me]?{status:statuses[me]}:{})})},
        hand:me!==null?(own?.hole??[]).map(card=>paint(card)):[],
        opponents:others.map(index=>({id:players[index].id,name:players[index].name,appearance:appearance(index),handCount:view?.players.find(player=>player.seat===index)?.hole_count??0,...(statuses[index]?{status:statuses[index]}:{})})),collections,
        information,...(statusPresentation?{statusPresentation}:{}),
        scoreboard:{id:'poker:scores',title:'점수판',disclosure:{openLabel:'점수판 보기',closeLabel:'점수판 닫기'},columns:[{id:'hand',label:'이번 판'},{id:'total',label:'누적'}],rows:players.map((player,index)=>({participantId:player.id,values:[match(index)?view?.payoffs?.[index]??null:null,room.seats[index].kind==='empty'?null:room.scores[index]??0]}))},
        facts:view?.payoffs?[{id:'poker:result',label:'이번 판 결과',value:view.payoffs.map((value,index)=>`${resultName(index)} ${value>=0?'+':''}${value}`).join(' · '),subject:'table',essential:true}]:[],decision,
        offer:{id:JSON.stringify(room.in_hand&&state?['poker:game',room.id,room.session_id,room.hands_played,client.viewerId,me,state.version]:['poker:room',stamp]),actions}};
}

/** Transport receives exact currently offered payloads through shared single-use callbacks. */
export function sendPokerCommand(client:ConnectedCommandClient<Poker>,command:PokerCommand,submitGame:(action:PokerAction)=>boolean,submitRoom:(action:RoomActionOf<Poker['settings']>)=>boolean):boolean{
    if(client.status!=='open'||!client.room||client.room.game!=='poker'||command.stamp!==pokerRoomStamp(client))return false;
    if(command.kind==='game'){
        const state=client.game;
        if(!client.room.in_hand||!state||state.version!==command.version||client.seat!==command.seat||!pokerViewerMatches(state,command.seat)||command.action.type==='deal'||command.action.type==='reveal')return false;
        const onTurn=typeof state.turn==='object'&&state.turn.Seat===command.seat;
        if(!capacityAllows(client.room,'can_play')||!policyAllowsAction(state,command.action,onTurn))return false;
        return submitGame(command.action);
    }
    const current=pokerDocument(client,0);
    if(!current?.offer.actions.some(action=>action.enabled&&action.kind==='command'&&action.action.kind==='room'&&JSON.stringify(action.action.action)===JSON.stringify(command.action)))return false;
    return submitRoom(command.action);
}
