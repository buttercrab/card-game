// The server's types, generated from its Rust definitions (see
// crates/server/src/codegen.rs), plus a few names for parts of them.
import type { Action, RoomMsg, SessionMsg } from '../../generated/protocol';

export type * from '../../generated/protocol';

/** A card played, with how a joker leads and whether it calls the joker. */
export type PlayAction = Extract<Action, { Play: unknown }>['Play'];

/** The table as the client keeps it: the latest room message with the
 * session (scores and finished hands) that goes with it. The server sends
 * the session only when it changes. */
export type RoomView = RoomMsg & SessionMsg;
