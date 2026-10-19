import { expect, test } from 'vitest';
import { cardLabel, cardName, rankText } from './types';

test('shared playing-card names preserve ordinary suit/rank and joker names', () => {
  expect(rankText(14)).toBe('A');
  expect(rankText(10)).toBe('10');
  expect(cardName({Normal:['Heart',13]})).toBe('하트 K');
  expect(cardName({Joker:'Black'})).toBe('흑 조커');
  expect(cardName({Joker:'Red'})).toBe('홍 조커');
});
test('face-down labels discard all supplied emphasis and label metadata', () => {
  expect(cardLabel(null,{emphasis:'special',labelOverride:'비밀 에이스',kitty:true,unplayable:true})).toBe('비공개 카드');
});
test('shared emphasis labels stay generic and games can supply their existing labels', () => {
  const card = {Normal:['Spade',14]} as const;
  expect(cardLabel({Normal:[...card.Normal]},{emphasis:'special',powerless:true})).toBe('스페이드 A, 특수 카드, 효력 없음');
  expect(cardLabel({Normal:[...card.Normal]},{labelOverride:'스페이드 A, 마이티'})).toBe('스페이드 A, 마이티');
  expect(cardLabel({Normal:['Club',3]},{emphasis:'call',kitty:true,unplayable:true})).toBe('클로버 3, 호출 카드, 키티, 낼 수 없음');
});
