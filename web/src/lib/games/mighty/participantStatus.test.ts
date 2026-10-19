import {expect,test} from 'vitest';
import {projectMightyParticipantStatus,projectMightyStatusPresentation,projectMightyHistoricalParticipantStatus,projectMightyHistoricalParticipantStatuses} from './participantStatus';
import type {InformationPanel} from '../../table/foundation/contracts';
import type {StateMsg,PhaseView,View,RecordedHand,CommandScope} from './types';
import {presetRules} from './catalog';
const phase=():PhaseView=>({Bidding:{to_act:0,best:[1,{trump:'Heart',count:17}],passed:[true,true,false,false,false],has_bid:Array(5).fill(false)}});
const state=(value:PhaseView=phase()):StateMsg=>({view:{phase:value}} as StateMsg);
const panel:InformationPanel={id:'mighty-status',title:'상황판',primary:{value:{kind:'text',text:'공약 없음'}},summary:{text:'내 차례',tone:'accent'},fields:[{id:'minimum',label:'최소',value:{kind:'number',value:14}},{id:'bidder',label:'공약자',value:{kind:'participant',participantId:'p1'}},{id:'declarer',label:'주공',value:{kind:'participant',participantId:'p1'}},{id:'friend',label:'프렌드',value:{kind:'text',text:'첫 라운드'}},{id:'round',label:'라운드',value:{kind:'text',text:'3/10'}}],progress:{label:'점수 카드',total:20,series:[{id:'team',label:'여당',value:3,tone:'gold',from:'start'}]}};
test('public best bid takes precedence over pass, no-trump stays exact and unmarked seats stay empty',()=>{
 const s=state();expect(projectMightyParticipantStatus(s,1)).toEqual({purpose:'announcement',tone:'plain',value:{kind:'inline',values:[{kind:'suit',suit:'Heart',label:'♥'},{kind:'number',value:17}]}});expect(projectMightyParticipantStatus(s,0)).toEqual({purpose:'announcement',tone:'muted',muted:true,value:{kind:'text',text:'패스'}});expect(projectMightyParticipantStatus(s,2)).toBeUndefined();
 const p=phase();if(typeof p!=='object'||!('Bidding'in p))throw Error();p.Bidding.best=[1,{trump:null,count:255}];expect(projectMightyParticipantStatus(state(p),1)?.value).toEqual({kind:'inline',values:[{kind:'text',text:'노기루다'},{kind:'number',value:255}]});
});
test('player and observer projections use only public bidding without reading hands or unrelated state',()=>{
 const s=state();let calls=0;const trap={get(){calls++;throw Error('private');},enumerable:true};Object.defineProperty(s.view,'hand',trap);Object.defineProperty(s,'command',trap);Object.defineProperty(s.view,'viewer',trap);
 const result=projectMightyParticipantStatus(s,1);expect(result).toBeDefined();expect(Object.isFrozen(result!.value)).toBe(true);expect(calls).toBe(0);expect(projectMightyParticipantStatus(s,-1)).toBeUndefined();expect(projectMightyParticipantStatus(s,5)).toBeUndefined();expect(projectMightyParticipantStatus(null,0)).toBeUndefined();expect(projectMightyParticipantStatus(state('Dealing'),0)).toBeUndefined();
});
test('malformed public contracts/counts/accessors never execute or invent a label',()=>{
 const s=state();const p=s.view.phase;if(typeof p!=='object'||!('Bidding'in p))throw Error();p.Bidding.best![1].count=256;expect(projectMightyParticipantStatus(s,1)).toBeUndefined();let calls=0;Object.defineProperty(p.Bidding,'passed',{get(){calls++;return [];}});expect(projectMightyParticipantStatus(s,1)).toBeUndefined();expect(calls).toBe(0);
});
test('compact references select current exact information IDs, never copy values or unrelated panels',()=>{
 const p=phase();if(typeof p!=='object'||!('Bidding'in p))throw Error();expect(projectMightyStatusPresentation([panel],p)).toEqual({informationId:'mighty-status',fieldIds:['bidder'],primary:true,summary:true,progress:true});p.Bidding.best=null;expect(projectMightyStatusPresentation([panel],p)?.fieldIds).toEqual(['minimum']);
 const play={Play:{}} as PhaseView;expect(projectMightyStatusPresentation([panel],play)?.fieldIds).toEqual(['declarer','friend','round']);expect(projectMightyStatusPresentation([panel],{Exchange:{}} as PhaseView)?.fieldIds).toEqual([]);expect(projectMightyStatusPresentation([panel],null)).toBeUndefined();expect(projectMightyStatusPresentation([panel],{Done:{}} as PhaseView)).toBeUndefined();expect(projectMightyStatusPresentation([{...panel,id:'foreign'}],p)).toBeUndefined();expect(projectMightyStatusPresentation([panel,panel],p)).toBeUndefined();
 const result=projectMightyStatusPresentation([panel],p)!;expect(Object.isFrozen(result.fieldIds)).toBe(true);expect(JSON.stringify(result)).not.toContain('공약 없음');
});

