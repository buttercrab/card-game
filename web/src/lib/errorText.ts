// The server refuses with a code (crates/server/src/protocol.rs); players
// read Korean. The map is keyed by the generated union, so a new code on
// the server does not compile here until it has its words. A game says
// more about the refusals only it makes (Mighty: which rule check failed)
// through a `refusal` of its own.
import type { ErrorCode, ServerError } from './generated/protocol';

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
  table_gone: '아무도 없어서 테이블이 닫혔어요',
};

/** A game's own words for a refusal, or null to use the room's. */
export type Refusal = (error: Partial<ServerError>) => string | null;

/** What to tell a player about a refusal. A code this build does not know
 * (a newer server) still gets words, never a crash. */
export function errorText(error: Partial<ServerError> | null | undefined, refusal?: Refusal): string {
  if (error && refusal) {
    const said = refusal(error);
    if (said) return said;
  }
  return (error?.code && ERROR_TEXT[error.code]) || '요청을 처리하지 못했어요';
}

/** The refusal in an HTTP error response's body, if it has one. */
export async function responseError(res: Response, refusal?: Refusal): Promise<string> {
  try {
    return errorText((await res.json()) as ServerError, refusal);
  } catch {
    return errorText(null);
  }
}
