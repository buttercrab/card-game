import {expect,test,vi} from 'vitest';
import {createCardSession} from '../../table/foundation/session';
import {validateTableDecision} from '../../table/foundation/decisions';
import {DecisionController} from '../../table/decision';
import {CATALOG} from '../../catalog';
import type {TableClient} from '../../room/tableClient';
import type {PokerStreet} from '../../generated/protocol';
import type {Poker,RoomView,StateMsg} from './types';
import {pokerDocument,pokerGeneration,pokerViewerMatches,sendPokerCommand,type PokerCommand} from './foundation';

const room=():RoomView=>({id:'holdem',game:'poker',protocol:CATALOG.protocol,settings:{rules:{players:3,starting_stack:200}},rules:{players:3,starting_stack:200},customized:false,seats:[{kind:'human',name:'재용',connected:true,away:false},{kind:'bot',name:'보리',level:'easy'},{kind:'bot',name:'호두',level:'easy'}],in_hand:true,showing:true,table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:0,observers:[],ready:[true,true,true],participant_ids:['p0','p1','p2'],participation:[],scores:[10,-5,-5],hands_played:0,history:[],hands:[]});
const state=():StateMsg=>({version:7,grace_ms:0,turn:{Seat:0},legal:[{type:'fold'},{type:'call'},...Array.from({length:197},(_,index)=>({type:'raise_to' as const,amount:index+4})),{type:'all_in'}],out_of_turn:[],notes:{to_call:2,min_raise_to:4,independent_hand:true},view:{viewer:0,dealer:2,street:'preflop',actor:0,board:[],players:Array.from({length:3},(_,seat)=>({seat,stack:200-seat,contributed:seat,street_bet:seat,folded:false,all_in:false,hole_count:2,hole:seat===0?[{rank:14,suit:'spades'},{rank:13,suit:'hearts'}]:null,shown:false})),pot:3,current_bet:2,min_raise_to:4,showdown:false,over:false,pots:[],refunds:[0,0,0],payoffs:null}});
const client=()=>({room:room(),game:state(),seat:0,viewerId:'p0',viewerName:'재용',status:'open',act:vi.fn(),join:vi.fn(),start:vi.fn()} as unknown as TableClient<Poker>);
test('native capacity fences gameplay and disabled Start through projection and final dispatch',()=>{
 const c=client(),game=vi.fn(()=>true),room=vi.fn(()=>true),command=pokerDocument(c,1)!.offer.actions[0];if(command.kind!=='command')throw Error('command');
 c.room!.capacity={can_start:false,can_archive:false,can_play:false,reason:{code:'invariant'}};
 expect(pokerDocument(c,2)!.offer.actions.every(action=>!action.enabled)).toBe(true);expect(sendPokerCommand(c,command.action,game,room)).toBe(false);
 c.room!.in_hand=false;c.room!.showing=false;const start=pokerDocument(c,3)!.offer.actions.find(action=>action.id==='start')!;expect(start.enabled).toBe(false);if(start.kind!=='command')throw Error('start');expect(sendPokerCommand(c,start.action,game,room)).toBe(false);expect(room).not.toHaveBeenCalled();
});
test('policy subset preserves exact rule raises but prevents disabled and stale-policy dispatch',()=>{
 const c=client(),before=pokerDocument(c,1)!,fold=before.offer.actions.find(action=>action.kind==='command'&&action.action.kind==='game'&&action.action.action.type==='fold')!;
 if(fold.kind!=='command')throw Error('command');
 Object.assign(c.game!,{policy_actions:{legal:[c.game!.legal[1],c.game!.legal[2]],out_of_turn:[]}});
 const doc=pokerDocument(c,2)!;expect(doc.offer.actions.filter(action=>action.enabled)).toHaveLength(2);expect(c.game!.legal).toHaveLength(200);
 const game=vi.fn(()=>true),room=vi.fn(()=>true);expect(sendPokerCommand(c,fold.action,game,room)).toBe(false);expect(game).not.toHaveBeenCalled();
 const session=createCardSession({transport:game});session.receive(doc);expect(validateTableDecision(doc)).toEqual([]);session.dispose();
});

