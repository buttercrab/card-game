import {expect,test} from 'vitest';
import {createMightyCompletionHost} from './completionHost';
import {completionFixture as fixture} from './testSupport/completionFixture';
import type {CompletionStorage} from './completionStore';
function memory(){const data=new Map<string,string>();let writes=0,fail=false;return {data,get writes(){return writes;},set fail(v:boolean){fail=v;},getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{if(fail)throw Error('quota');writes++;data.set(key,value);}};}
test('confirmed awards remain stable through benign revisions without repeated commits',()=>{
 const storage=memory(),owner=createMightyCompletionHost(storage),input=fixture(),first=owner.observe(input,10)!;expect(first.status).toBe('stored');expect(first.earnedTitles).toContain('첫 승리');
 expect(owner.observe({...input,scope:{...input.scope!,version:99}},11)).toBe(first);expect(storage.writes).toBe(1);expect(owner.retry(first.id)).toBe(false);
 owner.revoke();expect(owner.observe(input,12)).toMatchObject({status:'duplicate',earnedTitles:[]});expect(storage.writes).toBe(1);
});
test('quota errors do not retry on every publication; explicit current-result retry can succeed',()=>{
 const storage=memory();storage.fail=true;const owner=createMightyCompletionHost(storage),input=fixture(),failed=owner.observe(input,1)!;expect(failed).toMatchObject({status:'failed',earnedTitles:[]});storage.fail=false;
 expect(owner.observe(input,2)).toBe(failed);expect(storage.writes).toBe(0);expect(owner.retry('stale')).toBe(false);expect(owner.retry(failed.id)).toBe(true);expect(owner.observe(input,3)).toMatchObject({status:'stored'});expect(storage.writes).toBe(1);
});
test('replacement and observer never inherit cached original-actor award presentation',()=>{
 const owner=createMightyCompletionHost(memory()),input=fixture();expect(owner.observe(input,1)!.earnedTitles.length).toBeGreaterThan(0);expect(owner.observe({...input,seat:null},2)).toBeNull();expect(owner.observe({...input,actorId:'replacement'},2)).toBeNull();
 owner.dispose();expect(owner.observe(input,3)).toBeNull();
});
test('reentrant storage read revocation prevents later writes and resurrection',()=>{
 const data=memory();let owner:ReturnType<typeof createMightyCompletionHost>;const port:CompletionStorage={getItem(key){owner.revoke();return data.getItem(key);},setItem:data.setItem};owner=createMightyCompletionHost(port);
 expect(owner.observe(fixture(),1)).toBeNull();expect(data.writes).toBe(0);
});
test('reentrant storage commit disposal suppresses stale awards after an already attempted write',()=>{
 const data=memory();let owner:ReturnType<typeof createMightyCompletionHost>;const port:CompletionStorage={getItem:data.getItem,setItem(key,value){data.setItem(key,value);owner.dispose();}};owner=createMightyCompletionHost(port);
 expect(owner.observe(fixture(),1)).toBeNull();expect(data.writes).toBe(1);expect(owner.observe(fixture(),2)).toBeNull();
 const fresh=createMightyCompletionHost(data);expect(fresh.observe(fixture(),3)).toMatchObject({status:'duplicate',earnedTitles:[]});
});

test('host native-current predicate fences actor change inside storage without waiting for reactive cleanup',()=>{
 const data=memory();let valid=true;const port:CompletionStorage={getItem(key){valid=false;return data.getItem(key);},setItem:data.setItem};const owner=createMightyCompletionHost(port);
 expect(owner.observe(fixture(),1,()=>valid)).toBeNull();expect(data.writes).toBe(0);
});
test('native-current callback reentrancy cannot restore retired scope by returning true',()=>{
 const data=memory(),owner=createMightyCompletionHost(data);
 expect(owner.observe(fixture(),1,()=>{owner.revoke();return true;})).toBeNull();expect(data.writes).toBe(0);
});
test('unknown legacy result provenance reports unsupported without touching storage or guessing identity',()=>{
 const input=fixture();delete input.room!.current_hand!.session_id;let reads=0,writes=0;
 const owner=createMightyCompletionHost({getItem(){reads++;return null;},setItem(){writes++;}});
 const refusal=owner.observe(input,1,()=>true)!;expect(refusal).toMatchObject({status:'unsupported',earnedTitles:[],message:expect.stringContaining('원래 세션')});
 expect(owner.retry(refusal.id)).toBe(false);expect(owner.observe(input,2,()=>false)).toBeNull();
 expect(owner.observe(input,3,()=>{owner.revoke();return true;})).toBeNull();expect(reads).toBe(0);expect(writes).toBe(0);
});
