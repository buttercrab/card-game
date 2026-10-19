import type {CurrentRoomViewOf as RoomViewOf} from '../../room/currentRoom';
import type { BotLevel, GameTypes, RoomActionOf } from '../../room/types';
import {capacityAllowsRoomAction} from '../../room/capacity';

export type RoomOperationPurpose = 'request-participation' | 'cancel-participation' | 'accept-participation'
    | 'offer-seat' | 'cancel-offer' | 'add-bot' | 'bot-level' | 'remove-bot'
    | 'swap-seats' | 'move-seat' | 'stand' | 'clear-seat' | 'relieve-seat' | 'reset-scores';
export type RoomOperationSubject = { readonly kind: 'room'; readonly roomId: string }
    | { readonly kind: 'person'; readonly participantId: string }
    | { readonly kind: 'seat'; readonly seat: number; readonly participantId?: string };
/** Inert exact command data. IDs are opaque; consumers must never parse them. */
export interface RoomOperation<S> {
    readonly id: string;
    readonly purpose: RoomOperationPurpose;
    readonly label: string;
    readonly action: RoomActionOf<S>;
    readonly subjects: readonly RoomOperationSubject[];
    readonly confirmation?: { readonly title: string; readonly message: string; readonly confirmLabel: string };
}
export interface RoomOperationsInput<G extends GameTypes> {
    readonly room: RoomViewOf<G> | null;
    readonly status: 'connecting' | 'open' | 'closed' | 'missing';
    readonly seat: number | null;
    readonly viewerId: string | null;
    readonly botLevels: readonly { readonly id: BotLevel; readonly label: string }[];
}

/** Bounded lookup ID only: exact scoped action binding remains the authority. */
function opaqueId(value: string): string {
    let hash = 0xcbf29ce484222325n;
    for (let index = 0; index < value.length; index++)
        hash = BigInt.asUintN(64, (hash ^ BigInt(value.charCodeAt(index))) * 0x100000001b3n);
    return `room-operation:${hash.toString(16).padStart(16, '0')}`;
}

/**
 * Conservative discoverability projection, NOT an authorization or freshness gate.
 * Authority remains server actor.rs / seating.rs / lifecycle.rs. The connected
 * host must capture the offered room window and admit through scoped transport.
 * Legacy arranging restrictions intentionally hide seat/bot management mid-hand,
 * even where the server permits replacing an offline seat earlier. Reservations
 * suppress destructive management; owner stand/cancel and next-hand offers remain.
 * Name editing and direct Join need the generic native-edit contract and are not
 * fabricated from remembered names or seat indices here. AcceptSeat uses the
 * server's existing named observer and exact reservation target instead.
 */
