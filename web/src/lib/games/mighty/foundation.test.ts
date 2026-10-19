import {cardDecision} from '../../table/decisionCore';
import {deckCards,kittyCount} from './cards';
import {completionFixture} from './testSupport/completionFixture';
import {expect,test,vi} from 'vitest';
import {createCardSession} from '../../table/foundation/session';
import {mightyDocument,prepareMightyCommand,sendMightyCommand,roomStamp,mightyGeneration} from './foundation';
import {mightyConnectedGame} from './connected';
import {createConnectedCommandClient} from '../../table/foundation/connected';
import {presetRules} from './catalog';
import {CATALOG} from '../../catalog';
import type {Mighty,RoomView,StateMsg,Action,View} from './types';
import type {TableClient} from '../../room/tableClient';
import {validateTableDecision} from '../../table/foundation/decisions';
const room=():RoomView=>({id:'live',game:'mighty',protocol:CATALOG.protocol,settings:{preset:'default'},rules:presetRules('default'),customized:false,seats:Array.from({length:5},(_,i)=>({kind:'human',name:`P${i}`,connected:true,away:false})),in_hand:true,showing:true,table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:0,observers:[],ready:Array(5).fill(true),participant_ids:['p0','p1','p2','p3','p4'],participation:[],scores:[1,2,3,4,5],hands_played:0,history:[],hands:[]});
const state=():StateMsg=>({version:7,grace_ms:0,turn:{Seat:0},legal:[{Play:{card:{Normal:['Spade',14]},joker_lead:null,call_joker:false}}],out_of_turn:[],notes:{unplayable:[],contracts:[]},view:{viewer:{Seat:0},rules:presetRules('default'),first_bidder:0,hand:[{Normal:['Spade',14]}],hand_sizes:[1,8,9,9,10],points_taken:[[],[],[],[],[]],bids:[],redealt:null,phase:{Play:{declarer:1,contract:{trump:'Heart',count:17},call:'Alone',friend:null,no_friend:true,trick_no:1,leader:0,lead:null,plays:[],leading:null,called_joker:null,tricks:[],discards:null}}}});
function client(){return{room:room(),game:state(),seat:0,viewerId:'p0',viewerName:'P0',status:'open' as const,act:vi.fn(),join:vi.fn(),addBot:vi.fn(),ready:vi.fn(),start:vi.fn()} as unknown as TableClient<Mighty>;}
test('maximum native bidding domain survives semantic projection and canonical admission with every exact action',()=>{
 const c=client(),game=c.game!;game.view.phase={Bidding:{to_act:0,best:null,passed:Array(5).fill(false),has_bid:Array(5).fill(false)}};
 game.view.rules.bidding.min=1;game.view.rules.bidding.max=255;c.room!.rules=structuredClone(game.view.rules);
 game.view.hand=Array.from({length:10},(_,index)=>({Normal:['Spade',index+2]}));game.view.hand_sizes=Array(5).fill(10);
 const actions:Action[]=['Pass',...(['Spade','Diamond','Heart','Club',null] as const).flatMap(trump=>Array.from({length:255},(_,index)=>({Bid:{trump,count:index+1}})))];
 game.legal=actions;game.policy_actions={legal:actions,out_of_turn:[]};const document=mightyDocument(c,1)!;
 expect(document.offer.actions).toHaveLength(1276);expect(document.offer.actions.every(action=>action.enabled)).toBe(true);expect(validateTableDecision(document)).toEqual([]);
 const session=createCardSession({transport:vi.fn()});session.receive(document);expect(session.snapshot().document?.offer.actions).toHaveLength(1276);expect(session.snapshot().connected).toBe(true);session.dispose();
});
test('native capacity changes disable current gameplay and stale start commands without changing rules',()=>{
 const c=client(),game=mightyDocument(c,1)!.offer.actions[0];if(game.kind!=='command')throw Error('command');
 c.room!.capacity={can_start:false,can_archive:false,can_play:false,reason:{code:'invariant'}};
 expect(mightyDocument(c,2)!.offer.actions.every(action=>!action.enabled)).toBe(true);expect(prepareMightyCommand(c,game.action)).toBeNull();
 c.room!.in_hand=false;c.room!.showing=false;c.room!.seats=c.room!.seats.map((seat,index)=>index?{kind:'bot',name:`B${index}`,level:'easy'}:seat);
 const start=mightyDocument(c,3)!.offer.actions.find(action=>action.id==='start')!;expect(start.enabled).toBe(false);if(start.kind!=='command')throw Error('start');expect(prepareMightyCommand(c,start.action)).toBeNull();
 c.room!.capacity.can_start=true;expect(mightyDocument(c,4)!.offer.actions.find(action=>action.id==='start')!.enabled).toBe(true);expect(prepareMightyCommand(c,start.action)).toEqual({kind:'room',action:{type:'start'}});
});
test('same-version infrastructure policy replacement fences a previously offered game command',()=>{
 const c=client(),offered=mightyDocument(c,1)!.offer.actions[0];if(offered.kind!=='command')throw Error('command');
 Object.assign(c.game!,{policy_actions:{legal:[],out_of_turn:[]}});
 expect(mightyDocument(c,2)!.offer.actions[0].enabled).toBe(false);
 expect(prepareMightyCommand(c,offered.action)).toBeNull();expect(sendMightyCommand(c,offered.action)).toBe(false);expect(c.act).not.toHaveBeenCalled();expect(c.game!.legal).toHaveLength(1);
});
test('real projection carries only the authorized hand, counts, essential trump and exact legal payload',()=>{
    const c=client(),doc=mightyDocument(c,1)!;expect(doc.hand).toHaveLength(1);expect(doc.opponents!.map(item=>item.handCount)).toEqual([8,9,9,10]);
    expect(doc.information![0].primary!.value).toMatchObject({kind:'inline',values:[{kind:'suit',suit:'Heart'},{kind:'number',value:17}]});expect(doc.scoreboard!.rows[0]).toMatchObject({participantId:'p0',values:[0,1]});
    expect(doc.offer.actions[0]).toMatchObject({kind:'command',action:{kind:'game',version:7,seat:0,stamp:roomStamp(c),action:c.game!.legal[0]}});expect(doc.decision.kind).toBe('card-selection');expect(validateTableDecision(doc)).toEqual([]);
});
test('no-trump primary preserves the original compact token without changing action payloads',()=>{
 const c=client(),phase=c.game!.view.phase;if(typeof phase!=='object'||!('Play'in phase))throw Error('Expected play fixture');
 phase.Play.contract={trump:null,count:17};
 const doc=mightyDocument(c,1)!;
 expect(doc.information![0].primary!.value).toEqual({kind:'inline',values:[{kind:'token',token:'노',label:'노기루다'},{kind:'number',value:17}]});
 expect(doc.offer.actions[0]).toMatchObject({kind:'command',action:{kind:'game',action:c.game!.legal[0]}});
});
test('mismatched viewer and spectator never receive faces or playable actions',()=>{
    const c=client();c.game!.view.viewer={Seat:1};let doc=mightyDocument(c,1)!;expect(doc.hand).toEqual([]);expect(doc.offer.actions).toEqual([]);
    c.game!.view.viewer='Spectator';Object.assign(c,{seat:null});doc=mightyDocument(c,2)!;expect(doc.hand).toEqual([]);expect(doc.offer.actions).toEqual([]);
});
test('multiple exact joker actions remain attached to the selected card with explicit disambiguation',()=>{
    const c=client();c.room!.rules.deck='TwoJokers';c.game!.view.rules.deck='TwoJokers';c.game!.view.hand=[{Joker:'Red'}];c.game!.legal=[{Play:{card:{Joker:'Red'},joker_lead:{Suit:'Spade'},call_joker:false}},{Play:{card:{Joker:'Red'},joker_lead:{Color:'Red'},call_joker:false}}];
    const doc=mightyDocument(c,1)!;expect(doc.offer.actions).toHaveLength(2);expect(validateTableDecision(doc)).toEqual([]);expect(doc.decision.kind).toBe('card-selection');
    if(doc.decision.kind==='card-selection'){expect(doc.decision.disambiguation).toBe('choose-action');expect(doc.decision.variants.map(row=>row.actionId)).toEqual(doc.offer.actions.map(action=>action.id));expect(doc.decision.variants.every(row=>row.cardIds[0]===JSON.stringify({Joker:'Red'}))).toBe(true);expect(doc.decision.commands).toEqual([]);const session=createCardSession({transport:vi.fn()});session.receive(doc);expect(session.snapshot().document!.offer.actions).toEqual(doc.offer.actions);session.dispose();}
});
test('transport fences version, viewer, status, turn and exact current server membership',()=>{
    const c=client(),command={kind:'game' as const,version:7,seat:0,stamp:roomStamp(c),action:c.game!.legal[0]};expect(sendMightyCommand(c,command)).toBe(true);expect(c.act).toHaveBeenCalledWith(command.action);
    expect(sendMightyCommand(c,{...command,version:6})).toBe(false);expect(sendMightyCommand(c,{...command,action:'Pass'})).toBe(false);
    c.game!.view.viewer='Spectator';expect(sendMightyCommand(c,command)).toBe(false);c.game!.view.viewer={Seat:0};c.game!.turn={Seat:1};expect(sendMightyCommand(c,command)).toBe(false);
    Object.assign(c,{status:'closed'});expect(sendMightyCommand(c,command)).toBe(false);
});
test('connected adapter fences inert semantic input and executes only the selected host capability',()=>{
    const c=client(),command={kind:'game' as const,version:7,seat:0,stamp:roomStamp(c),action:c.game!.legal[0]};
    const view=createConnectedCommandClient<Mighty>(c),submitGame=vi.fn(()=>true),submitRoom=vi.fn(()=>true);
    expect(prepareMightyCommand(view,command)).toEqual({kind:'game',action:command.action});
    expect(mightyConnectedGame.submit(view,command,submitGame,submitRoom)).toBe(true);
    expect(submitGame).toHaveBeenCalledExactlyOnceWith(command.action);expect(submitRoom).not.toHaveBeenCalled();expect(c.act).not.toHaveBeenCalled();
    submitGame.mockClear();
    expect(mightyConnectedGame.submit(view,{...command,version:6},submitGame,submitRoom)).toBe(false);
    expect(submitGame).not.toHaveBeenCalled();
    const ready={kind:'room' as const,stamp:roomStamp(c),op:'ready' as const,ready:true};
    expect(mightyConnectedGame.submit(view,ready,submitGame,submitRoom)).toBe(true);
    expect(submitRoom).toHaveBeenCalledExactlyOnceWith({type:'ready',ready:true});expect(c.ready).not.toHaveBeenCalled();
});

