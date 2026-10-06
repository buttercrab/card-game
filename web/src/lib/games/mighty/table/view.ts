// What the table shows about a hand, worked out from one state: the phase,
// the teams as far as this viewer can tell, the points, the contract's
// prospects and the tags. Pure, so it is tested on its own (view.test.ts);
// Table.svelte and its parts only draw it.

import { contractLabel, friendCallLabel, isPoint, mightyCard, sameCard } from '../cards';
import { ledgerLines } from '../ledger';
import type { Card, Contract, FriendCall, Lead, PhaseView, Played, Suit, View } from '../types';
import type { Team } from '../../../ui/Badge.svelte';

type Phase<K extends string> = Extract<PhaseView, Record<K, unknown>> extends Record<K, infer P> ? P : never;
export type Bidding = Phase<'Bidding'>;
export type Exchange = Phase<'Exchange'>;
export type Play = Phase<'Play'>;
export type Done = Phase<'Done'>;

/** A tag on the hand's progress, in the tone it is drawn in. */
export interface Tag {
  text: string;
  tone: 'accent' | 'danger' | 'gold' | 'plain';
}

/** The point cards as twenty ticks: 여당's from the left, 야당's from the right. */
export interface Tally {
  decl: number;
  def: number;
}

export interface HandView {
  bidding: Bidding | null;
  exchange: Exchange | null;
  play: Play | null;
  done: Done | null;
  contract: Contract | null;
  declarer: number | null;
  friend: number | null;
  call: FriendCall | null;
  twoJokers: boolean;
  /** The viewer can tell there is no friend. */
  noFriend: boolean;
  /** The friend, or that there is none, is known. */
  friendKnown: boolean;
  /** The viewer holds the called card: the 프렌드 only they know about. */
  secretFriend: boolean;
  /** The dealer's extra turn after everyone passed, from this count; else null. */
  lastChance: number | null;
  /** Point cards each seat has won. */
  points: (seat: number) => number;
  /** A seat's side as far as the viewer can tell; null while unknown. */
  team: (seat: number) => Team | null;
  /** Point cards the 여당 has, as everyone can count them. */
  teamPoints: number;
  /** Point cards the defence has, once the teams are known. */
  defensePoints: number | null;
  /** 'made': the 여당 has its points; 'lost': too few are left to make it. */
  contractState: 'made' | 'lost' | null;
  tally: Tally;
}

export function phaseOf(phase: PhaseView) {
  const p = typeof phase === 'object' ? phase : null;
  return {
    bidding: p && 'Bidding' in p ? p.Bidding : null,
    exchange: p && 'Exchange' in p ? p.Exchange : null,
    play: p && 'Play' in p ? p.Play : null,
    done: p && 'Done' in p ? p.Done : null,
  };
}

export function handView(view: View, me: number | null): HandView {
  const { bidding, exchange, play, done } = phaseOf(view.phase);
  const n = view.hand_sizes.length;
  const stage = exchange ?? play ?? done;
  const contract = stage?.contract ?? null;
  const declarer = stage?.declarer ?? null;
  const friend = play?.friend ?? done?.friend ?? null;
  const call = play?.call ?? done?.call ?? null;
  // The engine says when the viewer can tell there is no friend: called
  // alone, the 주공 took the first trick that named it or played the called
  // card, or (on the 주공's own screen) the called card is theirs.
  const noFriend = friend === null && (call === 'Alone' || (play?.no_friend ?? false) || done !== null);
  const friendKnown = friend !== null || noFriend;
  const secretFriend =
    me !== null &&
    me !== declarer &&
    friend === null &&
    !noFriend &&
    play !== null &&
    typeof call === 'object' &&
    call !== null &&
    'Card' in call &&
    view.hand.some((c) => sameCard(c, call.Card));
  const points = (seat: number) => view.points_taken[seat]?.filter(isPoint).length ?? 0;
  const team = (seat: number): Team | null => {
    if (declarer === null) return null;
    if (seat === declarer) return 'declarer';
    if (seat === friend) return 'friend';
    return friendKnown ? 'defense' : null;
  };
  const teamPoints = done
    ? done.team_points
    : declarer === null
      ? 0
      : points(declarer) + (friend !== null ? points(friend) : 0);
  const defensePoints = friendKnown
    ? view.points_taken.reduce((sum, _, s) => sum + (team(s) === 'defense' ? points(s) : 0), 0)
    : null;
  let contractState: HandView['contractState'] = null;
  if (play && contract) {
    if (teamPoints >= contract.count) contractState = 'made';
    else if (defensePoints !== null && 20 - defensePoints < contract.count) contractState = 'lost';
  }
  // Until the 프렌드 is known, its points count for 야당, as everyone sees them.
  const decl = Math.min(teamPoints, 20);
  const def = Math.min(
    20 - decl,
    defensePoints ?? view.points_taken.reduce((sum, _, s) => sum + (s !== declarer && s !== friend ? points(s) : 0), 0),
  );
  const min = view.rules.bidding.last_chance_min;
  const lastChance = !bidding || bidding.best || min == null ? null : view.bids.length === n ? min : null;
  return {
    bidding,
    exchange,
    play,
    done,
    contract,
    declarer,
    friend,
    call,
    twoJokers: view.rules.deck === 'TwoJokers',
    noFriend,
    friendKnown,
    secretFriend,
    lastChance,
    points,
    team,
    teamPoints,
    defensePoints,
    contractState,
    tally: { decl, def },
  };
}

