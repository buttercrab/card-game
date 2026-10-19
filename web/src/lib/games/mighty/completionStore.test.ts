import {expect,test} from 'vitest';
import {COMPLETION_STORAGE_KEY,COMPLETION_LIMIT,completionKey,readDeviceRecords,storeCompletion,deleteDeviceStats,captureDeviceStatsDeletion,type CompletionStorage} from './completionStore';
import type {HandRecord} from './stats';
class Memory implements CompletionStorage {
 values=new Map<string,string>();writes=0;fail=false;
 getItem(key:string){return this.values.get(key)??null;}
 setItem(key:string,value:string){if(this.fail)throw Error('quota');this.writes++;this.values.set(key,value);}
}
const hand=(n=1):HandRecord=>({key:completionKey({roomId:'room',roomEpoch:'epoch',sessionId:1,handNumber:n,actorId:'me'}),at:n,role:'declarer',won:true,payoff:6,contract:{trump:null,count:17},teamPoints:20});
const put=(s:CompletionStorage,h=hand())=>storeCompletion({hand:h,tookWithMighty:true,alone:true},s);
test('one atomic item acknowledges both summary and newly earned awards, repeated completion is inert',()=>{
 const s=new Memory(),first=put(s);expect(first.status).toBe('stored');expect(s.writes).toBe(1);if(first.status!=='stored')throw Error();
 expect(first.earnedIds).toEqual(expect.arrayContaining(['first-win','declarer-win','mighty-take','no-trump','big-contract','alone','run']));
 expect(first.records.hands).toHaveLength(1);expect(first.records.unlocked['first-win']).toBe(1);expect(Object.isFrozen(first.records.hands)).toBe(true);
 expect(put(s)).toMatchObject({status:'duplicate',earnedIds:[]});expect(s.writes).toBe(1);
 const reloaded=readDeviceRecords(s);expect(reloaded).toEqual({status:'ready',records:first.records});
});
test('quota or read denial never claims stored or returns fresh awards; retry repairs atomically',()=>{
 const s=new Memory();s.fail=true;expect(put(s)).toMatchObject({status:'failed'});expect(s.values.size).toBe(0);s.fail=false;expect(put(s)).toMatchObject({status:'stored'});
 const denied={getItem(){throw Error();},setItem(){throw Error();}};expect(put(denied)).toMatchObject({status:'failed'});expect(readDeviceRecords(denied)).toMatchObject({status:'failed'});
});
test('legacy import strips replay-shaped keys and preserves raw source bytes',()=>{
 const s=new Memory(),raw=JSON.stringify([{...hand(),key:'PRIVATE_DISCARDS_REPLAY_JSON'},{...hand(),key:'PRIVATE_DISCARDS_REPLAY_JSON'}]);s.values.set('mighty.stats',raw);s.values.set('mighty.achievements',JSON.stringify({'friend-win':7}));
 expect(put(s,{...hand(2),contract:{trump:null,count:16}})).toMatchObject({status:'stored'});const saved=s.getItem(COMPLETION_STORAGE_KEY)!;expect(saved).not.toContain('PRIVATE');expect(JSON.parse(saved).hands[0].key).toBe('imported:0');expect(JSON.parse(saved).unlocked['friend-win']).toBe(7);expect(s.getItem('mighty.stats')).toBe(raw);
});
test('malformed, unknown and over-budget existing storage is preserved without a write',()=>{
 for(const [key,raw] of [['mighty.stats','{bad'],['mighty.stats',JSON.stringify([{...hand(),payoff:'bad'}])],['mighty.stats',JSON.stringify([{...hand(),key:''}])],['mighty.achievements',JSON.stringify({'unknown-award':1})],[COMPLETION_STORAGE_KEY,JSON.stringify({version:2,hands:[],unlocked:{}})],[COMPLETION_STORAGE_KEY,'x'.repeat(2*1024*1024+1)]]){
  const s=new Memory();s.values.set(key,raw);expect(put(s)).toMatchObject({status:'unsupported'});expect(s.writes).toBe(0);expect(s.getItem(key)).toBe(raw);
 }
});
test('read and prewrite basis conflict refuses overwriting observed concurrent edits',()=>{
 const s=new Memory();let reads=0;const raced:CompletionStorage={getItem(key){if(key===COMPLETION_STORAGE_KEY&&++reads===2)s.values.set(key,'another-tab');return s.getItem(key);},setItem:s.setItem.bind(s)};
 expect(put(raced)).toMatchObject({status:'conflict'});expect(s.writes).toBe(0);expect(s.getItem(COMPLETION_STORAGE_KEY)).toBe('another-tab');
});
test('postwrite interference reports conflict without fresh award acknowledgment',()=>{
 const s=new Memory();const raced:CompletionStorage={getItem:s.getItem.bind(s),setItem(key,value){s.setItem(key,value);s.values.set(key,'other');}};
 expect(put(raced)).toMatchObject({status:'conflict'});
});
test('bounded retained summaries deduplicate within 1000 records and keep awards after confirmed deletion',()=>{
 const s=new Memory(),history=Array.from({length:COMPLETION_LIMIT},(_,i)=>hand(i+1));s.values.set(COMPLETION_STORAGE_KEY,JSON.stringify({version:1,completed:history.map(hand=>hand.key),hands:history,unlocked:{'first-win':1}}));
 const result=put(s,hand(1001));expect(result.status).toBe('stored');if(result.status!=='stored')throw Error();expect(result.records.hands).toHaveLength(1000);expect(result.records.hands[0].at).toBe(2);expect(result.earnedIds).toContain('fifty');
 const deleted=deleteDeviceStats(s);expect(deleted).toMatchObject({status:'stored',records:{hands:[],unlocked:{'first-win':1}}});expect(put(s,hand(1001))).toMatchObject({status:'duplicate'});expect(put(s,hand(1002))).toMatchObject({status:'stored',earnedIds:[]});
});
test('unsafe input keys and inert-boundary accessors cannot persist private payload or run code',()=>{
 const s=new Memory();expect(put(s,{...hand(),key:'PRIVATE_REPLAY'})).toMatchObject({status:'unsupported'});
 let calls=0;const input=Object.defineProperty({hand:hand(),tookWithMighty:true,alone:false},'alone',{enumerable:true,get(){calls++;return true;}});expect(storeCompletion(input,s)).toMatchObject({status:'unsupported'});expect(calls).toBe(0);expect(s.writes).toBe(0);
});
test('summary predicates preserve role, streak and no-friend requirements',()=>{
 const s=new Memory();for(let n=1;n<=3;n++)put(s,{...hand(n),role:'defense',won:true,payoff:3,contract:{trump:'Spade',count:17},teamPoints:16});
 const state=readDeviceRecords(s);expect(state.status).toBe('ready');if(state.status!=='ready')throw Error();expect(Object.keys(state.records.unlocked)).toEqual(expect.arrayContaining(['first-win','defense','streak3','mighty-take']));expect(state.records.unlocked).not.toHaveProperty('alone');expect(state.records.unlocked).not.toHaveProperty('run');
});

