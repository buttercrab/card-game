//! Puzzles: positions where a bot once went wrong, kept as data (the rules,
//! the deal number and every action up to the decision) with the actions
//! that are right there.
//!
//! A *scored* puzzle's answer is proven: for Mighty, the acceptable
//! actions do at least as well as every other in every way the hidden
//! cards could lie, with perfect play after (the suite's tests check this).
//! An *informational* one records a known weakness whose right answer
//! depends on what cannot be seen; it is reported, never scored.

use crate::{EvalGame, preset};
use engine::{Game, Seat, Turn, Viewer};
use rand::SeedableRng;
use rand_chacha::ChaCha8Rng;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(bound = "", deny_unknown_fields)]
pub struct Puzzle<G: EvalGame> {
    pub id: String,
    /// Counted in the score; otherwise informational.
    pub scored: bool,
    pub title: String,
    /// Why the acceptable actions are right, and where the position came from.
    pub why: String,
    /// A preset id.
    pub rules: String,
    /// The options are those of this deal number ([`EvalGame::options`]).
    pub deal: u64,
    /// Every action from the start of the hand, chance actions included.
    pub log: Vec<G::Action>,
    pub acceptable: Vec<G::Action>,
    /// The log version `log` was recorded in ([`EvalGame::LOG_VERSION`]):
    /// the puzzle file's, set by [`parse`].
    #[serde(skip, default = "first_log_version")]
    pub log_version: u32,
}

/// The log version of a puzzle file that names none: suite v1's, recorded
/// before files carried one.
const fn first_log_version() -> u32 {
    1
}

/// A puzzle file that names its log version.
#[derive(Deserialize)]
#[serde(bound = "", deny_unknown_fields)]
struct Versioned<G: EvalGame> {
    log_version: u32,
    puzzles: Vec<Puzzle<G>>,
}

/// A puzzle's position, ready to ask a bot.
pub struct Position<G: Game> {
    pub state: G::State,
    pub seat: Seat,
    pub legal: Vec<G::Action>,
}

impl<G: EvalGame> Puzzle<G> {
    /// Replays the log, and checks that a seat is to act and that some but
    /// not all of its legal actions are acceptable.
    pub fn position(&self) -> Result<Position<G>, String> {
        let fail = |e: String| format!("puzzle {}: {e}", self.id);
        let rules = preset::<G>(&self.rules).map_err(fail)?;
        let options = G::options(&rules, self.deal);
        // Upgraded by the version it was recorded in, never by trial: an
        // old log may replay as it is to some other position.
        let version = self.log_version;
        let replaying = || match version {
            v if v == G::LOG_VERSION => format!("log version {v}"),
            v => format!("log version {v}, upgraded to {}", G::LOG_VERSION),
        };
        let steps = G::upgrade_log(&options, &self.log, version).map_err(|e| fail(format!("{}: {e}", replaying())))?;
        let mut state = G::new_game(&options).map_err(|e| fail(e.to_string()))?;
        for (i, (seat, action)) in steps.into_iter().enumerate() {
            let applied = match seat {
                Some(seat) => G::apply(&mut state, seat, action).map_err(|e| e.to_string()),
                None => engine::apply_on_turn::<G>(&mut state, action).map_err(|e| e.to_string()),
            };
            applied.map_err(|e| fail(format!("{}: step {i}: {e}", replaying())))?;
        }
        let Turn::Seat(seat) = G::turn(&state) else {
            return Err(fail("no seat is to act".into()));
        };
        let legal = G::legal_actions(&state, seat);
        if let Some(a) = self.acceptable.iter().find(|a| !legal.contains(a)) {
            return Err(fail(format!("acceptable {a:?} is not legal")));
        }
        if self.acceptable.is_empty() || legal.iter().all(|a| self.acceptable.contains(a)) {
            return Err(fail("some but not all legal actions must be acceptable".into()));
        }
        Ok(Position { state, seat, legal })
    }

    /// Asks `bot` the puzzle `tries` times, on seeds `0..tries`.
    pub fn ask(&self, bot: &G::Spec, tries: u64) -> Result<Answer, String> {
        let Position { state, seat, legal } = self.position()?;
        let view = G::view(&state, Viewer::Seat(seat));
        let chose: Vec<G::Action> = (0..tries)
            .map(|seed| G::bot(bot, seat).act(&view, &legal, &mut ChaCha8Rng::seed_from_u64(seed)))
            .collect();
        Ok(Answer {
            right: chose.iter().filter(|a| self.acceptable.contains(a)).count() as u64,
            tries,
            chose: chose
                .iter()
                .map(|a| serde_json::to_value(a).expect("actions serialize"))
                .collect(),
        })
    }
}

/// How a bot answered a puzzle.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Answer {
    /// Tries that chose an acceptable action.
    pub right: u64,
    pub tries: u64,
    /// The action chosen on each try.
    pub chose: Vec<Value>,
}

impl Answer {
    /// Passed: right on every try.
    pub fn passed(&self) -> bool {
        self.right == self.tries
    }
}

