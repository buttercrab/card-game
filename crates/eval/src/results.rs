//! `results.json`: what a run measured, and everything needed to say what
//! was run where. The schema is [`SCHEMA`]; a change to it that a reader
//! would notice bumps the number. Fields are documented in
//! `research/evals/README.md`.

use crate::puzzle::Answer;
use crate::stats::{Estimate, ThinkTime};
use harness::provenance::Machine;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const SCHEMA: &str = "eval-results/1";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Results {
    pub schema: String,
    pub suite: SuiteInfo,
    /// The bot under test, as named.
    pub bot: String,
    pub baseline: Option<String>,
    /// Every bot in the run decides without a clock, so a rerun of the
    /// same commit gives the same numbers (not the same think times).
    pub reproducible: bool,
    pub run: RunInfo,
    pub machine: Machine,
    pub ladder: Option<LadderResult>,
    pub presets: Option<PartResult>,
    pub heldout: Option<PartResult>,
    pub matches: Option<Vec<TableResult>>,
    pub cost: Option<CostResult>,
    pub puzzles: Option<PuzzlesResult>,
    /// Every field bot the run met, by name, with its fingerprint: its
    /// choices on fixed probe positions, hashed ([`crate::fingerprint`]).
    /// Results written before fingerprints have none.
    #[serde(default)]
    pub fingerprints: BTreeMap<String, String>,
}

impl Results {
    /// The field bots both runs name but that chose differently on the
    /// probe positions: the same name, another bot. Numbers measured
    /// against them do not compare.
    pub fn differing_fields(&self, other: &Results) -> Vec<String> {
        self.fingerprints
            .iter()
            .filter(|(name, print)| other.fingerprints.get(*name).is_some_and(|theirs| theirs != *print))
            .map(|(name, _)| name.clone())
            .collect()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SuiteInfo {
    pub name: String,
    pub game: String,
    /// SHA-256 of the suite file.
    pub sha256: String,
    /// A quick run plays a few deals of everything: a smoke test only.
    pub quick: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RunInfo {
    /// The commit the runner was built from, if run inside a checkout.
    pub commit: Option<String>,
    /// Tracked files differed from the commit.
    pub dirty: bool,
    /// UTC, `YYYY-MM-DDTHH:MM:SSZ`.
    pub started: String,
    pub wall_seconds: f64,
    /// Worker threads playing deals at once (cost always uses one).
    pub threads: usize,
    /// The command line.
    pub command: Vec<String>,
}

/// One table: the measured seat's points per seat-hand.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TableResult {
    pub name: String,
    /// The rule set in a few words.
    pub rules: String,
    pub field: String,
    pub seed: u64,
    pub deals: u64,
    pub bot: Estimate,
    pub baseline: Option<Estimate>,
    /// Bot minus baseline, deal by deal.
    pub diff: Option<Estimate>,
    /// SHA-256 of every deal's payoffs, so two runs can be checked for
    /// identical play without storing them.
    pub digest: String,
}

/// Several tables and their equal-weight average ([`Estimate::average`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PartResult {
    pub tables: Vec<TableResult>,
    pub average: Summary,
    pub seconds: f64,
}

/// The ladder: one table per rung, and the rating.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LadderResult {
    pub rungs: Vec<TableResult>,
    /// The mean over rungs of points per seat-hand, each rung weighted
    /// equally (`mean-over-rungs`).
    pub rating: Summary,
    pub seconds: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Summary {
    pub bot: Estimate,
    pub baseline: Option<Estimate>,
    pub diff: Option<Estimate>,
}

impl Summary {
    /// The equal-weight average of `tables`.
    pub fn average(tables: &[TableResult]) -> Summary {
        let of = |pick: fn(&TableResult) -> Option<Estimate>| -> Option<Estimate> {
            let parts: Option<Vec<Estimate>> = tables.iter().map(pick).collect();
            parts.filter(|p| !p.is_empty()).map(|p| Estimate::average(&p))
        };
        Summary {
            bot: of(|t| Some(t.bot)).expect("at least one table"),
            baseline: of(|t| t.baseline),
            diff: of(|t| t.diff),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CostResult {
    pub rules: String,
    pub field: String,
    pub seed: u64,
    pub deals: u64,
    pub bot: Option<ThinkTime>,
    pub baseline: Option<ThinkTime>,
    pub seconds: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PuzzlesResult {
    /// Scored puzzles the bot passed, of all scored puzzles.
    pub passed: usize,
    pub scored: usize,
    pub baseline_passed: Option<usize>,
    pub puzzles: Vec<PuzzleResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PuzzleResult {
    pub id: String,
    pub title: String,
    pub scored: bool,
    pub bot: Answer,
    pub baseline: Option<Answer>,
}