/** The round being played (1-based), or the one resolving; 0 outside play. */
export function trickNumber(play: Play | null, resolving: number | null): number {
  if (resolving !== null) return resolving;
  return play ? play.trick_no + 1 : 0;
}

/** The hand's tags: the contract made or lost, a 런 in reach, the last round. */
export function tagsOf(hand: HandView, handSize: number, trickNo: number, resolving: boolean): Tag[] {
  const list: Tag[] = [];
  const play = hand.play;
  if (!play) return list;
  if (hand.contractState === 'made') list.push({ text: '공약 확정', tone: 'accent' });
  if (hand.contractState === 'lost') list.push({ text: '공약 불가', tone: 'danger' });
  if (hand.defensePoints === 0 && hand.teamPoints > 0 && play.tricks.length >= 5 && trickNo <= handSize) {
    list.push({ text: '런 찬스', tone: 'gold' });
  }
  if (trickNo === handSize && !resolving) list.push({ text: '마지막 라운드', tone: 'plain' });
  return list;
}

/** A seat's note beside it during the bidding: its bid, or 패스. */
export function bidNote(bidding: Bidding | null, seat: number): string | null {
  if (!bidding) return null;
  if (bidding.best && bidding.best[0] === seat) return contractLabel(bidding.best[1]);
  if (bidding.passed[seat]) return '패스';
  return null;
}

/** Whether `call` names the 마이티 under this trump. */
export function callsMighty(call: FriendCall, trump: Suit | null): boolean {
  return typeof call === 'object' && 'Card' in call && sameCard(call.Card, mightyCard(trump));
}

/** The friend as the top line names them: who, once known; else the call. */
export function callLabel(hand: HandView, seatName: (seat: number) => string): string | null {
  const { call, friend, contract } = hand;
  if (!call) return null;
  if (friend !== null) return seatName(friend);
  if (hand.noFriend && call !== 'Alone') return '없음';
  if (contract && callsMighty(call, contract.trump)) return '마이티';
  return friendCallLabel(call, seatName, hand.twoJokers);
}

/** Whose turn it is, in parts, so a long name gives way and the rest stays. */
export function waitingFor(
  hand: HandView,
  turn: number | null,
  seatName: (seat: number) => string,
): { pre: string; name: string; post: string } | null {
  if (turn === null) return null;
  const name = seatName(turn);
  if (hand.exchange) return { pre: '주공 ', name, post: ' · 키티 정리 중' };
  if (hand.lastChance !== null) return { pre: '모두 패스했어요 · 딜러 ', name, post: ` 한 번 더 (${hand.lastChance}부터)` };
  if (hand.bidding) return { pre: '', name, post: ' · 공약 고르는 중' };
  return { pre: '', name, post: ' 차례' };
}

/** Why cards on the table are hatched: they have no power here. */
export function trickNotes(onTable: Played[], trickNo: number, handSize: number, label: (card: Card) => string): string[] {
  const notes: string[] = [];
  for (const p of onTable) {
    if (p.powered) continue;
    const when = trickNo === 1 ? '첫 라운드라 ' : trickNo === handSize ? '마지막 라운드라 ' : '';
    notes.push(`${when}${label(p.card)} 효력 없음`);
  }
  return notes;
}

/**
 * How hard a card lands: the 마이티 and jokers ring; a trump cutting the
 * round thumps. With two jokers the other-colour one ranks below every
 * trump, so a joker rings only while it takes the round (`taker`).
 */
export function weight(
  p: Played,
  leader: boolean,
  lead: Lead | null,
  trump: Suit | null,
  taker: number | null,
  twoJokers: boolean,
): 'mighty' | 'joker' | 'cut' | null {
  if (!p.powered) return null;
  if ('Joker' in p.card) return !twoJokers || taker === p.seat ? 'joker' : null;
  if (sameCard(p.card, mightyCard(trump))) return 'mighty';
  const suit = p.card.Normal[0];
  if (leader || trump === null || suit !== trump || !lead) return null;
  const followsLead = 'Suit' in lead ? lead.Suit === trump : (['Spade', 'Club'].includes(trump) ? 'Black' : 'Red') === lead.Color;
  return followsLead ? null : 'cut';
}

/** The result as the server scored it: what one opponent pays, then each
 * doubling on its own line. */
export function resultOf(done: Done) {
  return {
    made: done.value.made,
    lines: ledgerLines(done.value),
    run: done.team_points === 20,
    margin: done.team_points - done.contract.count,
    /** The 여당 made the contract. */
    won: done.team_points >= done.contract.count,
  };
}

/** Whether `seat` is on the side that won the hand. */
export function wonHand(done: Done, seat: number): boolean {
  const declarerWon = done.team_points >= done.contract.count;
  return (seat === done.declarer || seat === done.friend) === declarerWon;
}

/** How a seat's figure feels: glad after winning (the round, or the hand),
 * down after losing points in it. */
export function moodOf(
  seat: number,
  done: Done | null,
  winner: number | null,
  resolving: Played[] | null,
): 'happy' | 'down' | null {
  if (done) return wonHand(done, seat) ? 'happy' : 'down';
  if (winner === null) return null;
  if (seat === winner) return 'happy';
  return resolving?.some((p) => p.seat === seat && isPoint(p.card)) ? 'down' : null;
}
