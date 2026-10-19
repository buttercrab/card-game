import {readActionPolicy} from '../../room/actionPolicy';
import type { ActionSpec, CardSpec, GamePresentation, GamePresenter } from '../../table/presentation';
import { actionLabel, cardKey, cardLabel, phaseName, rankLabel, sameCard, mightyCard, SUIT_SYMBOL } from './cards';
import type { Action, Card, StateMsg } from './types';
import { refusalText } from './ledger';

export type LegalPlayAction = Extract<Action, { Play: unknown }>;
export type PlayActionSpec = Extract<ActionSpec<Action>, { kind: 'command' }> & { readonly action: LegalPlayAction };

/** Keep each server action intact: one joker may have several legal leads. */
export function selectPlayActions(legal: readonly Action[], card?: Card): LegalPlayAction[] {
  return legal.filter((action): action is LegalPlayAction => typeof action === 'object' && 'Play' in action && (!card || sameCard(action.Play.card, card)));
}
export const playActionsForCard = selectPlayActions;

/** Membership in an explicit server offer, without interpreting the rules. */
export function playableCards(legal: readonly Action[], hand: readonly Card[]): Card[] {
  return hand.filter(card => selectPlayActions(legal, card).length > 0);
}

/** Typed variants for a rendered card; disabled descriptors remain inspectable. */
export function cardActionSpecs(presentation: GamePresentation<Action>, cardId: string): PlayActionSpec[] {
  return presentation.offer.actions.filter((spec): spec is PlayActionSpec => spec.kind === 'command'
    && typeof spec.action === 'object' && 'Play' in spec.action && cardKey(spec.action.Play.card) === cardId);
}

function describeCard(card: Card, zoneId: string): CardSpec {
  return {
    id: cardKey(card), zoneId, label: cardLabel(card), face: 'up', artKey: cardKey(card),
    visual: 'Normal' in card ? { kind: 'standard', rank: card.Normal[1], suit: card.Normal[0] } : { kind: 'joker', color: card.Joker },
    ...('Normal' in card ? { rank: rankLabel(card.Normal[1]), suit: SUIT_SYMBOL[card.Normal[0]] } : {}),
  };
}

/** Project only an authorized view and exact legal payloads; never simulate legality. */
export const projectMighty: GamePresenter<StateMsg, Action> = (state, context) => {
  const policy=readActionPolicy(state),available=new Set(policy.legal.map(action=>JSON.stringify(action))),offTurnAvailable=new Set(policy.out_of_turn.map(action=>JSON.stringify(action)));
  const policyReason=policy.valid?'테이블의 저장 한도로 지금은 이 동작을 할 수 없어요':'가능한 동작을 확인할 수 없어요';
  const phase = phaseName(state.view.phase);
  const authorizedViewer = context.viewer !== null && typeof state.view.viewer === 'object' && state.view.viewer.Seat === context.viewer;
  const active = authorizedViewer && context.active;
  const name = (seat: number) => context.players.find(player => player.seat === seat)?.label ?? `${seat + 1}번 자리`;
  const actions: ActionSpec<Action>[] = (authorizedViewer ? state.legal : []).map(action => {
    const offTurnMisdeal = action === 'Misdeal' && authorizedViewer && state.out_of_turn.includes('Misdeal');
    const ruleEnabled=active||offTurnMisdeal;
    const enabled = active&&available.has(JSON.stringify(action))||offTurnMisdeal&&offTurnAvailable.has(JSON.stringify(action));
    return {
      kind: 'command', id: `mighty-action:${JSON.stringify(action)}`, label: typeof action==='object'&&'CallFriend'in action&&typeof action.CallFriend==='object'&&'Card'in action.CallFriend&&typeof state.view.phase==='object'&&'Exchange'in state.view.phase&&sameCard(action.CallFriend.Card,mightyCard(state.view.phase.Exchange.contract.trump))?`프렌드 마이티 (${cardLabel(action.CallFriend.Card)})`:actionLabel(action, name) || '패 나누기',
      intent: action === 'Pass' ? 'secondary' : action === 'Misdeal' ? 'quiet' : 'primary',
      enabled, ...(!enabled ? { reason:ruleEnabled?policyReason:'지금은 내 차례가 아니에요' } : {}), action,
    };
  });
  if (authorizedViewer && state.out_of_turn.includes('Misdeal') && !state.legal.includes('Misdeal')) {
    const enabled=offTurnAvailable.has(JSON.stringify('Misdeal'));
    actions.push({ kind: 'command', id: 'mighty-action:"Misdeal"', label: '딜미스', intent: 'quiet', enabled,...(!enabled?{reason:policyReason}:{}), action: 'Misdeal' });
  }
  const offer = {
    id: `mighty:${state.version}:${phase}:${context.viewer}:${active}:${JSON.stringify(actions.map(spec => [spec.id, spec.enabled]))}`,
    actions,
  };
  const cards: CardSpec[] = (authorizedViewer ? state.view.hand : []).map(card => {
    const rulePlayable=state.legal.some(action=>typeof action==='object'&&('Play'in action&&sameCard(action.Play.card,card)||'Discard'in action&&sameCard(action.Discard,card)));
    const enabled = active && policy.legal.some(action => typeof action === 'object'
      && ('Play' in action && sameCard(action.Play.card, card) || 'Discard' in action && sameCard(action.Discard, card)));
    const reason = state.notes.unplayable.find(note => sameCard(note.card, card))?.why;
    return { ...describeCard(card, 'own-hand'), enabled, ...(!enabled ? { reason:active&&rulePlayable?policyReason:reason ? refusalText(reason) : '현재 선택지에 없는 카드예요' } : {}) };
  });
  const play = typeof state.view.phase === 'object' && 'Play' in state.view.phase ? state.view.phase.Play : null;
  for (const played of play?.plays ?? []) cards.push({ ...describeCard(played.card, 'current-trick'), enabled: false });
  const ownerId = context.players.find(player => player.seat === context.viewer)?.id;
  const turn = typeof state.turn === 'object' ? state.turn.Seat : null;
  return {
    id: 'mighty',
    zones: [{ id: 'own-hand', label: '내 패', kind: 'hand', ...(ownerId ? { ownerId } : {}) }, { id: 'current-trick', label: '이번 라운드', kind: 'table' }],
    cards,
    players: context.players.map(player => ({ id: player.id, seat: player.seat, name: player.label, kind: player.kind ?? 'human' })),
    offer,
    status: state.turn === 'Chance' ? '패를 나누는 중' : state.turn === 'Over' ? '판 종료' : active ? '내 차례' : `${name(turn!)}님 차례`,
  };
};