test('entire exact legal raise domain survives projection, finite binding and dispatch',()=>{
    const c=client(),doc=pokerDocument(c,1)!;
    expect(validateTableDecision(doc)).toEqual([]);
    expect(doc.offer.actions.map(action=>action.kind==='command'&&action.action.kind==='game'?action.action.action:null)).toEqual(c.game!.legal);
    expect(doc.decision.kind).toBe('finite-choice');
    if(doc.decision.kind!=='finite-choice')throw new Error('Finite decision required');
    expect(doc.decision.fields[0].options).toHaveLength(197);
    const controller=new DecisionController<PokerCommand>(()=>{}),handle=controller.bind(doc.decision,doc.offer,'player');
    for(const amount of [4,37,199,200]){
        expect(controller.choose(handle,'amount',String(amount))).toBe(true);
        expect(controller.snapshot(handle)?.selected?.action).toMatchObject({kind:'game',action:{type:'raise_to',amount}});
    }
    expect(controller.choose(handle,'amount','201')).toBe(false);
    expect(doc.decision.commands).toContain('poker:all_in');
    expect(doc.offer.actions.find(action=>action.id==='poker:all_in')).toMatchObject({action:{action:{type:'all_in'}}});
});

test.each<PokerStreet>(['preflop','flop','turn','river'])('%s document enters canonical session and admits exact offered payload',async street=>{
    const c=client();c.game!.view.street=street;
    c.game!.view.board=Array.from({length:street==='preflop'?0:street==='flop'?3:street==='turn'?4:5},(_,index)=>({rank:index+2,suit:'clubs'}));
    const transport=vi.fn(),session=createCardSession<PokerCommand>({transport});
    session.receive(pokerDocument(c,1)!);
    const doc=session.snapshot().document!;
    expect(doc).not.toBeNull();expect(doc.collections![0].cards).toHaveLength(c.game!.view.board.length);
    const action=doc.offer.actions.find(action=>action.id==='poker:raise:37');
    if(action?.kind!=='command')throw new Error('Expected command');
    expect(session.admit(doc.context,doc.offer.id,action.id,action.action)).toBe(true);
    await Promise.resolve();expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0].action.action).toEqual({type:'raise_to',amount:37});session.dispose();
});

test('projection never serializes unshown opponent holes; observer private data is absent',()=>{
    const c=client();c.game!.view.players[1].hole=[{rank:9,suit:'diamonds'},{rank:8,suit:'diamonds'}];
    const doc=pokerDocument(c,1)!;expect(doc.hand).toHaveLength(2);expect(JSON.stringify(doc)).not.toContain('poker:diamonds:9');
    expect(doc.opponents!.map(person=>person.handCount)).toEqual([2,2]);
    Object.assign(c,{seat:null,viewerId:'watcher'});expect(pokerDocument(c,2)).toBeNull();
    c.game!.view.viewer=null;c.game!.view.players[0].shown=false;
    const observer=pokerDocument(c,3)!;expect(observer.hand).toEqual([]);expect(observer.offer.actions).toEqual([]);expect(observer.participant.role).toBe('observer');
    expect(JSON.stringify(observer)).not.toContain('poker:spades:14');
    c.game!.view.players[1].shown=true;
    const shown=pokerDocument(c,4)!;expect(shown.collections!.find(group=>group.id==='poker:shown:1')?.cards).toHaveLength(2);
    const session=createCardSession<PokerCommand>({transport:()=>{}});session.receive(shown);expect(session.snapshot().document).not.toBeNull();session.dispose();
});

test('lobby join/bot/start use shared preparation semantics and canonical admission',()=>{
    const c=client();c.room!.in_hand=false;c.room!.showing=false;c.room!.seats[2]={kind:'empty'};
    let doc=pokerDocument(c,1)!;expect(doc.offer.actions.map(action=>action.id)).toContain('bot:2');expect(doc.offer.actions.map(action=>action.id)).not.toContain('start');
    const session=createCardSession<PokerCommand>({transport:()=>{}});session.receive(doc);expect(session.snapshot().document).not.toBeNull();
    const lobby=session.snapshot().document!,bot=lobby.offer.actions.find(action=>action.id==='bot:2');if(bot?.kind!=='command')throw new Error('Bot command');
    expect(session.admit(lobby.context,lobby.offer.id,bot.id,bot.action)).toBe(true);session.dispose();
    Object.assign(c,{seat:null,viewerId:'watcher'});doc=pokerDocument(c,2)!;expect(doc.offer.actions.map(action=>action.id)).toEqual(['join']);expect(doc.hand).toEqual([]);
    Object.assign(c,{seat:0,viewerId:'p0'});c.room!.seats[2]={kind:'bot',name:'호두',level:'easy'};doc=pokerDocument(c,3)!;expect(doc.offer.actions.map(action=>action.id)).toEqual(['start']);
    const submitRoom=vi.fn(()=>true),command=doc.offer.actions[0];if(command.kind!=='command')throw new Error('Command');
    expect(sendPokerCommand(c,command.action,vi.fn(),submitRoom)).toBe(true);expect(submitRoom).toHaveBeenCalledWith({type:'start'});
    c.room!.participation=[{id:'pending',seat:1,target_id:'p1',name:'대기',order:1,offered_by:null}];expect(sendPokerCommand(c,command.action,vi.fn(),submitRoom)).toBe(false);
});

