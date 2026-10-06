//! What can go wrong in an experiment.

use mighty::Action;

/// Why an experiment could not run on a hand.
#[derive(Debug, thiserror::Error)]
pub enum LabError {
    /// A recorded hand does not replay under these rules: a record made
    /// with other rules, or another version of the game.
    #[error("deal {deal}: the recorded {action:?} at step {step} does not replay: {why}")]
    Replay {
        deal: u64,
        step: usize,
        action: Action,
        why: String,
    },
    /// An action an experiment chose was refused.
    #[error("deal {deal}: {action:?} was refused: {why}")]
    Refused { deal: u64, action: Action, why: String },
    /// The hand did not end where it should have, or a record lacks a part
    /// the experiment needs.
    #[error("deal {deal}: {what}")]
    Hand { deal: u64, what: String },
    #[error("{0}")]
    Rules(String),
    /// A bot or variant by a name that does not parse.
    #[error("{0}")]
    Spec(String),
}

pub type Result<T> = std::result::Result<T, LabError>;
