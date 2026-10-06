//! What the environment needs from a game, and where each hand's rules
//! come from.

use crate::Error;
use engine::Encode;
use rand::seq::IndexedRandom;
use rand::{Rng, RngCore};
use serde::Serialize;
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256};
pub use sim::Research;
use std::fmt::Debug;
use std::path::Path;

/// A game the environment can run: its research hooks ([`Research`]: rule
/// sets by name, varied draws, bots by name) with a model encoding
/// ([`Encode`]). Everything else (seeding, batching, rewards, data) is
/// shared, so a second game plugs in by implementing those two.
pub trait EnvGame: Research + Encode {}

impl<G: Research + Encode> EnvGame for G {}

/// The options of one hand under `rules`, the seat that opens it drawn
/// from `rng`: any seat may, and in a session that rotates, so every seat
/// gets every position.
pub fn draw_options<G: EnvGame>(rules: &G::Rules, rng: &mut dyn RngCore) -> G::Options {
    let deal = rng.random_range(0..G::seats(rules));
    G::options(rules, deal as u64)
}

/// A stable id for a rule set: the SHA-256 of its JSON, in hex. Data
/// records it with every decision; equal rules always get the same id.
pub fn rules_id<R: Serialize>(rules: &R) -> String {
    digest(rules).iter().map(|b| format!("{b:02x}")).collect()
}

/// The first 64 bits of [`rules_id`], for arrays.
pub fn rules_key<R: Serialize>(rules: &R) -> u64 {
    let digest = digest(rules);
    u64::from_be_bytes(digest[..8].try_into().expect("32 bytes"))
}

fn digest<R: Serialize>(rules: &R) -> [u8; 32] {
    let json = serde_json::to_vec(rules).expect("rules serialize to JSON");
    Sha256::digest(&json).into()
}

/// Where each hand's rules come from.
#[derive(Debug, Clone, PartialEq)]
pub enum RuleSource<R> {
    /// One rule set for every hand.
    Fixed(R),
    /// One of these, uniformly, each hand.
    Pool(Vec<R>),
    /// A fresh draw each hand: a base from this list, uniformly, with its
    /// optional rules varied by [`EnvGame::vary`].
    Varied(Vec<R>),
}

impl<R: Clone + DeserializeOwned> RuleSource<R> {
    /// Reads a rule source from text, the way the command line and the
    /// Python side give it:
    ///
    /// - `NAME`: one named rule set ([`EnvGame::named_rules`]).
    /// - `pool:NAME,NAME,...`: one of these each hand.
    /// - `varied`: varied draws from every preset; `varied:NAME,...` from
    ///   these bases only.
    /// - `{...}`: one rule set as JSON; `[{...}, ...]`: a pool of them.
    pub fn parse<G: EnvGame<Rules = R>>(text: &str) -> Result<RuleSource<R>, Error> {
        let text = text.trim();
        let bad = |e: String| Error::Rules(format!("{text:?}: {e}"));
        let names = |list: &str| -> Result<Vec<R>, Error> {
            let rules: Vec<R> = list
                .split(',')
                .map(|name| G::named_rules(name.trim()).map_err(bad))
                .collect::<Result<_, _>>()?;
            if rules.is_empty() {
                return Err(bad("no rule sets".into()));
            }
            Ok(rules)
        };
        if text.starts_with('{') {
            return serde_json::from_str(text)
                .map(RuleSource::Fixed)
                .map_err(|e| bad(e.to_string()));
        }
        if text.starts_with('[') {
            return serde_json::from_str(text)
                .map(RuleSource::Pool)
                .map_err(|e| bad(e.to_string()));
        }
        if text == "varied" {
            return Ok(RuleSource::Varied(G::presets().into_iter().map(|p| p.rules).collect()));
        }
        if let Some(list) = text.strip_prefix("varied:") {
            return names(list).map(RuleSource::Varied);
        }
        if let Some(list) = text.strip_prefix("pool:") {
            return names(list).map(RuleSource::Pool);
        }
        G::named_rules(text).map(RuleSource::Fixed).map_err(bad)
    }
}

/// How many varied draws may land on excluded rule sets in a row before
/// the sampler gives up: the exclusions must be covering everything.
const MAX_REDRAWS: usize = 1000;

/// Draws rule sets from a [`RuleSource`], never one of the excluded sets
/// (the held-out rule sets of the evals). Exclusion compares whole rule
/// sets for equality.
#[derive(Debug, Clone)]
pub struct RuleSampler<R> {
    source: RuleSource<R>,
    excluded: Vec<R>,
}

impl<R: Clone + PartialEq + Debug> RuleSampler<R> {
    /// Fails when a fixed or pooled rule set is excluded: such a source
    /// could only ever play held-out rules.
    pub fn new(source: RuleSource<R>, excluded: Vec<R>) -> Result<RuleSampler<R>, Error> {
        let listed: &[R] = match &source {
            RuleSource::Fixed(rules) => std::slice::from_ref(rules),
            RuleSource::Pool(pool) | RuleSource::Varied(pool) => pool,
        };
        if listed.is_empty() {
            return Err(Error::Rules("no rule sets to play".into()));
        }
        if !matches!(source, RuleSource::Varied(_)) && listed.iter().any(|r| excluded.contains(r)) {
            return Err(Error::Rules("a listed rule set is excluded".into()));
        }
        Ok(RuleSampler { source, excluded })
    }

    pub fn source(&self) -> &RuleSource<R> {
        &self.source
    }

    pub fn excluded(&self) -> &[R] {
        &self.excluded
    }

    /// The rules of one hand.
    pub fn draw<G: EnvGame<Rules = R>>(&self, rng: &mut dyn RngCore) -> Result<R, Error> {
        match &self.source {
            RuleSource::Fixed(rules) => Ok(rules.clone()),
            RuleSource::Pool(pool) => Ok(pool.choose(rng).expect("not empty").clone()),
            RuleSource::Varied(bases) => {
                for _ in 0..MAX_REDRAWS {
                    let rules = G::vary(bases.choose(rng).expect("not empty"), rng);
                    if !self.excluded.contains(&rules) {
                        return Ok(rules);
                    }
                }
                Err(Error::Rules(format!(
                    "{MAX_REDRAWS} varied draws in a row were all excluded"
                )))
            }
        }
    }
}

/// Reads a JSON array of serialized rule sets, such as the evals' held-out
/// ones (`research/evals/v1/heldout-rules.json`): rule sets to exclude, or
/// a pool to play.
pub fn load_rule_sets<R: DeserializeOwned>(path: &Path) -> Result<Vec<R>, Error> {
    let text = std::fs::read_to_string(path).map_err(|e| Error::Io(format!("{}: {e}", path.display())))?;
    serde_json::from_str(&text).map_err(|e| Error::Rules(format!("{}: {e}", path.display())))
}
