import type { Suit } from '../../cardTypes';
import type { CommandSpec } from '../presentation';
import type { TableCard, TableDocument } from './contracts';

export type PressureKind = 'poker' | 'melds' | 'one-card';
export type PressureAction =
    | { readonly kind: 'poker-raise'; readonly amount: 40 | 80 | 160 }
    | { readonly kind: 'poker-all-in'; readonly amount: 37 }
    | { readonly kind: 'poker-fold' | 'poker-check-call' }
    | { readonly kind: 'meld-draw' | 'meld-end-turn' }
    | { readonly kind: 'one-card-draw' | 'one-card-catch' };

const suits: readonly Suit[] = ['Spade', 'Diamond', 'Heart', 'Club'];
const card = (id: string, rank: number, suit: Suit): TableCard => ({
    id, label: `${suit} ${rank}`, visual: { kind: 'standard', rank, suit },
});
const command = (id: string, label: string, action: PressureAction, intent: CommandSpec<PressureAction>['intent'] = 'secondary'): CommandSpec<PressureAction> => ({
    id, label, action, kind: 'command', enabled: true, intent,
});

/** Synthetic semantic composition fixtures, not executable implementations of game rules. */
export function pressureDocument(kind: PressureKind, { revision = 1, longName = false, cards, sparse = false }: {
    revision?: number;
    longName?: boolean;
    cards?: number;
    sparse?: boolean;
} = {}): TableDocument<PressureAction> {
    const base = {
        context: { session: 'foundation-proof', audience: 'player', generation: '1', revision: String(revision) },
        participant: {
            id: 'local',
            name: longName ? '재용 · 여러 공개 카드 묶음과 긴 이름이 함께 있는 구성 실험' : '재용',
            markers: ['구성 실험', '연결됨'],
        },
        hand: Array.from({ length: cards ?? (kind === 'poker' ? 2 : kind === 'melds' ? 14 : 7) }, (_, index) => card(`hand:${index}`, 2 + index % 13, suits[index % suits.length])),
    };
    const fixtureFact = { id: 'fixture', label: '범위', value: '레이아웃 압력 실험 · 실제 규칙, 판정, 숫자 입력 구현 아님', subject: 'table' as const, essential: true };
    if (kind === 'poker') {
        const amounts = ([40, 80, 160] as const).filter(amount => !sparse || amount !== 80);
        const raises = amounts.map(amount => command(`poker:raise:${amount}`, `레이즈 ${amount}`, { kind: 'poker-raise', amount }, 'primary'));
        const allIn = command('poker:all-in:37', '올인 37 · 별도 정확한 행동', { kind: 'poker-all-in', amount: 37 }, 'primary');
        const commands = [command('poker:fold', '폴드', { kind: 'poker-fold' }, 'quiet'), command('poker:check-call', '체크 / 콜 · 제공된 행동', { kind: 'poker-check-call' })];
        return {
            ...base,
            collections: [{ id: 'poker:board', label: '공개 커뮤니티 카드 · 5장', cards: [card('board:0', 14, 'Spade'), card('board:1', 13, 'Heart'), card('board:2', 12, 'Diamond'), card('board:3', 4, 'Club'), card('board:4', 2, 'Spade')] }],
            facts: [fixtureFact, { id: 'pot', label: '팟', value: '240 · 합성 데이터', subject: 'table', essential: true }, { id: 'raise-policy', label: '제공된 금액', value: `${amounts.join(' / ')} 레이즈, 별도 올인 37 · 연속 범위를 뜻하지 않음`, subject: 'table', essential: true }],
            offer: { id: `pressure:poker:${revision}:${sparse}`, actions: [...raises, allIn, ...commands] },
            decision: {
                id: 'poker:betting', kind: 'finite-choice', commands: commands.map(action => action.id),
                fields: [
                    { id: 'bet-kind', label: '행동 종류', options: [{ id: 'raise', label: '레이즈', enabled: true }, { id: 'all-in', label: '별도 올인', enabled: true }] },
                    { id: 'amount', label: '정확히 제공된 금액', options: [...amounts, 37].map(amount => ({ id: String(amount), label: String(amount), enabled: true })) },
                ],
                variants: [...raises.map((action, index) => ({ tuple: { 'bet-kind': 'raise', amount: String(amounts[index]) }, actionId: action.id })), { tuple: { 'bet-kind': 'all-in', amount: '37' }, actionId: allIn.id }],
                initialValues: { 'bet-kind': 'raise', amount: '40' }, reconciliation: 'preserve-compatible', submit: { unavailable: 'disabled', presentationLabel: { prefix: '확정' } },
            },
        };
    }
    if (kind === 'melds') {
        const commands = [command('melds:draw', '카드 받기 · 구조화된 선택은 아직 구현하지 않음', { kind: 'meld-draw' }, 'primary'), command('melds:end-turn', '차례 종료 · 제공된 실험 행동', { kind: 'meld-end-turn' })];
        return {
            ...base,
            collections: Array.from({ length: 12 }, (_, index) => {
                const run = index % 2 === 0;
                const rank = 2 + index % 10;
                return {
                    id: `meld:${index}`,
                    label: `${index + 1}번 공개 ${run ? '연속 묶음' : '같은 숫자 묶음'} · 여러 덱을 사용하는 합성 데이터${longName ? ' · 긴 설명도 카드와 다른 묶음을 침범하지 않아야 해요' : ''}`,
                    cards: Array.from({ length: run ? 4 : 3 }, (_, offset) => card(`meld:${index}:${offset}`, run ? rank + offset : rank, run ? suits[index % 4] : suits[offset])),
                };
            }),
            facts: [fixtureFact, { id: 'meld-scope', label: '공개 묶음', value: '12개 런 / 세트 · 묶음 생성, 선택, 합법성 검증은 범위 밖', subject: 'table', essential: true }],
            offer: { id: `pressure:melds:${revision}`, actions: commands },
            decision: { id: 'melds:commands', kind: 'commands', commands: commands.map(action => action.id) },
        };
    }
    const commands = [command('one-card:draw', '카드 받기', { kind: 'one-card-draw' }, 'primary'), command('one-card:catch', '원카드 캐치 · 독립된 제공 행동', { kind: 'one-card-catch' })];
    return {
        ...base,
        collections: [{ id: 'one-card:stock', label: '뽑기 더미 · 숨겨진 23장 (앞면 비공개)', cards: [] }, { id: 'one-card:discard', label: '공개 버림 카드', cards: [card('discard:top', 7, 'Heart')] }],
        facts: [fixtureFact, { id: 'effective-suit', label: '현재 유효한 무늬', value: '♣ 클로버 · 맨 위 카드 무늬와 독립된 상태', subject: 'table', essential: true }, { id: 'pending-penalty', label: '대기 중인 페널티', value: '4장 · 합성 상태', subject: 'table', essential: true }, { id: 'catch-scope', label: '캐치', value: '동시에 제공된 독립 행동 · 시간 창, 우선순위, 판정 구현 아님', subject: 'table', essential: true }],
        offer: { id: `pressure:one-card:${revision}`, actions: commands },
        decision: { id: 'one-card:commands', kind: 'commands', commands: commands.map(action => action.id) },
    };
}
