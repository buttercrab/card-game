import type { CardBack, TableTone } from '../../looks';

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

