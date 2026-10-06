// The server's types, generated from its Rust definitions (see
// crates/server/src/codegen.rs), plus a few names for parts of them.
import type { Action } from './generated/protocol';

export type * from './generated/protocol';

/** A card played, with how a joker leads and whether it calls the joker. */
export type PlayAction = Extract<Action, { Play: unknown }>['Play'];
