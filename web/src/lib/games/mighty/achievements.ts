// Achievements (업적), kept on this device like 내 기록. Some unlock a card
// back or a table colour, which are only looks: nothing changes the game.

import type { CardBack, TableTone } from '../../looks';
import { mightyCard } from './cards';
import type { HandRecord } from './stats';
import type { PhaseView } from './types';

export { BACK_NAMES, TABLE_NAMES, type CardBack, type TableTone } from '../../looks';

type Done = Extract<PhaseView, { Done: unknown }>['Done'];

export type Reward = { kind: 'back'; id: CardBack } | { kind: 'table'; id: TableTone };

export interface Achievement {
  id: string;
  title: string;
  /** How to earn it, as shown while it is still locked. */
  how: string;
  reward?: Reward;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-win', title: '첫 승리', how: '한 판 이기기', reward: { kind: 'back', id: 'plum' } },
  { id: 'declarer-win', title: '주공의 품격', how: '주공으로 이기기', reward: { kind: 'table', id: 'celadon' } },
  { id: 'friend-win', title: '든든한 프렌드', how: '프렌드로 이기기' },
  { id: 'defense', title: '철벽 야당', how: '야당으로 공약 막기', reward: { kind: 'back', id: 'indigo' } },
  { id: 'mighty-take', title: '마이티의 주인', how: '마이티로 라운드 가져오기' },
  { id: 'no-trump', title: '노기루다', how: '노기루다 공약 성공' },
  { id: 'big-contract', title: '큰 그림', how: '공약 17 이상을 주공으로 성공', reward: { kind: 'back', id: 'gold' } },
  { id: 'alone', title: '나 혼자 간다', how: '노프렌드로 이기기', reward: { kind: 'table', id: 'indigo' } },
  { id: 'streak3', title: '3연승', how: '세 판 연속 이기기', reward: { kind: 'table', id: 'blush' } },
  { id: 'run', title: '런', how: '여당으로 20점 모두 가져오기', reward: { kind: 'back', id: 'ink' } },
  { id: 'ten', title: '단골', how: '10판 하기' },
  { id: 'fifty', title: '마이티 중독', how: '50판 하기', reward: { kind: 'back', id: 'jade' } },
];

const KEY = 'mighty.achievements';

/** Unlocked achievements by id, with when. */
export function loadUnlocked(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

function save(all: Record<string, number>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage refused: the achievement shows now but is not kept.
  }
}

/** Whether a look can be chosen: the defaults always, others once earned. */
export function isUnlocked(reward: Reward, unlocked = loadUnlocked()): boolean {
  if ((reward.kind === 'back' && reward.id === 'charcoal') || (reward.kind === 'table' && reward.id === 'hanji')) {
    return true;
  }
  const by = ACHIEVEMENTS.find((a) => a.reward?.kind === reward.kind && a.reward.id === reward.id);
  return !!by && by.id in unlocked;
}

/**
 * Checks a finished hand for newly earned achievements, records them and
 * returns them. `history` already includes this hand.
 */
export function checkHand(done: Done, me: number, history: HandRecord[]): Achievement[] {
  const role = me === done.declarer ? 'declarer' : me === done.friend ? 'friend' : 'defense';
  const made = done.team_points >= done.contract.count;
  const won = role === 'defense' ? !made : made;
  const mighty = mightyCard(done.contract.trump);
  const earned = new Set<string>();
  if (won) earned.add('first-win');
  if (won && role === 'declarer') earned.add('declarer-win');
  if (won && role === 'friend') earned.add('friend-win');
  if (won && role === 'defense') earned.add('defense');
  if (made && role === 'declarer' && done.contract.count >= 17) earned.add('big-contract');
  if (made && role !== 'defense' && done.contract.trump === null) earned.add('no-trump');
  if (made && role === 'declarer' && done.call === 'Alone') earned.add('alone');
  if (made && role !== 'defense' && done.team_points === 20) earned.add('run');
  const tookWithMighty = done.tricks.some(
    (t) => t.winner === me && t.plays.some((p) => p.seat === me && 'Normal' in p.card && JSON.stringify(p.card) === JSON.stringify(mighty)),
  );
  if (tookWithMighty) earned.add('mighty-take');
  const last3 = history.slice(-3);
  if (last3.length === 3 && last3.every((h) => h.won)) earned.add('streak3');
  if (history.length >= 10) earned.add('ten');
  if (history.length >= 50) earned.add('fifty');

  const unlocked = loadUnlocked();
  const fresh = ACHIEVEMENTS.filter((a) => earned.has(a.id) && !(a.id in unlocked));
  for (const a of fresh) unlocked[a.id] = Date.now();
  if (fresh.length) save(unlocked);
  return fresh;
}
