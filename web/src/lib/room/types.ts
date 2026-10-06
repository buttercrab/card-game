// The room's messages for any game. The server's generated types are
// written for the game it plays today; here each game's own parts (its
// settings, rules, view, actions, notes and finished hands) become type
// parameters, so the room, its connection and its seats never name a game.
import type { ClientMsg, RoomMsg, ServerMsg, SessionMsg, StateMsg } from '../generated/protocol';

export type {
  BotLevel,
  ClockInfo,
  ErrorCode,
  SeatInfo,
  SeatsMoved,
  ServerError,
  TableSettings,
  Turn,
} from '../generated/protocol';

/** A game's own types, as the room carries them without looking inside. */
export interface GameTypes {
  /** What the table's players choose before a hand (a preset, its rules). */
  settings: unknown;
  /** The rules the table plays by. */
  rules: unknown;
  /** The hand as one seat (or a watcher) sees it. */
  view: unknown;
  /** One thing a seat may do. */
  action: unknown;
  /** What the table needs told on the seat's turn. */
  notes: unknown;
  /** A finished hand, in brief. */
  hand: unknown;
}

/** The table: who sits where, the timer and the game's settings. */
export type RoomMsgOf<G extends GameTypes> = Omit<RoomMsg, 'settings' | 'rules'> & {
  settings: G['settings'];
  rules: G['rules'];
};

/** The session so far: the scores and every finished hand. */
export type SessionMsgOf<G extends GameTypes> = Omit<SessionMsg, 'hands'> & { hands: G['hand'][] };

/** The hand as this seat (or a watcher) sees it, and what it may do. */
export type StateMsgOf<G extends GameTypes> = Omit<StateMsg, 'view' | 'legal' | 'out_of_turn' | 'notes'> & {
  view: G['view'];
  legal: G['action'][];
  out_of_turn: G['action'][];
  notes: G['notes'];
};

/** The table as the client keeps it: the latest room message with the
 * session (scores and finished hands) that goes with it. The server sends
 * the session only when it changes. */
export type RoomViewOf<G extends GameTypes> = RoomMsgOf<G> & SessionMsgOf<G>;

/** Everything the server sends on a table's connection. */
export type ServerMsgOf<G extends GameTypes> =
  | Exclude<ServerMsg, { type: 'room' | 'session' | 'state' | 'hint' }>
  | ({ type: 'room' } & RoomMsgOf<G>)
  | ({ type: 'session' } & SessionMsgOf<G>)
  | ({ type: 'state' } & StateMsgOf<G>)
  | { type: 'hint'; version: number; action: G['action'] };

/** Everything a client may send on a table's connection. */
export type ClientMsgOf<G extends GameTypes> =
  | Exclude<ClientMsg, { type: 'set_settings' | 'act' }>
  | { type: 'set_settings'; settings: G['settings'] }
  | { type: 'act'; action: G['action'] };
