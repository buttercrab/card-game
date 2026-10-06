import { describe, expect, test } from 'vitest';
import fixture from '../../../../../crates/mighty/tests/payoffs.json';
import { ledgerLines, refusalText } from './ledger';
import type { Contract, FriendCall, HandValue, Rules } from './types';

// Hands the engine scored (crates/mighty/src/state.rs, payoff_fixture),
// each with the breakdown the server sends: the count the result shows
// must end on what the engine pays.
type Hand = { contract: Contract; call: FriendCall; team_points: number; value: number; payoffs: number[]; breakdown: HandValue };
const sets = fixture as unknown as { name: string; rules: Rules; hands: Hand[] }[];

const label = (h: Hand) =>
  `${h.contract.trump ?? 'NT'} ${h.contract.count}, ${h.team_points} points${h.call === 'Alone' ? ', alone' : ''}`;

test('the fixture has hands to check', () => {
  expect(sets.length).toBeGreaterThan(10);
});

describe.each(sets.map((s) => [s.name, s] as const))('%s', (_, { hands }) => {
  test.each(hands.map((h) => [label(h), h] as const))('%s', (_, hand) => {
    const { breakdown } = hand;
    // Seat 0 declared; the last seat is always an opponent. (`|| 0`: a
    // zero is a zero, whatever its sign.)
    expect(-hand.payoffs[hand.payoffs.length - 1] || 0).toBe(breakdown.value || 0);
    const lines = ledgerLines(breakdown);
    expect(lines.length).toBe(breakdown.steps.length);
    // The last line ends on the amount: what is owed, until a doubling
    // shows it as the loss it is. A bare shortfall has no sum to show.
    const last = breakdown.steps[breakdown.steps.length - 1];
    const shown = Number(lines[lines.length - 1].split('= ').pop());
    if ('Short' in last) expect(shown).toBeNaN();
    else expect(shown || 0).toBe(('Doubled' in last || breakdown.made ? breakdown.value : -breakdown.value) || 0);
  });
});

test('a made bid under the minimum earns no bonus and costs nothing', () => {
  const set = sets.find((s) => s.name === 'bid-bonus')!;
  const under = set.hands.find((h) => h.contract.count === set.rules.bidding.min - 1 && h.team_points === h.contract.count)!;
  expect(under.breakdown.value).toBe(0);
  expect(ledgerLines(under.breakdown)[0]).toContain('보너스 0');
});

test('refusals say which rule holds the card back', () => {
  expect(refusalText({ MustFollow: { Suit: 'Heart' } })).toBe('♥를 따라 내야 해요');
  expect(refusalText({ HeldBack: { card: 'Trump', trick: 'First', leading: true } })).toBe('첫 라운드엔 기루다로 선을 낼 수 없어요');
  expect(refusalText({ HeldBack: { card: 'Mighty', trick: 'Last', leading: false } })).toBe('마지막 라운드엔 마이티를 낼 수 없어요');
  expect(refusalText('JokerFirstLead')).toBe('첫 라운드엔 조커로 선을 낼 수 없어요');
});
