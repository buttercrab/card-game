import {expect,test} from 'vitest';
import {ownDisclosureDocument,ownDisclosureOffer,ownDisclosurePage} from '../../table/foundation/disclosures';
import {createMightyDeviceReadPolicy,mightyDeviceCatalogOffer,MIGHTY_DEVICE_ENTRY_ID,type MightyDeviceReadCapture} from './deviceReadPolicy';
function setup(){let reads=0;let latest:MightyDeviceReadCapture|null={scope:{roomId:'room',roomEpoch:'epoch',actorId:'actor',connectionEpoch:'connection',visibility:'audience',audience:'actor:0'},revision:'1',readRecords(){reads++;return {status:'ready',records:{version:1,hands:[],completed:[],unlocked:{}}};}};return {get latest(){return latest;},set latest(v){latest=v;},get reads(){return reads;},policy:createMightyDeviceReadPolicy(()=>latest)};}
test('device offer/page do not read storage; only admitted selection reads the summary owner once',()=>{
 const s=setup(),offer=ownDisclosureOffer(mightyDeviceCatalogOffer(s.latest!));expect(s.reads).toBe(0);expect(()=>s.policy.select(offer,MIGHTY_DEVICE_ENTRY_ID)).toThrow();
 const page=ownDisclosurePage(s.policy.page(offer,0),offer,0);expect(page.entries).toHaveLength(1);expect(s.reads).toBe(0);
 const doc=ownDisclosureDocument(s.policy.select(offer,page.entries[0].id));expect(doc.sections).toHaveLength(3);expect(s.reads).toBe(1);expect(doc.cards).toEqual([]);expect(()=>s.policy.select(offer,'unknown')).toThrow();expect(s.reads).toBe(1);
});
test('audience/epoch changes fence device reads and synchronous read revocation fences publication',()=>{
 const s=setup(),original=s.latest!,offer=mightyDeviceCatalogOffer(original);const page=s.policy.page(offer,0);s.latest={...original,scope:{...original.scope,audience:'actor:watch'}};expect(()=>s.policy.select(offer,page.entries[0].id)).toThrow();expect(s.reads).toBe(0);
 s.latest={...original,readRecords(){s.latest=null;return {status:'failed',message:'ignored'};}};const next=s.policy.page(offer,0);expect(()=>s.policy.select(offer,next.entries[0].id)).toThrow();
});
test('read denial becomes a bounded explanatory document without exposing exception text',()=>{
 const s=setup();s.latest={...s.latest!,readRecords(){throw Error('PRIVATE STORAGE DETAILS');}};const offer=mightyDeviceCatalogOffer(s.latest!);const page=s.policy.page(offer,0);const doc=ownDisclosureDocument(s.policy.select(offer,page.entries[0].id));expect(doc.sections).toHaveLength(1);expect(JSON.stringify(doc)).toContain('기록을 읽지 못했어요');expect(JSON.stringify(doc)).not.toContain('PRIVATE');
});

test('one page owns one captured snapshot; a fresh page requires a new read and rejects the old entry',()=>{
 const s=setup(),offer=mightyDeviceCatalogOffer(s.latest!),first=s.policy.page(offer,0),id=first.entries[0].id;
 const doc=s.policy.select(offer,id);expect(s.policy.select(offer,id)).toBe(doc);expect(s.reads).toBe(1);
 const second=s.policy.page(offer,0);expect(second.entries[0].id).not.toBe(id);expect(()=>s.policy.select(offer,id)).toThrow();s.policy.select(offer,second.entries[0].id);expect(s.reads).toBe(2);
});
test('a reentrant page replacement cannot publish a prior entry capture',()=>{
 const s=setup(),offer=mightyDeviceCatalogOffer(s.latest!);s.latest={...s.latest!,readRecords(){s.policy.page(offer,0);return {status:'ready',records:{version:1,hands:[],completed:[],unlocked:{}}};}};
 const page=s.policy.page(offer,0);expect(()=>s.policy.select(offer,page.entries[0].id)).toThrow('Retired device-record read');
});
