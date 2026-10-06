import { describe, expect, it } from 'vitest';
import { presetRules } from '../catalog';
import type { Card, PhaseView, Played, View } from '../types';
import { bidNote, callLabel, handView, moodOf, resultOf, tagsOf, trickNotes, trickNumber, waitingFor, weight, type Bidding, type Done } from './view';

const n = (suit: 'Spade' | 'Diamond' | 'Heart' | 'Club', rank: number): Card => ({ Normal: [suit, rank] });
const rules = presetRules('gshs');
const name = (s: number) => ['나', '콩떡', '민수', '호두', '재용'][s];

function viewOf(phase: PhaseView, over: Partial<View> = {}): View {
  return {
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
  };
}

const contract = { trump: 'Spade' as const, count: 15 };
function playing(over: Partial<Extract<PhaseView, { Play: unknown }>['Play']> = {}): PhaseView {
  return {
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
  };
}

describe('handView', () => {
  it('knows nothing of teams before the contract', () => {
    const h = handView(viewOf({ Bidding: { to_act: 0, best: null, passed: [false, false, false, false, false], has_bid: [false, false, false, false, false] } }), 0);
    expect(h.bidding).not.toBeNull();
    expect(h.team(2)).toBeNull();
    expect(h.contract).toBeNull();
  });

  it('counts the friend’s points for 야당 until the friend is known', () => {
    const view = viewOf(playing(), { points_taken: [[n('Club', 10)], [], [n('Heart', 10), n('Spade', 11)], [n('Club', 13)], [n('Diamond', 4)]] });
    const h = handView(view, 0);
    expect(h.team(2)).toBe('declarer');
    expect(h.team(3)).toBeNull();
    expect(h.teamPoints).toBe(2);
    expect(h.defensePoints).toBeNull();
    // The 4 is not a point card; 3's K counts for 야당 for now.
    expect(h.tally).toEqual({ decl: 2, def: 2 });
    expect(h.points(4)).toBe(0);
  });

  it('splits the teams once the friend is out', () => {
    const view = viewOf(playing({ friend: 3 }), { points_taken: [[n('Club', 10)], [], [n('Heart', 10)], [n('Club', 13)], []] });
    const h = handView(view, 0);
    expect(h.team(3)).toBe('friend');
    expect(h.team(0)).toBe('defense');
    expect(h.teamPoints).toBe(2);
    expect(h.defensePoints).toBe(1);
  });

  it('says when the contract is made or out of reach', () => {
    const many = Array.from({ length: 15 }, (_, i) => n(i % 2 ? 'Heart' : 'Club', 10 + (i % 5)));
    const made = handView(viewOf(playing({ friend: 3 }), { points_taken: [[], [], many, [], []] }), 0);
    expect(made.contractState).toBe('made');
    const lost = handView(viewOf(playing({ friend: 3 }), { points_taken: [many.slice(0, 6), [], [], [], []] }), 0);
    expect(lost.contractState).toBe('lost');
  });

  it('knows you are the friend when you hold the called card', () => {
    const h = handView(viewOf(playing(), { hand: [{ Joker: 'Black' }, n('Club', 3)] }), 0);
    expect(h.secretFriend).toBe(true);
    expect(handView(viewOf(playing(), { hand: [n('Club', 3)] }), 0).secretFriend).toBe(false);
  });

  it('offers the dealer’s extra turn once everyone passed', () => {
    const passed = { Bidding: { to_act: 0, best: null, passed: [true, true, true, true, true], has_bid: [false, false, false, false, false] } };
    const bids = [0, 1, 2, 3, 4].map((seat) => ({ seat, contract: null }));
    const withMin = { ...rules, bidding: { ...rules.bidding, last_chance_min: 11 } };
    expect(handView(viewOf(passed, { bids, rules: withMin }), 0).lastChance).toBe(11);
    expect(handView(viewOf(passed, { bids: bids.slice(1), rules: withMin }), 0).lastChance).toBeNull();
  });
});

