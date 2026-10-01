// Mirrors the JSON the server sends: serde's default enum encoding of the
// Rust types in crates/mighty and crates/server.

export type Suit = 'Spade' | 'Diamond' | 'Heart' | 'Club';
export type Color = 'Black' | 'Red';
export type Card = { Normal: [Suit, number] } | { Joker: Color };

export interface Contract {
  /** null is no-trump. */
  trump: Suit | null;
  count: number;
}

export type FriendCall = { Card: Card } | { Seat: number } | 'FirstTrick' | 'LastTrick' | 'Alone';

export type PlayAction = { card: Card; joker_suit: Suit | null; call_joker: boolean };

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
  lead: Suit;
  winner: number;
}

export type Turn = 'Chance' | 'Over' | { Seat: number };

export interface Rules {
  players: number;
  hand_size: number;
  deck: 'OneJoker' | 'TwoJokers';
  bidding: {
    min: number;
    max: number;
    allow_no_trump: boolean;
    no_trump_bonus: number;
    first_bidder_may_pass: boolean;
    change_trump_cost: number;
  };
  joker_call: {
    calls: [Card, Card][];
    mighty_defense: boolean;
    called_joker_has_power: boolean;
  };
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
        lead: Suit | null;
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
}

export type SeatInfo =
  | { kind: 'empty' }
  | { kind: 'human'; name: string; connected: boolean }
  | { kind: 'bot'; name: string };

export interface RoomMsg {
  type: 'room';
  id: string;
  game: string;
  settings: { preset: string };
  seats: SeatInfo[];
  scores: number[];
  hands_played: number;
  in_hand: boolean;
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
  | { type: 'error'; message: string };
