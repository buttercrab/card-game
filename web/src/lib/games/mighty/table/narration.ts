// The table's words for what happens: the one event line under the top
// display (a pass, a bid, who took the round), and the tip for learners
// (초보 도움말). Pure, so it is tested on its own (narration.test.ts).

import { contractLabel, friendCallLabel, isPoint, leadLabel } from '../cards';
import type { PlayAction, PhaseView, StateMsg, Trick, Card, Rules } from '../types';
import { callsMighty, phaseOf, type HandView } from './view';

/** What the rounds of a phase look like, for comparing two states. */
export interface Round {
  plays: { seat: number; card: Card }[];
  tricks: Trick[];
  friend: number | null;
  no_friend?: boolean;
  called_joker?: Card | null;
  leading?: number | null;
}

export function roundOf(p: PhaseView): Round | null {
  const { play, done } = phaseOf(p);
  if (play) return play;
  if (done) return { plays: [], tricks: done.tricks, friend: done.friend };
  return null;
}

/** Whether the cards were dealt again between two states. */
export function redealtBetween(prev: StateMsg, next: StateMsg): boolean {
  const r = next.view.redealt;
  return r != null && JSON.stringify(r) !== JSON.stringify(prev.view.redealt);
}

/** The event line for a change of state, or null to keep the last one. */
export function describe(prev: StateMsg, next: StateMsg, seatName: (seat: number) => string, twoJokers: boolean): string | null {
  const was = phaseOf(prev.view.phase);
  const now = phaseOf(next.view.phase);
  if (typeof next.view.phase !== 'object') return null;
  const redeal = next.view.redealt;
  if (redeal && redealtBetween(prev, next)) {
    return redeal.why === 'AllPassed' ? '모두 패스 · 패를 다시 나눠요' : `${seatName(redeal.why.Misdeal.seat)} 딜미스 · 패를 다시 나눠요`;
  }
  if (now.bidding) {
    if (!was.bidding) return null;
    const passed = now.bidding.passed.findIndex((p, i) => p && !was.bidding!.passed[i]);
    if (passed >= 0) return `${seatName(passed)} · 패스`;
    const best = now.bidding.best;
    if (best && JSON.stringify(best) !== JSON.stringify(was.bidding.best)) {
      return `${seatName(best[0])} · 공약 ${contractLabel(best[1])}`;
    }
    return null;
  }
  if (now.exchange && !was.exchange) {
    return `${seatName(now.exchange.declarer)} 주공 · ${contractLabel(now.exchange.contract)}`;
  }
  if (now.exchange && was.exchange) {
    const before = was.exchange.contract;
    const after = now.exchange.contract;
    if (before.trump !== after.trump) return `기루다 변경 · ${contractLabel(after)}`;
    if (before.count !== after.count) return `공약 올리기 · ${contractLabel(after)}`;
    return null;
  }
  if (now.play && was.exchange) {
    const label = friendCallLabel(now.play.call, seatName, twoJokers);
    return `프렌드 ${callsMighty(now.play.call, now.play.contract.trump) ? '마이티' : label}`;
  }
  const a = roundOf(prev.view.phase);
  const b = roundOf(next.view.phase);
  if (a && b) {
    if (b.friend !== null && a.friend === null) return `${seatName(b.friend)} 프렌드 공개`;
    if (b.no_friend && !a.no_friend) return '프렌드 없음 · 주공 혼자';
    if (b.called_joker && !a.called_joker) return '조커콜 · 조커를 가진 사람은 조커를 내야 해요';
    if (b.tricks.length > a.tricks.length) {
      const t = b.tricks.at(-1)!;
      const got = t.plays.filter((p) => isPoint(p.card)).length;
      return `${seatName(t.winner)} 가져감${got > 0 ? ` · ${got}점` : ''}`;
    }
  }
  return null;
}

/** A line of advice on your turn, for people learning the game; null when
 * there is nothing to say. `misdeal`: 딜미스 is open outside your turn. */
export function tipFor(hand: HandView, rules: Rules, myTurn: boolean, misdeal: boolean, toDiscard: number): string | null {
  if (misdeal) return '패가 약해요. 차례가 아니어도 딜미스로 다시 나눌 수 있어요.';
  if (!myTurn) return null;
  const { bidding, exchange, play } = hand;
  if (bidding)
    return bidding.best
      ? `${contractLabel(bidding.best[1])}보다 높게 부르거나 패스. 센 카드가 많으면 도전!`
      : hand.lastChance !== null
        ? `모두 패스했어요. ${hand.lastChance}부터 부르거나, 또 패스하면 다시 나눠요.`
        : '많이 가진 무늬를 기루다로 골라 불러요. 자신 없으면 패스.';
  if (exchange)
    return toDiscard > 0
      ? `필요 없는 카드 ${toDiscard}장을 버려요. 버린 점수 카드${!rules.scoring.discards_to_declarer ? '는 야당 점수가 돼요.' : '도 여당 점수예요.'}`
      : '프렌드를 불러요. 보통 마이티나 조커를 불러요.';
  if (play) {
    if (play.plays.length === 0) return '내가 선이에요. 아무 카드나 내도 돼요.';
    const lead = play.lead;
    if (lead && 'Suit' in lead) return `${leadLabel(lead)}를 따라 내요. 없으면 아무거나. 마이티·조커는 언제든.`;
    return '처음 낸 색이 있으면 그 색을 내요. 없으면 아무거나.';
  }
  return null;
}

/** How a card that can be played more than one way is played, as a button says it. */
export function variantLabel(p: PlayAction): string {
  if (p.joker_lead) return 'Suit' in p.joker_lead ? `${leadLabel(p.joker_lead)}로 내기` : `${leadLabel(p.joker_lead)}으로 내기`;
  if (p.call_joker) return '조커콜';
  return '그냥 내기';
}
