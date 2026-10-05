// Mirrors the JSON the server sends: serde's default enum encoding of the
// Rust types in crates/mighty and crates/server.
import type { ServerError } from './generated/protocol';

export type BotLevel = 'easy' | 'normal' | 'hard';
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
  /** Declarer, before discarding, where `bidding.raise_on_exchange`: a
   * contract higher than keeping trump or ChangeTrump gives. */
  | { Raise: Contract }
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

/** When a doubling applies: never, only to a made contract, or made or not. */
export type Doubling = 'Never' | 'Win' | 'Always';
/** What a made contract is worth before doubling: points − 10 (at least 1),
 * points − the minimum bid, points − the contract, or points − the contract
 * + 2 × how far the bid ranks above the minimum. */
export type WinScore = 'OverTen' | 'OverMin' | 'OverBid' | 'BidBonus' | { BothOver: number };
/** What a failed contract costs before doubling: the shortfall, or
 * (contract − n) plus the shortfall. */
export type LoseScore = 'Shortfall' | { PaysBack: number };
/** Who opens the next hand's bidding: the next seat, or last hand's friend
 * (else its declarer). */
export type NextDealer = 'Rotate' | 'FriendOrDeclarer';
/** When a failed contract counts double (백런). */
export type BackRun = 'Never' | 'DefenceReachesBid' | { TeamAtMost: number } | { ShortBy: number };

export interface Scoring {
  win: WinScore;
  /** Older servers leave this out: the shortfall. */
  lose?: LoseScore;
  no_trump: Doubling;
  /** Playing openly alone (노프렌드). */
  alone: Doubling;
  /** Taking all 20 points doubles a win. */
  run: boolean;
  back_run: BackRun;
  /** When a contract of 20 doubles the score. Older servers leave this out. */
  full_contract?: Doubling;
  /** Point cards in the declarer's discards count for the declarer's side;
   * otherwise for the defence. */
  discards_to_declarer: boolean;
}

export interface Rules {
  players: number;
  hand_size: number;
  deck: 'OneJoker' | 'TwoJokers';
  /** The lowest rank dealt (2 unless 3마 or 4마). Older servers leave this out. */
  lowest_rank?: number;
  /** Cards below `lowest_rank` dealt anyway, such as ♣3 and ♠3 in 4마. */
  extra_cards?: Card[];
  /** Full rules carry these; the preview's made-up rules may not. */
  misdeal?: {
    point_value: number;
    joker_value: number;
    card_values: [Card, number][];
    threshold: number;
    /** A hand of only point cards qualifies too. */
    all_points?: boolean;
    /** A player who already bid may still ask on their turn. */
    after_bidding?: boolean;
    /** The declarer may ask after taking the kitty, before discarding. */
    declarer?: boolean;
    /** Anyone may call it until the first bid, and the first bid waits a
     * moment after the deal; no misdeal later. */
    ask_first?: boolean;
    /** Whoever calls the misdeal opens the new deal's bidding. */
    caller_deals?: boolean;
  };
  bidding: {
    min: number;
    max: number;
    allow_no_trump: boolean;
    no_trump_bonus: number;
    no_trump_wins_ties?: boolean;
    first_bidder_may_pass: boolean;
    change_trump_cost: number;
    /** How much the contract's number rises to change to no-trump; null
     * means like any change. */
    change_to_no_trump_cost?: number | null;
    /** false: a player who passed may bid again, and the bidding ends when
     * everyone else passes in a row. */
    pass_is_final?: boolean;
    /** After five passes the first bidder bids once more from this minimum. */
    last_chance_min?: number | null;
    /** The declarer may raise the contract after taking the kitty. */
    raise_on_exchange?: boolean;
  };
  friend?: { by_card: boolean; by_seat: boolean; first_trick: boolean; last_trick: boolean; fake: boolean; alone: boolean };
  policy?: {
    mighty: TrickPolicy;
    trump: TrickPolicy;
    joker: TrickPolicy;
    joker_call: TrickPolicy;
    overrides: [Card, TrickPolicy][];
    /** false: a held-back lead is released only when nothing but jokers
     * is left (nine trumps and the mighty lead the mighty). */
    release_with_mighty?: boolean;
  };
  joker_call: {
    calls: [Card, Card][];
    mighty_defense: boolean;
    called_joker_has_power: boolean;
  };
  /** `not_first_trick`: a joker may not lead the first trick. */
  joker_lead?: { by_color: boolean; powerless_passes: boolean; not_first_trick?: boolean };
  /** Older servers leave this out; their scoring is the default here. */
  scoring?: Scoring;
  /** false: the discards stay hidden after the hand (from all but the declarer). */
  reveal_discards?: boolean;
  next_dealer?: NextDealer;
}

