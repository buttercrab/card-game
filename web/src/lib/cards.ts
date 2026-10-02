import type { Card, Contract, FriendCall, PhaseView, Rules, Suit } from './types';

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

export type Seal = 'mighty' | 'joker' | 'call';

/** The jokers in a deck, in the order the rules list their joker calls. */
export function jokers(rules: Rules): Card[] {
  return rules.deck === 'TwoJokers' ? [{ Joker: 'Black' }, { Joker: 'Red' }] : [{ Joker: 'Black' }];
}

/** The mighty: ♠A, or ♦A when spades are trump. */
export function mightyCard(trump: Suit | null): Card {
  return { Normal: [trump === 'Spade' ? 'Diamond' : 'Spade', 14] };
}

/** The card that calls out a joker, moved off the trump suit when needed. */
export function jokerCallCard(rules: Rules, joker: Card, trump: Suit | null): Card | null {
  const index = jokers(rules).findIndex((j) => sameCard(j, joker));
  const pair = rules.joker_call.calls[index];
  if (!pair) return null;
  const [call, fallback] = pair;
  return trump !== null && 'Normal' in call && call.Normal[0] === trump ? fallback : call;
}

/** Which special role, if any, `card` plays under these rules and trump. */
export function sealOf(card: Card, rules: Rules, trump: Suit | null): Seal | null {
  if ('Joker' in card) return 'joker';
  if (sameCard(card, mightyCard(trump))) return 'mighty';
  const calls = jokers(rules).map((j) => jokerCallCard(rules, j, trump));
  return calls.some((c) => c && sameCard(c, card)) ? 'call' : null;
}
