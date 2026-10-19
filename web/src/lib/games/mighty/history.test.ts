import {expect,test} from 'vitest';
import {presetRules} from './catalog';
import {deckCards,isPoint} from './cards';
import {projectMightyHistory,type MightyHistoryInput} from './history';
import type {RecordedHand,View} from './types';
function fixture():MightyHistoryInput & {record:RecordedHand}{
 const rules=presetRules('default'),contract={trump:'Heart' as const,count:17};rules.reveal_discards=false;
 const view:View={viewer:'Spectator',rules,first_bidder:0,hand:[],hand_sizes:Array(5).fill(0),points_taken:Array.from({length:5},()=>[]),bids:[],redealt:null,phase:{Done:{declarer:1,friend:2,contract,call:{Card:{Normal:['Club',14]}},team_points:18,payoffs:[-2,3,3,-2,-2],value:{contract,team_points:18,made:true,steps:[{OverTen:{points:18,total:8}},{Doubled:{why:'Alone',total:16}}],value:16},tricks:[{lead:{Suit:'Spade'},winner:0,plays:[{seat:2,card:{Normal:['Spade',10]},powered:false},{seat:0,card:{Normal:['Spade',14]},powered:true}]},{lead:{Color:'Red'},winner:1,plays:[{seat:1,card:{Joker:'Black'},powered:true},{seat:2,card:{Normal:['Heart',3]},powered:true}]}],discards:[]}}};
 return {identity:{roomId:'room',roomEpoch:'epoch',sessionId:2,handNumber:3},record:{number:3,names:['Old Alice','Old Bob','Old Carol','Old Dan','Old Eve'],participant_ids:['alice','bob','carol','dan','eve'],payoffs:[-2,3,3,-2,-2],rules,view}};
}
test('historical roster, ordered rounds, lead/winner/power and explicit matrix blanks stay frozen',()=>{
 const source=fixture(),result=projectMightyHistory(source);expect(result.status).toBe('available');if(result.status!=='available')return;
 expect(result.roster.map(p=>p.name)).toEqual(source.record.names);expect(result.roster[1]).toMatchObject({participantId:'bob',team:'declarer',payoff:3});
 expect(result.rounds[0].plays.map(p=>p.participantId)).toEqual([result.roster[2].id,result.roster[0].id]);expect(result.rounds[0].plays[0]).toMatchObject({leader:true,powered:false,winner:false});expect(result.rounds[0].winnerId).toBe(result.roster[0].id);
 expect(result.rounds[1].plays[0].jokerLead).toEqual({value:{Color:'Red'},label:result.rounds[1].leadLabel});
 expect(result.matrix.rows).toHaveLength(5);expect(result.matrix.rows[0].cells.map(c=>c.kind)).toEqual(['card','blank']);expect(result.matrix.rows[1].cells.map(c=>c.kind)).toEqual(['blank','card']);expect(result.matrix.rows[3].cells.map(c=>c.kind)).toEqual(['blank','blank']);
 source.record.names[1]='Replacement Bob';source.record.participant_ids[1]='replacement';expect(result.roster[1].name).toBe('Old Bob');expect(result.roster[1].participantId).toBe('bob');expect(Object.isFrozen(result.matrix.rows[0].cells)).toBe(true);
 expect(result.details.points[0].cards).toHaveLength(2);expect(result.details.scoring).toEqual(['여당 18점 − 10 = 8','노프렌드 ×2 = 16']);
});
test('hidden discards are explained, never reconstructed from a privileged audience or hidden cache',()=>{
 const f=fixture(),result=projectMightyHistory(f);expect(result.status).toBe('available');if(result.status==='available')expect(result.details.discards).toMatchObject({kind:'hidden'});
 const view=f.record.view as View;view.viewer={Seat:1};view.hand=[{Normal:['Club',2]}];expect(projectMightyHistory(f)).toMatchObject({status:'unavailable',reason:'malformed'});
 view.viewer='Spectator';view.hand=[];if(typeof view.phase==='object'&&'Done'in view.phase)view.phase.Done.discards=[{Normal:['Club',2]}];expect(projectMightyHistory(f)).toMatchObject({status:'unavailable',reason:'malformed'});
});
test('public discards belong only to the recorded rule snapshot and reject duplicate physical cards',()=>{
 const f=fixture(),rules=f.record.rules as ReturnType<typeof presetRules>;rules.reveal_discards=true;const view=f.record.view as View;if(typeof view.phase!=='object'||!('Done'in view.phase))throw Error();view.phase.Done.discards=[{Normal:['Club',2]}];
 const result=projectMightyHistory(f);expect(result.status).toBe('available');if(result.status==='available')expect(result.details.discards).toMatchObject({kind:'public',cards:[{visual:{kind:'standard',suit:'Club',rank:2}}]});
 view.phase.Done.discards=[{Normal:['Spade',14]}];expect(projectMightyHistory(f)).toMatchObject({status:'unavailable',reason:'malformed'});
});
test('unknown rules and summary-only records return bounded explicit unavailable summaries',()=>{
 const f=fixture();expect(projectMightyHistory({...f,record:{contract:{trump:null,count:17},made:true}})).toMatchObject({status:'unavailable',reason:'summary-only'});
 expect(projectMightyHistory({...f,record:{...f.record,rules:{futureRules:true}}})).toMatchObject({status:'unavailable',reason:'unknown-rules'});
 expect(projectMightyHistory({...f,record:{...f.record,view:{viewer:'Spectator',phase:'Dealing'}}})).toMatchObject({status:'unavailable',reason:'malformed'});
});
test('duplicate round cards/seats, oversized records, foreign hand numbers and inert accessors refuse',()=>{
 const f=fixture(),view=f.record.view as View;if(typeof view.phase!=='object'||!('Done'in view.phase))throw Error();view.phase.Done.tricks[1].plays[0].card={Normal:['Spade',14]};expect(projectMightyHistory(f).status).toBe('unavailable');
 const next=fixture(),done=(next.record.view as View).phase;if(typeof done!=='object'||!('Done'in done))throw Error();done.Done.tricks[0].plays[1].seat=2;expect(projectMightyHistory(next).status).toBe('unavailable');
 expect(projectMightyHistory({...fixture(),identity:{...f.identity,handNumber:4}}).status).toBe('unavailable');
 let reads=0;const evil=Object.defineProperty(fixture(),'record',{get(){reads++;return f.record;}});expect(projectMightyHistory(evil).status).toBe('unavailable');expect(reads).toBe(0);
 const large=fixture();large.record.names[0]='x'.repeat(8193);expect(projectMightyHistory(large).status).toBe('unavailable');
});
test('lineage scopes historical identities without depending on current live room seats',()=>{
 const f=fixture(),a=projectMightyHistory(f),b=projectMightyHistory({...f,identity:{...f.identity,sessionId:3}});expect(a.status).toBe('available');expect(b.status).toBe('available');if(a.status==='available'&&b.status==='available'){expect(a.id).not.toBe(b.id);expect(a.roster[0].id).not.toBe(b.roster[0].id);expect(a.roster[0].participantId).toBe(b.roster[0].participantId);}
});

