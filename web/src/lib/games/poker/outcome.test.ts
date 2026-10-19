import {expect,test} from 'vitest';
import type {CommandScope} from '../../generated/protocol';
import type {TableDocument} from '../../table/foundation/contracts';
import {createCardSession} from '../../table/foundation/session';
import {createPokerOutcome} from './outcome';
import type {PokerCommand} from './foundation';
import type {RoomView} from './types';
function fixture(){
 const room={id:'poker',game:'poker',in_hand:false,showing:true,session_id:2,hands_played:3,current_hand:{number:3,names:['Old A','Old B'],participant_ids:['a','b'],payoffs:[10,-10],rules:{players:2,starting_stack:200},view:{viewer:null,over:true,payoffs:[10,-10]}},participant_ids:['a','b'],seats:[]} as unknown as RoomView;
 const roomScope:CommandScope={domain:'room',room_id:'poker',room_epoch:'e'.repeat(32),session_id:2,hand:3,version:4,actor_id:'a',seat:0};
 const document:TableDocument<PokerCommand>={context:{session:'poker',audience:'a',generation:'2',revision:'1'},participant:{id:'a',name:'New A',markers:[]},hand:[{id:'own',label:'내 카드',visual:{kind:'standard',suit:'Spade',rank:14}}],facts:[],offer:{id:'offer',actions:[{id:'next',label:'새 독립 판',kind:'command',enabled:true,intent:'primary',action:{kind:'room',stamp:'scope',action:{type:'start'}}}]},decision:{kind:'commands',id:'decision',commands:['next']}};
 return {room,roomScope,document,client:{room,game:null,seat:0,viewerId:'a',viewerName:'New A'}};
}
test('Poker settles original participant payoff and exact continuation without replacing retained cards',()=>{
 const input=fixture(),before=structuredClone(input.document.hand),result=createPokerOutcome(input)!;expect(result.information.primary).toMatchObject({value:{text:'+10칩'}});expect(result.information.fields[0]).toMatchObject({label:'Old A'});expect(result.outcome.continuationActionIds).toEqual(['next']);expect(input.document.hand).toEqual(before);
 const session=createCardSession<PokerCommand>({transport:()=>{}});session.receive({...input.document,outcome:result.outcome,information:[result.information]});expect(session.snapshot().document?.hand).toEqual(before);
});
test('a replacement or uninvolved observer cannot inherit historical payoff',()=>{
 const f=fixture();f.client.viewerId='replacement';f.roomScope.actor_id='replacement';f.room.participant_ids![0]='replacement';const result=createPokerOutcome(f)!;expect(result.information.primary).toBeUndefined();expect(result.information.fields[0]).toMatchObject({id:'participation'});expect(result.information.fields[1].label).toBe('Old A');
});
test('foreign scope, unsettled and malformed public payoff records refuse',()=>{
 const f=fixture();expect(createPokerOutcome({...f,roomScope:{...f.roomScope,actor_id:'foreign'}})).toBeNull();f.room.in_hand=true;expect(createPokerOutcome(f)).toBeNull();f.room.in_hand=false;(f.room.current_hand!.view as {payoffs:number[]}).payoffs[0]=20;expect(createPokerOutcome(f)).toBeNull();
});
test('private or unrelated replay content never enters generic outcome data',()=>{
 const f=fixture();Object.assign(f.room.current_hand!.view as object,{private:'DO_NOT_RENDER'});const result=createPokerOutcome(f)!;expect(JSON.stringify(result)).not.toContain('DO_NOT_RENDER');expect(result.outcome.id).toBe(createPokerOutcome({...f,roomScope:{...f.roomScope,version:5}})!.outcome.id);
});
