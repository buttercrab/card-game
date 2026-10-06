//! A game as the platform names and lists it: its id, its name for
//! people, the rule sets it ships with, and serde for what crosses a wire
//! or a file. Every layer above a game (the server, the environment, the
//! evals) starts from [`GameInfo`]; what each needs beyond it is a small
//! capability trait of its own ([`crate::table`] for the server, the
//! research hooks in `sim`, model encodings in `engine-ml`).

use crate::Game;
use serde::Serialize;
use serde::de::DeserializeOwned;
use std::fmt::Debug;

/// A named rule set a game ships with.
#[derive(Debug, Clone, PartialEq)]
pub struct Preset<R> {
    /// Stable, for links, saved tables and the command line: `gshs`.
    pub id: &'static str,
    /// For people: `경기과고`.
    pub name: &'static str,
    pub rules: R,
}

/// What every layer above a [`Game`] needs to name it, list its rule sets
/// and move its values through JSON.
pub trait GameInfo:
    Game<
        Options: Serialize + DeserializeOwned + Send + Sync,
        State: Send + Sync,
        Action: Serialize + DeserializeOwned + Send + Sync + 'static,
        View: Serialize + DeserializeOwned + Send + Sync + 'static,
    > + Sized
    + 'static
{
    /// A rule set: what presets hold, players edit and data records. Part
    /// of the options of every hand.
    type Rules: Clone + PartialEq + Debug + Serialize + DeserializeOwned + Send + Sync + 'static;

    /// Why a rule set cannot be played, as players are told it.
    type RulesError: std::error::Error + Serialize + Send + Sync + 'static;

    /// Stable id, for URLs, saved tables and data: `mighty`.
    const ID: &'static str;
    /// For people: `마이티`.
    const NAME: &'static str;

    /// The presets, in the order players pick them.
    fn presets() -> Vec<Preset<Self::Rules>>;

    /// Why `rules` cannot be played, if they cannot.
    fn validate(rules: &Self::Rules) -> Result<(), Self::RulesError>;

    /// How many seats a table under `rules` has.
    fn seats(rules: &Self::Rules) -> usize;

    /// A rule set in a few words, for reports and logs.
    fn describe(rules: &Self::Rules) -> String;
}

/// The rules of `G`'s preset `id`.
pub fn preset<G: GameInfo>(id: &str) -> Option<G::Rules> {
    G::presets().into_iter().find(|p| p.id == id).map(|p| p.rules)
}