test('failed verification after atomic write is uncertain; retry does not re-award',()=>{
 const s=new Memory();let written=false;const port:CompletionStorage={getItem(key){if(written)throw Error('denied');return s.getItem(key);},setItem(key,value){s.setItem(key,value);written=true;}};
 expect(put(port)).toMatchObject({status:'uncertain'});expect(put(s)).toMatchObject({status:'duplicate',earnedIds:[]});
});

test('ambiguous first legacy completion never silently increments a possibly already recorded hand',()=>{
 const s=new Memory(),raw=JSON.stringify([{...hand(),key:'legacy-without-session-lineage'}]);s.values.set('mighty.stats',raw);
 expect(put(s)).toMatchObject({status:'unsupported'});expect(s.writes).toBe(0);expect(s.getItem('mighty.stats')).toBe(raw);
 // A distinguishable later outcome can migrate all old summaries and record normally.
 expect(put(s,{...hand(2),contract:{trump:'Heart',count:16}})).toMatchObject({status:'stored'});
});

test('identical outcomes under distinct canonical completion identities both count after migration',()=>{
 const s=new Memory();expect(put(s,hand(1))).toMatchObject({status:'stored'});expect(put(s,hand(2))).toMatchObject({status:'stored',earnedIds:[]});
 const read=readDeviceRecords(s);expect(read.status).toBe('ready');if(read.status==='ready')expect(read.records.hands).toHaveLength(2);
});
test('captured deletion refuses a new unseen completion and retains awards and deduplication after confirmed deletion',()=>{
 const s=new Memory();put(s);const captured=captureDeviceStatsDeletion(s);expect(captured.status).toBe('ready');if(captured.status!=='ready')throw Error();
 put(s,hand(2));const before=s.getItem(COMPLETION_STORAGE_KEY),writes=s.writes;expect(captured.commit()).toMatchObject({status:'conflict'});expect(s.writes).toBe(writes);expect(s.getItem(COMPLETION_STORAGE_KEY)).toBe(before);
 const fresh=captureDeviceStatsDeletion(s);if(fresh.status!=='ready')throw Error();const result=fresh.commit(()=>true);expect(result.status).toBe('stored');if(result.status!=='stored')throw Error();expect(result.records.hands).toEqual([]);expect(result.records.completed).toEqual(fresh.records.completed);expect(result.records.unlocked).toEqual(fresh.records.unlocked);expect(put(s,hand(2)).status).toBe('duplicate');
});
test('deletion checks authority again after prewrite storage reads and never writes on stale or throwing guard',()=>{
 const s=new Memory();put(s);let current=true,retireOnRead=false;
 const port:CompletionStorage={getItem(key){if(retireOnRead)current=false;return s.getItem(key);},setItem:s.setItem.bind(s)};
 const captured=captureDeviceStatsDeletion(port);if(captured.status!=='ready')throw Error();const writes=s.writes,before=s.getItem(COMPLETION_STORAGE_KEY);retireOnRead=true;
 expect(captured.commit(()=>current)).toMatchObject({status:'conflict'});expect(s.writes).toBe(writes);expect(s.getItem(COMPLETION_STORAGE_KEY)).toBe(before);
 expect(captured.commit(()=>{throw Error();})).toMatchObject({status:'conflict'});expect(s.writes).toBe(writes);
});
