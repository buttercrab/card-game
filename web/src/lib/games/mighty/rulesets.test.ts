import { expect, test } from 'vitest';
import { MIGHTY, presetRules } from './catalog';
import { fillGaps, upgradeRules } from './rulesets';
import type { Rules } from './types';

test('rules saved before an option existed read it as the server does', () => {
  const saved = presetRules('gshs') as Partial<Rules> & Record<string, unknown>;
  delete saved.lowest_rank;
  delete saved.scoring;
  delete (saved.bidding as Partial<Rules['bidding']>).raise_on_exchange;
  const filled = fillGaps(saved as Rules, MIGHTY.rule_defaults);
  expect(filled.lowest_rank).toBe(MIGHTY.rule_defaults.lowest_rank);
  expect(filled.scoring).toEqual(MIGHTY.rule_defaults.scoring);
  expect(filled.bidding.raise_on_exchange).toBe(MIGHTY.rule_defaults.bidding.raise_on_exchange);
  // What the set says stays as it says.
  expect(filled.bidding.min).toBe(presetRules('gshs').bidding.min);
  expect(filled.joker_call.calls).toEqual(presetRules('gshs').joker_call.calls);
  expect(filled.deck).toBe('TwoJokers');
});

test('rules saved with the old misdeal flags read them as the window they meant', () => {
  const cases: [boolean, boolean, Rules['misdeal']['window']][] = [
    [false, false, 'OwnTurnUntilBid'],
    [false, true, 'AllBidding'],
    [true, false, 'BeforeFirstBid'],
    [true, true, 'BeforeFirstBid'],
  ];
  for (const [ask_first, after_bidding, window] of cases) {
    const saved = presetRules('gshs');
    const misdeal = saved.misdeal as Partial<Rules['misdeal']> & Record<string, unknown>;
    delete misdeal.window;
    Object.assign(misdeal, { ask_first, after_bidding });
    const read = fillGaps(upgradeRules(saved), MIGHTY.rule_defaults);
    expect(read.misdeal.window).toBe(window);
    expect('ask_first' in read.misdeal).toBe(false);
  }
  // Rules saved now pass as they are.
  expect(upgradeRules(presetRules('default'))).toEqual(presetRules('default'));
});
