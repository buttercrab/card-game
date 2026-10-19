import {expect,test} from 'vitest';
import {createMightyDeviceDisclosure} from './deviceDisclosure';
import type {DeviceRead} from './completionStore';
import {copyFormData} from '../../table/foundation/forms';
const read=():DeviceRead=>({status:'ready',records:{version:1,completed:[],hands:[{key:'private-completion-key',at:123,role:'declarer',won:true,payoff:3,contract:{trump:'Heart',count:17},teamPoints:18}],unlocked:{'first-win':123}}});
test('device information maps existing three sections without keys, timestamps or card artwork',()=>{
 const doc=createMightyDeviceDisclosure({entryId:'device:revision1',read:read()});expect(doc.sections.map(section=>section.id)).toEqual(['overview','recent','achievements']);expect(doc.cards).toEqual([]);expect(doc.roster).toEqual([]);expect(JSON.stringify(doc)).not.toContain('private-completion-key');expect(JSON.stringify(doc)).not.toContain('123');expect(Object.isFrozen(doc.sections[0])).toBe(true);expect(()=>copyFormData(doc)).not.toThrow();
});
test('completed ledger, per-hand identity and private caches are never read',()=>{
 const source=read();if(source.status!=='ready')throw Error();let reads=0;Object.defineProperty(source.records,'completed',{get(){reads++;throw Error();},enumerable:true});Object.defineProperty(source.records.hands[0],'key',{get(){reads++;throw Error();},enumerable:true});Object.defineProperty(source,'privateCache',{get(){reads++;throw Error();},enumerable:true});
 const doc=createMightyDeviceDisclosure({entryId:'device',read:source});expect(reads).toBe(0);expect(doc.sections).toHaveLength(3);
});
test('failure/malformed/oversized device input stays an explicit failure, not empty stats',()=>{
 const failed=createMightyDeviceDisclosure({entryId:'device',read:{status:'failed',message:'기록 접근 거부'}});expect(failed.sections).toHaveLength(1);expect(JSON.stringify(failed)).toContain('기록 접근 거부');
 const source=read();if(source.status!=='ready')throw Error();const huge={status:'ready' as const,records:{...source.records,hands:new Array(1001).fill(source.records.hands[0])}};expect(createMightyDeviceDisclosure({entryId:'device',read:huge}).sections).toHaveLength(1);
 let calls=0;Object.defineProperty(source.records.hands[0],'won',{get(){calls++;return true;},enumerable:true});expect(createMightyDeviceDisclosure({entryId:'device',read:source}).sections).toHaveLength(1);expect(calls).toBe(0);
});

test('bounded hand-array indexing never enumerates unrelated own properties',()=>{
 const source=read();if(source.status!=='ready')throw Error();let getterReads=0,enumerations=0,indexReads=0;const hands=[...source.records.hands];Object.defineProperty(hands,'private-cache',{get(){getterReads++;throw Error('unrelated getter');},enumerable:true});
 const bounded=new Proxy(hands,{ownKeys(){enumerations++;throw Error('array enumeration forbidden');},getOwnPropertyDescriptor(target,key){if(key==='0')indexReads++;return Reflect.getOwnPropertyDescriptor(target,key);}});
 const doc=createMightyDeviceDisclosure({entryId:'device',read:{status:'ready',records:{...source.records,hands:bounded}}});expect(doc.sections).toHaveLength(3);expect(indexReads).toBe(1);expect(getterReads).toBe(0);expect(enumerations).toBe(0);
});

test('closed contract and achievement projection does not enumerate unrelated object properties',()=>{
 const source=read();if(source.status!=='ready')throw Error();let enumeration=0,reads=0;const protectedObject=<T extends object>(value:T):T=>{Object.defineProperty(value,'private-cache',{get(){reads++;throw Error();},enumerable:true});return new Proxy(value,{ownKeys(){enumeration++;throw Error('unbounded enumeration');}});};
 const hand={...source.records.hands[0],contract:protectedObject({...source.records.hands[0].contract})};const next:DeviceRead={status:'ready',records:{...source.records,hands:[hand],unlocked:protectedObject({'first-win':123})}};
 const doc=createMightyDeviceDisclosure({entryId:'device',read:next});expect(doc.sections).toHaveLength(3);expect(JSON.stringify(doc)).toContain('달성');expect(enumeration).toBe(0);expect(reads).toBe(0);
});
