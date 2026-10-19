import {expect,test} from 'vitest';
import {projectPokerParticipantStatus,projectPokerStatusPresentation} from './participantStatus';
import type {InformationPanel} from '../../table/foundation/contracts';
import type {PokerView} from '../../generated/protocol';
import type {StateMsg} from './types';
const view=():PokerView=>({over:false,street:'flop',players:[{seat:0,folded:true,all_in:false},{seat:1,folded:false,all_in:true},{seat:2,folded:false,all_in:false}]} as PokerView);
const state=(value:PokerView):StateMsg=>({view:value} as StateMsg);
const panel:InformationPanel={id:'poker:status',title:'상황판',summary:{text:'내 차례',tone:'accent'},primary:{label:'팟',value:{kind:'number',value:20}},fields:[{id:'street',label:'스트리트',value:{kind:'text',text:'플롭'}},{id:'current-bet',label:'현재 총 베팅',value:{kind:'number',value:8}},{id:'dealer',label:'딜러',value:{kind:'text',text:'선수'}}]};
test('public fold/all-in persist without inferring unpublished check/call/raise actions',()=>{
 const s=state(view());expect(projectPokerParticipantStatus(s,0)).toEqual({value:{kind:'text',text:'폴드'},tone:'muted',muted:true});expect(projectPokerParticipantStatus(s,1)).toEqual({value:{kind:'text',text:'올인'},tone:'accent'});expect(projectPokerParticipantStatus(s,2)).toBeUndefined();expect(projectPokerParticipantStatus(s,3)).toBeUndefined();s.view.over=true;expect(projectPokerParticipantStatus(s,1)).toBeUndefined();expect(projectPokerParticipantStatus(null,1)).toBeUndefined();
});
test('observer/player private holes, board, payoffs and commands never enter participant meaning',()=>{
 const v=view();let calls=0;const trap={get(){calls++;throw Error('private');},enumerable:true};for(const player of v.players)Object.defineProperty(player,'hole',trap);Object.defineProperty(v,'board',trap);Object.defineProperty(v,'payoffs',trap);const s=state(v);Object.defineProperty(s,'command',trap);expect(projectPokerParticipantStatus(s,1)).toBeDefined();expect(calls).toBe(0);const status=projectPokerParticipantStatus(s,0)!;expect(Object.isFrozen(status.value)).toBe(true);
 v.players[2].seat=1;expect(projectPokerParticipantStatus(s,1)).toBeUndefined();
});
test('compact poker selects existing pot/summary/street/bet references, with no Mighty or inferred data',()=>{
 const v=view(),result=projectPokerStatusPresentation([panel],v)!;expect(result).toEqual({informationId:'poker:status',fieldIds:['street','current-bet'],primary:true,summary:true});expect(Object.isFrozen(result.fieldIds)).toBe(true);expect(JSON.stringify(result)).not.toMatch(/공약|기루다|20|플롭/);v.over=true;expect(projectPokerStatusPresentation([panel],v)).toBeUndefined();expect(projectPokerStatusPresentation([panel],null)).toBeUndefined();expect(projectPokerStatusPresentation([{...panel,id:'foreign'}],view())).toBeUndefined();expect(projectPokerStatusPresentation([panel,panel],view())).toBeUndefined();
});

test('unknown public street or accessor flags refuse without reading private data',()=>{
 const v=view();Object.assign(v,{street:'unknown'});expect(projectPokerParticipantStatus(state(v),0)).toBeUndefined();Object.assign(v,{street:'river'});let calls=0;Object.defineProperty(v.players[0],'folded',{get(){calls++;return true;}});expect(projectPokerParticipantStatus(state(v),0)).toBeUndefined();expect(calls).toBe(0);
});
