// Mighty's own refusals: why the rules a table chose cannot be played, as
// Rules::validate finds it (crates/mighty). Keyed by the generated union,
// so a new check does not compile here until it has its words.
import type { InvalidRules, ServerError } from './types';

/** Why rules cannot be played, as Rules::validate finds it. */
export const RULE_TEXT: Record<InvalidRules, string> = {
  point_cards_missing: '점수 카드(10~A)는 모두 덱에 있어야 해요',
  bad_extra_cards: '더 넣는 카드는 가장 낮은 숫자보다 낮은 서로 다른 카드여야 해요',
  table_size: '인원이나 패 장수가 맞지 않아요',
  too_few_cards: '나눠 줄 카드가 모자라요',
  joker_call_not_in_deck: '조커콜 카드가 덱에 없어요',
  empty_bid_range: '최소 공약이 최대 공약보다 클 수 없어요',
  no_trump_bonus_too_high: '노기루다 보너스는 최소 공약보다 작아야 해요',
  joker_call_per_joker: '조커마다 조커콜 카드가 하나씩 있어야 해요',
  pays_back_too_much: '갚는 기준이 가장 낮은 공약보다 크면 지고도 점수를 받게 돼요',
  no_friend_rule: '프렌드를 정하는 방법을 하나는 켜 주세요 (가짜 프렌드만으로는 안 돼요)',
  fake_without_card: '가짜 프렌드는 카드로 프렌드를 부를 때만 쓸 수 있어요',
  always_misdeal: '딜미스 기준이 너무 높아 어떤 패든 딜미스가 돼요',
};

/** Mighty's words for a refusal, or null for the room's. */
export function ruleRefusal(error: Partial<ServerError>): string | null {
  return error.code === 'invalid_rules' && error.rule && error.rule in RULE_TEXT ? RULE_TEXT[error.rule] : null;
}
