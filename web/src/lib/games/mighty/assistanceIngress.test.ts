import {expect,test,vi} from 'vitest';
import {CATALOG} from '../../catalog';
import {createMightyAssistance,type MightyAssistanceInput} from './assistance';
import {presetRules} from './catalog';
import {cardKey} from './cards';
import {mightyDocument,type MightyCommand} from './foundation';
import type {RoomView,StateMsg,MightySettings} from './types';
import {connectedDocument,type HostCommand} from '../../table/foundation/connectedDocument';
import {createCardSession} from '../../table/foundation/session';
function fixture():MightyAssistanceInput {
    const room:RoomView={id:'live',game:'mighty',protocol:CATALOG.protocol,settings:{preset:'default'},rules:presetRules('default'),customized:false,seats:Array.from({length:5},(_,i)=>({kind:'human',name:`P${i}`,connected:true,away:false})),in_hand:true,showing:true,table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:0,observers:[],ready:Array(5).fill(true),participant_ids:['p0','p1','p2','p3','p4'],participation:[],scores:[1,2,3,4,5],hands_played:0,history:[],hands:[]};
    const state:StateMsg={version:7,grace_ms:0,turn:{Seat:0},legal:[{Play:{card:{Normal:['Spade',14]},joker_lead:null,call_joker:false}}],out_of_turn:[],notes:{unplayable:[{card:{Normal:['Heart',2]},why:{MustFollow:{Suit:'Spade'}}}],contracts:[]},view:{viewer:{Seat:0},rules:presetRules('default'),first_bidder:0,hand:[{Normal:['Spade',14]},{Normal:['Heart',2]}],hand_sizes:[2,8,9,9,10],points_taken:[[],[],[],[],[]],bids:[],redealt:null,phase:{Play:{declarer:1,contract:{trump:'Heart',count:17},call:'Alone',friend:null,no_friend:true,trick_no:1,leader:0,lead:null,plays:[],leading:null,called_joker:null,tricks:[],discards:null}}}};
    const client={room,game:state,seat:0,viewerId:'p0',viewerName:'P0',status:'open' as const};
    state.command={scope:{domain:'game',room_id:'live',room_epoch:'epoch',session_id:0,hand:0,version:7,seat:0,actor_id:'p0'},next_sequence:1};
    return {client,document:mightyDocument(client,1)!,roomEpoch:'epoch',connectionEpoch:'connection',publicationReady:true,graceReady:true,preferences:{hints:true,tips:true}};
}

test('ambiguous same-card Joker commands retain canonical card references through the actual connected session ingress',()=>{
 const input=fixture(),state=input.client.game!,joker={Joker:'Black'} as const;state.view.hand=[joker,{Normal:['Heart',2]}];state.legal=[{Play:{card:joker,joker_lead:{Suit:'Spade'},call_joker:false}},{Play:{card:joker,joker_lead:{Suit:'Heart'},call_joker:false}}];state.notes.unplayable=[{card:{Normal:['Heart',2]},why:{MustFollow:{Suit:'Spade'}}}];
 const source=mightyDocument(input.client,1)!,advice=createMightyAssistance({...input,document:source,nativeHint:{scope:{connectionEpoch:'connection',command:state.command!.scope,gameVersion:7},action:state.legal[0]}})!;
 expect(source.decision.kind).toBe('card-selection');if(source.decision.kind!=='card-selection')throw Error('selection');expect(source.decision.disambiguation).toBe('choose-action');expect(source.decision.variants.map(row=>row.actionId)).toEqual(source.offer.actions.map(action=>action.id));expect(source.decision.variants.every(row=>row.cardIds.length===1&&row.cardIds[0]===cardKey(joker))).toBe(true);expect(source.decision.commands).toEqual([]);expect(advice.projection.advice?.cardIds).toEqual([cardKey(joker)]);expect(advice.projection.inspections.some(item=>item.cardId===cardKey(joker))).toBe(false);
 const roomWindow={scope:{...state.command!.scope,domain:'room' as const},next_sequence:1},wrapped=connectedDocument({...source,assistance:advice},{roomCode:'live',client:input.client,roomWindow});const send=vi.fn(),session=createCardSession<HostCommand<MightyCommand,MightySettings>>({transport:send});
 expect(()=>session.receive(wrapped)).not.toThrow();expect(session.snapshot().document!.assistance!.projection.advice?.label).toBe(advice.projection.advice?.label);expect(send).not.toHaveBeenCalled();
 const command=session.snapshot().document!.offer.actions.find(action=>action.id===advice.projection.advice!.actionId)!;if(command.kind!=='command')throw Error('command');expect(command.cardIds).toEqual([cardKey(joker)]);expect(Object.isFrozen(command.cardIds)).toBe(true);
 const forged={...wrapped,offer:{...wrapped.offer,actions:wrapped.offer.actions.map(action=>action.id===command.id?{...action,cardIds:['foreign-hand-card']}:action)}};expect(()=>session.receive(forged)).toThrow('Foreign command hand reference');
});
