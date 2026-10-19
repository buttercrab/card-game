import type { FigureAppearance, InformationPanel, InformationValue, Scoreboard } from '../../table/foundation/contracts';
import { cardLabel, friendCallLabel, phaseName, sealOf } from './cards';
import { callLabel, handView, tagsOf, trickNumber } from './table/view';
import type { Card, Contract, CurrentRoomView as RoomView, StateMsg, Suit } from './types';

const suits: Record<Suit, string> = { Spade: '스페이드', Heart: '하트', Diamond: '다이아몬드', Club: '클로버' };
const phases: Record<string, string> = { Dealing: '패 나누기', Bidding: '공약 고르기', Exchange: '키티 정리', Play: '카드 내기', Done: '판 종료' };
const text = (value: string): InformationValue => ({ kind: 'text', text: value });
const number = (value: number): InformationValue => ({ kind: 'number', value });
function contractValue(contract: Contract): InformationValue {
    return { kind: 'inline', values: [contract.trump ? { kind: 'suit', suit: contract.trump, label: suits[contract.trump] } : { kind: 'token', token: '노', label: '노기루다' }, { kind: 'number', value: contract.count }] };
}
/** Public information only. Private friend inference never enters the score/role projection. */
export function createMightyInformation({ room, game, seat, participantIds }: {
    room: RoomView;
    game: StateMsg | null;
    seat: number | null;
    participantIds: readonly string[];
}, graceReady = true): { information: readonly InformationPanel[]; scoreboard: Scoreboard; teams: readonly FigureAppearance['team'][] } {
    const shown = room.showing ? game : null;
    const hand = shown ? handView(shown.view, null) : null;
    const name = (index: number) => { const person = room.seats[index]; return person && person.kind !== 'empty' ? person.name : `${index + 1}번 자리`; };
    const matched = (index: number) => !hand?.done || !room.current_hand || room.current_hand.participant_ids[index] === room.participant_ids?.[index];
    const participant = (index: number): InformationValue => matched(index) ? { kind: 'participant', participantId: participantIds[index] } : text(room.current_hand?.names[index] || '이전 참가자');
    const teams = room.seats.map((person, index) => person.kind !== 'empty' && matched(index) ? hand?.team(index) ?? null : null);
    const turn = shown && typeof shown.turn === 'object' ? shown.turn.Seat : null;
    const myTurn = seat !== null && turn === seat && !!shown && typeof shown.view.viewer === 'object' && shown.view.viewer.Seat === seat;
    const summary = { text: !shown ? room.hands_played ? `${room.hands_played}판 끝 · 다음 판을 기다려요` : '첫 판을 기다려요'
        : hand?.done ? '판 종료' : myTurn && !graceReady ? '딜미스 확인 대기' : shown.turn === 'Chance' ? '패를 나누는 중' : shown.turn === 'Over' ? '판 종료' : myTurn ? '내 차례' : turn !== null ? `${name(turn)} 차례` : '진행 중',
        tone: !hand?.done && myTurn && graceReady ? 'accent' as const : 'muted' as const };
    const fields: InformationPanel['fields'][number][] = [];
    let primary: InformationPanel['primary'];
    if (hand?.bidding) {
        const best = hand.bidding.best;
        primary = best ? { label: '최고 공약', value: contractValue(best[1]) } : { value: text('공약 없음') };
        fields.push(best ? { id: 'bidder', label: '공약자', value: participant(best[0]) } : { id: 'minimum', label: '최소', value: number(hand.lastChance ?? room.rules.bidding.min) });
    } else if (hand?.contract) {
        primary = { label: '공약', value: contractValue(hand.contract) };
        if (hand.declarer !== null) fields.push({ id: 'declarer', label: '주공', value: participant(hand.declarer) });
        if (hand.call) {
            let value: InformationValue;
            if (hand.friend !== null) value = participant(hand.friend);
            else if (hand.noFriend) value = text(hand.call === 'Alone' ? '노프렌드' : '없음');
            else if (typeof hand.call === 'object' && 'Card' in hand.call) {
                const card: Card = hand.call.Card;
                const seal = sealOf(card, room.rules, hand.contract.trump);
                value = { kind: 'card', label: callLabel(hand, name) ?? cardLabel(card), visual: 'Normal' in card ? { kind: 'standard', suit: card.Normal[0], rank: card.Normal[1] } : { kind: 'joker', color: card.Joker },
                    ...(seal ? { emphasis: seal === 'mighty' ? 'special' as const : seal } : {}) };
            } else value = text(friendCallLabel(hand.call, name, hand.twoJokers));
            fields.push({ id: 'friend', label: '프렌드', value });
        }
        if (hand.play) fields.push({ id: 'round', label: '라운드', value: text(`${trickNumber(hand.play, null)}/${room.rules.hand_size}`) });
    }
    if (shown) fields.push({ id: 'phase', label: '단계', value: text(phases[phaseName(shown.view.phase)] ?? phaseName(shown.view.phase)) });
    else {
        if (room.table.turn_secs) fields.push({ id: 'turn-limit', label: '턴', value: text(`${room.table.turn_secs}초`) });
        if (room.hands_played) fields.push({ id: 'hands', label: '완료', value: text(`${room.hands_played}판`) });
    }
    const progress: InformationPanel['progress'] = hand?.contract && (hand.play || hand.done) ? {
        label: '점수 카드', total: 20, target: hand.contract.count,
        series: [{ id: 'declarer', label: '여당', value: hand.tally.decl, tone: 'gold', from: 'start' }, { id: 'defense', label: '야당', value: hand.tally.def, tone: 'plain', from: 'end' }],
    } : undefined;
    const start = seat ?? 0;
    return { information: [{ id: 'mighty-status', title: '상황판', summary, ...(primary ? {primary} : {}), fields, ...(progress ? {progress} : {}), badges: hand ? tagsOf(hand, room.rules.hand_size, trickNumber(hand.play, null), false) : [] }],
        scoreboard: { id: 'scores', title: '점수판', columns: [{ id: 'hand', label: '점수' }, { id: 'total', label: '누적' }],
            rows: room.seats.map((_, offset) => {
                const index = (start + offset) % room.seats.length;
                const vacant = room.seats[index].kind === 'empty';
                const team = teams[index];
                return { participantId: participantIds[index], values: [!vacant && matched(index) && (hand?.play || hand?.done) ? hand.points(index) : null, vacant ? null : room.scores[index] ?? 0],
                    ...(team ? { badges: [{ text: team === 'declarer' ? '주공' : team === 'friend' ? '프렌드' : '야당', tone: team === 'declarer' ? 'gold' as const : team === 'friend' ? 'accent' as const : 'plain' as const }] } : {}) };
            }) }, teams };
}
