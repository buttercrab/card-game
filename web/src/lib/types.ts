// Mirrors the JSON the server sends: serde's default enum encoding of the
// Rust types in crates/mighty and crates/server.

export type BotLevel = 'easy' | 'normal' | 'hard';
export type BotPace = 'fast' | 'normal' | 'slow';
export type Suit = 'Spade' | 'Diamond' | 'Heart' | 'Club';
export type Color = 'Black' | 'Red';
export type Card = { Normal: [Suit, number] } | { Joker: Color };

export interface Contract {
  /** null is no-trump. */
  trump: Suit | null;
  count: number;
}

export type FriendCall = { Card: Card } | { Seat: number } | 'FirstTrick' | 'LastTrick' | 'Alone';

/** What a trick follows: a suit, or a colour when a joker leads by colour. */
export type Lead = { Suit: Suit } | { Color: Color };

export type PlayAction = { card: Card; joker_lead: Lead | null; call_joker: boolean };

export type Action =
  | 'Misdeal'
  | 'Pass'
  | { Bid: Contract }
  | { ChangeTrump: Suit | null }
  | { Discard: Card }
  | { CallFriend: FriendCall }
  | { Play: PlayAction };

export interface Played {
  seat: number;
  card: Card;
  powered: boolean;
}

export interface Trick {
  plays: Played[];
  lead: Lead;
  winner: number;
}

export type Turn = 'Chance' | 'Over' | { Seat: number };

export type CardPolicy = 'Valid' | 'NoEffect' | 'Invalid' | 'NoLead';
export interface TrickPolicy {
  first: CardPolicy;
  last: CardPolicy;
}

export interface Rules {
  players: number;
  hand_size: number;
  deck: 'OneJoker' | 'TwoJokers';
  /** Full rules carry these; the preview's made-up rules may not. */
  misdeal?: { point_value: number; joker_value: number; card_values: [Card, number][]; threshold: number };
  bidding: {
    min: number;
    max: number;
    allow_no_trump: boolean;
    no_trump_bonus: number;
    no_trump_wins_ties?: boolean;
    first_bidder_may_pass: boolean;
    change_trump_cost: number;
  };
  friend?: { by_card: boolean; by_seat: boolean; first_trick: boolean; last_trick: boolean; fake: boolean; alone: boolean };
  policy?: {
    mighty: TrickPolicy;
    trump: TrickPolicy;
    joker: TrickPolicy;
    joker_call: TrickPolicy;
    overrides: [Card, TrickPolicy][];
  };
  joker_call: {
    calls: [Card, Card][];
    mighty_defense: boolean;
    called_joker_has_power: boolean;
  };
  joker_lead?: { by_color: boolean; powerless_passes: boolean };
}

export type PhaseView =
  | 'Dealing'
  | { Bidding: { to_act: number; best: [number, Contract] | null; passed: boolean[]; has_bid: boolean[] } }
  | {
      Exchange: {
        declarer: number;
        contract: Contract;
        trump_changed: boolean;
        discards: Card[] | null;
      };
    }
  | {
      Play: {
        declarer: number;
        contract: Contract;
        call: FriendCall;
        friend: number | null;
        trick_no: number;
        leader: number;
        lead: Lead | null;
        plays: Played[];
        called_joker: Card | null;
        /** Completed tricks, oldest first. */
        tricks: Trick[];
        discards: Card[] | null;
      };
    }
  | {
      Done: {
        declarer: number;
        contract: Contract;
        call: FriendCall;
        friend: number | null;
        team_points: number;
        payoffs: number[];
        tricks: Trick[];
        /** Older servers leave this out. */
        discards?: Card[];
      };
    };

export interface View {
  viewer: { Seat: number } | 'Spectator';
  rules: Rules;
  first_bidder: number;
  hand: Card[];
  hand_sizes: number[];
  points_taken: Card[][];
  phase: PhaseView;
  /** Every bid and pass of this deal so far, in order; null is a pass. Older servers leave this out. */
  bids?: Bid[];
}

export interface Bid {
  seat: number;
  contract: Contract | null;
}

export type SeatInfo =
  | { kind: 'empty' }
  | { kind: 'human'; name: string; connected: boolean }
  | { kind: 'bot'; name: string; level?: BotLevel };

export interface RoomMsg {
  type: 'room';
  id: string;
  game: string;
  settings: { preset: string; rules?: Rules };
  seats: SeatInfo[];
  scores: number[];
  hands_played: number;
  in_hand: boolean;
  bot_pace?: BotPace;
}

export interface StateMsg {
  type: 'state';
  view: View;
  legal: Action[];
  turn: Turn;
}

export type ServerMsg =
  | RoomMsg
  | StateMsg
  | { type: 'welcome'; seat: number; token: string }
  | { type: 'reaction'; seat: number; text: string }
  | { type: 'hint'; version: number; action: Action }
  | { type: 'error'; message: string };