test('audience/hand replacement fails the final fence and room-only updates retain game admission identity',()=>{
    const c=client(),first=mightyDocument(c,1)!,command=first.offer.actions[0];
    expect(command.kind).toBe('command');if(command.kind!=='command')return;
    c.room!.watching++;c.room!.scores[0]++;
    const second=mightyDocument(c,2)!;expect(second.offer.id).toBe(first.offer.id);expect(second.context.revision).not.toBe(first.context.revision);
    Object.assign(c,{viewerId:'different-actor'});expect(sendMightyCommand(c,command.action)).toBe(false);
    Object.assign(c,{viewerId:'p0'});c.room!.hands_played++;expect(sendMightyCommand(c,command.action)).toBe(false);
});

test('an uncertain game command stays deduplicated after a room-only publication',async()=>{
    const c=client(),send=vi.fn(),session=createCardSession({transport:send});session.receive(mightyDocument(c,1)!);
    let doc=session.snapshot().document!,binding=doc.offer.actions[0];if(binding.kind!=='command')throw new Error('Expected command');
    expect(session.admit(doc.context,doc.offer.id,binding.id,binding.action)).toBe(true);await Promise.resolve();expect(send).toHaveBeenCalledTimes(1);
    c.room!.watching++;c.room!.scores[0]++;session.receive(mightyDocument(c,2)!);doc=session.snapshot().document!;binding=doc.offer.actions[0];if(binding.kind!=='command')throw new Error('Expected command');
    expect(session.admit(doc.context,doc.offer.id,binding.id,binding.action)).toBe(false);expect(send).toHaveBeenCalledTimes(1);session.dispose();
});

