import type { GameTypes, RoomMsgOf } from './types';

type ParticipationRoom = Pick<RoomMsgOf<GameTypes>, 'seats' | 'participation' | 'observers' | 'participant_ids' | 'in_hand'>;

/** Both observer entry points must respect another person's reservation. */
export function availableSeat(room: Pick<ParticipationRoom, 'seats' | 'participation'>, viewerId: string | null) {
  return room.seats.findIndex((seat, index) =>
    (seat.kind === 'empty' || seat.kind === 'bot') &&
    !room.participation?.some(request => request.seat === index && request.id !== viewerId));
}

/** One quiet, actionable transition; unchanged snapshots do not repeat it. */
export function participationNotice(before: ParticipationRoom, after: ParticipationRoom, viewerId: string) {
  const requests = after.participation ?? [];
  const own = requests.find(request => request.id === viewerId);
  const previousOwn = before.participation?.find(request => request.id === viewerId);
  if (own?.seat !== null && own?.seat !== undefined && !after.in_hand &&
    (before.in_hand || previousOwn?.seat !== own.seat || previousOwn?.target_id !== own.target_id)) {
    return `${own.name}님, 자리가 준비됐어요. 앉아서 다음 판을 준비해주세요`;
  }
  const joined = before.observers?.find(observer =>
    observer.id !== viewerId && !before.participant_ids?.includes(observer.id) && after.participant_ids?.includes(observer.id));
  if (joined) return `${joined.name}님이 다음 판부터 함께해요`;
  const waiting = requests.find(request => request.id !== viewerId && request.seat === null &&
    !before.participation?.some(previous => previous.id === request.id));
  if (waiting) return `${waiting.name}님이 다음 판 참여를 기다려요`;
  const added = after.observers?.find(observer => observer.id !== viewerId &&
    !before.observers?.some(previous => previous.id === observer.id));
  return added ? `${added.name}님이 관전을 시작했어요` : null;
}
