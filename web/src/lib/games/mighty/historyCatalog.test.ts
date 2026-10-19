import {expect,test} from 'vitest';
import {createMightyHistoryCatalog,resolveMightyHistoryEntry,resolveMightyHistorySource,type MightyHistoryCatalogInput} from './historyCatalog';
import {presetRules} from './catalog';
import type {RecordedHand,View} from './types';
const scope=()=>({roomId:'room',roomEpoch:'epoch',actorId:'alice',revision:'revision1'});
function record(number:number):RecordedHand {
 const rules=presetRules('default');rules.reveal_discards=false;const contract={trump:'Heart' as const,count:17};
 const view:View={viewer:'Spectator',rules,first_bidder:0,hand:[],hand_sizes:[],points_taken:[],bids:[],redealt:null,phase:{Done:{declarer:0,friend:null,contract,call:'Alone',team_points:18,payoffs:[4,-1,-1,-1,-1],value:{contract,team_points:18,made:true,steps:[],value:1},tricks:[],discards:[]}}};
 return {number,names:['Original Alice','Bob','Carol','Dan','Eve'],participant_ids:['alice','bob','carol','dan','eve'],payoffs:[4,-1,-1,-1,-1],rules,view};
}
const input=(records:unknown[]=Array.from({length:25},(_,i)=>record(i+1))):MightyHistoryCatalogInput=>({identity:scope(),current:{sessionId:3,records},archives:[]});
test('bounded pages present current newest records, then newest archives with stable lineage IDs',()=>{
 const source={...input(Array.from({length:14},(_,i)=>record(i+1))),archives:[{id:1,records:[record(1)],summary:null},{id:2,records:[record(2),record(3)],summary:null}]};
 const first=createMightyHistoryCatalog(source);expect(first.status).toBe('ready');if(first.status!=='ready')return;
 expect(first.totalEntries).toBe(17);expect(first.pageCount).toBe(2);expect(first.entries.map(entry=>entry.handNumber)).toEqual([14,13,12,11,10,9,8,7,6,5,4,3]);expect(first.sessions.map(session=>session.sessionId)).toEqual([3,2,1]);
 const last=createMightyHistoryCatalog({...source,page:999});expect(last.status).toBe('ready');if(last.status!=='ready')return;expect(last.page).toBe(1);expect(last.entries.map(entry=>[entry.sessionId,entry.handNumber])).toEqual([[3,2],[3,1],[2,3],[2,2],[1,1]]);
 const reordered={...source,archives:[{id:2,records:[record(2),record(3)],summary:null},{id:1,records:[record(1)],summary:null}]};const other=createMightyHistoryCatalog({...reordered,page:1});if(other.status!=='ready')throw Error();expect(other.entries.find(entry=>entry.sessionId===1)!.id).toBe(last.entries.find(entry=>entry.sessionId===1)!.id);
});
test('only twelve metadata rows are read; all record view and private-cache accessors stay untouched',()=>{
 let rows=0,views=0,caches=0;const records=new Array(4096);
 for(let i=0;i<4096;i++)Object.defineProperty(records,i,{get(){rows++;return {number:i+1,names:['A'],get view(){views++;throw Error();}};},enumerable:true});
 // Accessor rows are refused as metadata without executing their getter.
 const refused=createMightyHistoryCatalog(input(records));expect(refused.status).toBe('ready');expect(rows).toBe(0);expect(views).toBe(0);
 let touched=0;const publicRecords=Array.from({length:4096},(_,i)=>{const value={number:i+1,names:['Original'],get view(){views++;throw Error();}};return value;});
 const pageRows=publicRecords.map((value,index)=>new Proxy(value,{getOwnPropertyDescriptor(target,key){if(key==='number')touched++;return Reflect.getOwnPropertyDescriptor(target,key);}}));
 const source=Object.defineProperty(input(pageRows),'privateCache',{get(){caches++;throw Error();},enumerable:true});Object.defineProperty(source,'page',{value:100});const page=createMightyHistoryCatalog(source);expect(page.status).toBe('ready');expect(touched).toBe(12);expect(views).toBe(0);expect(caches).toBe(0);
});
test('selected public replay owns only one record and keeps original identity after catalog/live replacement',()=>{
 let views=0;const chosen=record(2),other={number:1,names:['Unused'],get view(){views++;throw Error();}};const source=input([other,chosen]),catalog=createMightyHistoryCatalog(source);if(catalog.status!=='ready')throw Error();
 const selection=catalog.entries[0].selection,result=resolveMightyHistoryEntry(source,selection);expect(result.status).toBe('selected');if(result.status!=='selected'||result.replay.status!=='available')throw Error();expect(result.replay.roster[0].name).toBe('Original Alice');
 chosen.names[0]='Replacement';chosen.participant_ids[0]='replacement';expect(result.replay.roster[0].name).toBe('Original Alice');expect(result.replay.roster[0].participantId).toBe('alice');expect(views).toBe(0);
 expect(resolveMightyHistoryEntry({...source,identity:{...source.identity,revision:'new'}},selection)).toMatchObject({status:'unavailable',reason:'stale'});
 expect(resolveMightyHistoryEntry({...source,identity:{...source.identity,actorId:'other'}},selection)).toMatchObject({status:'unavailable',reason:'stale'});
 expect(resolveMightyHistoryEntry({...source,identity:{...source.identity,roomEpoch:'new'}},selection)).toMatchObject({status:'unavailable',reason:'stale'});
});
test('reset/rematch summary-only periods stay honest aggregates without inventing duplicate per-hand entries',()=>{
 const source={identity:scope(),current:{sessionId:3,records:[],summary:{hands_played:0,hands:[]}},archives:[{id:1,records:[],summary:{hands_played:99,hands:new Array(99)}},{id:2,records:[record(100)],summary:{hands_played:100,hands:new Array(100)}}]};
 const catalog=createMightyHistoryCatalog(source);expect(catalog.status).toBe('ready');if(catalog.status!=='ready')return;expect(catalog.totalEntries).toBe(2);expect(catalog.entries.map(entry=>entry.kind)).toEqual(['record','summary-only']);expect(catalog.entries[1].handNumber).toBeUndefined();expect(resolveMightyHistoryEntry(source,catalog.entries[1].selection)).toMatchObject({status:'unavailable',reason:'summary-only'});
});
test('selected malformed/summary-only/private-shaped records never become playable replay',()=>{
 const summary={number:1,names:['Legacy']},privateRecord=record(2);(privateRecord.view as View).viewer={Seat:0};(privateRecord.view as View).hand=[{Normal:['Club',2]}];const source=input([summary,privateRecord]);const catalog=createMightyHistoryCatalog(source);if(catalog.status!=='ready')throw Error();
 for(const entry of catalog.entries){const selected=resolveMightyHistoryEntry(source,entry.selection);expect(selected.status).toBe('selected');if(selected.status==='selected')expect(selected.replay.status).toBe('unavailable');}
 let reads=0;const accessor={number:3,names:['Accessor'],get view(){reads++;return privateRecord.view;}};const f=input([accessor]),c=createMightyHistoryCatalog(f);if(c.status!=='ready')throw Error();expect(resolveMightyHistoryEntry(f,c.entries[0].selection)).toMatchObject({status:'selected',replay:{status:'unavailable'}});expect(reads).toBe(0);
});
test('size caps and malformed identities refuse before touching any record views',()=>{
 expect(createMightyHistoryCatalog(input(new Array(4097)))).toMatchObject({status:'unavailable',reason:'too-large'});
 const many={...input([]),archives:Array.from({length:128},(_,id)=>({id,records:[]}))};expect(createMightyHistoryCatalog(many)).toMatchObject({status:'unavailable',reason:'too-large'});
 const total={...input(new Array(4096)),archives:Array.from({length:4},(_,id)=>({id:id+10,records:new Array(4096)}))};expect(createMightyHistoryCatalog(total)).toMatchObject({status:'unavailable',reason:'too-large'});
 expect(createMightyHistoryCatalog({...input([]),archives:[{id:3,records:[]}]})).toMatchObject({status:'unavailable',reason:'malformed'});
 expect(createMightyHistoryCatalog({...input([]),page:-1})).toMatchObject({status:'unavailable',reason:'malformed'});
});

