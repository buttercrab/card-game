import {expect,test} from 'vitest';
import {ownDisclosureDocument,ownDisclosureOffer,ownDisclosurePage} from '../../table/foundation/disclosures';
import {completionFixture} from './testSupport/completionFixture';
import {createMightyHistoryReadPolicy,mightyHistoryCatalogOffer,type MightyHistoryReadCapture} from './historyReadPolicy';
function capture():MightyHistoryReadCapture {const f=completionFixture();return {scope:{roomId:'room',roomEpoch:'epoch',actorId:'bob',connectionEpoch:'connection',visibility:'public'},source:{identity:{roomId:'room',roomEpoch:'epoch',actorId:'bob',revision:'1'},current:{sessionId:2,records:Array.from({length:13},(_,i)=>({...f.room!.current_hand!,number:i+1}))},archives:[]}};}
test('read policy admits only current metadata page and resolves one strict public record',()=>{
 let latest:MightyHistoryReadCapture|null=capture();const policy=createMightyHistoryReadPolicy(()=>latest),offer=ownDisclosureOffer(mightyHistoryCatalogOffer(latest));
 const first=ownDisclosurePage(policy.page(offer,0),offer,0);expect(first.entries).toHaveLength(12);expect(first.entries[0].title).toBe('13판 기록');
 const selected=ownDisclosureDocument(policy.select(offer,first.entries[0].id),first.entries[0].id);expect(selected.roster[1].name).toBe('Old Bob');expect(selected.cards).toHaveLength(1);
 const second=ownDisclosurePage(policy.page(offer,1),offer,1);expect(second.entries).toHaveLength(1);expect(()=>policy.select(offer,first.entries[0].id)).toThrow();
 latest=null;expect(()=>policy.select(offer,second.entries[0].id)).toThrow();expect(selected.roster[1].name).toBe('Old Bob');
});
test('same-count source replacement and ownership changes retire offered navigation',()=>{
 const original=capture();let latest:MightyHistoryReadCapture|null=original;const policy=createMightyHistoryReadPolicy(()=>latest),offer=mightyHistoryCatalogOffer(original);const page=policy.page(offer,0);
 latest={...original,source:{...original.source,identity:{...original.source.identity,revision:'2'}}};expect(()=>policy.select(offer,page.entries[0].id)).toThrow();
 latest={...original,scope:{...original.scope,connectionEpoch:'new'}};expect(()=>policy.page(offer,0)).toThrow();
 latest={...original,scope:{...original.scope,actorId:'other'}};expect(()=>policy.page(offer,0)).toThrow();
 latest={...original,scope:{...original.scope,visibility:'audience',audience:'private'}};expect(()=>policy.page(offer,0)).toThrow();
});
test('summary-only and malformed/over-limit catalogs expose bounded inert explanations',()=>{
 const f=capture();let latest:MightyHistoryReadCapture|null={...f,source:{...f.source,current:{sessionId:2,records:[],summary:{hands_played:1}}}};const policy=createMightyHistoryReadPolicy(()=>latest);
 let offer=mightyHistoryCatalogOffer(latest),page=policy.page(offer,0),doc=ownDisclosureDocument(policy.select(offer,page.entries[0].id));expect(doc.cards).toEqual([]);expect(JSON.stringify(doc)).toContain('요약만 남아');
 latest={...f,source:{...f.source,current:{sessionId:2,records:new Array(4097)}}};offer=ownDisclosureOffer(mightyHistoryCatalogOffer(latest));page=ownDisclosurePage(policy.page(offer,0),offer,0);doc=ownDisclosureDocument(policy.select(offer,page.entries[0].id));expect(doc.cards).toEqual([]);expect(JSON.stringify(doc)).toContain('지원 범위');
});
test('metadata never reads views or unrelated caches and privileged selected content stays unavailable',()=>{
 const latest=capture();let visits=0;Object.defineProperty(latest.source,'privateCache',{enumerable:true,get(){visits++;throw Error();}});
 const record=(latest.source.current.records as any[])[12];Object.defineProperty(record,'view',{enumerable:true,get(){visits++;throw Error();}});
 const policy=createMightyHistoryReadPolicy(()=>latest),offer=mightyHistoryCatalogOffer(latest),page=policy.page(offer,0);expect(visits).toBe(0);
 const doc=ownDisclosureDocument(policy.select(offer,page.entries[0].id));expect(doc.cards).toEqual([]);expect(visits).toBe(0);
});
