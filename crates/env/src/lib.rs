//! A batched, deterministic reinforcement-learning environment over any
//! game with a model encoding ([`engine::Encode`]), and the self-play
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
//! The core is generic; what differs between games is the small
//! [`EnvGame`] trait. Mighty's is in [`mighty`].

mod env;
pub mod game;
mod hand;
pub mod mighty;
pub mod npz;
pub mod selfplay;

pub use env::{Batch, Config, Env};
pub use game::{EnvGame, RuleSampler, RuleSource, load_rule_sets, rules_id, rules_key};
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
