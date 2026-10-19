import {expect,test} from 'vitest';
import type {CommandScope} from '../../generated/protocol';
import type {RoomView,View,RecordedHand} from './types';
import {presetRules} from './catalog';
import {mightyConnectedGame} from './connected';
import {mightyGeneration} from './foundation';
import {projectMightyHistory} from './history';
import {projectMightyOutcome} from './settled';
import {createCardSession} from '../../table/foundation/session';
function fixture(){
 const rules=presetRules('default'),contract={trump:'Heart' as const,count:17};
 const view:View={viewer:'Spectator',rules,first_bidder:0,hand:[],hand_sizes:[0,0,0,0,0],points_taken:[[],[],[],[],[]],bids:[],redealt:null,phase:{Done:{declarer:1,friend:2,contract,call:'FirstTrick',team_points:18,payoffs:[-2,3,3,-2,-2],value:{contract,team_points:18,made:true,steps:[],value:8},tricks:[{lead:{Suit:'Spade'},winner:1,plays:[{seat:1,card:{Normal:['Spade',14]},powered:true},{seat:2,card:{Normal:['Spade',10]},powered:false}]}],discards:[]}}};
 const saved:RecordedHand={number:3,names:['Old Alice','Old Bob','Old Carol','Old Dan','Old Eve'],participant_ids:['alice','bob','carol','dan','eve'],payoffs:[-2,3,3,-2,-2],rules,view};
 const room:RoomView={id:'room',game:'mighty',protocol:'test',session_id:2,settings:{preset:'default'},rules,customized:false,seats:saved.names.map(name=>({kind:'human',name,connected:true,away:false})),in_hand:false,showing:true,table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:0,observers:[],ready:[false,false,false,false,false],participant_ids:[...saved.participant_ids],participation:[],scores:[0,0,0,0,0],hands_played:3,history:[],hands:[],current_hand:saved};
 const scope:CommandScope={domain:'room',room_id:'room',room_epoch:'e'.repeat(32),session_id:2,hand:3,version:10,actor_id:'alice',seat:0};
 const client={roomScope:scope,room,game:null,seat:0,viewerId:'alice',viewerName:'Old Alice'};
 const project=()=>{const document=mightyConnectedGame.project(client,1,true)!;return {document,result:projectMightyOutcome({client,document,roomScope:scope})!};};
 return {room,scope,client,project};
}
test('restored public result and complete last trick project before any live State',()=>{
 const {project}=fixture(),{document,result}=project();expect(document.facts).toEqual([]);expect(result.outcome).toBeDefined();expect(result.information.primary).toMatchObject({value:{text:'-2점'}});const captured=result.collections?.find(zone=>zone.purpose==='captured')!;expect(captured.cards).toHaveLength(2);expect(captured.cards[0]).toMatchObject({label:'Old Bob · ♠A',ownerId:'bob'});expect(captured.cards[0].id).toBe(JSON.stringify({Normal:['Spade',14]}));expect(captured.collectedBy).toBe('bob');expect(result.reveals).toEqual([{participantId:'bob',cardId:captured.cards[0].id},{participantId:'carol',cardId:captured.cards[1].id}]);
 const session=createCardSession({transport:()=>{}});session.receive({...document,outcome:result.outcome,information:[...document.information!,result.information],collections:result.collections,reveals:result.reveals??document.reveals},{connected:false});expect(session.snapshot().document?.outcome).toBeDefined();expect(session.snapshot().connected).toBe(false);
});
test('departed original actors keep frozen labels and never inherit replacement owners',()=>{
 const f=fixture();f.room.participant_ids![1]='replacement';f.room.seats[1]={kind:'human',name:'New Bob',connected:true,away:false};const captured=f.project().result.collections!.find(zone=>zone.purpose==='captured')!;expect(captured.label).toBe('직전 트릭 · Old Bob');expect(captured.cards[0].label).toContain('Old Bob');expect(captured.cards[0].ownerId).toBeUndefined();expect(captured.cards[1].ownerId).toBe('carol');expect(JSON.stringify(captured)).not.toContain('replacement');
});
test('privileged or malformed recorded cards never enter restored collection',()=>{
 const f=fixture();(f.room.current_hand!.view as View).viewer={Seat:0};(f.room.current_hand!.view as View).hand=[{Normal:['Club',2]}];const result=f.project().result;expect(result.outcome).toBeDefined();expect(result.collections?.every(zone=>zone.cards.length===0)).toBe(true);expect(result.collections?.some(zone=>zone.purpose==='captured')).toBe(false);expect(JSON.stringify(result)).not.toContain('Club');
});
test('settled generation does not change when the authorized Done packet later arrives',()=>{
 const f=fixture();const before=mightyGeneration(f.room,null);expect(before).toBe('[2,0]');const game={view:f.room.current_hand!.view} as Parameters<typeof mightyGeneration>[1];expect(mightyGeneration(f.room,game,before)).toBe(before);
});

