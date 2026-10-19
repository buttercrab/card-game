import { describe, expect, test } from 'vitest';
import { availableSeat, participationNotice } from './participation';
import type { GameTypes, RoomMsgOf } from './types';

const room = (patch: Partial<RoomMsgOf<GameTypes>> = {}) => ({
  seats: [{kind:'bot',name:'보리',level:'easy'}, {kind:'empty'}],
  observers: [{id:'incoming',name:'수연',requested:true}], participant_ids:['bot:보리','empty:1'],
  in_hand:true, participation:[], ...patch,
} as RoomMsgOf<GameTypes>);
const request = {id:'incoming',name:'수연',order:1,seat:0,target_id:'bot:보리',offered_by:null};

describe('observer seat availability', () => {
  test('skips booked bots, permits the owner, and waits when all targets are booked', () => {
    const booked = room({participation:[request]});
    expect(availableSeat(booked, 'other')).toBe(1);
    expect(availableSeat(booked, 'incoming')).toBe(0);
    booked.participation!.push({...request,id:'second',seat:1,target_id:'empty:1'});
    expect(availableSeat(booked, 'other')).toBe(-1);
  });
  test('never offers a human seat without the explicit handoff path', () => {
    expect(availableSeat(room({seats:[{kind:'human',name:'민수',connected:true,away:false}]}), 'incoming')).toBe(-1);
  });
});

describe('participation transition notices', () => {
  test('announces own reservation when the hand finishes exactly once', () => {
    const live = room({participation:[request]});
    const finished = room({in_hand:false,participation:[request]});
    expect(participationNotice(live, finished, 'incoming')).toContain('수연님, 자리가 준비됐어요');
    expect(participationNotice(finished, finished, 'incoming')).toBeNull();
  });
  test('names a waiting person and an accepted person without a vague removal notice', () => {
    const initial = room();
    const waiting = room({participation:[{...request,seat:null,target_id:null}]});
    expect(participationNotice(initial, waiting, 'player')).toBe('수연님이 다음 판 참여를 기다려요');
    expect(participationNotice(waiting, room({observers:[],participant_ids:['incoming','empty:1']}), 'player')).toBe('수연님이 다음 판부터 함께해요');
    expect(participationNotice(initial, room({observers:[]}), 'player')).toBeNull();
  });
  test('seat shuffles do not announce an existing player as newly admitted', () => {
    const before = room({participant_ids:['incoming','other']});
    expect(participationNotice(before, room({participant_ids:['other','incoming']}), 'other')).toBeNull();
  });
});