export function projectRoomOperations<G extends GameTypes>(input: RoomOperationsInput<G>): readonly RoomOperation<G['settings']>[] {
    const { room, status, viewerId, seat, botLevels } = input;
    if (!room || status !== 'open' || !viewerId || room.seats.length > 32) return Object.freeze([]);
    const requests = room.participation ?? [];
    const personId = (index: number) => room.participant_ids?.[index];
    const seatSubject = (index: number): RoomOperationSubject => ({ kind: 'seat', seat: index,
        ...(personId(index) ? { participantId: personId(index) } : {}) });
    const roomSubject: RoomOperationSubject = { kind: 'room', roomId: room.id };
    const name = (index: number) => room.seats[index].kind === 'empty' ? `${index + 1}번 빈자리` : room.seats[index].name;
    const reserved = (index: number) => requests.some(request => request.seat === index);
    const result: RoomOperation<G['settings']>[] = [];
    const identities = new Map<string, string>();
    function add(purpose: RoomOperationPurpose, label: string, action: RoomActionOf<G['settings']>, subjects: readonly RoomOperationSubject[], confirmation?: RoomOperation<G['settings']>['confirmation']) {
        if(!capacityAllowsRoomAction(room,action))return;
        const frozenSubjects = Object.freeze(subjects.map(subject => Object.freeze({ ...subject })));
        const identity = JSON.stringify([purpose, action, frozenSubjects]), id = opaqueId(identity);
        if (identities.has(id)) throw new Error('Room operation ID collision');
        identities.set(id, identity);
        result.push(Object.freeze({ id, purpose, label,
            action: Object.freeze({ ...action }), subjects: frozenSubjects,
            ...(confirmation ? { confirmation: Object.freeze({ ...confirmation }) } : {}) }));
    }
    const own = seat === null ? undefined : room.seats[seat];
    const seated = own?.kind === 'human' && own.connected && (!personId(seat!) || personId(seat!) === viewerId);
    if (!seated) {
        // observer_id rejects an observing guest who still owns an offline seat.
        if (seat !== null || room.seats.some((occupant, index) => occupant.kind === 'human' && personId(index) === viewerId)
            || !room.observers?.some(observer => observer.id === viewerId && observer.name.trim())) return Object.freeze([]);
        const request = requests.find(request => request.id === viewerId);
        const subject: RoomOperationSubject = { kind: 'person', participantId: viewerId };
        if (request) {
            add('cancel-participation', '참여 취소', { type: 'request_seat', requested: false, seat: null }, [subject]);
            const target = request.seat;
            if (!room.in_hand && target !== null && room.seats[target] && request.target_id
                && personId(target) === request.target_id
                && (room.seats[target].kind !== 'human' || request.offered_by === request.target_id))
                add('accept-participation', '앉아서 다음 판 준비', { type: 'accept_seat', seat: target, target_id: request.target_id }, [subject, seatSubject(target)]);
        } else {
            add('request-participation', '다음 판 참여', { type: 'request_seat', requested: true, seat: null }, [subject]);
            room.seats.forEach((occupant, index) => {
                if (occupant.kind !== 'human' && !reserved(index))
                    add('request-participation', `${index + 1}번 자리 참여 요청`, { type: 'request_seat', requested: true, seat: index }, [subject, seatSubject(index)]);
            });
        }
        return Object.freeze(result);
    }
    const ownOffer = requests.find(request => request.offered_by === viewerId);
    if (ownOffer) add('cancel-offer', '자리 양보 취소', { type: 'offer_seat', requester_id: null }, [seatSubject(seat!)]);
    const waiting = requests.filter(request => request.seat === null).sort((a, b) => a.order - b.order)[0];
    if (!ownOffer && !reserved(seat!) && waiting)
        add('offer-seat', `${waiting.name}님에게 다음 판 자리 양보`, { type: 'offer_seat', requester_id: waiting.id }, [seatSubject(seat!), { kind: 'person', participantId: waiting.id }]);
    if (room.in_hand) return Object.freeze(result);
    add('stand', '관전으로 전환', { type: 'leave' }, [seatSubject(seat!)]);
    add('reset-scores', '점수 초기화', { type: 'reset_scores' }, [roomSubject], {
        title: '누적 점수를 초기화할까요?', message: '사람과 자리, 규칙은 그대로 두고 누적 점수를 0점부터 시작해요.', confirmLabel: '점수 초기화',
    });
    const levels = botLevels.filter((level, index) => ['easy', 'normal', 'hard'].includes(level.id)
        && level.label.trim() && botLevels.findIndex(candidate => candidate.id === level.id) === index);
    room.seats.forEach((occupant, index) => {
        if (reserved(index)) return;
        if (occupant.kind === 'empty' || occupant.kind === 'bot' || !occupant.connected) {
            for (const level of levels) {
                if (occupant.kind === 'bot' && occupant.level === level.id) continue;
                const purpose = occupant.kind === 'empty' ? 'add-bot' : occupant.kind === 'bot' ? 'bot-level' : 'relieve-seat';
                add(purpose, `${name(index)} · ${level.label} 봇${occupant.kind === 'empty' ? ' 앉히기' : occupant.kind === 'bot' ? '으로 변경' : '에게 맡기기'}`,
                    { type: 'add_bot', seat: index, level: level.id }, [seatSubject(index)], occupant.kind === 'human' ? {
                        title: `${name(index)}님 자리를 봇에게 맡길까요?`, message: '기존 플레이어 대신 봇이 이 자리와 점수를 이어받아요.', confirmLabel: '봇에게 맡기기',
                    } : undefined);
            }
        }
        if (occupant.kind === 'bot') add('remove-bot', `${name(index)} 봇 빼기`, { type: 'remove_bot', seat: index }, [seatSubject(index)]);
        if (occupant.kind === 'human' && index !== seat)
            add('clear-seat', `${name(index)}님을 관전으로 전환`, { type: 'clear_seat', seat: index }, [seatSubject(index)], {
                title: `${name(index)}님을 구경하는 자리로 옮길까요?`, message: '플레이어는 다시 참여할 수 있어요.', confirmLabel: '관전으로 전환',
            });
        for (let other = index + 1; other < room.seats.length; other++) {
            if (reserved(other) || occupant.kind === 'empty' && room.seats[other].kind === 'empty') continue;
            const moving = (index === seat && room.seats[other].kind === 'empty') || (other === seat && occupant.kind === 'empty');
            add(moving ? 'move-seat' : 'swap-seats', `${name(index)} ↔ ${name(other)}`, { type: 'swap_seats', a: index, b: other }, [seatSubject(index), seatSubject(other)]);
        }
    });
    return Object.freeze(result);
}