test('final transport fence rejects changed version, payload, audience, hand, turn and disconnected state',()=>{
    const c=client(),doc=pokerDocument(c,1)!,binding=doc.offer.actions.find(action=>action.id==='poker:raise:37')!;
    if(binding.kind!=='command'||binding.action.kind!=='game')throw new Error('Game command');
    const command=binding.action,send=vi.fn(()=>true),roomSend=vi.fn();
    expect(sendPokerCommand(c,command,send,roomSend)).toBe(true);expect(send).toHaveBeenCalledWith({type:'raise_to',amount:37});
    expect(sendPokerCommand(c,{...command,version:6},send,roomSend)).toBe(false);
    expect(sendPokerCommand(c,{...command,action:{type:'raise_to',amount:201}},send,roomSend)).toBe(false);
    c.game!.turn={Seat:1};expect(sendPokerCommand(c,command,send,roomSend)).toBe(false);c.game!.turn={Seat:0};
    Object.assign(c,{viewerId:'changed'});expect(sendPokerCommand(c,command,send,roomSend)).toBe(false);Object.assign(c,{viewerId:'p0'});
    c.room!.hands_played++;expect(sendPokerCommand(c,command,send,roomSend)).toBe(false);c.room!.hands_played--;
    Object.assign(c,{status:'closed'});expect(sendPokerCommand(c,command,send,roomSend)).toBe(false);
    expect(c.act).not.toHaveBeenCalled();
});

test('status and settlement remain structured exact public information with hand-relative scope',()=>{
    const c=client();c.game!.view.over=true;c.game!.view.actor=null;c.game!.turn='Over';c.game!.legal=[];
    c.game!.view.payoffs=[15,-10,-5];c.game!.view.pots=[{amount:30,winners:[0]},{amount:11,winners:[0,1]}];c.game!.view.refunds=[3,0,0];c.game!.view.players[1].folded=true;c.game!.view.players[2].all_in=true;
    c.room!.hands_played=1;c.room!.in_hand=false;
    c.room!.current_hand={number:1,names:['재용','보리','호두'],participant_ids:['p0','p1','p2'],payoffs:[15,-10,-5],rules:c.room!.rules,view:{...c.game!.view,viewer:null}};
    const doc=pokerDocument(c,2)!;expect(pokerGeneration(c.room!,c.game!)).toBe('0');
    expect(doc.scoreboard!.rows[0].values).toEqual([15,10]);
    expect(doc.information![0].fields.find(field=>field.id==='award:1')!.value).toEqual({kind:'text',text:'11 · 재용 / 보리'});
    expect(doc.information![0].fields.find(field=>field.id==='refund:0')!.value).toEqual({kind:'text',text:'재용 3'});
    expect(doc.facts[0].value).toContain('재용 +15');
    const session=createCardSession<PokerCommand>({transport:()=>{}});session.receive(doc);expect(session.snapshot().document).not.toBeNull();session.dispose();
});

test('chance-only actions are never exposed as commands and grace disables the full action offer',()=>{
    const c=client();c.game!.legal.push({type:'deal',deck:[1,2,3]},{type:'reveal'});
    const doc=pokerDocument(c,1,false)!;
    expect(doc.offer.actions.every(action=>!action.enabled)).toBe(true);
    expect(doc.offer.actions.some(action=>action.id==='poker:deal'||action.id==='poker:reveal')).toBe(false);
    const send=vi.fn(()=>true);const action=doc.offer.actions[0];if(action.kind!=='command'||action.action.kind!=='game')throw new Error('Game');
    expect(sendPokerCommand(c,{...action.action,action:{type:'deal',deck:[]}},send,send)).toBe(false);
});

