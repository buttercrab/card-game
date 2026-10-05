import { describe, expect, test } from 'vitest';
import fixture from '../../../crates/mighty/tests/payoffs.json';
import { handValue, ledger, type Counted } from './scoring';
import type { Rules } from './types';

// Hands the engine scored (crates/mighty/src/state.rs, payoff_fixture):
// the client's count must say what the engine pays.
type Hand = Counted & { value: number; payoffs: number[] };
const sets = fixture as unknown as { name: string; rules: Rules; hands: Hand[] }[];

const label = (h: Hand) =>
  `${h.contract.trump ?? 'NT'} ${h.contract.count}, ${h.team_points} points${h.call === 'Alone' ? ', alone' : ''}`;

test('the fixture has hands to check', () => {
  expect(sets.length).toBeGreaterThan(10);
});

describe.each(sets.map((s) => [s.name, s] as const))('%s', (_, { rules, hands }) => {
  test.each(hands.map((h) => [label(h), h] as const))('%s', (_, hand) => {
    // Seat 0 declared; the last seat is always an opponent. (`|| 0`: a
    // zero is a zero, whatever its sign.)
    expect(-hand.payoffs[hand.payoffs.length - 1] || 0).toBe(hand.value);
    expect(ledger(rules, hand).value || 0).toBe(hand.value);
    expect(handValue(rules, hand.contract, hand.call === 'Alone', hand.team_points) || 0).toBe(hand.value);
  });
});

test('a made bid under the minimum earns no bonus and costs nothing', () => {
  const { rules } = sets.find((s) => s.name === 'bid-bonus')!;
  const count = rules.bidding.min - 1;
  const result = ledger(rules, { contract: { trump: 'Spade', count }, call: { Seat: 1 }, team_points: count });
  expect(result.value).toBe(0);
  expect(result.lines[0]).toContain('보너스 0');
});
