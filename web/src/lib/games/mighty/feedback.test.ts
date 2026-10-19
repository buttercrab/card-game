import {expect,test} from 'vitest';
import {ownFeedback} from '../../table/foundation/feedback';
import {CATALOG} from '../../catalog';
import {presetRules} from './catalog';
import {mightyDocument} from './foundation';
import {createMightyFeedback,type MightyFeedbackInput} from './feedback';
import type {RoomView,StateMsg,PhaseView,Played} from './types';
const rules=()=>presetRules('default');
function state(version:number,phase:PhaseView):StateMsg{return {version,grace_ms:0,turn:{Seat:1},legal:[],out_of_turn:[],notes:{unplayable:[],contracts:[]},view:{viewer:{Seat:0},rules:rules(),first_bidder:0,hand:[],hand_sizes:Array(5).fill(10),points_taken:Array.from({length:5},()=>[]),bids:[],redealt:null,phase}};}
const bidding=():PhaseView=>({Bidding:{to_act:0,best:null,passed:Array(5).fill(false),has_bid:Array(5).fill(false)}});
const play=():Extract<PhaseView,{Play:unknown}>=>({Play:{declarer:1,contract:{trump:'Heart',count:17},call:'Alone',friend:null,no_friend:true,trick_no:0,leader:0,lead:null,plays:[],leading:null,called_joker:null,tricks:[],discards:null}});
function input(previous:StateMsg|null,next:StateMsg):MightyFeedbackInput {
 const room:RoomView={id:'live',game:'mighty',protocol:CATALOG.protocol,settings:{preset:'default'},rules:rules(),customized:false,seats:Array.from({length:5},(_,i)=>({kind:'human',name:`P${i}`,connected:true,away:false})),in_hand:true,showing:true,table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:0,observers:[],ready:Array(5).fill(true),participant_ids:['p0','p1','p2','p3','p4'],participation:[],scores:Array(5).fill(0),hands_played:0,history:[],hands:[]};
 const client={room,game:next,seat:0,viewerId:'p0',viewerName:'P0',status:'open' as const};
 return {client,previous,previousParticipantIds:room.participant_ids!,document:mightyDocument(client,1)!,connectionEpoch:'connection',roomEpoch:'epoch',clock:null,baseline:false};
}
test('baseline and nonadvancing snapshots emit nothing; semantic IDs survive resize and input stays owned',()=>{
 const old=state(1,bidding()),next=state(2,bidding());if(typeof next.view.phase==='object'&&'Bidding'in next.view.phase)next.view.phase.Bidding.passed[1]=true;
 const f=input(old,next),a=createMightyFeedback(f)!;expect(a.events.map(event=>event.kind)).toEqual(['bid']);expect(a.events[0]).toMatchObject({participantId:'p1',amount:0,label:'패스'});
 expect(createMightyFeedback({...f,baseline:true})!.events).toEqual([]);expect(createMightyFeedback({...f,previous:next})!.events).toEqual([]);
 expect(createMightyFeedback({...f,document:mightyDocument(f.client,99)!})!.events).toEqual(a.events);expect(Object.isFrozen(a.events)).toBe(true);
});
test('deal/redeal, authorized public misdeal disclosure excludes unrelated private cards',()=>{
 const old=state(1,'Dealing'),next=state(2,bidding());expect(createMightyFeedback(input(old,next))!.events.map(e=>e.kind)).toEqual(['shuffle']);
 next.view.hand=[{Normal:['Club',3]}];next.view.redealt={why:{Misdeal:{seat:2,hand:[{Normal:['Heart',2]}]}},count:1};const result=createMightyFeedback(input(state(1,bidding()),next))!;expect(result.events.map(e=>e.kind)).toEqual(['shuffle','cue']);expect(result.events[1]).toMatchObject({cue:'misdeal',participantId:'p2'});expect(result.events[1].publicCards).toMatchObject([{visual:{kind:'standard',suit:'Heart',rank:2}}]);expect(JSON.stringify(result)).not.toContain('Club');
 expect(result.events[1].publicCards![0].id).not.toBe(JSON.stringify({Normal:['Heart',2]}));
 const exchange:PhaseView={Exchange:{declarer:1,contract:{trump:'Heart',count:17},trump_changed:false,discards:null}};
 expect(createMightyFeedback(input(state(1,bidding()),state(2,exchange)))!.events[0]).toMatchObject({kind:'cue',cue:'declarer',participantId:'p1'});
 expect(createMightyFeedback(input(state(1,exchange),state(2,play())))!.events[0]).toMatchObject({kind:'call'});
});
test('public card landing/heavy/special, trick sweep and score credit follow exact card milestones',()=>{
 const mighty:Played={seat:0,card:{Normal:['Spade',14]},powered:true};const previous=state(1,play()),now=play();now.Play.plays=[mighty];now.Play.lead={Suit:'Spade'};now.Play.leading=0;
 const landed=createMightyFeedback(input(previous,state(2,now)))!;expect(landed.events.map(e=>e.kind)).toEqual(['card','heavy','cue']);expect(landed.events[0].milestone).toEqual({kind:'arrival',entityIds:[JSON.stringify(mighty.card)]});expect(landed.events[2].cue).toBe('mighty');
 const swept=play();swept.Play.trick_no=1;swept.Play.tricks=[{plays:[mighty],lead:{Suit:'Spade'},winner:0}];const collected=createMightyFeedback(input(state(2,now),state(3,swept)))!;expect(collected.events.map(e=>e.kind)).toEqual(['sweep','score']);expect(collected.events[1]).toMatchObject({participantId:'p0',amount:1});
});
test('friend, answer, turn and result are public transitions with own-side outcome only',()=>{
 const old=state(1,play()),p=play();p.Play.friend=2;p.Play.no_friend=false;const next=state(2,p);next.turn={Seat:0};
 const result=createMightyFeedback(input(old,next))!;expect(result.events.map(e=>e.kind)).toEqual(['friend','answer','turn']);expect(result.events[0].participantId).toBe('p2');expect(result.events[1].participantId).toBe('p1');
 const contract={trump:'Heart' as const,count:17},done:PhaseView={Done:{declarer:1,friend:2,contract,call:'Alone',team_points:18,payoffs:[-1,2,2,-1,-1],tricks:[],discards:[],value:{contract,team_points:18,made:true,steps:[],value:1}}};
 const finished=createMightyFeedback(input(next,state(3,done)))!;expect(finished.mood).toBe('result');expect(finished.events.find(e=>e.kind==='result')).toMatchObject({positive:false});
});
test('replaced public humans and foreign private audiences never receive inherited seat-indexed effects',()=>{
 const old=state(1,bidding()),next=state(2,bidding());if(typeof next.view.phase==='object'&&'Bidding'in next.view.phase)next.view.phase.Bidding.passed[1]=true;
 const f=input(old,next);expect(createMightyFeedback({...f,previousParticipantIds:['p0','old-person','p2','p3','p4']})!.events).toEqual([]);expect(createMightyFeedback({...f,previousParticipantIds:null})!.events).toEqual([]);
 old.view.viewer={Seat:2};expect(createMightyFeedback(f)!.events).toEqual([]);next.view.viewer={Seat:2};expect(createMightyFeedback(f)).toBeNull();
});
test('deadline and mood are pure snapshots, and known lobby-to-deal gets one semantic shuffle',()=>{
 const f=input(null,state(1,bidding()));const result=createMightyFeedback({...f,clock:{seat:0,deadline:12345,total:10000}})!;expect(result.mood).toBe('bidding');expect(result.clock).toMatchObject({participantId:'p0',deadline:12345,total:10000,local:true});expect(result.events.map(e=>e.kind)).toEqual(['shuffle']);expect(createMightyFeedback({...f,baseline:true})!.events).toEqual([]);
});

test('projected arrival facts pass the shared canonical participant/entity boundary',()=>{
 const p=play();p.Play.plays=[{seat:0,card:{Joker:'Black'},powered:true}];p.Play.called_joker={Joker:'Black'};p.Play.leading=0;
 const f=input(state(1,play()),state(2,p)),result=createMightyFeedback(f)!;
 expect(result.events.map(e=>e.kind)).toEqual(['card','heavy','cue','cue']);
 expect(()=>ownFeedback(result,f.document.context,['p0','p1','p2','p3','p4'],f.document.collections!.flatMap(c=>c.cards.map(card=>card.id)))).not.toThrow();
 const plain=play();plain.Play.plays=[{seat:0,card:{Normal:['Spade',14]},powered:false}];
 expect(createMightyFeedback(input(state(1,play()),state(2,plain)))!.events.map(e=>e.kind)).toEqual(['card']);
});
