import {expect,test} from 'vitest';
import {nativeDisclosureReadCurrent,nativeDisclosureRetainedCurrent,type NativeDisclosureState} from './disclosureNative';
import type {DisclosureContext,DisclosureScope} from './disclosures';
const context:DisclosureContext={roomId:'room',roomEpoch:'epoch',actorId:'actor',connectionEpoch:'connection',audience:'opaque-original-audience'};
const publicScope:DisclosureScope={roomId:'room',roomEpoch:'epoch',actorId:'actor',connectionEpoch:'connection',visibility:'public'};
const privateScope:DisclosureScope={...publicScope,visibility:'audience',audience:context.audience};
const native=():NativeDisclosureState=>({open:true,readable:true,sourceCurrent:true,roomId:'room',roomEpoch:'epoch',actorId:'actor',connectionEpoch:'connection',seat:0,published:{actorId:'actor',seat:0,audience:context.audience}});
test('current readonly checkpoint authorizes reads without any Game command or connection flag',()=>{
 expect(nativeDisclosureReadCurrent(context,native())).toBe(true);expect(nativeDisclosureRetainedCurrent(publicScope,native())).toBe(true);expect(nativeDisclosureRetainedCurrent(privateScope,native())).toBe(true);
 for(const patch of [{sourceCurrent:false},{readable:false}]){const n={...native(),...patch};expect(nativeDisclosureReadCurrent(context,n)).toBe(false);expect(nativeDisclosureRetainedCurrent(publicScope,n)).toBe(true);}
});
test('native actor/epoch/connection/offline revocation scrubs retained public and private snapshots',()=>{
 for(const patch of [{open:false},{roomId:'elsewhere'},{roomEpoch:'new'},{actorId:'replacement'},{connectionEpoch:'new'}]){
  const n={...native(),...patch};expect(nativeDisclosureReadCurrent(context,n)).toBe(false);expect(nativeDisclosureRetainedCurrent(publicScope,n)).toBe(false);expect(nativeDisclosureRetainedCurrent(privateScope,n)).toBe(false);
 }
});
test('public history survives reseating, private audience retires until exact new publication',()=>{
 const n={...native(),seat:2,sourceCurrent:false};expect(nativeDisclosureReadCurrent(context,n)).toBe(false);expect(nativeDisclosureRetainedCurrent(publicScope,n)).toBe(true);expect(nativeDisclosureRetainedCurrent(privateScope,n)).toBe(false);
 const published={...n,sourceCurrent:true,published:{actorId:'actor',seat:2,audience:'opaque-new-audience'}};expect(nativeDisclosureRetainedCurrent(publicScope,published)).toBe(true);expect(nativeDisclosureRetainedCurrent(privateScope,published)).toBe(false);expect(nativeDisclosureReadCurrent({...context,audience:'opaque-new-audience'},published)).toBe(true);
});
