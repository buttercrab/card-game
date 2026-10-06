//! A batched, deterministic reinforcement-learning environment over any
//! game with a model encoding ([`engine_ml::Encode`]), and the self-play
//! data generator built on it.
//!
//! - [`Env`] steps many hands at once for a caller that plays some seats
//!   (all of them for self-play, one against bots, ...), with built-in
//!   bots in the others. Observations, legal masks, rewards and done
//!   flags come back as one contiguous array per field.
//! - Rules are a parameter of the environment ([`RuleSource`]): one rule
//!   set, a pool, or fresh varied draws, never one of an excluded list
//!   (the evals' held-out rule sets).
//! - [`selfplay`] plays bots against each other and writes every decision
//!   to shards for training, with a manifest.
//!
//! Everything is reproducible: a hand is a function of its seed and the
//! caller's actions ([`Hand`]), and each slot of a batch draws its hands'
//! seeds from its own stream, whatever the batch size or thread count.
//!
//! Hands are played turn by turn, for training: a seat is offered its
//! legal actions ([`engine::Game::legal_actions`]) only on its own turn
//! ([`engine::Game::turn`]), and the optional actions other seats have
//! meanwhile (such as a 딜미스 called the moment the cards land) are left
//! aside. A seat that may throw the deal in finds the misdeal among its
//! legal actions on its own turn, as long as the rules still allow it
//! then; with `misdeal.window` at `BeforeFirstBid` that is only the seats
//! that speak before the first bid. The simulator and the evals play the
//! same way.
//!
//! The core is generic; what differs between games is what [`EnvGame`]
//! asks: the game's research hooks (`sim::Research`) and its model
//! encoding (`engine_ml::Encode`).

mod env;
pub mod game;
mod hand;
pub mod npz;
pub mod selfplay;

pub use env::{Batch, Config, Env};
pub use game::{EnvGame, Research, RuleSampler, RuleSource, draw_options, load_rule_sets, rules_id, rules_key};
pub use hand::{BotPool, Decision, Hand, Setup, Status};

/// Why the environment could not do what was asked.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("rules: {0}")]
    Rules(String),
    #[error("bots: {0}")]
    Bot(String),
    #[error("{0}")]
    Config(String),
    #[error("the game refused a move: {0}")]
    Game(String),
    #[error("environment {slot}: action {index} is not legal")]
    IllegalAction { slot: usize, index: usize },
    #[error("step before reset")]
    NotReset,
    #[error("{0}")]
    Io(String),
}