test('caller mutation cannot rewrite an owned badge and each projection observes current public values',()=>{
 const s=state(),first=projectMightyParticipantStatus(s,1)!;const phase=s.view.phase;if(typeof phase!=='object'||!('Bidding'in phase))throw Error();phase.Bidding.best![1].count=20;expect(JSON.stringify(first)).toContain('17');expect(JSON.stringify(projectMightyParticipantStatus(s,1))).toContain('20');
 let calls=0;const copy={...panel,fields:panel.fields.map(field=>({...field}))};Object.defineProperty(copy.fields[0],'value',{get(){calls++;throw Error('must not materialize referenced values');}});phase.Bidding.best=null;expect(projectMightyStatusPresentation([copy],phase)?.fieldIds).toEqual(['minimum']);expect(calls).toBe(0);
});

function playing(friend:number|null=null):StateMsg{return {view:{phase:{Play:{declarer:0,friend,call:{Card:{Normal:['Heart',14]}},no_friend:false,plays:[],tricks:[]}},points_taken:[[{Normal:['Spade',10]}],[{Normal:['Club',2]},{Normal:['Heart',13]}],[],[],[]]}} as unknown as StateMsg;}
test('public Play roles and captured points are distinct; hidden friend is never inferred from private data',()=>{
 const hidden=playing();let privateReads=0;const trap={get(){privateReads++;throw Error('private');},enumerable:true};Object.defineProperty(hidden.view,'hand',trap);Object.defineProperty(hidden.view,'viewer',trap);const play=(hidden.view.phase as Extract<PhaseView,{Play:unknown}>).Play;Object.defineProperty(play,'no_friend',trap);
 expect(projectMightyParticipantStatus(hidden,0)).toEqual({purpose:'standing',value:{kind:'text',text:'주공'},tone:'gold',badges:[{text:'1점',tone:'plain'}]});
 expect(projectMightyParticipantStatus(hidden,1)).toEqual({purpose:'standing',value:{kind:'text',text:'1점'},tone:'plain'});expect(projectMightyParticipantStatus(hidden,2)).toBeUndefined();expect(privateReads).toBe(0);
 const revealed=playing(1);expect(projectMightyParticipantStatus(revealed,1)).toEqual({purpose:'standing',value:{kind:'text',text:'프렌드'},tone:'accent',badges:[{text:'1점',tone:'plain'}]});expect(projectMightyParticipantStatus(revealed,2)).toEqual({purpose:'standing',value:{kind:'text',text:'야당'},tone:'plain'});
});
test('public no-friend proof uses Alone, explicit own-seat call, first-trick winner or the declarer playing the called card',()=>{
 for(const patch of [{call:'Alone'},{call:{Seat:0}},{call:'FirstTrick',tricks:[{winner:0,plays:[]}]},{plays:[{seat:0,card:{Normal:['Heart',14]}}]},{tricks:[{winner:2,plays:[{seat:0,card:{Normal:['Heart',14]}}]}]}]){
  const s=playing(),play=(s.view.phase as Extract<PhaseView,{Play:unknown}>).Play;Object.assign(play,patch);expect(projectMightyParticipantStatus(s,2)).toEqual({purpose:'standing',value:{kind:'text',text:'야당'},tone:'plain'});
 }
 const s=playing(),play=(s.view.phase as Extract<PhaseView,{Play:unknown}>).Play;play.no_friend=true;expect(projectMightyParticipantStatus(s,2)).toBeUndefined();
 Object.assign(play,{tricks:[{winner:0,plays:[{seat:1,card:{Normal:['Heart',14]}}]}]});expect(projectMightyParticipantStatus(s,2)).toBeUndefined();
});
test('captured-point rows are bounded owned data, omit zero-count badges and reject malformed or accessor cards',()=>{
 const s=playing(1),first=projectMightyParticipantStatus(s,0)!;expect(Object.isFrozen(first.badges)).toBe(true);s.view.points_taken[0].push({Normal:['Diamond',12]});expect(first.badges![0].text).toBe('1점');expect(projectMightyParticipantStatus(s,0)?.badges?.[0].text).toBe('2점');
 s.view.points_taken[0]=[];expect(projectMightyParticipantStatus(s,0)?.badges).toBeUndefined();let reads=0;Object.defineProperty(s.view.points_taken[0],0,{get(){reads++;return {Normal:['Club',14]};}});expect(projectMightyParticipantStatus(s,0)).toBeUndefined();expect(reads).toBe(0);
 expect(projectMightyParticipantStatus(playing(),-1)).toBeUndefined();expect(projectMightyParticipantStatus(playing(),5)).toBeUndefined();
});
function historical(){
 const rules=presetRules('default'),contract={trump:'Heart' as const,count:17};
 const view:View={viewer:'Spectator',rules,first_bidder:0,hand:[],hand_sizes:[0,0,0,0,0],points_taken:[[],[],[],[],[]],bids:[],redealt:null,phase:{Done:{declarer:1,friend:2,contract,call:'FirstTrick',team_points:2,payoffs:[2,-3,-3,2,2],value:{contract,team_points:2,made:false,steps:[],value:-3},tricks:[{lead:{Suit:'Spade'},winner:1,plays:[{seat:1,card:{Normal:['Spade',14]},powered:true},{seat:2,card:{Normal:['Spade',10]},powered:false}]}],discards:[]}}};
 const record:RecordedHand={session_id:2,number:3,names:['Alice','Bob','Carol','Dan','Eve'],participant_ids:['alice','bob','carol','dan','eve'],payoffs:[2,-3,-3,2,2],rules,view};
 const scope:CommandScope={domain:'room',room_id:'room',room_epoch:'epoch',session_id:2,hand:3,version:10,actor_id:'alice',seat:0};
 const identity={roomId:'room',roomEpoch:'epoch',sessionId:2,handNumber:3};return {record,scope,identity};
}
test('Done roles and captured points bind original participant IDs, never replacement seat occupants',()=>{
 const input=historical(),all=projectMightyHistoricalParticipantStatuses(input);expect(all).toHaveLength(5);expect(Object.isFrozen(all)).toBe(true);
 expect(projectMightyHistoricalParticipantStatus({...input,participantId:'bob'})).toEqual({purpose:'standing',value:{kind:'text',text:'주공'},tone:'gold',badges:[{text:'2점',tone:'plain'}]});
 expect(projectMightyHistoricalParticipantStatus({...input,participantId:'carol'})).toEqual({purpose:'standing',value:{kind:'text',text:'프렌드'},tone:'accent'});
 expect(projectMightyHistoricalParticipantStatus({...input,participantId:'replacement-bob'})).toBeUndefined();expect(projectMightyParticipantStatus({view:input.record.view} as StateMsg,1)).toBeUndefined();
 const retained=all[1].status;input.record.participant_ids[1]='replacement-bob';expect(retained.value).toEqual({kind:'text',text:'주공'});expect(all[1].id).toBe('bob');
});
test('historical badges reject stale/foreign scope, future origin, privileged views and duplicate original IDs',()=>{
 const input=historical();for(const change of [{room_id:'foreign'},{room_epoch:'foreign'},{session_id:3}])expect(projectMightyHistoricalParticipantStatuses({...input,scope:{...input.scope,...change}})).toEqual([]);
 const future=historical();future.record.session_id=3;expect(projectMightyHistoricalParticipantStatuses(future)).toEqual([]);
 const privileged=historical();(privileged.record.view as View).viewer={Seat:1};(privileged.record.view as View).hand=[{Normal:['Club',2]}];expect(projectMightyHistoricalParticipantStatuses(privileged)).toEqual([]);
 const duplicate=historical();duplicate.record.participant_ids[2]='bob';expect(projectMightyHistoricalParticipantStatuses(duplicate)).toEqual([]);
});

