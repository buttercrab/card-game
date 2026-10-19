import {expect,test} from 'vitest';
import {createPublicHistoryCapture,type PublicHistorySource} from './publicHistoryCapture';
const source=():PublicHistorySource=>({nativeSource:Object.freeze({}),roomId:'room',roomEpoch:'epoch',sessionId:1,handsPlayed:1,records:[{}],archives:[],history:[[1]],hands:[{}]});
test('same source reuses capture; same-count replacement changes revision without comparing record values',()=>{
 const owner=createPublicHistoryCapture(),input=source(),first=owner.capture(input);expect(owner.capture({...input})).toBe(first);
 // Presence creates fresh array proxies without changing native Session.
 expect(owner.capture({...input,records:[{}],archives:[],history:[[1]],hands:[{}]})).toBe(first);
 const replaced=owner.capture({...input,nativeSource:Object.freeze({}),records:[{}]});expect(replaced.revision).not.toBe(first.revision);expect((replaced.history.current.records as any[])).not.toBe(input.records);
 const reset=owner.capture({...input,sessionId:2});expect(reset.revision).not.toBe(replaced.revision);
 owner.clear();expect(owner.capture(input).revision).not.toBe(first.revision);
});
test('capture never reads array contents, counts, extra properties, or replay caches',()=>{
 const blocked=new Proxy([],{get(){throw Error('historical traversal');},ownKeys(){throw Error('historical enumeration');}}),input={...source(),records:blocked,archives:blocked,history:blocked,hands:blocked};
 let reads=0;Object.defineProperty(input,'privateCache',{enumerable:true,get(){reads++;throw Error('private cache');}});
 const owner=createPublicHistoryCapture(),captured=owner.capture(input);expect(captured.history.current.records).toBe(blocked);expect(captured.history.archives).toBe(blocked);expect(owner.capture(input)).toBe(captured);expect(reads).toBe(0);
});