test('bidding and discard translate the exact server offer without manufacturing actions',()=>{
    const c=client();c.game!.view.phase={Bidding:{to_act:0,best:null,passed:Array(5).fill(false),has_bid:Array(5).fill(false)}};c.game!.legal=[{Bid:{trump:'Spade',count:14}},'Pass'];
    let doc=mightyDocument(c,1)!;expect(doc.decision.kind).toBe('finite-choice');expect(validateTableDecision(doc)).toEqual([]);
    c.game!.view.phase={Exchange:{declarer:0,contract:{trump:'Spade',count:14},trump_changed:false,discards:[]}};c.game!.view.hand=deckCards(c.room!.rules).slice(0,c.room!.rules.hand_size+kittyCount(c.room!.rules));c.game!.view.hand_sizes[0]=c.game!.view.hand.length;c.game!.legal=c.game!.view.hand.map(card=>({Discard:card}));
    doc=mightyDocument(c,2)!;expect(doc.decision).toMatchObject({kind:'composition',id:'mighty-exchange'});const discard=cardDecision(doc.decision)!;expect(discard).toMatchObject({kind:'card-selection',id:'mighty-discard',mode:'count',count:kittyCount(c.room!.rules)});expect(validateTableDecision(doc)).toEqual([]);expect(discard.variants).toHaveLength(c.game!.view.hand.length);
    expect(doc.offer.actions.map(item=>item.kind==='command'&&item.action.kind==='game'?item.action.action:null)).toEqual(c.game!.legal);
    expect(mightyDocument(c,3,false)!.offer.actions.every(item=>!item.enabled)).toBe(true);
});

 test('artwork carries only visible roles and public bot/offline identity',()=>{
    const c=client();c.room!.seats[2]={kind:'bot',name:'Bot',level:'easy'} as RoomView['seats'][number];
    const doc=mightyDocument(c,1)!;
    expect(doc.hand[0].emphasis).toBe('special');
    expect(doc.participant.appearance).toMatchObject({team:'defense',thinking:true});
    expect(doc.opponents![0].appearance).toMatchObject({team:'declarer',trumpSuit:'Heart'});
    expect(doc.opponents![1].appearance).toMatchObject({bot:true,team:'defense'});
    const phase=c.game!.view.phase;if(typeof phase!=='object'||!('Play' in phase))throw new Error('play fixture');
    phase.Play.friend=2;
    expect(mightyDocument(c,2)!.opponents![1].appearance!.team).toBe('friend');
 });

