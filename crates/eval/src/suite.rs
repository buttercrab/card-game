//! Suite definitions: what a suite plays, read from
//! `research/evals/<name>/suite.json`. A published suite never changes;
//! a change makes a new version. The fields are documented in
//! `research/evals/README.md`.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Suite {
    /// The suite's name and version, as runs cite it: `v1`.
    pub suite: String,
    /// The game, by [`engine::JsonGame::ID`].
    pub game: String,
    /// What the suite is for, in a sentence or two.
    pub about: String,
    #[serde(default)]
    pub ladder: Option<Ladder>,
    #[serde(default)]
    pub presets: Option<Presets>,
    #[serde(default)]
    pub heldout: Option<Heldout>,
    #[serde(default)]
    pub matches: Option<Vec<Match>>,
    #[serde(default)]
    pub cost: Option<Cost>,
    #[serde(default)]
    pub puzzles: Option<Puzzles>,
}

/// How many deals a table plays: the full count, or the quick one in a
/// quick run (a smoke test, too small to measure anything).
pub fn deals(full: u64, quick_deals: u64, quick: bool) -> u64 {
    if quick { quick_deals.min(full) } else { full }
}

/// The bot under test against a field of each rung in turn, under one
/// preset. Rung `k` plays seeds `seed + k·deals + d`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ladder {
    pub rules: String,
    pub seed: u64,
    pub deals: u64,
    /// Deals in a quick run.
    pub quick_deals: u64,
    pub rungs: Vec<Rung>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Rung {
    pub name: String,
    pub field: String,
}

/// The bot under test against one field in each preset. Preset `k`
/// plays seeds `seed + k·deals + d`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Presets {
    pub field: String,
    pub seed: u64,
    pub deals: u64,
    /// Deals in a quick run.
    pub quick_deals: u64,
    pub presets: Vec<String>,
}

/// The bot under test against one field in each held-out rule set, a JSON
/// array of the game's rule sets beside the suite file. Set `k` plays
/// seeds `seed + k·deals + d`; a quick run plays only the first
/// `quick_sets`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Heldout {
    pub field: String,
    pub file: String,
    /// SHA-256 of `file`, so a changed file cannot pass for the suite's.
    pub sha256: String,
    pub seed: u64,
    pub deals: u64,
    /// Deals in a quick run.
    pub quick_deals: u64,
    pub quick_sets: usize,
}

/// One table given in full, for suites that redo a past measurement.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Match {
    pub name: String,
    pub rules: RulesRef,
    pub field: String,
    pub seed: u64,
    pub deals: u64,
    /// Deals in a quick run.
    pub quick_deals: u64,
}

/// A rule set: a preset by id, or one given in full (the game's rules as
/// JSON), such as a preset as it was when a past measurement ran.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum RulesRef {
    Preset(String),
    Given(serde_json::Value),
}

/// Think time: deals played one at a time on one thread, so nothing else
/// in the run competes with the bot for the machine.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Cost {
    pub rules: String,
    pub field: String,
    pub seed: u64,
    pub deals: u64,
    /// Deals in a quick run.
    pub quick_deals: u64,
}

/// Positions with a known right answer, in a JSON file beside the suite
/// file; each is asked `tries` times, on seeds `0..tries`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Puzzles {
    pub file: String,
    pub sha256: String,
    pub tries: u64,
}

/// The parts of a suite, in the order they run and report.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum Part {
    Ladder,
    Presets,
    Heldout,
    Matches,
    Cost,
    Puzzles,
}

impl Part {
    pub const ALL: [Part; 6] = [
        Part::Ladder,
        Part::Presets,
        Part::Heldout,
        Part::Matches,
        Part::Cost,
        Part::Puzzles,
    ];
}

/// A suite read from disk, with where it came from.
#[derive(Debug, Clone)]
pub struct Loaded {
    pub suite: Suite,
    /// The folder holding the suite file and the files it names.
    pub dir: PathBuf,
    /// SHA-256 of the suite file.
    pub sha256: String,
}

impl Loaded {
    /// Reads `name_or_path`: a suite file, a folder holding `suite.json`,
    /// or a suite name such as `v1`, looked up in `research/evals/` of the
    /// repository holding the current directory.
    pub fn load(name_or_path: &str) -> Result<Loaded, String> {
        let given = Path::new(name_or_path);
        let file = if given.is_file() {
            given.to_path_buf()
        } else if given.join("suite.json").is_file() {
            given.join("suite.json")
        } else {
            let root = repository_root().ok_or("not inside the repository; give the suite file's path")?;
            root.join("research/evals").join(name_or_path).join("suite.json")
        };
        let bytes = std::fs::read(&file).map_err(|e| format!("{}: {e}", file.display()))?;
        let suite: Suite = serde_json::from_slice(&bytes).map_err(|e| format!("{}: {e}", file.display()))?;
        let dir = file.parent().map_or_else(|| PathBuf::from("."), Path::to_path_buf);
        Ok(Loaded {
            suite,
            dir,
            sha256: sha256(&bytes),
        })
    }

    /// The parts this suite has.
    pub fn parts(&self) -> Vec<Part> {
        let s = &self.suite;
        Part::ALL
            .into_iter()
            .filter(|part| match part {
                Part::Ladder => s.ladder.is_some(),
                Part::Presets => s.presets.is_some(),
                Part::Heldout => s.heldout.is_some(),
                Part::Matches => s.matches.is_some(),
                Part::Cost => s.cost.is_some(),
                Part::Puzzles => s.puzzles.is_some(),
            })
            .collect()
    }

    /// The file `name` beside the suite file, checked against its hash.
    pub fn read(&self, name: &str, expected_sha256: &str) -> Result<Vec<u8>, String> {
        let path = self.dir.join(name);
        let bytes = std::fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        let actual = sha256(&bytes);
        if actual != expected_sha256 {
            return Err(format!(
                "{} has SHA-256 {actual}, but the suite says {expected_sha256}",
                path.display()
            ));
        }
        Ok(bytes)
    }
}

pub fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// The nearest folder at or above the current directory that holds
/// `research/evals`.
pub fn repository_root() -> Option<PathBuf> {
    let here = std::env::current_dir().ok()?;
    here.ancestors()
        .find(|dir| dir.join("research/evals").is_dir())
        .map(Path::to_path_buf)
}