test('validated completion candidates contain only original-actor summary fields',()=>{
 const result=projectMightyHistory(fixture());expect(result.status).toBe('available');if(result.status!=='available')return;
 expect(result.completion).toMatchObject({identity:{sessionId:2,handNumber:3},made:true,alone:false,teamPoints:18,participants:expect.arrayContaining([{participantId:'alice',seat:0,role:'defense',won:false,payoff:-2,tookWithMighty:true},{participantId:'bob',seat:1,role:'declarer',won:true,payoff:3,tookWithMighty:false}])});
 expect(JSON.stringify(result.completion)).not.toContain('Normal');expect(JSON.stringify(result.completion)).not.toContain('Old Alice');
 const hidden=fixture(),v=hidden.record.view as View;if(typeof v.phase==='object'&&'Done'in v.phase)(v.phase.Done as unknown as {discards:null}).discards=null;expect(projectMightyHistory(hidden).status).toBe('available');
});

test('authoritative recorded origin must match the containing lineage; legacy catalog replay remains explicit',()=>{
 const source=fixture();Object.assign(source.record,{session_id:2});expect(projectMightyHistory(source).status).toBe('available');
 expect(projectMightyHistory({...source,identity:{...source.identity,sessionId:3}})).toMatchObject({status:'unavailable',reason:'malformed'});
 Object.assign(source.record,{session_id:null});expect(projectMightyHistory(source)).toMatchObject({status:'unavailable',reason:'malformed'});
 const legacy=fixture();expect(projectMightyHistory(legacy).status).toBe('available');
});

