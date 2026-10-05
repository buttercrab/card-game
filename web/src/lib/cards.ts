import type { Action, Card, Contract, FriendCall, Lead, PhaseView, Rules, Suit } from './types';

export const SUITS: Suit[] = ['Spade', 'Diamond', 'Heart', 'Club'];

export const SUIT_SYMBOL: Record<Suit, string> = {
  Spade: '♠',
  Diamond: '♦',
  Heart: '♥',
  Club: '♣',
};

const GLYPH: Record<string, Suit> = { '♠': 'Spade', '♦': 'Diamond', '♥': 'Heart', '♣': 'Club' };

/** A label in runs of words and suits: the labels here write a suit as its
 * glyph (♠A, ♥ 15), and the page draws each one (SuitText.svelte). */
export function suitRuns(text: string): ({ text: string } | { suit: Suit })[] {
  const out: ({ text: string } | { suit: Suit })[] = [];
  for (const part of text.split(/([♠♦♥♣])/u)) {
    if (!part) continue;
    const suit = GLYPH[part];
    out.push(suit ? { suit } : { text: part });
  }
  return out;
}

const RANK: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };

export function rankLabel(rank: number): string {
  return RANK[rank] ?? String(rank);
}

/** Short form for running text: ♠A, ♥10, 흑조커. */
export function cardLabel(card: Card): string {
  if ('Joker' in card) return card.Joker === 'Red' ? '홍조커' : '흑조커';
  const [suit, rank] = card.Normal;
  return `${SUIT_SYMBOL[suit]}${rankLabel(rank)}`;
}

export function sameCard(a: Card, b: Card): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function trumpLabel(trump: Suit | null): string {
  return trump ? SUIT_SYMBOL[trump] : '노기루다';
}

export function contractLabel(c: Contract): string {
  return `${trumpLabel(c.trump)} ${c.count}`;
}

export function friendCallLabel(call: FriendCall, name: (seat: number) => string, twoJokers = true): string {
  if (call === 'FirstTrick') return '첫 라운드';
  if (call === 'LastTrick') return '마지막 라운드';
  if (call === 'Alone') return '노프렌드';
  if ('Seat' in call) return name(call.Seat);
  if (!twoJokers && 'Joker' in call.Card) return '조커';
  return cardLabel(call.Card);
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

/** Cards in the deck: four suits from the lowest rank to A, the jokers,
 * and any cards kept below the lowest rank (4마 keeps ♣3 and ♠3). */
export function deckSize(rules: Rules): number {
  return 4 * (15 - rules.lowest_rank) + jokers(rules).length + rules.extra_cards.length;
}

/** Cards left face down after the deal. */
export function kittyCount(rules: Rules): number {
  return deckSize(rules) - rules.players * rules.hand_size;
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

/** ♦, or 빨강 / 검정 for a colour lead. */
export function leadLabel(lead: Lead): string {
  if ('Suit' in lead) return SUIT_SYMBOL[lead.Suit];
  return lead.Color === 'Red' ? '빨강' : '검정';
}

/** Any action in words, for hints: ♠A, ♥ 15, 패스. */
export function actionLabel(action: Action, name: (seat: number) => string): string {
  if (action === 'Misdeal') return '딜미스';
  if (action === 'Pass') return '패스';
  if ('Bid' in action) return contractLabel(action.Bid);
  if ('ChangeTrump' in action) return `기루다를 ${trumpLabel(action.ChangeTrump)}로 바꾸기`;
  if ('Raise' in action) return `공약을 ${contractLabel(action.Raise)}로 올리기`;
  if ('Discard' in action) return `${cardLabel(action.Discard)} 버리기`;
  if ('CallFriend' in action) return `프렌드 ${friendCallLabel(action.CallFriend, name)}`;
  if ('Deal' in action) return '';
  const p = action.Play;
  let label = cardLabel(p.card);
  if (p.joker_lead) label += ` · ${leadLabel(p.joker_lead)}`;
  if (p.call_joker) label += ' · 조커콜';
  return label;
}