test('completed tricks and their winner come from public server history with count-only reveal hints',()=>{
    const c=client(),phase=c.game!.view.phase;
    if(typeof phase!=='object'||!('Play' in phase))throw new Error('Play fixture');
    phase.Play.plays=[{seat:2,card:{Normal:['Club',3]},powered:true}];
    phase.Play.tricks=[{winner:1,lead:{Suit:'Heart'},plays:[{seat:1,card:{Normal:['Heart',2]},powered:true}]}];
    const doc=mightyDocument(c,1)!;
    expect(doc.collections!.find(zone=>zone.id==='captured')).toMatchObject({label:'직전 트릭 · P1',purpose:'captured',collectedBy:'p1',cards:[{id:cardId('Heart',2),ownerId:'p1'}]});
    expect(doc.collections!.find(zone=>zone.id==='trick')).toMatchObject({kind:'trick',cards:[{ownerId:'p2'}]});
    expect(doc.reveals).toEqual([{participantId:'p2',cardId:cardId('Club',3)},{participantId:'p1',cardId:cardId('Heart',2)}]);
    expect(doc.opponents!.every(peer=>!('cards' in peer))).toBe(true);
    function cardId(suit:'Heart'|'Club',rank:number){return JSON.stringify({Normal:[suit,rank]});}
});