test.each([3,6])('%i-seat documents satisfy canonical information bounds across every street, all-in and maximal settlement detail',count=>{
    const c=client();
    c.room!.rules.players=count;c.room!.settings.rules.players=count;
    c.room!.seats=Array.from({length:count},(_,seat)=>seat===0?{kind:'human' as const,name:'재용',connected:true,away:false}:{kind:'bot' as const,name:`플레이어${seat}`,level:'easy' as const});
    c.room!.participant_ids=Array.from({length:count},(_,seat)=>`p${seat}`);c.room!.scores=Array(count).fill(0);c.room!.ready=Array(count).fill(true);
    c.game!.view.players=Array.from({length:count},(_,seat)=>({...state().view.players[seat%3],seat,hole:seat===0?state().view.players[0].hole:null}));
    const session=createCardSession<PokerCommand>({transport:()=>{}});
    let revision=0;
    for(const street of ['preflop','flop','turn','river'] as const){
        c.game!.view.street=street;c.game!.version++;
        session.receive(pokerDocument(c,++revision)!);expect(session.snapshot().document).not.toBeNull();
    }
    c.game!.view.players.forEach(player=>{player.all_in=true;player.stack=0;});
    c.game!.legal=[];c.game!.turn='Chance';c.game!.view.actor=null;c.game!.version++;
    session.receive(pokerDocument(c,++revision)!);expect(session.snapshot().document!.offer.actions).toEqual([]);
    c.game!.view.over=true;c.game!.view.showdown=true;c.game!.turn='Over';c.game!.version++;
    c.game!.view.pots=Array.from({length:count},(_,index)=>({amount:index+1,winners:[index]}));
    c.game!.view.refunds=Array.from({length:count},(_,index)=>index+1);
    c.game!.view.payoffs=Array(count).fill(0);
    const settled=pokerDocument(c,++revision)!;
    session.receive(settled);expect(session.snapshot().document).not.toBeNull();
    expect(settled.information!.every(panel=>panel.fields.length<=12)).toBe(true);
    expect(settled.information!.flatMap(panel=>panel.fields).filter(field=>field.id.startsWith('award:'))).toHaveLength(count);
    expect(settled.information!.flatMap(panel=>panel.fields).filter(field=>field.id.startsWith('refund:'))).toHaveLength(count);
    session.dispose();
});

test('waiting is explicit public room state and native names remove the first-empty bot shortcut',()=>{
 const c=client();c.room!.in_hand=false;c.room!.showing=false;c.room!.seats[2]={kind:'empty'};c.game!.view.board=[{rank:2,suit:'clubs'}];c.game!.view.players[1].shown=true;c.game!.view.players[1].hole=[{rank:3,suit:'diamonds'}];
 const doc=pokerDocument(c,30,true,true)!;expect(doc.stage).toBe('waiting');expect(doc.hand).toEqual([]);expect(doc.collections!.every(zone=>zone.cards.length===0)).toBe(true);expect(doc.opponents!.every(person=>person.handCount===0)).toBe(true);expect(doc.offer.actions.some(action=>action.id.startsWith('bot:'))).toBe(false);expect(pokerDocument(c,31)!.offer.actions.some(action=>action.id==='bot:2')).toBe(true);expect(c.game!.view.players[0].hole).toHaveLength(2);
 const session=createCardSession<PokerCommand>({transport:()=>{}});session.receive(doc);expect(session.snapshot().document?.stage).toBe('waiting');session.dispose();
});
test('a retained settled public poker hand stays active even with no local hole cards',()=>{
 const c=client();c.room!.in_hand=false;c.room!.showing=true;c.game!.view.over=true;c.game!.view.actor=null;c.game!.turn='Over';c.game!.legal=[];c.game!.view.payoffs=[15,-10,-5];c.game!.view.board=[{rank:2,suit:'clubs'}];c.game!.view.players[0].hole=[];
 const doc=pokerDocument(c,32)!;expect(doc.stage).toBe('active');expect(doc.hand).toEqual([]);expect(doc.collections!.find(zone=>zone.id==='poker:board')!.cards).toHaveLength(1);expect(doc.facts[0].value).toContain('이전 참가자 1 +15');const session=createCardSession<PokerCommand>({transport:()=>{}});session.receive(doc);expect(session.snapshot().document?.stage).toBe('active');session.dispose();
});
test('canonical Poker document wires only explicit public fold/all-in status and existing pot presentation',()=>{
 const c=client();c.game!.view.players[0].folded=true;c.game!.view.players[1].all_in=true;
 const doc=pokerDocument(c,101)!;expect(doc.participant.status).toEqual({value:{kind:'text',text:'폴드'},tone:'muted',muted:true});expect(doc.opponents!.find(person=>person.id==='p1')?.status).toEqual({value:{kind:'text',text:'올인'},tone:'accent'});expect(doc.opponents!.find(person=>person.id==='p2')?.status).toBeUndefined();expect(doc.statusPresentation).toEqual({informationId:'poker:status',fieldIds:['street','current-bet'],primary:true,summary:true});
 const session=createCardSession({transport:vi.fn()});session.receive(doc);expect(session.snapshot().document?.participant.status).toEqual(doc.participant.status);expect(session.snapshot().document?.statusPresentation).toEqual(doc.statusPresentation);session.dispose();
 c.game!.view.over=true;const done=pokerDocument(c,102)!;expect(done.participant.status).toBeUndefined();expect(done.opponents!.every(person=>person.status===undefined)).toBe(true);expect(done.statusPresentation).toBeUndefined();
 c.room!.showing=false;c.room!.in_hand=false;const waiting=pokerDocument(c,103)!;expect(waiting.participant.status).toBeUndefined();expect(waiting.opponents!.every(person=>person.status===undefined)).toBe(true);expect(waiting.statusPresentation).toBeUndefined();
});
test('Poker observer retains explicit public participant status without receiving an own-seat status',()=>{
 const c=client();Object.assign(c,{seat:null});c.game!.view.viewer=null;c.game!.view.players[0].folded=true;c.game!.view.players[1].all_in=true;
 const doc=pokerDocument(c,104)!;expect(doc.participant.role).toBe('observer');expect(doc.participant.status).toBeUndefined();expect(doc.opponents!.find(person=>person.id==='p0')?.status?.muted).toBe(true);expect(doc.opponents!.find(person=>person.id==='p1')?.status?.value).toEqual({kind:'text',text:'올인'});
});

