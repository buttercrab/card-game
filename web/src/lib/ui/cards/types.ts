/** Ordinary playing-card primitives; no game or generated protocol dependency. */
import type { Suit, StandardCard, CardEmphasis } from '../../cardTypes';
export type { Suit, StandardCard, CardSize, CardEmphasis, CardVisual } from '../../cardTypes';
const RANK: Record<number, string> = {11:'J',12:'Q',13:'K',14:'A'};
const SUIT_NAME: Record<Suit,string> = {Spade:'스페이드',Heart:'하트',Diamond:'다이아몬드',Club:'클로버'};
export function rankText(rank: number): string { return RANK[rank] ?? String(rank); }
export function cardName(card: StandardCard): string {
  return 'Joker' in card ? card.Joker === 'Black' ? '흑 조커' : '홍 조커' : `${SUIT_NAME[card.Normal[0]]} ${rankText(card.Normal[1])}`;
}
export function cardLabel(card: StandardCard | null, options: {
  emphasis?: CardEmphasis | null;
  labelOverride?: string;
  powerless?: boolean;
  kitty?: boolean;
  unplayable?: boolean;
} = {}): string {
  if (!card) return '비공개 카드';
  if (options.labelOverride !== undefined) return options.labelOverride;
  const parts = [cardName(card)];
  if (options.emphasis === 'special') parts.push('특수 카드');
  if (options.emphasis === 'call') parts.push('호출 카드');
  if (options.powerless) parts.push('효력 없음');
  if (options.kitty) parts.push('키티');
  if (options.unplayable) parts.push('낼 수 없음');
  return parts.join(', ');
}