test('initial distribution and kitty are public counts with separate identities for every audience',()=>{
    const c=client();c.game!.view.phase={Bidding:{to_act:0,best:null,passed:Array(5).fill(false),has_bid:Array(5).fill(false)}};
    let doc=mightyDocument(c,1)!;expect(doc.collections!.find(zone=>zone.id==='stock')).toMatchObject({hiddenCount:3,relevance:'auxiliary'});expect(doc.deals![0]).toMatchObject({handCount:10,cardIds:[],recipients:expect.any(Array)});expect(doc.deals![0].recipients).toHaveLength(4);const initial=doc.deals![0].id;
    c.game!.view.viewer={Seat:1};expect(mightyDocument(c,1)!.deals).toEqual([]);c.game!.view.viewer={Seat:0};
    c.game!.view.phase={Exchange:{declarer:0,contract:{trump:null,count:20},trump_changed:false,discards:[]}};c.game!.view.hand_sizes[0]=13;doc=mightyDocument(c,2)!;
    expect(doc.deals![0]).toMatchObject({handCount:3,cardIds:[],recipients:[]});expect(doc.deals![0].id).not.toBe(initial);expect(doc.collections!.find(zone=>zone.id==='stock')!.hiddenCount).toBe(0);
    Object.assign(c,{seat:null});c.game!.view.viewer='Spectator';c.game!.view.hand=[];doc=mightyDocument(c,3)!;expect(doc.participant.role).toBe('observer');expect(doc.opponents!.map(person=>person.id)).toEqual(['p1','p2','p3','p4','p0']);expect(doc.hand).toEqual([]);expect(doc.deals![0]).toMatchObject({handCount:0,cardIds:[],recipients:[{participantId:'p0',count:3}]});
});
test('completed-hand, next-hand and redeal scopes prevent cross-deal card identity reuse',()=>{
    const c=client();const first=mightyGeneration(c.room!,c.game!);c.room!.hands_played=1;
    const current=c.game!.view.phase;if(typeof current!=='object'||!('Play' in current))throw new Error('Play');
    c.game!.view.phase={Done:{...current.Play,team_points:0,payoffs:[0,0,0,0,0],value:{} as never,discards:[]}};
    expect(mightyGeneration(c.room!,c.game!)).toBe(first);
    c.game!.view.phase={Bidding:{to_act:0,best:null,passed:Array(5).fill(false),has_bid:Array(5).fill(false)}};
    expect(mightyGeneration(c.room!,c.game!)).not.toBe(first);const second=mightyGeneration(c.room!,c.game!);
    c.game!.view.redealt={count:1,why:'AllPassed'} as never;expect(mightyGeneration(c.room!,c.game!)).not.toBe(second);
});

test('canonical context retains the observed redeal epoch after the server clears its bidding notice',()=>{
    const c=client();c.game!.view.redealt={count:1,why:'AllPassed'};
    const bidding=mightyDocument(c,1)!.context.generation;c.game!.view.redealt=null;
    c.game!.view.phase={Exchange:{declarer:0,contract:{trump:null,count:20},trump_changed:false,discards:[]}};
    expect(mightyDocument(c,2,true,bidding)!.context.generation).toBe(bidding);
    c.room!.hands_played=1;expect(mightyDocument(c,3,true,bidding)!.context.generation).not.toBe(bidding);
});


test('discard projection retains a count-only return destination at the play boundary',()=>{
 const c=client();const play=c.game!.view.phase;
 c.game!.view.phase={Exchange:{declarer:0,contract:{trump:null,count:20},trump_changed:false,discards:[]}};
 for(const count of [13,12,11,10]){c.game!.view.hand_sizes[0]=count;const doc=mightyDocument(c,count)!;expect(doc.collections!.find(zone=>zone.id==='stock')!.hiddenCount).toBe(13-count);if(count<13){expect(doc.deals).toEqual([]);expect(doc.stockReturn).toEqual({destination:'stock',source:{kind:'hand'}});}}
 Object.assign(c,{seat:null});c.game!.view.viewer='Spectator';c.game!.view.hand=[];
 expect(mightyDocument(c,20)!.stockReturn).toEqual({destination:'stock',source:{kind:'participant',id:'p0'}});
 c.game!.view.phase=play;const active=mightyDocument(c,21)!;expect(active.collections!.find(zone=>zone.id==='stock')!.hiddenCount).toBe(3);expect(active.stockReturn).toBeDefined();
});

