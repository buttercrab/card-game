import type { Card, Contract, FriendCall, PhaseView, Suit } from './types';

export const SUITS: Suit[] = ['Spade', 'Diamond', 'Heart', 'Club'];

export const SUIT_SYMBOL: Record<Suit, string> = {
  Spade: '♠',
  Diamond: '♦',
  Heart: '♥',
  Club: '♣',
};

const RANK: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export function rankLabel(rank: number): string {
  return RANK[rank] ?? String(rank);
}

export function isRed(card: Card): boolean {
  if ('Joker' in card) return card.Joker === 'Red';
  return card.Normal[0] === 'Diamond' || card.Normal[0] === 'Heart';
}

export function cardLabel(card: Card): string {
  if ('Joker' in card) return card.Joker === 'Red' ? 'Red joker' : 'Black joker';
  const [suit, rank] = card.Normal;
  return `${SUIT_SYMBOL[suit]}${rankLabel(rank)}`;
}

export function sameCard(a: Card, b: Card): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function trumpLabel(trump: Suit | null): string {
  return trump ? SUIT_SYMBOL[trump] : 'No trump';
}

export function contractLabel(c: Contract): string {
  return `${trumpLabel(c.trump)} ${c.count}`;
}

export function friendCallLabel(call: FriendCall, name: (seat: number) => string): string {
  if (call === 'FirstTrick') return 'First trick winner';
  if (call === 'LastTrick') return 'Last trick winner';
  if (call === 'Alone') return 'Playing alone';
  if ('Seat' in call) return name(call.Seat);
  return `Holder of ${cardLabel(call.Card)}`;
}

export function phaseName(phase: PhaseView): string {
  return typeof phase === 'string' ? phase : Object.keys(phase)[0];
}

/** Point cards (10 to A) count toward the contract. */
export function isPoint(card: Card): boolean {
  return 'Normal' in card && card.Normal[1] >= 10;
}