test('duplicate hand numbers across pages retain distinct positional disclosure identities without scanning views',()=>{
 let metadataReads=0,viewReads=0;const originals=Array.from({length:13},(_,index)=>{const value=record(index===0||index===12?1:index+1);value.names[0]=index===0?'Earlier original':'Later original';return value;});
 const records=originals.map(value=>new Proxy(value,{getOwnPropertyDescriptor(target,key){if(key==='number')metadataReads++;if(key==='view')viewReads++;return Reflect.getOwnPropertyDescriptor(target,key);}}));
 const source=input(records),first=createMightyHistoryCatalog(source);if(first.status!=='ready')throw Error();expect(metadataReads).toBe(12);expect(viewReads).toBe(0);
 const last=createMightyHistoryCatalog({...source,page:1});if(last.status!=='ready')throw Error();expect(metadataReads).toBe(13);expect(viewReads).toBe(0);
 const later=first.entries[0],earlier=last.entries[0];expect(later.handNumber).toBe(1);expect(earlier.handNumber).toBe(1);expect(later.id).not.toBe(earlier.id);
 const a=resolveMightyHistoryEntry(source,later.selection),b=resolveMightyHistoryEntry(source,earlier.selection);expect(metadataReads).toBe(17);expect(viewReads).toBe(2);
 if(a.status!=='selected'||b.status!=='selected'||a.replay.status!=='available'||b.replay.status!=='available')throw Error();
 expect(a.entryId).not.toBe(b.entryId);expect(a.replay.id).toBe(b.replay.id);expect(a.replay.roster[0].name).toBe('Later original');expect(b.replay.roster[0].name).toBe('Earlier original');
});