test('raw completed hand retains outgoing kitty and public final trick until outcome authority supplies a next-deal preview',()=>{
 const c=client(),phase=c.game!.view.phase;if(typeof phase!=='object'||!('Play' in phase))throw new Error('Play');
 const trick={winner:1,lead:{Suit:'Heart' as const},plays:[{seat:1,card:{Normal:['Heart' as const,2] as ['Heart',number]},powered:true}]};
 c.game!.view.phase={Done:{...phase.Play,tricks:[trick],team_points:0,payoffs:[0,0,0,0,0],value:{} as never,discards:[]}};
 c.game!.view.hand=[];c.game!.view.hand_sizes=[0,0,0,0,0];
 const doc=mightyDocument(c,2)!;expect(doc.collections!.find(zone=>zone.id==='stock')).toMatchObject({label:'키티',hiddenCount:3,cards:[]});
 expect(doc.collections!.find(zone=>zone.id==='stock')!.availability).toBeUndefined();expect(doc.presentation!.tableCollectionIds).toEqual([]);expect(doc.collections!.find(zone=>zone.id==='captured')!.cards).toHaveLength(1);expect(doc.stockReturn).toBeUndefined();expect(doc.hand).toEqual([]);expect(doc.opponents!.every(peer=>peer.handCount===0)).toBe(true);
});

