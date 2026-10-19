import { describe, expect, test } from 'vitest';
import { preparation } from './readiness';
import type { GameTypes, RoomViewOf } from './types';
const table = (seats: RoomViewOf<GameTypes>['seats'], ready: boolean[]) => ({seats, ready, participation: []} as unknown as RoomViewOf<GameTypes>);
describe('human preparation', () => {
  test('one human with ready bots starts directly without a second preparation gesture', () => {
    const room = table([{kind:'human', name:'수연', connected:true,away:false}, ...Array.from({length:4}, () => ({kind:'bot' as const,name:'봇',level:'easy' as const}))], [false,true,true,true,true]);
    const prep = preparation(room, 0);
    expect(prep.solo).toBe(true);
    expect(prep.waiting).toBe('');
    expect(prep.full).toBe(true);
  });
  test('multiple humans name the actual awaited people and exclude ready bots', () => {
    const room = table([{kind:'human',name:'나',connected:true,away:false},{kind:'human',name:'수연',connected:true,away:false},{kind:'bot',name:'봇',level:'easy'}], [true,false,true]);
    expect(preparation(room, 0).waiting).toBe('수연님 준비 기다리는 중');
    room.ready![0] = false;
    expect(preparation(room,0).waiting).toBe('플레이어 준비 0/2');
  });
  test('offered/reserved admission blocks starting but an unoffered queue does not', () => {
    const room = table([{kind:'human',name:'나',connected:true,away:false}], [true]);
    room.participation = [{id:'incoming',name:'수연',order:1,seat:null,target_id:null,offered_by:null}];
    expect(preparation(room,0).pending).toBe(false);
    room.participation[0].seat = 0;
    expect(preparation(room,0).pending).toBe(true);
    expect(preparation(room,0).waiting).toBe('참여할 자리를 확인하는 중');
  });
});
