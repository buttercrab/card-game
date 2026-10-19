import type { StandardCard, CardVisual } from '../cardTypes';

/** Descriptors can supply an explicit standard face or simple rank/suit text. */
export interface StandardCardDescriptor {
  readonly face: 'up' | 'down';
  readonly rank?: string;
  readonly suit?: string;
  readonly visual?: CardVisual;
}

const SUITS = { '♠': 'Spade', '♥': 'Heart', '♦': 'Diamond', '♣': 'Club' } as const;
const RANKS: Readonly<Record<string, number>> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14,
};
const validRank = (rank: number) => Number.isInteger(rank) && rank >= 2 && rank <= 14;
const validSuit = (suit: string) => suit === 'Spade' || suit === 'Heart' || suit === 'Diamond' || suit === 'Club';

/** Never inspect hidden metadata or interpret an opaque renderer asset key. */
export function toStandardCard(descriptor: StandardCardDescriptor): StandardCard | null {
  if (descriptor.face !== 'up') return null;
  const visual = descriptor.visual;
  if (visual !== undefined) {
    if (visual === null || typeof visual !== 'object') return null;
    if (visual.kind === 'joker') {
      return visual.color === 'Red' || visual.color === 'Black' ? { Joker: visual.color } : null;
    }
    if (visual.kind === 'standard' && validRank(visual.rank) && validSuit(visual.suit)) {
      return { Normal: [visual.suit, visual.rank] };
    }
    return null;
  }
  const rankText = descriptor.rank;
  const suitText = descriptor.suit;
  if (rankText === undefined || suitText === undefined || !Object.hasOwn(RANKS, rankText) || !Object.hasOwn(SUITS, suitText)) return null;
  return { Normal: [SUITS[suitText as keyof typeof SUITS], RANKS[rankText]] };
}
