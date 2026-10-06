// The words for what the server works out (crates/mighty/src/score.rs and
// explain.rs): a hand's score, line by line, and why a card can't be
// played. Only wording lives here; every number and every decision comes
// from the server.
import { leadLabel } from './cards';
import type { HandValue, Refusal, ScoreStep } from './types';

const DOUBLE: Record<Extract<ScoreStep, { Doubled: unknown }>['Doubled']['why'], string> = {
  NoTrump: '노기루다',
  Alone: '노프렌드',
  Run: '런',
  FullContract: '공약 20',
};

/** One step of the count, as the result shows it. */
function line(step: ScoreStep, made: boolean): string {
  if ('OverTen' in step) return `여당 ${step.OverTen.points}점 − 10 = ${step.OverTen.total}`;
  if ('OverMin' in step) return `여당 ${step.OverMin.points}점 − 최소 ${step.OverMin.min} = ${step.OverMin.total}`;
  if ('OverBid' in step) return `여당 ${step.OverBid.points}점 − 공약 ${step.OverBid.contract} = ${step.OverBid.total}`;
  if ('BidBonus' in step) {
    const s = step.BidBonus;
    return `여당 ${s.points} − 공약 ${s.contract} + 보너스 ${s.bonus} = ${s.total}`;
  }
  if ('BothOver' in step) {
    const s = step.BothOver;
    return `(여당 ${s.points} − ${s.n}) + (공약 ${s.contract} − ${s.n}) = ${s.total}`;
  }
  if ('Short' in step) {
    const s = step.Short;
    return s.short === 1 ? '아깝게 1점 모자람' : `공약 ${s.contract}에서 ${s.short}점 모자람`;
  }
  if ('PaysBack' in step) {
    const s = step.PaysBack;
    return `공약 ${s.contract} − ${s.n} 갚고 + ${s.short} = ${s.total}`;
  }
  if ('BackRun' in step) {
    const { rule, total } = step.BackRun;
    const why =
      rule === 'DefenceReachesBid'
        ? '야당이 공약만큼'
        : rule === 'Never'
          ? '백런'
          : 'TeamAtMost' in rule
            ? `${rule.TeamAtMost}점 이하`
            : `${rule.ShortBy}점 이상 모자람`;
    return `${why} ×2 = ${total}`;
  }
  const { why, total } = step.Doubled;
  // A failed hand's doublings show what it owes, as a loss.
  return `${DOUBLE[why]} ×2 = ${made ? total : -total}`;
}

/** The count as the server scored it: what one opponent pays, then each
 * doubling on its own line. */
export function ledgerLines(value: HandValue): string[] {
  return value.steps.map((step) => line(step, value.made));
}

/** Why a card can't be played, in a few words. */
export function refusalText(why: Refusal): string {
  if (why === 'CalledJoker') return '조커콜 · 조커를 내야 해요';
  if (why === 'JokerFirstLead') return '첫 라운드엔 조커로 선을 낼 수 없어요';
  if ('MustFollow' in why) {
    const lead = why.MustFollow;
    return 'Suit' in lead ? `${leadLabel(lead)}를 따라 내야 해요` : `${leadLabel(lead)} 카드를 내야 해요`;
  }
  const { card, trick, leading } = why.HeldBack;
  const when = trick === 'First' ? '첫 라운드엔' : '마지막 라운드엔';
  const what = { Mighty: '마이티', Joker: '조커', Trump: '기루다', Card: '이 카드' }[card];
  return leading ? `${when} ${what}로 선을 낼 수 없어요` : `${when} ${what}를 낼 수 없어요`;
}