test('native hand_stats counter is independent of recorded hand number and old origin survives a score-period reset',()=>{
 const input=historical();input.scope.hand=7;expect(input.record.number).toBe(3);expect(projectMightyHistoricalParticipantStatuses(input)).toHaveLength(5);
 const reset={...input,scope:{...input.scope,session_id:3},identity:{...input.identity,sessionId:3}};expect(input.record.session_id).toBe(2);expect(projectMightyHistoricalParticipantStatuses(reset)).toHaveLength(5);
 expect(projectMightyHistoricalParticipantStatuses({...input,identity:{...input.identity,handNumber:2}})).toEqual([]);
});

test('Exchange announces only its public declarer without inspecting privileged exchange cards or private caches',()=>{
 const s={view:{phase:{Exchange:{declarer:1}},hand_sizes:[10,13,10,10,10]}} as unknown as StateMsg;let reads=0;const trap={get(){reads++;throw Error('private');},enumerable:true};
 for(const key of ['hand','viewer','points_taken','cache'])Object.defineProperty(s.view,key,trap);
 const exchange=(s.view.phase as Extract<PhaseView,{Exchange:unknown}>).Exchange;for(const key of ['discards','no_friend','contract'])Object.defineProperty(exchange,key,trap);
 expect(projectMightyParticipantStatus(s,1)).toEqual({purpose:'standing',value:{kind:'text',text:'주공'},tone:'gold'});for(const seat of [0,2,3,4])expect(projectMightyParticipantStatus(s,seat)).toBeUndefined();expect(reads).toBe(0);
});
test('Exchange requires a current bounded public roster and exact valid declarer/subject seats',()=>{
 const make=(declarer:number,sizes:unknown=[10,13,10,10,10])=>({view:{phase:{Exchange:{declarer}},hand_sizes:sizes}} as unknown as StateMsg);
 for(const declarer of [-1,5,1.5])expect(projectMightyParticipantStatus(make(declarer),1)).toBeUndefined();for(const seat of [-1,5,1.5])expect(projectMightyParticipantStatus(make(1),seat)).toBeUndefined();
 for(const sizes of [[],[13],Array(9).fill(10),[10,55,10],[10,-1,10],[10,1.5,10]])expect(projectMightyParticipantStatus(make(1,sizes),1)).toBeUndefined();
 let reads=0;const sizes=[10,13,10,10,10];Object.defineProperty(sizes,1,{get(){reads++;return 13;}});expect(projectMightyParticipantStatus(make(1,sizes),1)).toBeUndefined();expect(reads).toBe(0);
});

test('Play status references all three existing public fields without reading their values or private phase details',()=>{
 let reads=0;const fields=panel.fields.map(field=>({...field}));for(const field of fields)Object.defineProperty(field,'value',{enumerable:true,get(){reads++;throw Error('must reference canonical public information');}});
 const play={};for(const key of ['friend','no_friend','discards','hand'])Object.defineProperty(play,key,{get(){reads++;throw Error('private phase');}});
 const result=projectMightyStatusPresentation([{...panel,fields}],{Play:play} as PhaseView)!;
 expect(result).toEqual({informationId:'mighty-status',fieldIds:['declarer','friend','round'],primary:true,summary:true,progress:true});expect(reads).toBe(0);expect(Object.isFrozen(result.fieldIds)).toBe(true);
 expect(projectMightyStatusPresentation([{...panel,fields:panel.fields.filter(field=>field.id!=='friend')}],{Play:play} as PhaseView)?.fieldIds).toEqual(['declarer','round']);
});