export type PhaseView =
  | 'Dealing'
  | {
      Bidding: {
        to_act: number;
        best: [number, Contract] | null;
        passed: boolean[];
        has_bid: boolean[];
      };
    }
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
        /** The viewer knows the 주공 has no friend (older servers omit it). */
        no_friend?: boolean;
        trick_no: number;
        leader: number;
        lead: Lead | null;
        plays: Played[];
        /** Who is winning this trick so far; null before its first card. */
        leading: number | null;
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
  /** Why the cards were last dealt again, while the new deal is bid on. */
  redealt?: Redealt | null;
}

export type Redeal = { Misdeal: { seat: number; hand: Card[] } } | 'AllPassed';
export interface Redealt {
  why: Redeal;
  count: number;
}

export interface Bid {
  seat: number;
  contract: Contract | null;
}

export type SeatInfo =
  | { kind: 'empty' }
  | { kind: 'human'; name: string; connected: boolean; /** Its turn ran out and was played for it (자리 비움). */ away?: boolean }
  | { kind: 'bot'; name: string; level?: BotLevel };

export interface RoomMsg {
  type: 'room';
  id: string;
  game: string;
  /** `rules`: the table's own, when its players changed the preset's.
   * `preset_rules`: the preset's rules as pinned when the table chose it,
   * which may differ from the preset's today. */
  settings: { preset: string; rules?: Rules; preset_rules?: Rules };
  seats: SeatInfo[];
  scores: number[];
  hands_played: number;
  in_hand: boolean;
  /** Each finished hand's payoffs, in order. Older servers leave this out. */
  history?: number[][];
  /** Each finished hand in brief, in order. Older servers leave this out,
   * and rooms saved before it may hold fewer of these than `history`. */
  hands?: HandSummary[];
  /** The table's own settings, apart from the rules. */
  table?: TableSettings;
  /** The running turn timer: the time left as of this message. */
  clock?: { seat: number; ms: number; total_ms: number } | null;
  /** How many connections watch without a seat. */
  watching?: number;
  /** Whether a hand, running or just over, is on the table. */
  showing?: boolean;
}

export interface TableSettings {
  /** Seconds per decision; 0 is no limit. */
  turn_secs: number;
  /** The seats are shuffled before every hand. */
  shuffle: boolean;
  /** 섞기 was pressed: the seats are shuffled when the next hand starts.
   * Older servers leave this out. */
  shuffle_next?: boolean;
}

/** A finished hand in brief, for the session's share card. */
export interface HandSummary {
  contract: Contract;
  declarer: number;
  friend: number | null;
  made: boolean;
  team_points: number;
  /** Point cards each trick took, oldest first: positive for the declarer's
   * side (여당), negative for the defence (야당), 0 for none. */
  rounds: number[];
  /** The trick during which the friend became known. */
  friend_revealed: number | null;
}

export interface StateMsg {
  type: 'state';
  view: View;
  legal: Action[];
  turn: Turn;
  /** What this seat may do although it is not its turn: 'Misdeal' from
   * the moment the cards land, for a hand that qualifies. */
  out_of_turn?: Action[];
  /** How long, in ms, the slowest legal action must still wait after the
   * deal (the first bid where 딜미스 comes first). */
  grace_ms?: number;
  /** Which state of the hand this is; a hint carries the version it was
   * asked for, and one for an older state is dropped. */
  version?: number;
}

export type ServerMsg =
  | RoomMsg
  | StateMsg
  | { type: 'welcome'; seat: number; token: string }
  | { type: 'unseated' }
  | { type: 'seats_moved'; how: 'shuffle' | 'swap'; seats?: [number, number]; /** Shuffle: where each seat went. */ order?: number[] }
  | { type: 'reaction'; seat: number; text: string }
  | { type: 'hint'; version: number; action: Action }
  | ({ type: 'error' } & ServerError);
