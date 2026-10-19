import {expect,test} from 'vitest';
import {selectCurrentRoom,freezePublication} from './currentRoom';
import {completionFixture} from '../games/mighty/testSupport/completionFixture';

test('current-room selection never reads or snapshots historical collections or unknown fields',()=>{
 const room=completionFixture().room!;let visits=0;
 for(const key of ['records','archives','history','hands','unrelated'])Object.defineProperty(room,key,{enumerable:true,get(){visits++;throw Error('unbounded history access');}});
 const current=selectCurrentRoom(room)!;
 expect(current.id).toBe(room.id);expect(current.current_hand).toBe(room.current_hand);expect(current.participant_ids).toBe(room.participant_ids);
 expect(Object.keys(current)).not.toEqual(expect.arrayContaining(['records']));
 for(const key of ['records','archives','history','hands','unrelated'])expect(Object.hasOwn(current,key)).toBe(false);
 expect(visits).toBe(0);expect(selectCurrentRoom(null)).toBeNull();
});
test('detached shared publication is immutable across pure adapter hooks',()=>{
 const source=completionFixture().room!,snapshot=freezePublication(structuredClone(selectCurrentRoom(source)!));
 expect(Object.isFrozen(snapshot)).toBe(true);expect(Object.isFrozen(snapshot.current_hand)).toBe(true);
 expect(()=>{snapshot.participant_ids![0]='replacement';}).toThrow();
 expect(()=>{snapshot.current_hand!.session_id=999;}).toThrow();
 expect(source.participant_ids![0]).toBe('bob');expect(source.current_hand!.session_id).toBe(2);
});
test('selection preserves current live changes and does not fabricate archived history',()=>{
 const room=completionFixture().room!,before=selectCurrentRoom(room)!;
 room.hands_played=4;room.current_hand={...room.current_hand!,number:4};room.session_id=3;
 const after=selectCurrentRoom(room)!;
 expect(before.hands_played).toBe(3);expect(after.hands_played).toBe(4);expect(after.current_hand!.number).toBe(4);expect(after.session_id).toBe(3);
 expect('hands'in after).toBe(false);expect('records'in after).toBe(false);
});
