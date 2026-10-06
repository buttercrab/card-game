// The table's looks: card backs and table colours, picked in 설정 and
// some unlocked by achievements. Only looks: nothing changes the game.

export type CardBack = 'charcoal' | 'plum' | 'indigo' | 'gold' | 'ink' | 'jade';
export type TableTone = 'hanji' | 'celadon' | 'indigo' | 'blush';

export const BACK_NAMES: Record<CardBack, string> = {
  charcoal: '숯',
  plum: '자두',
  indigo: '쪽빛',
  gold: '금',
  ink: '먹',
  jade: '옥',
};
export const TABLE_NAMES: Record<TableTone, string> = {
  hanji: '한지',
  celadon: '청자',
  indigo: '쪽빛',
  blush: '분홍',
};
