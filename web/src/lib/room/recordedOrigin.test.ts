import {expect,test} from 'vitest';
import {recordedOrigin} from './recordedOrigin';
test('recorded origin retains original period and distinguishes unknown legacy provenance',()=>{
 expect(recordedOrigin({session_id:2},3)).toEqual({status:'known',sessionId:2});
 expect(recordedOrigin({},3)).toEqual({status:'legacy'});
 expect(recordedOrigin(Object.create({session_id:2}),3)).toEqual({status:'legacy'});
 for(const value of [undefined,null,'2',-1,2.5,4,NaN,Infinity])expect(recordedOrigin({session_id:value},3)).toEqual({status:'invalid'});
 for(const value of [-1,NaN,1.5])expect(recordedOrigin({session_id:0},value)).toEqual({status:'invalid'});
});
test('origin accessors are refused without running arbitrary code',()=>{
 let reads=0;const record=Object.defineProperty({},'session_id',{get(){reads++;return 2;}});
 expect(recordedOrigin(record,3)).toEqual({status:'invalid'});expect(reads).toBe(0);
});