/// Reads a puzzle file: `{"log_version": N, "puzzles": [...]}`, or a bare
/// array of puzzles (suite v1's), whose logs are log version 1. Ids are
/// distinct.
pub fn parse<G: EvalGame>(bytes: &[u8]) -> Result<Vec<Puzzle<G>>, String> {
    let json: Value = serde_json::from_slice(bytes).map_err(|e| format!("puzzles: {e}"))?;
    let (version, puzzles) = if json.is_array() {
        let puzzles: Vec<Puzzle<G>> = serde_json::from_value(json).map_err(|e| format!("puzzles: {e}"))?;
        (first_log_version(), puzzles)
    } else {
        let file: Versioned<G> = serde_json::from_value(json).map_err(|e| format!("puzzles: {e}"))?;
        (file.log_version, file.puzzles)
    };
    if version == 0 || version > G::LOG_VERSION {
        return Err(format!(
            "puzzles: {}",
            crate::unknown_log_version(version, G::LOG_VERSION)
        ));
    }
    let puzzles: Vec<Puzzle<G>> = puzzles
        .into_iter()
        .map(|p| Puzzle {
            log_version: version,
            ..p
        })
        .collect();
    let mut ids: Vec<&str> = puzzles.iter().map(|p| p.id.as_str()).collect();
    ids.sort_unstable();
    if let Some(w) = ids.windows(2).find(|w| w[0] == w[1]) {
        return Err(format!("puzzle id {:?} is used twice", w[0]));
    }
    Ok(puzzles)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mighty::card::Suit;
    use mighty::rules::Contract;
    use mighty::{Action, Mighty};
    use serde_json::json;

    /// A puzzle under 기본 (whose misdeal round version 1 logs answer):
    /// the deal of deal number 0, then `after`.
    fn puzzle(after: &[Action]) -> Value {
        let rules = crate::preset::<Mighty>("default").unwrap();
        let state = Mighty::new_game(&Mighty::options(&rules, 0)).unwrap();
        let deal = Mighty::sample_chance(&state, &mut ChaCha8Rng::seed_from_u64(0));
        let mut log = vec![deal];
        log.extend_from_slice(after);
        json!({
            "id": "p",
            "scored": false,
            "title": "t",
            "why": "w",
            "rules": "default",
            "deal": 0,
            "log": log,
            "acceptable": [Action::Pass],
        })
    }

    fn one(file: Value) -> Result<Puzzle<Mighty>, String> {
        let mut puzzles = parse::<Mighty>(file.to_string().as_bytes())?;
        assert_eq!(puzzles.len(), 1);
        Ok(puzzles.remove(0))
    }

    /// Regression: a version 1 log was replayed as it is first, and only
    /// upgraded when that failed. Five passes after the deal are the
    /// misdeal round's answers in version 1, but five bidding passes
    /// in version 2, which replay to another position: each file means what its
    /// version says.
    #[test]
    fn a_log_replays_by_its_version_not_by_trial() {
        let five = vec![Action::Pass; 5];
        let v1 = one(json!([puzzle(&five)])).unwrap();
        assert_eq!(v1.log_version, 1);
        let position = v1.position().unwrap();
        assert_eq!(position.seat, 0, "the first bidder bids first");
        assert!(position.legal.iter().any(|a| matches!(a, Action::Bid(_))));
        let v2 = one(json!({"log_version": 2, "puzzles": [puzzle(&five)]})).unwrap();
        assert_eq!(v2.log_version, 2);
        // Both replay; only the version says which position is meant.
        let other = v2.position().unwrap();
        assert!(other.state != position.state);
    }

    /// An upgrade that fails says so, with the version, rather than
    /// falling back to the log as it is.
    #[test]
    fn a_failed_upgrade_is_reported() {
        let bid_first = [Action::Bid(Contract {
            trump: Some(Suit::Spade),
            count: 13,
        })];
        let err = one(json!([puzzle(&bid_first)])).unwrap().position().err().unwrap();
        assert!(
            err.contains("log version 1, upgraded to 2") && err.contains("misdeal round"),
            "{err}"
        );
        let err = one(json!([puzzle(&vec![Action::Pass; 2])]))
            .unwrap()
            .position()
            .err()
            .unwrap();
        assert!(err.contains("ends in the misdeal round"), "{err}");
    }

    #[test]
    fn unknown_versions_and_fields_are_refused() {
        for file in [
            json!({"log_version": 3, "puzzles": []}),
            json!({"log_version": 0, "puzzles": []}),
            json!({"log_version": 2, "puzzles": [], "extra": 1}),
            json!({"puzzles": []}),
        ] {
            assert!(parse::<Mighty>(file.to_string().as_bytes()).is_err(), "{file}");
        }
        let err = parse::<Mighty>(json!({"log_version": 9, "puzzles": []}).to_string().as_bytes()).unwrap_err();
        assert!(err.contains("log version 9 is unknown"), "{err}");
    }
}
