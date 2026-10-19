import { proofDocument } from './fixtures';
import type { TableCard, TableDocument } from './contracts';
export type FlowAction = { Flow: 'deal' | 'batch' | 'collect' | 'reset' } | { Play: { cardId: string } };
export interface FlowState { readonly stock: readonly TableCard[]; readonly hand: readonly TableCard[]; readonly play: readonly TableCard[]; readonly captured: readonly TableCard[]; readonly round: number; readonly dealt: readonly string[]; }
export const initialFlow = (round = 1): FlowState => ({ stock: proofDocument({ cards: 3 }).hand, hand: [], play: [], captured: [], round, dealt: [] });
export function advanceFlow(state: FlowState, action: FlowAction): FlowState {
    if ('Flow' in action) {
        if (action.Flow === 'reset') return initialFlow(state.round + 1);
        if ((action.Flow === 'deal' || action.Flow === 'batch') && state.stock.length) {const cards=state.stock.slice(0,action.Flow==='batch'?3:1);return {...state,stock:state.stock.slice(cards.length),hand:[...state.hand,...cards],dealt:cards.map(card=>card.id)};}
        if (action.Flow === 'collect' && state.play.length) return { ...state, captured: [...state.captured, ...state.play], play: [], dealt: [] };
    } else if (!state.stock.length && !state.play.length) {
        const card = state.hand.find(card => card.id === action.Play.cardId);
        if (card) return { ...state, hand: state.hand.filter(item => item.id !== card.id), play: [card], dealt: [] };
    }
    throw new Error('Invalid synthetic flow transition');
}
export function flowDocument(state: FlowState, revision: number, hidden = false): TableDocument<FlowAction> {
    const base = proofDocument({ revision });
    const command = (id: 'deal' | 'batch' | 'collect' | 'reset', label: string) => ({ id: `flow:${id}`, kind: 'command' as const, label, intent: 'primary' as const, enabled: true, action: { Flow: id } as FlowAction });
    const commands = [command('reset', '다시 시작'), ...(state.stock.length ? [command('deal', '한 장 나누기'),...(hidden && state.stock.length>1?[command('batch','묶음 나누기')]:[])] : state.play.length ? [command('collect', '트릭 모으기')] : [])];
    const plays = !state.stock.length && !state.play.length ? state.hand.map(card => ({ id: `play:${card.id}`, kind: 'command' as const, label: '카드 내기', intent: 'primary' as const, enabled: true, action: { Play: { cardId: card.id } } })) : [];
    return { ...base, context: { ...base.context, session: hidden ? 'hidden-flow-proof' : 'flow-proof', generation: String(state.round) }, participant: { ...base.participant, markers: [] },
        hand: state.hand,
        ...(hidden && state.dealt.length ? {deals:[{id:`deal:${state.round}:${revision}`,source:'stock',cardIds:state.dealt}]} : {}),
        facts: [{ id: 'flow', subject: 'table', essential: true, label: '이동 검증', value: hidden ? '숨긴 덱 · 합성 배분 검증' : '공개 카드 3장 · 합성 흐름' }],
        collections: [ { id: 'stock', purpose: 'stock', label: '덱', cards: hidden ? [] : state.stock, ...(hidden?{hiddenCount:state.stock.length}:{}) }, { id: 'play', purpose: 'play', label: '테이블', cards: state.play }, { id: 'captured', purpose: 'captured', label: '획득', cards: state.captured } ],
        offer: { id: `flow:${state.round}:${revision}`, actions: [...commands,...plays] },
        decision: plays.length ? { kind: 'card-selection', id: 'flow-play', commands: commands.map(command=>command.id), mode: 'one', variants: plays.map(play=>({cardIds:[play.action.Play.cardId],actionId:play.id})), submit: {prefix:'선택 확정'} }
            : { kind: 'commands', id: 'flow-step', commands: commands.map(command=>command.id) },
    };
}