test('explicit public waiting ignores cached private state and native setup removes only global bot shortcuts',()=>{
 const c=client();c.room!.in_hand=false;c.room!.showing=false;c.room!.seats[4]={kind:'empty'};
 const cached=c.game!,native=mightyDocument(c,30,true,undefined,true)!;expect(native.stage).toBe('waiting');expect(native.hand).toEqual([]);expect(native.deals).toEqual([]);expect(native.reveals).toEqual([]);expect(native.stockReturn).toBeUndefined();expect(native.collections!.every(zone=>zone.cards.length===0)).toBe(true);expect(native.opponents!.every(person=>person.handCount===0&&!person.appearance?.thinking)).toBe(true);expect(native.offer.actions.some(action=>action.id.startsWith('bot:'))).toBe(false);expect(c.game).toBe(cached);expect(c.game!.view.hand).toHaveLength(1);
 expect(mightyDocument(c,31)!.offer.actions.some(action=>action.id==='bot:4')).toBe(true);
 const session=createCardSession({transport:vi.fn()});session.receive(native);expect(session.snapshot().document?.stage).toBe('waiting');session.dispose();
});
test('empty hands and retained public results never imply waiting',()=>{
 const c=client();c.game!.view.hand=[];expect(mightyDocument(c,32)!.stage).toBe('active');c.room!.in_hand=false;const phase=c.game!.view.phase;if(typeof phase!=='object'||!('Play'in phase))throw Error('Play');c.game!.view.phase={Done:{...phase.Play,team_points:0,payoffs:[0,0,0,0,0],value:{} as never,discards:[]}};expect(mightyDocument(c,33)!.stage).toBe('active');
 Object.assign(c,{game:null});expect(mightyDocument(c,34)!.stage).toBe('active');
});
test('canonical Mighty document wires current public bid/pass status and referenced table presentation',()=>{
 const c=client(),s=c.game!;s.view.phase={Bidding:{to_act:0,best:[1,{trump:'Heart',count:17}],passed:[true,false,false,false,false],has_bid:[true,true,false,false,false]}};s.legal=['Pass',{Bid:{trump:'Spade',count:18}}];
 const doc=mightyDocument(c,101)!;expect(doc.participant.status).toEqual({purpose:'announcement',value:{kind:'text',text:'패스'},tone:'muted',muted:true});expect(doc.opponents!.find(person=>person.id==='p1')?.status?.value).toEqual({kind:'inline',values:[{kind:'suit',suit:'Heart',label:'♥'},{kind:'number',value:17}]});
 expect(doc.opponents!.find(person=>person.id==='p2')?.status).toBeUndefined();expect(doc.statusPresentation).toMatchObject({informationId:'mighty-status',fieldIds:['bidder'],primary:true,summary:true});
 const session=createCardSession({transport:vi.fn()});session.receive(doc);expect(session.snapshot().document?.participant.status).toEqual(doc.participant.status);expect(session.snapshot().document?.statusPresentation).toEqual(doc.statusPresentation);session.dispose();
 Object.assign(c.game!,state());const play=mightyDocument(c,102)!;expect(play.participant.status).toEqual({purpose:'standing',value:{kind:'text',text:'야당'},tone:'plain'});expect(play.opponents!.find(person=>person.id==='p1')?.status?.value).toEqual({kind:'text',text:'주공'});expect(play.opponents!.filter(person=>person.id!=='p1').every(person=>person.status?.value.kind==='text'&&person.status.value.text==='야당')).toBe(true);expect(play.statusPresentation?.fieldIds).toEqual(['declarer','friend','round']);
 c.room!.showing=false;c.room!.in_hand=false;const waiting=mightyDocument(c,103)!;expect(waiting.participant.status).toBeUndefined();expect(waiting.opponents!.every(person=>person.status===undefined)).toBe(true);expect(waiting.statusPresentation).toBeUndefined();
});
test('Mighty observer has no own bid status but still sees correctly identified public opponents',()=>{
 const c=client();Object.assign(c,{seat:null});c.game!.view.viewer='Spectator';c.game!.view.hand=[];c.game!.view.phase={Bidding:{to_act:0,best:[1,{trump:null,count:17}],passed:[true,false,false,false,false],has_bid:[true,true,false,false,false]}};
 const doc=mightyDocument(c,104)!;expect(doc.participant.role).toBe('observer');expect(doc.participant.status).toBeUndefined();expect(doc.opponents!.find(person=>person.id==='p0')?.status?.muted).toBe(true);expect(doc.opponents!.find(person=>person.id==='p1')?.status?.value).toEqual({kind:'inline',values:[{kind:'text',text:'노기루다'},{kind:'number',value:17}]});
});

test('completed captured cards preserve original names and identities after seat replacement and reseating',()=>{
 const base=client(),saved=completionFixture(),savedRoom=saved.room! as RoomView,record=savedRoom.current_hand!,savedView=record.view as View,done=savedView.phase;if(typeof done!=='object'||!('Done'in done))throw Error('Done fixture');
 done.Done.tricks[0].plays.push({seat:0,card:{Normal:['Heart',10]},powered:true});
 const current={...base.room!,...savedRoom,participant_ids:['replacement','alice','carol','dan','eve'],seats:['Replacement','Renamed Alice','Current Carol','Current Dan','Current Eve'].map(name=>({kind:'human' as const,name,connected:true,away:false}))};
 const scope={...saved.scope!,actor_id:'replacement',seat:0},game={...base.game!,turn:'Over' as const,legal:[],out_of_turn:[],view:{...structuredClone(savedView),viewer:{Seat:0} as const,hand:[]}};
 const source={...base,room:current,roomScope:scope,game,viewerId:'replacement',viewerName:'Replacement'},document=mightyDocument(source,100)!;
 const captured=document.collections!.find(zone=>zone.id==='captured')!;expect(captured.label).toBe('직전 트릭 · Old Bob');expect(captured.label).not.toContain('Renamed Alice');expect(captured.cards[0].label).toContain('Old Bob');expect(captured.cards[0].ownerId).toBeUndefined();expect(captured.cards[1].label).toContain('Old Alice');expect(captured.cards[1].ownerId).toBe('alice');expect(captured.cards.some(card=>card.ownerId==='replacement')).toBe(false);expect(document.reveals?.some(hint=>hint.participantId==='replacement')).toBe(false);
 const session=createCardSession({transport:()=>{}});expect(()=>session.receive(document)).not.toThrow();session.dispose();
 expect(captured.collectedBy).toBeUndefined();
 const retained={...source,room:{...current,participant_ids:['bob','alice','carol','dan','eve']},viewerId:'bob',roomScope:{...scope,actor_id:'bob'}};const original=mightyDocument(retained,101)!.collections!.find(zone=>zone.id==='captured')!;expect(original.cards[0].ownerId).toBe('bob');expect(original.cards[0].label).toContain('Old Bob');expect(original.collectedBy).toBe('bob');
});

