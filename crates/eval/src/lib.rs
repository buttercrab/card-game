//! Eval suites and their runner: the scoreboard every bot and model is
//! measured on.
//!
//! A suite ([`suite::Suite`], a JSON file under `research/evals/<name>/`)
//! fixes everything that decides a score. Its parts:
//!
//! - **ladder**: the bot under test in one seat against tables of fixed
//!   bots, points per seat-hand with 95% intervals, and a rating;
//! - **presets**: the same against one field in every preset;
//! - **held-out rule sets**: the same over rule sets training never sees;
//! - **matches**: any other list of tables, such as a past benchmark's;
//! - **cost**: think time per decision, one game at a time;
//! - **puzzles**: positions with a known right answer.
//!
//! Every table is played on fixed seeds with the measured seat moving
//! round the table, and, given a baseline bot, played again with the
//! baseline in that seat on the same deal, so the two meet the same cards
//! ([`play`]). [`run::run`] plays a suite and returns [`results::Results`],
//! the versioned JSON the runner writes beside a Markdown report
//! ([`report`]).
//!
//! The runner is generic over [`EvalGame`]: a game's bots by name, how a
//! deal is set up, and its rule sets. Mighty's is in [`mighty`].

pub mod machine;
pub mod mighty;
pub mod play;
pub mod puzzle;
pub mod report;
pub mod results;
pub mod run;
pub mod stats;
pub mod suite;

use engine::{Bot, JsonGame, Seat};

/// What a game adds to be evaluated, beyond [`JsonGame`] (its rule sets,
/// presets and serde).
pub trait EvalGame: JsonGame<Rules: Clone + Send + Sync, Options: Send + Sync> + Sized {
    /// A bot by name, as the command line and suites give it.
    type Spec: Clone + Send + Sync;

    fn parse_bot(name: &str) -> Result<Self::Spec, String>;

    /// The bot `spec` names, for `seat`.
    fn bot(spec: &Self::Spec, seat: Seat) -> Box<dyn Bot<Self>>;

    /// Whether `spec` decides the same way in every run (no clock in its
    /// decisions), so that a rerun gives identical results.
    fn reproducible(spec: &Self::Spec) -> bool;

    /// The options of deal number `deal` under `rules`: whatever turns
    /// round the table from deal to deal (such as who bids first) is set
    /// from `deal`.
    fn options(rules: &Self::Rules, deal: u64) -> Self::Options;

    fn seats(rules: &Self::Rules) -> usize;

    /// A rule set in a few words, for reports.
    fn describe(rules: &Self::Rules) -> String;
}

/// The rules of the preset `id`.
pub fn preset<G: EvalGame>(id: &str) -> Result<G::Rules, String> {
    G::presets()
        .into_iter()
        .find(|(name, _, _)| *name == id)
        .map(|(_, _, rules)| rules)
        .ok_or_else(|| format!("{} has no preset {id:?}", G::ID))
}
