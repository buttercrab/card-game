import {expect,test} from 'vitest';
import {captureNativeAdvice,captureNativeReaction,nativeAdviceCurrent,type NativeAdviceAuthority} from './ephemeral';
const authority=():NativeAdviceAuthority<{Play:string}>=>({connectionEpoch:'1',publicationReady:true,connected:true,actorId:'alice',seat:0,roomId:'room',participantId:'alice',command:{domain:'game',room_id:'room',room_epoch:'epoch',session_id:1,hand:2,version:3,seat:0,actor_id:'alice'},gameVersion:3,viewerSeat:0,turnSeat:0,legal:[{Play:'ace'}]});
test('private advice owns the exact receive-time command and action without hidden state',()=>{
 const a=authority(),action={Play:'ace'},hint=captureNativeAdvice(a,3,action)!;
 expect(hint).toEqual({scope:{connectionEpoch:'1',command:a.command,gameVersion:3},action});expect(Object.isFrozen(hint.scope.command)).toBe(true);
 action.Play='mutated';a.command!.actor_id='changed';expect(hint.action.Play).toBe('ace');expect(hint.scope.command.actor_id).toBe('alice');
});
test('wrong action/version/turn/viewer/actor/publication/socket authority is refused and revokes a prior hint',()=>{
 const a=authority(),hint=captureNativeAdvice(a,3,{Play:'ace'})!;
 expect(captureNativeAdvice(a,2,{Play:'ace'})).toBeNull();expect(captureNativeAdvice(a,3,{Play:'two'})).toBeNull();
 for(const change of [{publicationReady:false},{connected:false},{seat:null},{viewerSeat:1},{turnSeat:1},{participantId:'replacement'},{connectionEpoch:'2'},{command:{...a.command!,room_epoch:'new'}},{legal:[]}]){
  expect(nativeAdviceCurrent(hint,{...a,...change})).toBe(false);
  if(!('connectionEpoch' in change)&&!('command' in change))expect(captureNativeAdvice({...a,...change},3,{Play:'ace'})).toBeNull();
 }
});
test('packet accessors are rejected without evaluation and reaction metadata is owned and whitelisted',()=>{
 let reads=0;const a=authority();Object.defineProperty(a,'legal',{get(){reads++;return [];}});expect(captureNativeAdvice(a,3,{Play:'ace'})).toBeNull();expect(reads).toBe(0);
 const record={eventId:'reaction:1:1',participantId:'alice',text:'👏',roomId:'room',roomEpoch:'epoch',connectionEpoch:'1'};
 expect(captureNativeReaction({...record,text:'arbitrary'},['👏'])).toBeNull();const copy=captureNativeReaction(record,['👏'])!;record.participantId='other';expect(copy.participantId).toBe('alice');expect(Object.isFrozen(copy)).toBe(true);
});
