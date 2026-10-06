// The server's types, generated from its Rust definitions (see
// crates/server/src/codegen.rs), plus a few names for parts of them, and
// Mighty's types as the room carries them (room/types.ts).
import type { Action, HandSummary, MightyNotes, MightySettings, Rules, View } from '../../generated/protocol';
import type { RoomViewOf, StateMsgOf } from '../../room/types';

export type * from '../../generated/protocol';

/** Mighty's own types, for the room's generic parts (RoomClient<Mighty>). */
export interface Mighty {
  settings: MightySettings;
  rules: Rules;
  view: View;
  action: Action;
  notes: MightyNotes;
  hand: HandSummary;
}

/** A card played, with how a joker leads and whether it calls the joker. */
export type PlayAction = Extract<Action, { Play: unknown }>['Play'];

/** The table as the client keeps it: the latest room message with the
 * session (scores and finished hands) that goes with it. The server sends
 * the session only when it changes. */
export type RoomView = RoomViewOf<Mighty>;

/** The hand as this seat (or a watcher) sees it, and what it may do. */
export type StateMsg = StateMsgOf<Mighty>;
