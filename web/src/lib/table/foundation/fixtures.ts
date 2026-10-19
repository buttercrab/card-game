import type { CardVisual, Suit } from '../../cardTypes';
import type { TableDocument } from './contracts';
export type ProofAction = {
    Bid: {
        trump: Suit | null;
        count: number;
    };
} | 'Pass';
export function proofDocument({ revision = 1, longName = false, cards = 10, sparse = false, audience = 'player' }: {
    revision?: number;
    longName?: boolean;
    cards?: number;
    sparse?: boolean;
    audience?: string;
} = {}): Omit<TableDocument<ProofAction>,'forms'> {
    const suits: [
        Suit | null,
        string
    ][] = [['Spade', '♠ 스페이드'], ['Diamond', '♦ 다이아몬드'], ['Heart', '♥ 하트'], ['Club', '♣ 클로버'], [null, '노기루다']];
    const bids = suits.flatMap(([trump]) => [14, 15, 16, 17, 18, 19, 20].filter(count => !sparse || (trump === 'Heart' && [16, 19].includes(count)) || (trump === 'Spade' && [14, 15, 17].includes(count)) || (trump === null && count === 20)).map(count => ({ id: `bid:${trump ?? 'nt'}:${count}`, label: `${suits.find(([suit]) => suit === trump)![1]} ${count}`, intent: 'primary' as const, kind: 'command' as const, enabled: true, action: { Bid: { trump, count } } })));
    const offer = { id: `proof:${revision}`, actions: [...bids, { id: 'pass', label: '패스', intent: 'secondary' as const, kind: 'command' as const, enabled: true, action: 'Pass' as const }] };
    const variants = bids.map(bid => ({ tuple: { trump: bid.action.Bid.trump ?? 'nt', count: String(bid.action.Bid.count) }, actionId: bid.id }));
    return {
        context: { session: 'foundation-proof', audience, generation: '1', revision: String(revision) },
        participant: { id: 'local', name: longName ? '재용 · 긴 이름과 여러 상태 표시도 공간을 정확히 예약해야 합니다' : '재용', markers: ['1점', '주공', '연결됨'] },
        hand: Array.from({ length: cards }, (_, index) => ({ id: `card-${index}`, label: `${index + 1}번 카드`, visual: { kind: 'standard', rank: 2 + index % 13, suit: (['Spade', 'Diamond', 'Heart', 'Club'] as const)[index % 4] } satisfies CardVisual })),
        facts: [{ id: 'turn', subject: 'table', essential: true, label: '상태', value: '내 차례 · 공약 고르기' }, { id: 'contract', subject: 'table', essential: true, label: '공약', value: '기루다와 공약 수는 하나의 유효한 조합으로 선택돼요' }, { id: 'score', subject: 'participant', essential: false, label: '점수', value: '재용 12 · 보리 5 · 호두 0' }],
        decision: { kind: 'finite-choice', id: 'bidding', commands: ['pass'], fields: [{ id: 'trump', label: '기루다', options: suits.filter(([trump]) => bids.some(bid => bid.action.Bid.trump === trump)).map(([trump, label]) => ({ id: trump ?? 'nt', label, enabled: true })) }, { id: 'count', label: '공약 수', options: [...new Set(bids.map(bid => bid.action.Bid.count))].map(count => ({ id: String(count), label: String(count), enabled: true })) }], variants, initialValues: variants[0].tuple, reconciliation: 'preserve-compatible', submit: { unavailable: 'disabled', presentationLabel: { prefix: '공약' } } },
        offer,
    };
}