test('capture recipient remains the public winner when a different player supplied the card',()=>{
 const c=client(),phase=c.game!.view.phase;
 if(typeof phase!=='object'||!('Play'in phase))throw Error('Play fixture');
 phase.Play.tricks=[{winner:0,lead:{Suit:'Heart'},plays:[{seat:2,card:{Normal:['Heart',2]},powered:true}]}];
 const projected=mightyDocument(c,12)!,captured=projected.collections!.find(zone=>zone.id==='captured')!;
 expect(captured.collectedBy).toBe('p0');expect(captured.cards[0].ownerId).toBe('p2');
 const session=createCardSession({transport:()=>{}});session.receive(projected);
 const admitted=session.snapshot().document!.collections!.find(zone=>zone.id==='captured')!;
 expect(admitted.collectedBy).toBe('p0');expect(Object.isFrozen(admitted)).toBe(true);session.dispose();
 phase.Play.tricks=[];expect(mightyDocument(c,13)!.collections!.find(zone=>zone.id==='captured')!.collectedBy).toBeUndefined();
});

test('a settled seated replacement accepts only the explicitly public Done projection',()=>{
 const c=client(),saved=completionFixture(),view=structuredClone(saved.room!.current_hand!.view) as View,game:StateMsg={...c.game!,view,turn:'Over',legal:[],out_of_turn:[]};
 game.view.viewer='Spectator';game.view.hand=[];if(typeof game.view.phase!=='object'||!('Done'in game.view.phase))throw Error('Done');game.view.rules.reveal_discards=false;game.view.phase.Done.discards=[];
 expect(mightyConnectedGame.viewerMatches(game,0)).toBe(true);expect(mightyDocument({...c,game},220)!.hand).toEqual([]);
 game.view.hand=[{Normal:['Spade',14]}];expect(mightyConnectedGame.viewerMatches(game,0)).toBe(false);game.view.hand=[];game.view.phase.Done.discards=[{Normal:['Heart',10]}];expect(mightyConnectedGame.viewerMatches(game,0)).toBe(false);game.view.rules.reveal_discards=true;expect(mightyConnectedGame.viewerMatches(game,0)).toBe(true);
 game.legal=['Pass'];expect(mightyConnectedGame.viewerMatches(game,0)).toBe(false);game.legal=[];game.view.phase=state().view.phase;expect(mightyConnectedGame.viewerMatches(game,0)).toBe(false);
});

test('Play caption cohort is identical for fresh passive and active snapshots regardless of private hand or friend',()=>{
 const c=client(),active=mightyDocument(c,1)!;expect(active.presentation?.selection).toBeDefined();
 c.game!.legal=[];c.game!.out_of_turn=[];c.game!.view.hand=[{Normal:['Heart',2]}];
 c.game!.turn={Seat:1};
 const phase=c.game!.view.phase;if(typeof phase==='object'&&'Play'in phase)phase.Play.friend=3;
 const passive=mightyDocument(c,2)!;
 expect(passive.presentation).toEqual(active.presentation);
 c.game!.view.hand=[];c.game!.view.viewer='Spectator';Object.assign(c,{seat:null});
 const observer=mightyDocument(c,3)!;expect(observer.presentation).toEqual(active.presentation);expect(observer.offer.actions).toEqual([]);
 const session=createCardSession({transport:vi.fn()});session.receive(observer);expect(session.snapshot().document!.presentation).toEqual(active.presentation);session.dispose();
});
