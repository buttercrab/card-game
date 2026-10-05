// The client's copies of the engine's scoring (`hand_value` in
// crates/mighty/src/state.rs): the result's ledger and the rulebook's
// worked examples. scoring.test.ts checks both against the payoffs the
// engine wrote to crates/mighty/tests/payoffs.json. Phase 2 of
// docs/REFACTOR.md has the server send the breakdown and removes these.
import type { Contract, Doubling, FriendCall, Rules, Scoring } from './types';

/** What servers that send no scoring score by (Scoring::default). */
export const DEFAULT_SCORING: Scoring = {
  win: 'OverTen',
  no_trump: 'Win',
  alone: 'Win',
  run: true,
  back_run: { TeamAtMost: 10 },
  full_contract: 'Never',
  discards_to_declarer: true,
  lose: 'Shortfall',
};

export const scoring = (r: Rules): Scoring => r.scoring ?? DEFAULT_SCORING;

/** A bid's rank against the minimum: 노기루다 may count more than it says. */
export const bidValue = (r: Rules, c: Contract) => c.count + (c.trump === null ? r.bidding.no_trump_bonus : 0);

/** The bid bonus of a made contract: twice how far the bid ranks above the
 * minimum, and never a penalty for a bid under it (the dealer's last chance). */
export const bidBonus = (r: Rules, c: Contract) => 2 * Math.max(bidValue(r, c) - r.bidding.min, 0);

/** What one opponent pays the declarer's side (negative: receives). */
export function handValue(r: Rules, c: Contract, alone: boolean, points: number): number {
  return ledger(r, { team_points: points, contract: c, call: alone ? 'Alone' : 'FirstTrick' }).value;
}

/** A finished hand, as much of it as the count needs. */
export interface Counted {
  team_points: number;
  contract: Contract;
  call: FriendCall;
}

/** The count as the rules score it: what one opponent pays, then each
 * doubling on its own line. */
export function ledger(rules: Rules, d: Counted) {
  const s = scoring(rules);
  const min = rules.bidding.min;
  const p = d.team_points;
  const c = d.contract.count;
  const made = p >= c;
  const lines: string[] = [];
  let value: number;
  if (made) {
    const win = s.win;
    if (typeof win === 'object') {
      const k = win.BothOver;
      value = Math.max(p - k + c - k, 1);
      lines.push(`(여당 ${p} − ${k}) + (공약 ${c} − ${k}) = ${value}`);
    } else if (win === 'OverMin') {
      value = p - min;
      lines.push(`여당 ${p}점 − 최소 ${min} = ${value}`);
    } else if (win === 'OverBid') {
      value = p - c;
      lines.push(`여당 ${p}점 − 공약 ${c} = ${value}`);
    } else if (win === 'BidBonus') {
      const bonus = bidBonus(rules, d.contract);
      value = p - c + bonus;
      lines.push(`여당 ${p} − 공약 ${c} + 보너스 ${bonus} = ${value}`);
    } else {
      value = Math.max(p - 10, 1);
      lines.push(`여당 ${p}점 − 10 = ${value}`);
    }
  } else {
    const short = c - p;
    lines.push(short === 1 ? `아깝게 1점 모자람` : `공약 ${c}에서 ${short}점 모자람`);
    value = short;
    const lose = s.lose ?? 'Shortfall';
    if (lose !== 'Shortfall') {
      value = c - lose.PaysBack + short;
      lines.push(`공약 ${c} − ${lose.PaysBack} 갚고 + ${short} = ${value}`);
    }
    const back = s.back_run;
    const why =
      back === 'Never'
        ? null
        : back === 'DefenceReachesBid'
          ? 20 - p >= c && '야당이 공약만큼'
          : 'TeamAtMost' in back
            ? p <= back.TeamAtMost && `${back.TeamAtMost}점 이하`
            : short >= back.ShortBy && `${back.ShortBy}점 이상 모자람`;
    if (why) {
      value *= 2;
      lines.push(`${why} ×2 = ${value}`);
    }
    value = -value;
  }
  const applies = (x: Doubling | undefined) => x === 'Always' || (x === 'Win' && made);
  const doubles = [
    applies(s.no_trump) && d.contract.trump === null && '노기루다',
    applies(s.alone) && d.call === 'Alone' && '노프렌드',
    s.run && made && p === 20 && '런',
    applies(s.full_contract) && c === 20 && '공약 20',
  ].filter((x): x is string => !!x);
  for (const why of doubles) {
    value *= 2;
    lines.push(`${why} ×2 = ${made ? value : -value}`);
  }
  const margin = p - c;
  return { made, lines, value, run: p === 20, margin };
}
