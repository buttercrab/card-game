import {describe,expect,it} from 'vitest';
import {ownConcealment} from './concealment';
describe('bounded inert concealment ingress',()=>{
 it('owns and freezes a dense unique mask or an explicit empty release',()=>{
  const raw=['a','b'],request=ownConcealment(7,raw,'batch-1')!;expect(request).toEqual({frameId:7,nodeIds:['a','b'],owner:'batch-1'});expect(Object.isFrozen(request)).toBe(true);expect(Object.isFrozen(request.nodeIds)).toBe(true);raw[0]='changed';expect(request.nodeIds).toEqual(['a','b']);expect(ownConcealment(7,[],'batch-1')).toEqual({frameId:7,nodeIds:[],owner:'batch-1'});expect(ownConcealment(1,Array.from({length:64},(_,i)=>String(i)),'batch')).not.toBeNull();
 });
 it('checks primitive frame and owner bounds without coercing capabilities',()=>{
  let reads=0;const exotic={valueOf(){reads++;return 1;},toString(){reads++;return 'batch';}};
  for(const frame of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',exotic])expect(ownConcealment(frame,[],'batch')).toBeNull();
  for(const owner of ['', ' ', ' batch','batch ', 'x'.repeat(129),exotic,new String('batch')])expect(ownConcealment(1,[],owner)).toBeNull();expect(reads).toBe(0);
 });
 it('never invokes index or own iterator getters, including during rejection',()=>{
  let reads=0;const indexed=['a'];Object.defineProperty(indexed,'0',{get(){reads++;throw Error('getter');}});expect(ownConcealment(1,indexed,'batch')).toBeNull();
  const iterated=['a'];Object.defineProperty(iterated,Symbol.iterator,{get(){reads++;throw Error('iterator');}});expect(ownConcealment(1,iterated,'batch')).toBeNull();
  const inherited=['a'];Object.setPrototypeOf(inherited,Object.create(Array.prototype,{[Symbol.iterator]:{get(){reads++;throw Error('inherited iterator');}}}));expect(ownConcealment(1,inherited,'batch')?.nodeIds).toEqual(['a']);expect(reads).toBe(0);
 });
 it('rejects huge or over-limit length before key enumeration or member descriptor reads',()=>{
  for(const length of [65,1_000_000_000]){
   let scans=0;const descriptors:string[]=[],raw=new Proxy(new Array(length),{getOwnPropertyDescriptor(target,key){descriptors.push(String(key));return Reflect.getOwnPropertyDescriptor(target,key);},ownKeys(){scans++;throw Error('must not enumerate');},get(){throw Error('must not read');}});
   expect(ownConcealment(1,raw,'batch')).toBeNull();expect(descriptors).toEqual(['length']);expect(scans).toBe(0);
  }
 });
 it('rejects symbols, extras, sparse/inherited indexes and duplicate values before unsafe reads',()=>{
  let reads=0;
  for(const extra of ['extra',Symbol('extra')]){const descriptors:string[]=[],array=['a'];Object.defineProperty(array,extra,{get(){reads++;throw Error('extra getter');}});const proxy=new Proxy(array,{getOwnPropertyDescriptor(target,key){descriptors.push(String(key));return Reflect.getOwnPropertyDescriptor(target,key);}});expect(ownConcealment(1,proxy,'batch')).toBeNull();expect(descriptors).toEqual(['length']);}
  const sparse=new Array(1);Object.setPrototypeOf(sparse,Object.create(Array.prototype,{'0':{get(){reads++;throw Error('inherited member');}}}));expect(ownConcealment(1,sparse,'batch')).toBeNull();
  for(const values of [['same','same'],[''],['x'.repeat(2049)],['a',4],{length:1,0:'a'}])expect(ownConcealment(1,values,'batch')).toBeNull();expect(reads).toBe(0);
 });
 it('rejects fabricated noncanonical or oversized keys before member descriptors',()=>{
  for(const key of ['00','-1','+0','x'.repeat(100000)]){const descriptors:string[]=[],raw=new Proxy(['a'],{ownKeys(){return ['length',key];},getOwnPropertyDescriptor(target,key){descriptors.push(String(key));return Reflect.getOwnPropertyDescriptor(target,key);},get(){throw Error('raw read');}});expect(ownConcealment(1,raw,'batch')).toBeNull();expect(descriptors).toEqual(['length']);}
 });
 it('uses one bounded key scan and only data descriptors even when Proxy traps reenter',()=>{
  let scans=0,rawReads=0,authority=1;const descriptors:string[]=[];
  const proxy=new Proxy(['a','b'],{ownKeys(target){scans++;authority=2;expect(ownConcealment(3,['nested'],'nested-owner')?.nodeIds).toEqual(['nested']);return Reflect.ownKeys(target);},getOwnPropertyDescriptor(target,key){descriptors.push(String(key));return Reflect.getOwnPropertyDescriptor(target,key);},get(){rawReads++;throw Error('raw read');}});
  const request=ownConcealment(1,proxy,'batch');expect(request?.nodeIds).toEqual(['a','b']);expect(authority).toBe(2);expect(scans).toBe(1);expect(descriptors).toEqual(['length','0','1']);expect(rawReads).toBe(0);
 });
 it('catches throwing/revoked Proxy traps without proceeding to raw reads',()=>{
  for(const failure of ['length','keys','member'] as const){let reads=0;const proxy=new Proxy(['a'],{getOwnPropertyDescriptor(target,key){if(key==='length'&&failure==='length'||key==='0'&&failure==='member')throw Error('trap');return Reflect.getOwnPropertyDescriptor(target,key);},ownKeys(target){if(failure==='keys')throw Error('trap');return Reflect.ownKeys(target);},get(){reads++;throw Error('read');}});expect(ownConcealment(1,proxy,'batch')).toBeNull();expect(reads).toBe(0);}
  const revoked=Proxy.revocable([],{});revoked.revoke();expect(ownConcealment(1,revoked.proxy,'batch')).toBeNull();
 });
});