describe('labels', () => {
  it('names the call, then the friend once known', () => {
    expect(callLabel(handView(viewOf(playing()), 0), name)).toBe('흑조커');
    expect(callLabel(handView(viewOf(playing({ friend: 3 })), 0), name)).toBe('호두');
    expect(callLabel(handView(viewOf(playing({ call: { Card: n('Diamond', 14) } })), 0), name)).toBe('마이티');
  });

  it('notes each seat’s bid and pass', () => {
    const bidding: Bidding = { to_act: 0, best: [1, { trump: 'Heart', count: 15 }], passed: [false, false, true, false, false], has_bid: [] };
    expect(bidNote(bidding, 1)).toBe('♥ 15');
    expect(bidNote(bidding, 2)).toBe('패스');
    expect(bidNote(bidding, 3)).toBeNull();
  });

  it('says whose turn it is, in parts', () => {
    expect(waitingFor(handView(viewOf(playing()), 0), 3, name)).toEqual({ pre: '', name: '호두', post: ' 차례' });
    expect(waitingFor(handView(viewOf(playing()), 0), null, name)).toBeNull();
  });

  it('tags the hand: the contract, a run in reach, the last round', () => {
    const h = handView(viewOf(playing({ trick_no: 9 })), 0);
    expect(tagsOf(h, 10, 10, false).map((t) => t.text)).toEqual(['마지막 라운드']);
    expect(tagsOf(h, 10, 10, true)).toEqual([]);
  });

  it('marks powerless cards on the first and last rounds', () => {
    const plays: Played[] = [
      { seat: 1, card: n('Spade', 14), powered: false },
      { seat: 2, card: n('Club', 3), powered: true },
    ];
    expect(trickNotes(plays, 1, 10, () => '♠A')).toEqual(['첫 라운드라 ♠A 효력 없음']);
    expect(trickNotes(plays, 4, 10, () => '♠A')).toEqual(['♠A 효력 없음']);
  });

  it('numbers the rounds from one, or the one resolving', () => {
    const play = handView(viewOf(playing({ trick_no: 3 })), 0).play;
    expect(trickNumber(play, null)).toBe(4);
    expect(trickNumber(play, 3)).toBe(3);
    expect(trickNumber(null, null)).toBe(0);
  });
});

describe('weight', () => {
  const card = (c: Card, seat = 1): Played => ({ seat, card: c, powered: true });
  it('rings the 마이티 and a winning joker', () => {
    expect(weight(card(n('Spade', 14)), false, { Suit: 'Club' }, 'Heart', 1, true)).toBe('mighty');
    expect(weight(card({ Joker: 'Red' }), false, { Suit: 'Club' }, 'Heart', 1, true)).toBe('joker');
    // With two jokers, one that does not take the round lands plainly.
    expect(weight(card({ Joker: 'Red' }), false, { Suit: 'Club' }, 'Heart', 2, true)).toBeNull();
  });
  it('thumps a trump cutting another suit, not one following it', () => {
    expect(weight(card(n('Heart', 4)), false, { Suit: 'Club' }, 'Heart', 1, true)).toBe('cut');
    expect(weight(card(n('Heart', 4)), false, { Suit: 'Heart' }, 'Heart', 1, true)).toBeNull();
    expect(weight(card(n('Heart', 4)), true, { Suit: 'Club' }, 'Heart', 1, true)).toBeNull();
    expect(weight({ ...card(n('Spade', 14)), powered: false }, false, { Suit: 'Club' }, 'Heart', 1, true)).toBeNull();
  });
});

describe('the result', () => {
  const done: Done = {
    declarer: 2,
    contract,
    call: 'Alone',
    friend: null,
    team_points: 20,
    payoffs: [-10, -10, 40, -10, -10],
    value: { contract, team_points: 20, made: true, steps: [{ OverTen: { points: 20, total: 10 } }], value: 10 },
    tricks: [],
    discards: [],
  };
  it('reads the server’s score', () => {
    expect(resultOf(done)).toMatchObject({ made: true, run: true, margin: 5, won: true, lines: ['여당 20점 − 10 = 10'] });
  });
  it('makes the winners glad and the losers down', () => {
    expect(moodOf(2, done, null, null)).toBe('happy');
    expect(moodOf(0, done, null, null)).toBe('down');
    expect(moodOf(0, null, 1, [{ seat: 0, card: n('Club', 10), powered: true }])).toBe('down');
    expect(moodOf(1, null, 1, [])).toBe('happy');
  });
});
