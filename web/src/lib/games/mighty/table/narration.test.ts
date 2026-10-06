import { describe, expect, it } from 'vitest';
import { presetRules } from '../../../catalog';
import type { Card, PhaseView, StateMsg } from '../types';
import { describe as narrate, tipFor, variantLabel } from './narration';
import { handView } from './view';

const n = (suit: 'Spade' | 'Diamond' | 'Heart' | 'Club', rank: number): Card => ({ Normal: [suit, rank] });
const rules = presetRules('gshs');
const name = (s: number) => ['나', '콩떡', '민수', '호두', '재용'][s];
const contract = { trump: 'Spade' as const, count: 15 };

function state(phase: PhaseView, over: Partial<StateMsg['view']> = {}): StateMsg {
  return {
    view: {
      viewer: { Seat: 0 },
      rules,
      first_bidder: 0,
      hand: [],
      hand_sizes: [10, 10, 10, 10, 10],
      points_taken: [[], [], [], [], []],
      phase,
      bids: [],
      redealt: null,
      ...over,
    },
    legal: [],
    notes: { unplayable: [], contracts: [] },
    turn: 'Over',
    out_of_turn: [],
    grace_ms: 0,
    version: 0,
  };
}
const bidding = (best: [number, typeof contract] | null, passed: boolean[]): PhaseView => ({
  Bidding: { to_act: 0, best, passed, has_bid: passed.map(() => false) },
});
const play = (over: Partial<Extract<PhaseView, { Play: unknown }>['Play']> = {}): PhaseView => ({
  Play: {
    declarer: 2,
    contract,
    call: { Card: { Joker: 'Black' } },
    friend: null,
    no_friend: false,
    trick_no: 0,
    leader: 2,
    lead: null,
    plays: [],
    leading: null,
    called_joker: null,
    tricks: [],
    discards: null,
    ...over,
  },
});

describe('the event line', () => {
  const none = [false, false, false, false, false];
  it('tells a pass and a bid', () => {
    expect(narrate(state(bidding(null, none)), state(bidding(null, [false, true, false, false, false])), name, true)).toBe('콩떡 · 패스');
    expect(narrate(state(bidding(null, none)), state(bidding([3, contract], none)), name, true)).toBe('호두 · 공약 ♠ 15');
  });
  it('tells a redeal', () => {
    const next = state(bidding(null, none), { redealt: { why: { Misdeal: { seat: 1, hand: [] } }, count: 1 } });
    expect(narrate(state(bidding(null, none)), next, name, true)).toBe('콩떡 딜미스 · 패를 다시 나눠요');
  });
  it('tells the declarer, a changed trump and the friend call', () => {
    const exchange = (trump: 'Spade' | 'Heart'): PhaseView => ({ Exchange: { declarer: 2, contract: { trump, count: 15 }, trump_changed: false, discards: null } });
    expect(narrate(state(bidding([2, contract], none)), state(exchange('Spade')), name, true)).toBe('민수 주공 · ♠ 15');
    expect(narrate(state(exchange('Spade')), state(exchange('Heart')), name, true)).toBe('기루다 변경 · ♥ 15');
    expect(narrate(state(exchange('Spade')), state(play({ call: { Card: n('Diamond', 14) } })), name, true)).toBe('프렌드 마이티');
    expect(narrate(state(exchange('Spade')), state(play()), name, true)).toBe('프렌드 흑조커');
  });
  it('tells who took the round, with its points', () => {
    const trick = { plays: [{ seat: 3, card: n('Club', 10), powered: true }, { seat: 4, card: n('Club', 3), powered: true }], lead: { Suit: 'Club' as const }, winner: 3 };
    expect(narrate(state(play()), state(play({ tricks: [trick] })), name, true)).toBe('호두 가져감 · 1점');
    expect(narrate(state(play()), state(play({ friend: 4 })), name, true)).toBe('재용 프렌드 공개');
  });
  it('keeps the last line when nothing new happened', () => {
    expect(narrate(state(play()), state(play()), name, true)).toBeNull();
  });
});

describe('tips', () => {
  it('say what to do on your turn', () => {
    const h = handView(state(play({ plays: [{ seat: 1, card: n('Club', 9), powered: true }], lead: { Suit: 'Club' } })).view, 0);
    expect(tipFor(h, rules, true, false, 0)).toBe('♣를 따라 내요. 없으면 아무거나. 마이티·조커는 언제든.');
    expect(tipFor(h, rules, false, false, 0)).toBeNull();
    expect(tipFor(h, rules, false, true, 0)).toMatch(/딜미스/);
  });
});

describe('variantLabel', () => {
  it('names each way to play a card', () => {
    expect(variantLabel({ card: { Joker: 'Red' }, joker_lead: { Suit: 'Heart' }, call_joker: false })).toBe('♥로 내기');
    expect(variantLabel({ card: { Joker: 'Red' }, joker_lead: { Color: 'Red' }, call_joker: false })).toBe('빨강으로 내기');
    expect(variantLabel({ card: n('Club', 3), joker_lead: null, call_joker: true })).toBe('조커콜');
    expect(variantLabel({ card: n('Club', 3), joker_lead: null, call_joker: false })).toBe('그냥 내기');
  });
});