/** Full public record shape: all physical cards accounted for, ten complete
 * five-seat rounds, frozen original roster, and Shortfall settlement matching
 * native score.rs/state::settle with all optional doublings disabled. */
function maximumContractFixture():MightyHistoryInput&{record:RecordedHand}{
 const f=fixture(),rules=f.record.rules as ReturnType<typeof presetRules>;rules.bidding.max=255;rules.reveal_discards=true;
 Object.assign(rules.scoring,{lose:'Shortfall',no_trump:'Never',alone:'Never',run:false,back_run:'Never',full_contract:'Never',discards_to_declarer:false});
 const contract={trump:'Heart' as const,count:255},deck=deckCards(rules),declarer=1,friend=2;
 const tricks=Array.from({length:rules.hand_size},(_,round)=>({lead:{Suit:'Spade' as const},winner:round%rules.players,plays:deck.slice(round*rules.players,(round+1)*rules.players).map((card,seat)=>({seat,card,powered:true}))}));
 const pointsTaken=Array.from({length:rules.players},(_,seat)=>tricks.filter(trick=>trick.winner===seat).flatMap(trick=>trick.plays.map(play=>play.card).filter(isPoint)));
 const points=pointsTaken[declarer].length+pointsTaken[friend].length,short=255-points,value=-short;
 const payoffs=Array.from({length:rules.players},(_,seat)=>seat===declarer?value*2:seat===friend?value:-value);
 const view:View={viewer:'Spectator',rules,first_bidder:0,hand:[],hand_sizes:Array(rules.players).fill(0),points_taken:pointsTaken,bids:[{seat:declarer,contract}],redealt:null,phase:{Done:{declarer,friend,contract,call:{Seat:friend},team_points:points,payoffs,value:{contract,team_points:points,made:false,steps:[{Short:{contract:255,short,total:short}}],value},tricks,discards:deck.slice(rules.players*rules.hand_size)}}};
 f.record={...f.record,session_id:f.identity.sessionId,rules,view,payoffs};return f;
}
test('complete native-u8 maximum contract record retains scoring, roster, rounds, point cards and original identities',()=>{
 const f=maximumContractFixture(),result=projectMightyHistory(f);expect(result.status).toBe('available');if(result.status!=='available')throw Error('maximum native contract refused');
 const view=f.record.view as View;if(typeof view.phase!=='object'||!('Done'in view.phase))throw Error();const done=view.phase.Done;
 expect(done.contract.count).toBe(255);expect(done.value.value).toBe(-(255-done.team_points));expect(done.payoffs.reduce((sum,value)=>sum+value,0)).toBe(0);
 expect(result.details.contract.count).toBe(255);expect(result.completion.contract.count).toBe(255);expect(result.details.made).toBe(false);expect(result.rounds).toHaveLength(10);expect(result.rounds.every(round=>round.plays.length===5)).toBe(true);
 expect(result.roster.map(person=>person.participantId)).toEqual(f.record.participant_ids);expect(result.roster.map(person=>person.payoff)).toEqual(done.payoffs);expect(result.completion.participants[1]).toMatchObject({participantId:'bob',role:'declarer',payoff:done.payoffs[1],won:false});
 expect(result.details.scoring).toEqual([`공약 255에서 ${255-done.team_points}점 모자람`]);
 expect(result.details.points.reduce((sum,person)=>sum+person.cards.length,0)).toBe(view.points_taken.reduce((sum,cards)=>sum+cards.length,0));
 expect(result.details.discards.kind).toBe('public');if(result.details.discards.kind==='public')expect(result.rounds.reduce((sum,round)=>sum+round.plays.length,0)+result.details.discards.cards.length).toBe(deckCards(f.record.rules as ReturnType<typeof presetRules>).length);
});
test('native u8 contract boundary remains exact across done, scoring agreement and bid-history consumers',()=>{
 for(const count of [256,-1,1.5,Number.NaN])for(const surface of ['done','scoring','bid']){
  const f=maximumContractFixture(),view=f.record.view as View;if(typeof view.phase!=='object'||!('Done'in view.phase))throw Error();
  if(surface==='done')view.phase.Done.contract={...view.phase.Done.contract,count};else if(surface==='scoring')view.phase.Done.value.contract={...view.phase.Done.value.contract,count};else view.bids[0].contract={...view.bids[0].contract!,count};
  expect(projectMightyHistory(f)).toMatchObject({status:'unavailable',reason:'malformed'});
 }
});
