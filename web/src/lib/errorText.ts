// The server refuses with a code (crates/server/src/protocol.rs); players
// read Korean. Both maps are keyed by the generated unions, so a new code
// on the server does not compile here until it has its words.
import type { ErrorCode, InvalidRules, ServerError } from './generated/protocol';

const ERROR_TEXT: Record<ErrorCode, string> = {
  not_seated: '자리에 앉은 사람만 할 수 있어요',
  already_seated: '이미 자리에 앉아 있어요',
  name_required: '이름을 적어 주세요',
  table_full: '자리가 다 찼어요',
  seat_taken: '이미 누가 앉은 자리예요',
  no_such_seat: '없는 자리예요',
  no_player_in_seat: '그 자리에는 사람이 없어요',
  no_bot_in_seat: '그 자리에는 봇이 없어요',
  nobody_to_move: '바꿀 사람이 없어요',
  leave_own_seat: '내 자리는 직접 일어나 주세요',
  seats_between_hands: '자리는 판과 판 사이에만 바꿀 수 있어요',
  rules_between_hands: '규칙은 판과 판 사이에만 바꿀 수 있어요',
  bots_stay_in_hand: '판이 끝날 때까지 봇을 뺄 수 없어요',
  hand_in_progress: '이미 판이 진행 중이에요',
  empty_seats: '빈 자리를 먼저 채워 주세요',
  no_hand: '지금은 진행 중인 판이 없어요',
  not_your_turn: '아직 내 차례가 아니에요',
  illegal_action: '지금은 그렇게 할 수 없어요',
  wait_after_deal: '딜미스할 사람이 있는지 잠깐 기다려요',
  no_such_turn_limit: '그 시간으로는 정할 수 없어요',
  invalid_rules: '그 규칙으로는 게임을 할 수 없어요',
  player_count_fixed: '테이블 인원은 바꿀 수 없어요',
  unknown_reaction: '보낼 수 없는 반응이에요',
  hints_busy: '지금은 힌트를 보는 사람이 많아요. 잠시 뒤에 다시 해 주세요',
  hints_too_often: '힌트는 잠시 뒤에 다시 볼 수 있어요',
  bad_message: '요청을 처리하지 못했어요. 새로고침해 주세요',
  rate_limited: '요청이 너무 잦아요. 잠시 뒤에 다시 해 주세요',
  too_many_tables: '지금은 열린 테이블이 너무 많아요. 잠시 뒤에 다시 해 주세요',
  unknown_preset: '그런 규칙은 없어요',
  empty_report: '어떤 문제인지 적어 주세요',
  too_many_reports: '신고가 너무 많이 들어왔어요. 잠시 뒤에 다시 해 주세요',
};

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
};

/** What to tell a player about a refusal. A code this build does not know
 * (a newer server) still gets words, never a crash. */
export function errorText(error: Partial<ServerError> | null | undefined): string {
  if (error?.code === 'invalid_rules' && error.rule && error.rule in RULE_TEXT) return RULE_TEXT[error.rule];
  return (error?.code && ERROR_TEXT[error.code]) || '요청을 처리하지 못했어요';
}

/** The refusal in an HTTP error response's body, if it has one. */
export async function responseError(res: Response): Promise<string> {
  try {
    return errorText((await res.json()) as ServerError);
  } catch {
    return errorText(null);
  }
}
