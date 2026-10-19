import {expect,test} from 'vitest';
import {CATALOG} from '../../catalog';
import {captureAssistance,resolveAssistanceIntent} from '../../table/foundation/assistance';
import {createMightyAssistance,type MightyAssistanceInput} from './assistance';
import {presetRules} from './catalog';
import {cardKey} from './cards';
import {mightyDocument} from './foundation';
import {refusalText} from './ledger';
import type {RoomView,StateMsg} from './types';
function fixture():MightyAssistanceInput {
    const room:RoomView={id:'live',game:'mighty',protocol:CATALOG.protocol,settings:{preset:'default'},rules:presetRules('default'),customized:false,seats:Array.from({length:5},(_,i)=>({kind:'human',name:`P${i}`,connected:true,away:false})),in_hand:true,showing:true,table:{turn_secs:0,shuffle:false,shuffle_next:false},clock:null,watching:0,observers:[],ready:Array(5).fill(true),participant_ids:['p0','p1','p2','p3','p4'],participation:[],scores:[1,2,3,4,5],hands_played:0,history:[],hands:[]};
    const state:StateMsg={version:7,grace_ms:0,turn:{Seat:0},legal:[{Play:{card:{Normal:['Spade',14]},joker_lead:null,call_joker:false}}],out_of_turn:[],notes:{unplayable:[{card:{Normal:['Heart',2]},why:{MustFollow:{Suit:'Spade'}}}],contracts:[]},view:{viewer:{Seat:0},rules:presetRules('default'),first_bidder:0,hand:[{Normal:['Spade',14]},{Normal:['Heart',2]}],hand_sizes:[2,8,9,9,10],points_taken:[[],[],[],[],[]],bids:[],redealt:null,phase:{Play:{declarer:1,contract:{trump:'Heart',count:17},call:'Alone',friend:null,no_friend:true,trick_no:1,leader:0,lead:null,plays:[],leading:null,called_joker:null,tricks:[],discards:null}}}};
    const client={room,game:state,seat:0,viewerId:'p0',viewerName:'P0',status:'open' as const};
    state.command={scope:{domain:'game',room_id:'live',room_epoch:'epoch',session_id:0,hand:0,version:7,seat:0,actor_id:'p0'},next_sequence:1};
    return {client,document:mightyDocument(client,1)!,roomEpoch:'epoch',connectionEpoch:'connection',publicationReady:true,graceReady:true,preferences:{hints:true,tips:true}};
}
test('actual Mighty canonical offers supply exact advice and server-authored blocked-card reasons',()=>{
    const input=fixture(),base=createMightyAssistance(input)!;expect(base).not.toBeNull();
    const result=createMightyAssistance({...input,nativeHint:{scope:{connectionEpoch:'connection',command:input.client.game!.command!.scope,gameVersion:7},action:input.client.game!.legal[0]}})!;
    expect(result.projection.advice?.actionId).toBe(input.document.offer.actions[0].id);
    expect(result.projection.advice?.cardIds).toEqual([cardKey({Normal:['Spade',14]})]);
    expect(result.projection.inspections).toEqual([{cardId:cardKey({Normal:['Heart',2]}),reason:refusalText({MustFollow:{Suit:'Spade'}})}]);
    expect(result.projection.guidance).toBeTruthy();
    expect(input.document.hand).toHaveLength(2);expect(Object.isFrozen(result.projection)).toBe(true);
});
test('native infrastructure policy disables advice and retires a now-unavailable same-version hint',()=>{
 const input=fixture(),state=input.client.game!,hint={scope:{connectionEpoch:input.connectionEpoch,command:state.command!.scope,gameVersion:state.version},action:state.legal[0]};
 Object.assign(state,{policy_actions:{legal:[],out_of_turn:[]}});
 const projection=createMightyAssistance({...input,document:mightyDocument(input.client,2)!,nativeHint:hint})!;expect(projection.projection.advice).toBeUndefined();
 expect(projection.projection.tools.find(tool=>tool.kind==='request-advice')).toMatchObject({enabled:false});
});
test('private advice cannot be restamped across a turn, connection, audience or generation',()=>{
    const input=fixture(),base=createMightyAssistance(input)!;
    const nativeScope={connectionEpoch:'connection',command:input.client.game!.command!.scope,gameVersion:7};
    for(const scope of [{...nativeScope,gameVersion:6},{...nativeScope,command:{...nativeScope.command,actor_id:'p1'}},{...nativeScope,connectionEpoch:'old'},{...nativeScope,command:{...nativeScope.command,hand:9}},{...nativeScope,command:{...nativeScope.command,session_id:9}},{...nativeScope,command:{...nativeScope.command,room_epoch:'old'}}]){
        expect(createMightyAssistance({...input,nativeHint:{scope,action:input.client.game!.legal[0]}})!.projection.advice).toBeUndefined();
    }
    expect(createMightyAssistance({...input,nativeHint:{scope:{connectionEpoch:'connection',command:input.client.game!.command!.scope,gameVersion:7},action:'Pass'}})!.projection.advice).toBeUndefined();
    const newer={...input,document:mightyDocument(input.client,2)!};
    expect(createMightyAssistance({...newer,nativeHint:{scope:{connectionEpoch:'connection',command:input.client.game!.command!.scope,gameVersion:7},action:input.client.game!.legal[0]}})!.projection.advice).toBeDefined();
    const capture=captureAssistance(base,base.bindings.authority,'advice')!;
    const replacement=createMightyAssistance(newer)!;expect(resolveAssistanceIntent(replacement,replacement.bindings.authority,capture)).toBeNull();
});
test('revoked publication, foreign viewer and forged own identity expose no assistance',()=>{
    const input=fixture();expect(createMightyAssistance({...input,publicationReady:false})).toBeNull();
    const foreign=fixture();foreign.client.game!.view.viewer={Seat:1};expect(createMightyAssistance(foreign)).toBeNull();
    const forged=fixture();Object.assign(forged.client,{viewerId:'p1'});expect(createMightyAssistance(forged)).toBeNull();
    const waiting=createMightyAssistance({...input,graceReady:false})!;expect(waiting.projection.advice).toBeUndefined();expect(waiting.projection.inspections).toEqual([]);expect(waiting.projection.tools.map(t=>t.kind)).toEqual(['send-reaction']);
});
test('approved active reactions retain ingress IDs across projection and ignore unknown people/text',()=>{
    const input=fixture(),withReactions={...input,nativeReactions:[{roomId:'live',roomEpoch:'epoch',connectionEpoch:'connection',eventId:'reaction:connection:4',participantId:'p1',text:CATALOG.reactions[0]},{roomId:'live',roomEpoch:'epoch',connectionEpoch:'connection',eventId:'reaction:connection:5',participantId:'p2',text:'unapproved'},{roomId:'live',roomEpoch:'epoch',connectionEpoch:'connection',eventId:'reaction:connection:6',participantId:'stranger',text:CATALOG.reactions[0]}]};
    const a=createMightyAssistance(withReactions)!;
    expect(a.projection.reactions).toEqual([{eventId:'reaction:connection:4',participantId:'p1',text:CATALOG.reactions[0]}]);
    expect(createMightyAssistance({...withReactions,connectionEpoch:'new'})!.projection.reactions).toEqual([]);
    input.client.room!.participant_ids![1]='replacement';
    const b=createMightyAssistance({...withReactions,document:mightyDocument(input.client,2)!})!;expect(b.projection.reactions).toEqual([]);
    const reaction=a.projection.tools.find(t=>t.kind==='send-reaction')!;if(reaction.kind!=='send-reaction')throw Error();
    const intent=captureAssistance(a,a.bindings.authority,reaction.id,reaction.options[0].id)!;
    expect(resolveAssistanceIntent(a,a.bindings.authority,intent)).toMatchObject({kind:'send-reaction',text:CATALOG.reactions[0]});
});
test('spectators retain reaction tools but receive no own-hand advice, reasons or novice private projection',()=>{
    const input=fixture();input.client.room!.observers=[{id:'watcher',name:'Watcher',requested:false}];input.client.room!.watching=1;
    Object.assign(input.client,{seat:null,viewerId:'watcher',viewerName:'Watcher'});input.client.game!.command=undefined;input.client.game!.view.viewer='Spectator';input.client.game!.view.hand=[];input.client.game!.legal=[];input.client.game!.notes.unplayable=[];
    const result=createMightyAssistance({...input,document:mightyDocument(input.client,1)!})!;
    expect(result).not.toBeNull();expect(result.bindings.handIds).toEqual([]);expect(result.bindings.actions).toEqual([]);expect(result.projection.advice).toBeUndefined();expect(result.projection.guidance).toBeUndefined();expect(result.projection.inspections).toEqual([]);
});