function settledClient(){
 const c=client(),game=c.game!,table=c.room!;game.view.over=true;game.view.actor=null;game.turn='Over';game.legal=[];game.out_of_turn=[];game.view.payoffs=[15,-10,-5];table.in_hand=false;table.hands_played=1;
 const publicView=structuredClone(game.view);publicView.viewer=null;for(const player of publicView.players)player.hole=null;
 table.current_hand={number:1,names:['Original A','Original B','Original C'],participant_ids:['p0','p1','p2'],payoffs:[15,-10,-5],rules:table.rules,view:publicView};return c;
}
test('settled replacement cannot inherit a retained private packet or original public card ownership',()=>{
 const c=settledClient();c.room!.participant_ids![0]='newcomer';c.room!.seats[0]={kind:'human',name:'Newcomer',connected:true,away:false};Object.assign(c,{viewerId:'newcomer'});
 const privateCard=c.game!.view.players[0].hole![0];expect(pokerDocument(c,200)!.hand).toEqual([]);expect(JSON.stringify(pokerDocument(c,200))).not.toContain(`poker:${privateCard.suit}:${privateCard.rank}`);
 c.game!.view.viewer=null;c.game!.view.players[0].hole=null;expect(pokerViewerMatches(c.game!,0)).toBe(true);expect(pokerDocument(c,201)!.hand).toEqual([]);
 c.game!.view.players[0].hole=[privateCard];expect(pokerViewerMatches(c.game!,0)).toBe(false);expect(pokerDocument(c,202)).toBeNull();
 c.game!.view.players[0].shown=true;const shown=pokerDocument(c,203)!;expect(shown.hand).toEqual([]);const publicCards=shown.collections!.find(zone=>zone.id==='poker:shown:0')!;expect(publicCards.label).toContain('Original A');expect(publicCards.cards[0].ownerId).toBeUndefined();
 const session=createCardSession({transport:()=>{}});session.receive(shown);expect(session.snapshot().document).not.toBeNull();session.dispose();
 c.room!.current_hand=null;const unknown=pokerDocument(c,204)!,group=unknown.collections!.find(zone=>zone.id==='poker:shown:0')!;expect(group.label).toContain('이전 참가자 1');expect(group.label).not.toContain('Newcomer');expect(group.cards[0].ownerId).toBeUndefined();expect(unknown.scoreboard!.rows[0].values[0]).toBeNull();
});
test('settled original private cards require frozen identity and public spectator packets cannot authorize live input',()=>{
 const c=settledClient();expect(pokerDocument(c,210)!.hand).toHaveLength(2);c.room!.current_hand=null;expect(pokerDocument(c,211)!.hand).toEqual([]);
 c.game!.view.viewer=null;for(const player of c.game!.view.players)player.hole=null;expect(pokerViewerMatches(c.game!,0)).toBe(true);
 c.game!.view.over=false;expect(pokerViewerMatches(c.game!,0)).toBe(false);c.game!.view.over=true;c.game!.turn={Seat:0};expect(pokerViewerMatches(c.game!,0)).toBe(false);c.game!.turn='Over';c.game!.legal=[{type:'fold'}];expect(pokerViewerMatches(c.game!,0)).toBe(false);
});
