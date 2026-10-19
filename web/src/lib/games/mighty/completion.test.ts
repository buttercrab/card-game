import {expect,test} from 'vitest';
import {mightyCompletionCandidate,recordMightyCompletion} from './completion';
import {COMPLETION_STORAGE_KEY,type CompletionStorage} from './completionStore';
import type {View} from './types';
import {completionFixture as fixture} from './testSupport/completionFixture';

test('original identity after reseating selects original payoff and role, not current seat',()=>{
 const input=fixture(),candidate=mightyCompletionCandidate(input,123);expect(candidate).toMatchObject({status:'eligible',hand:{at:123,role:'declarer',won:true,payoff:3,teamPoints:18},tookWithMighty:true,alone:false});
 const serialized=JSON.stringify(candidate);expect(serialized).not.toContain('Old Bob');expect(serialized).not.toContain('Normal');expect(serialized).not.toContain('PRIVATE');
 const next=mightyCompletionCandidate({...input,scope:{...input.scope!,version:99,hand:8}},999);expect(next.status).toBe('eligible');if(candidate.status==='eligible'&&next.status==='eligible')expect(next.hand.key).toBe(candidate.hand.key);
});
test('observer, replacement, fake client, in-flight game and mismatched native actor/session refuse',()=>{
 for(const patch of [{seat:null},{keepsRecord:false},{actorId:'replacement',scope:{...fixture().scope!,actor_id:'replacement'}},{scope:{...fixture().scope!,actor_id:'alice'}},{scope:{...fixture().scope!,session_id:3}},{scope:null}])expect(mightyCompletionCandidate({...fixture(),...patch},1).status).not.toBe('eligible');
 const input=fixture();input.room!.in_hand=true;expect(mightyCompletionCandidate(input,1)).toEqual({status:'ineligible'});
});
test('only the bounded current public record is inspected, not room archive/cache payloads',()=>{
 const input=fixture();Object.defineProperty(input.room!,'archives',{enumerable:true,get(){throw Error('unrelated archive read');}});Object.defineProperty(input.room!,'privateCache',{enumerable:true,get(){throw Error('private read');}});expect(mightyCompletionCandidate(input,1).status).toBe('eligible');
 const view=input.room!.current_hand!.view as View;view.viewer={Seat:1};view.hand=[{Normal:['Club',2]}];expect(mightyCompletionCandidate(input,1)).toMatchObject({status:'unsupported'});
});
test('host boundary writes once using stable public lineage and never records archive browsing',()=>{
 const map=new Map<string,string>();let writes=0;const storage:CompletionStorage={getItem:key=>map.get(key)??null,setItem:(key,value)=>{writes++;map.set(key,value);}};
 const input=fixture();expect(recordMightyCompletion(input,10,storage)).toMatchObject({status:'stored',earnedIds:expect.arrayContaining(['first-win','declarer-win','mighty-take'])});expect(recordMightyCompletion(input,11,storage)).toMatchObject({status:'duplicate',earnedIds:[]});expect(writes).toBe(1);expect(map.get(COMPLETION_STORAGE_KEY)).not.toContain('Old Bob');
 const old=fixture();old.room!.current_hand!.number=2;expect(recordMightyCompletion(old,11,storage).status).not.toBe('stored');expect(writes).toBe(1);
});
test('selected accessors are rejected without invocation',()=>{
 let calls=0;const input=Object.defineProperty(fixture(),'actorId',{enumerable:true,get(){calls++;return 'bob';}});expect(mightyCompletionCandidate(input,1)).toMatchObject({status:'unsupported'});expect(calls).toBe(0);
});
test('score reset preserves original completion identity and cannot count the displayed hand twice',()=>{
 const map=new Map<string,string>();let writes=0;const storage:CompletionStorage={getItem:key=>map.get(key)??null,setItem:(key,value)=>{writes++;map.set(key,value);}};
 const input=fixture(),original=mightyCompletionCandidate(input,10);
 expect(recordMightyCompletion(input,10,storage).status).toBe('stored');
 input.room!.session_id=3;Object.assign(input,{scope:{...input.scope!,session_id:3,version:16}});
 const reset=mightyCompletionCandidate(input,11);expect(reset.status).toBe('eligible');
 if(original.status==='eligible'&&reset.status==='eligible')expect(reset.hand.key).toBe(original.hand.key);
 expect(recordMightyCompletion(input,11,storage)).toMatchObject({status:'duplicate',earnedIds:[]});expect(writes).toBe(1);
 const distinct=fixture();distinct.room!.session_id=3;Object.assign(distinct,{scope:{...distinct.scope!,session_id:3}});distinct.room!.current_hand!.session_id=3;
 expect(recordMightyCompletion(distinct,12,storage).status).toBe('stored');expect(writes).toBe(2);
});
test('legacy missing, malformed or future record origin refuses automatic storage without guessing',()=>{
 for(const marker of [undefined,-1,2.5,Number.NaN,3]){
  const input=fixture();if(marker===undefined)delete input.room!.current_hand!.session_id;else input.room!.current_hand!.session_id=marker;
  let writes=0;const storage:CompletionStorage={getItem:()=>null,setItem:()=>{writes++;}};
  expect(recordMightyCompletion(input,1,storage)).toMatchObject({status:'unsupported'});expect(writes).toBe(0);
 }
});
