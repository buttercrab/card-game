import { expect, test } from 'vitest';
import fixture from '../../../crates/mighty/tests/presets.json';
import { tableRules } from './rulesets';
import type { Rules } from './types';

const presets = new Map(fixture as unknown as [string, Rules][]);
const gshs = presets.get('gshs')!;
const pinned: Rules = { ...gshs, bidding: { ...gshs.bidding, min: gshs.bidding.min - 1 } };

test("a table plays by its own rules, else its preset's as it pinned them", () => {
  const own: Rules = { ...gshs, hand_size: gshs.hand_size };
  expect(tableRules({ rules: own, preset_rules: pinned })).toBe(own);
  expect(tableRules({ preset_rules: pinned })).toBe(pinned);
  expect(tableRules({})).toBeNull();
});