test('recorded origin agrees with current/archive containers without inheriting the latest session',()=>{
 const outgoing=record(1);Object.assign(outgoing,{session_id:1});const source={identity:scope(),current:{sessionId:2,records:[]},archives:[{id:1,records:[outgoing],summary:null}]};
 const catalog=createMightyHistoryCatalog(source);if(catalog.status!=='ready')throw Error();const entry=catalog.entries[0];expect(entry.sessionId).toBe(1);const selected=resolveMightyHistoryEntry(source,entry.selection);expect(selected).toMatchObject({status:'selected',replay:{status:'available',identity:{sessionId:1}}});
 const misplaced={...source,current:{sessionId:2,records:[outgoing]},archives:[]};const invalid=createMightyHistoryCatalog(misplaced);if(invalid.status!=='ready')throw Error();expect(invalid.entries[0].kind).toBe('malformed');expect(resolveMightyHistoryEntry(misplaced,invalid.entries[0].selection)).toMatchObject({status:'unavailable',reason:'malformed'});
 const legacy={identity:scope(),current:{sessionId:2,records:[record(1)]},archives:[]};const old=createMightyHistoryCatalog(legacy);if(old.status!=='ready')throw Error();expect(resolveMightyHistoryEntry(legacy,old.entries[0].selection)).toMatchObject({status:'selected',replay:{status:'available',identity:{sessionId:2}}});
});

test('host source resolution admits one exact record without visiting or copying its view',()=>{
 const saved=record(1);let reads=0;Object.defineProperty(saved,'view',{enumerable:true,get(){reads++;throw Error('view accessor');}});
 const source=input([saved]),catalog=createMightyHistoryCatalog(source);if(catalog.status!=='ready')throw Error();
 const selected=resolveMightyHistorySource(source,catalog.entries[0].selection);expect(selected.status).toBe('selected');
 if(selected.status==='selected'){expect(selected.source.record).toBe(saved);expect(selected.source.identity).toEqual({roomId:'room',roomEpoch:'epoch',sessionId:3,handNumber:1});}
 expect(reads).toBe(0);
 const replay=resolveMightyHistoryEntry(source,catalog.entries[0].selection);expect(replay.status==='selected'&&replay.replay.status).toBe('unavailable');expect(reads).toBe(0);
 const stale=resolveMightyHistorySource({...source,identity:{...scope(),revision:'next'}},catalog.entries[0].selection);expect(stale).toMatchObject({status:'unavailable',reason:'stale'});
});
