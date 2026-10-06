import { expect, test } from 'vitest';
import { CATALOG, presetRules } from './catalog';
import { fillGaps } from './rulesets';
import type { Rules } from './types';

test('rules saved before an option existed read it as the server does', () => {
  const saved = presetRules('gshs') as Partial<Rules> & Record<string, unknown>;
  delete saved.lowest_rank;
  delete saved.scoring;
  delete (saved.bidding as Partial<Rules['bidding']>).raise_on_exchange;
  const filled = fillGaps(saved as Rules, CATALOG.rule_defaults);
  expect(filled.lowest_rank).toBe(CATALOG.rule_defaults.lowest_rank);
  expect(filled.scoring).toEqual(CATALOG.rule_defaults.scoring);
  expect(filled.bidding.raise_on_exchange).toBe(CATALOG.rule_defaults.bidding.raise_on_exchange);
  // What the set says stays as it says.
  expect(filled.bidding.min).toBe(presetRules('gshs').bidding.min);
  expect(filled.joker_call.calls).toEqual(presetRules('gshs').joker_call.calls);
  expect(filled.deck).toBe('TwoJokers');
});
