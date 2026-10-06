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
//! The runner is generic over the research tools' hooks into a game
//! ([`Research`]): its bots by name, how a deal is set up, its rule sets,
//! and how old puzzle logs replay. Mighty's are in `sim`.

pub mod fingerprint;
pub mod play;
pub mod puzzle;
pub mod report;
pub mod results;
pub mod run;
pub mod suite;

pub use harness::{provenance, stats};

pub use sim::Research;
pub use sim::research::{Steps, as_recorded, unknown_log_version};

/// The rule set `rules` names, and a label for it: the preset's id, or a
/// description of rules given in full (checked to be playable).
pub fn rules<G: Research>(rules: &suite::RulesRef) -> Result<(String, G::Rules), String> {
    match rules {
        suite::RulesRef::Preset(id) => Ok((id.clone(), preset::<G>(id)?)),
        suite::RulesRef::Given(json) => {
            let rules: G::Rules = serde_json::from_value(json.clone()).map_err(|e| format!("rules: {e}"))?;
            G::validate(&rules).map_err(|e| e.to_string())?;
            Ok((G::describe(&rules), rules))
        }
    }
}

/// The rules of the preset `id`.
pub fn preset<G: Research>(id: &str) -> Result<G::Rules, String> {
    engine::info::preset::<G>(id).ok_or_else(|| format!("{} has no preset {id:?}", G::ID))
}