test('strict public restore retains known original team costumes and trump before State',()=>{
 const f=fixture(),doc=f.project().document;expect(doc.participant.appearance).toMatchObject({team:'defense',trumpSuit:'Heart'});expect(doc.opponents!.find(person=>person.id==='bob')?.appearance).toMatchObject({team:'declarer',trumpSuit:'Heart'});expect(doc.opponents!.find(person=>person.id==='carol')?.appearance).toMatchObject({team:'friend'});
 f.room.participant_ids![1]='replacement';const changed=f.project().document;expect(changed.opponents!.find(person=>person.id==='replacement')?.appearance?.team).toBeNull();expect(changed.opponents!.find(person=>person.id==='carol')?.appearance?.team).toBe('friend');
 f.client.roomScope={...f.scope,actor_id:'foreign'};const foreign=f.project().document;expect(foreign.participant.appearance?.team).toBeNull();expect(foreign.participant.appearance?.trumpSuit).toBeNull();
});
test('Mighty start and readiness are primary continuation semantics',()=>{
 const f=fixture(),doc=f.project().document;expect(doc.offer.actions.find(action=>action.id==='ready')?.intent).toBe('primary');
 for(let seat=1;seat<5;seat++)f.room.seats[seat]={kind:'bot',name:'Bot '+seat,level:'easy'};f.room.ready=[true,true,true,true,true];const solo=f.project().document;expect(solo.offer.actions.find(action=>action.id==='start')?.intent).toBe('primary');
});

test('settled readiness labels and eligibility follow original one-primary continuation',()=>{
 const f=fixture();expect(f.project().document.offer.actions.find(action=>action.id==='ready')?.label).toBe('다음 판 준비');f.room.ready![0]=true;expect(f.project().document.offer.actions.find(action=>action.id==='ready')?.label).toBe('준비 취소');f.room.ready!.fill(true);const all=f.project().document;expect(all.offer.actions.some(action=>action.id==='ready')).toBe(false);expect(all.offer.actions.find(action=>action.id==='start')?.intent).toBe('primary');f.room.participation=[{id:'visitor',name:'Visitor',order:1,seat:1,target_id:'bob',offered_by:null}];expect(f.project().document.offer.actions.some(action=>action.id==='start')).toBe(false);
});
test('score reset preserves original public costumes, last trick and outcome lineage before State',()=>{
 const f=fixture();f.room.current_hand!.session_id=2;
 const before=f.project();f.room.session_id=3;f.scope.session_id=3;
 const reset=f.project();
 expect(reset.document.participant.appearance).toMatchObject({team:'defense',trumpSuit:'Heart'});
 expect(reset.document.opponents!.find(person=>person.id==='bob')?.appearance?.team).toBe('declarer');
 expect(reset.result.collections?.find(zone=>zone.purpose==='captured')?.cards).toEqual(before.result.collections?.find(zone=>zone.purpose==='captured')?.cards);
 expect(reset.result.outcome.id).toBe(before.result.outcome.id);
 f.room.current_hand!.session_id=4;const future=f.project();
 expect(future.result).toBeNull();expect(future.document.participant.appearance?.team).toBeNull();
});

test('connected outcome composition publishes next-deal53 atomically while raw Done remains current kitty3',()=>{
 const f=fixture(),raw=mightyConnectedGame.project(f.client,1,true)!;expect(raw.collections!.find(zone=>zone.purpose==='stock')).toMatchObject({hiddenCount:3});expect(raw.collections!.find(zone=>zone.purpose==='stock')?.availability).toBeUndefined();
 const result=mightyConnectedGame.outcome!({client:f.client,document:raw,roomScope:f.scope})!;expect(result).not.toBeNull();
 const final={...raw,outcome:result.outcome,information:[...(raw.information??[]),result.information],...(result.collections?{collections:result.collections}:{}),...(result.reveals?{reveals:result.reveals}:{})};
 const session=createCardSession({transport:()=>{}}),seen:unknown[]=[];session.subscribe(snapshot=>seen.push(snapshot.document));session.receive(final);
 expect(seen).toHaveLength(1);expect(session.snapshot().document!.presentation!.tableCollectionIds).toEqual([]);expect(session.snapshot().document!.collections!.find(zone=>zone.purpose==='stock')).toMatchObject({kind:'deck',availability:'next-deal',hiddenCount:53,cards:[]});expect(raw.collections!.find(zone=>zone.purpose==='stock')!.hiddenCount).toBe(3);session.dispose();
});

test('current physical completion and completed-hand replay keep separate stable entity identities',()=>{
 const f=fixture(),before=JSON.stringify(f.room.current_hand),projected=f.project().result,archived=projectMightyHistory({identity:{roomId:f.room.id,roomEpoch:f.scope.room_epoch,sessionId:f.scope.session_id,handNumber:f.room.current_hand!.number},record:f.room.current_hand});expect(archived.status).toBe('available');if(archived.status!=='available')throw Error('Strict public archive');
 const physical=projected.collections!.find(zone=>zone.purpose==='captured')!.cards;expect(physical.map(card=>card.id)).toEqual([JSON.stringify({Normal:['Spade',14]}),JSON.stringify({Normal:['Spade',10]})]);expect(archived.rounds[0].plays.every(play=>play.card.id.includes('mighty-history'))).toBe(true);expect(physical.every(card=>!archived.rounds[0].plays.some(play=>play.card.id===card.id))).toBe(true);expect(JSON.stringify(f.room.current_hand)).toBe(before);
 f.room.participant_ids![1]='replacement';f.room.seats[1]={kind:'human',name:'Replacement',connected:true,away:false};const changed=f.project().result;expect(changed.collections!.find(zone=>zone.purpose==='captured')?.collectedBy).toBeUndefined();expect(changed.reveals?.some(reveal=>reveal.participantId==='bob'||reveal.participantId==='replacement')).toBe(false);
});
