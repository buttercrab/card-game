import { expect, test } from 'vitest';
import { CATALOG } from '../../catalog';
import type { GameTypes, RoomViewOf } from '../../room/types';
import { projectRoomOperations, type RoomOperationsInput } from './roomOperations';

function input(): RoomOperationsInput<GameTypes> {
    const room: RoomViewOf<GameTypes> = { id: 'operations', game: 'generic', protocol: CATALOG.protocol,
        settings: {}, rules: {}, customized: false, in_hand: false, showing: false,
        seats: [{ kind: 'human', name: '재용', connected: true, away: false }, { kind: 'bot', name: '호두', level: 'normal' },
            { kind: 'empty' }, { kind: 'human', name: '보리', connected: false, away: false },
            { kind: 'human', name: '단추', connected: true, away: false }],
        participant_ids: ['me', 'bot', 'empty', 'offline', 'human'], ready: [], watching: 1,
        observers: [{ id: 'observer', name: '모과', requested: false }], participation: [],
        table: { turn_secs: 30, shuffle: false, shuffle_next: false }, clock: null, scores: [], hands_played: 0, history: [], hands: [] };
    return { room, status: 'open', seat: 0, viewerId: 'me', botLevels: [{ id: 'easy', label: '쉬움' }, { id: 'normal', label: '보통' }, { id: 'hard', label: '어려움' }] };
}
const actions = (source: RoomOperationsInput<GameTypes>) => projectRoomOperations(source).map(operation => operation.action);
function reserve(source: RoomOperationsInput<GameTypes>, seat: number | null, target = 'bot', offeredBy: string | null = null) {
    source.room!.participation = [{ id: 'observer', name: '모과', order: 1, seat, target_id: seat === null ? null : target, offered_by: offeredBy }];
}
test('seated lobby management uses exact actions and public seat subjects, never scopes', () => {
    const source = input(), operations = projectRoomOperations(source), offered = actions(source);
    expect(offered).toContainEqual({ type: 'leave' }); expect(offered).toContainEqual({ type: 'reset_scores' });
    expect(offered).toContainEqual({ type: 'add_bot', seat: 2, level: 'normal' });
    expect(offered).toContainEqual({ type: 'add_bot', seat: 1, level: 'hard' });
    expect(offered).not.toContainEqual({ type: 'add_bot', seat: 1, level: 'normal' });
    expect(offered).toContainEqual({ type: 'remove_bot', seat: 1 });
    expect(offered).toContainEqual({ type: 'swap_seats', a: 0, b: 2 });
    expect(operations.find(operation => operation.purpose === 'move-seat')!.subjects).toEqual([
        { kind: 'seat', seat: 0, participantId: 'me' }, { kind: 'seat', seat: 2, participantId: 'empty' }]);
    expect(new Set(operations.map(operation => operation.id)).size).toBe(operations.length);
    expect(operations.every(operation => operation.id.length <= 128)).toBe(true);
    expect(JSON.stringify(operations)).not.toMatch(/scope|callback|transport|onclick|room_epoch/);
});
test('management follows between-hand UI policy even though server add_bot permits some earlier changes', () => {
    const source = input(); source.room!.in_hand = true;
    expect(actions(source)).toEqual([]);
    reserve(source, null);
    expect(actions(source)).toEqual([{ type: 'offer_seat', requester_id: 'observer' }]);
});
test('closed, missing, connecting, unauthenticated and stale-seat clients have no offered mutations', () => {
    for (const status of ['connecting', 'closed', 'missing'] as const) expect(actions({ ...input(), status })).toEqual([]);
    expect(actions({ ...input(), room: null })).toEqual([]);
    expect(actions({ ...input(), viewerId: null })).toEqual([]);
    expect(actions({ ...input(), seat: 100 })).toEqual([]);
    expect(actions({ ...input(), viewerId: 'another-person' })).toEqual([]);
});
test('clear excludes own seat; relief excludes connected humans and carries explicit replacement confirmation', () => {
    const operations = projectRoomOperations(input());
    expect(operations.some(operation => operation.action.type === 'clear_seat' && operation.action.seat === 0)).toBe(false);
    expect(operations.some(operation => operation.action.type === 'add_bot' && [0, 4].includes(operation.action.seat))).toBe(false);
    expect(operations.find(operation => operation.action.type === 'clear_seat' && operation.action.seat === 4)!.confirmation).toBeDefined();
    expect(operations.filter(operation => operation.purpose === 'relieve-seat')).toHaveLength(3);
    expect(operations.filter(operation => operation.purpose === 'relieve-seat').every(operation => !!operation.confirmation)).toBe(true);
    expect(operations.find(operation => operation.purpose === 'reset-scores')!.confirmation).toBeDefined();
});
test('reservations block bot and human management and every swap endpoint without blocking owner stand', () => {
    for (const seat of [0, 1, 2, 3, 4]) {
        const source = input(); reserve(source, seat, source.room!.participant_ids![seat]);
        const offered = actions(source);
        expect(offered.filter(action => ['add_bot', 'remove_bot', 'clear_seat'].includes(action.type) && 'seat' in action && action.seat === seat)).toEqual([]);
        expect(offered.filter(action => action.type === 'swap_seats' && (action.a === seat || action.b === seat))).toEqual([]);
        expect(offered).toContainEqual({ type: 'leave' });
    }
});
test('observers request a future seat, including during a hand, without manufacturing Join/name actions', () => {
    const source = { ...input(), seat: null, viewerId: 'observer' }; source.room!.in_hand = true;
    const offered = actions(source);
    expect(offered).toEqual([{ type: 'request_seat', requested: true, seat: null },
        { type: 'request_seat', requested: true, seat: 1 }, { type: 'request_seat', requested: true, seat: 2 }]);
    expect(offered.some(action => action.type === 'join')).toBe(false);
});
test('other reservations are not offered as observer seat preferences', () => {
    const source = { ...input(), seat: null, viewerId: 'observer' }; reserve(source, 1);
    source.room!.participation![0].id = 'other';
    expect(actions(source)).not.toContainEqual({ type: 'request_seat', requested: true, seat: 1 });
});
test('existing observer requests have cancellation and exact reservation acceptance, not repeated joins', () => {
    const source = { ...input(), seat: null, viewerId: 'observer' }; reserve(source, 1);
    expect(actions(source)).toEqual([{ type: 'request_seat', requested: false, seat: null }, { type: 'accept_seat', seat: 1, target_id: 'bot' }]);
    source.room!.in_hand = true;
    expect(actions(source)).toEqual([{ type: 'request_seat', requested: false, seat: null }]);
});
test('acceptance requires matching authoritative target and human-owner consent', () => {
    const source = { ...input(), seat: null, viewerId: 'observer' }; reserve(source, 4, 'old-human');
    expect(actions(source)).toHaveLength(1);
    reserve(source, 4, 'human'); expect(actions(source)).toHaveLength(1);
    reserve(source, 4, 'human', 'human');
    expect(actions(source)).toContainEqual({ type: 'accept_seat', seat: 4, target_id: 'human' });
    source.room!.participant_ids = undefined; expect(actions(source)).toHaveLength(1);
});
test('observe-before-reclaim is not permission to request another seat', () => {
    const source = { ...input(), seat: null, viewerId: 'offline' };
    source.room!.observers!.push({ id: 'offline', name: '보리', requested: false });
    expect(actions(source)).toEqual([]);
    expect(actions({ ...source, viewerId: 'unknown' })).toEqual([]);
});
test('offers choose the oldest unassigned requester; reserved own seat only allows cancelling its offer', () => {
    const source = input(); reserve(source, null);
    source.room!.participation!.unshift({ id: 'later', name: '나중', order: 2, seat: null, target_id: null, offered_by: null });
    expect(actions(source)).toContainEqual({ type: 'offer_seat', requester_id: 'observer' });
    expect(actions(source)).not.toContainEqual({ type: 'offer_seat', requester_id: 'later' });
    reserve(source, 0, 'me', 'me'); source.room!.in_hand = true;
    expect(actions(source)).toEqual([{ type: 'offer_seat', requester_id: null }]);
});
test('swap pairs are unique and never offer empty to empty; seated users can swap other occupants', () => {
    const source = input(); source.room!.seats[3] = { kind: 'empty' };
    const swaps = actions(source).filter(action => action.type === 'swap_seats');
    expect(swaps).not.toContainEqual({ type: 'swap_seats', a: 2, b: 3 });
    expect(swaps).toContainEqual({ type: 'swap_seats', a: 1, b: 4 });
    expect(swaps.every(action => action.a < action.b)).toBe(true);
});
test('descriptors are immutable, input-independent, stable by meaning and change identity with an occupant', () => {
    const source = input(), operations = projectRoomOperations(source), encoded = JSON.stringify(operations);
    expect(projectRoomOperations(source)).toEqual(operations);
    expect(Object.isFrozen(operations)).toBe(true);
    expect(operations.every(operation => Object.isFrozen(operation) && Object.isFrozen(operation.action) && Object.isFrozen(operation.subjects))).toBe(true);
    const before = operations.find(operation => operation.action.type === 'clear_seat' && operation.action.seat === 4)!;
    source.room!.participant_ids![4] = 'replacement';
    const after = projectRoomOperations(source).find(operation => operation.action.type === 'clear_seat' && operation.action.seat === 4)!;
    expect(after.id).not.toBe(before.id); expect(JSON.stringify(operations)).toBe(encoded);
});
test('archive capacity suppresses only reset operations and keeps safe room management available',()=>{
 const source=input();expect(actions(source)).toContainEqual({type:'reset_scores'});
 source.room!.capacity={can_start:false,can_archive:false,can_play:false,reason:{code:'invariant'}};
 expect(actions(source)).not.toContainEqual({type:'reset_scores'});expect(actions(source)).toContainEqual({type:'leave'});
 source.room!.capacity.can_archive=true;expect(actions(source)).toContainEqual({type:'reset_scores'});
});
