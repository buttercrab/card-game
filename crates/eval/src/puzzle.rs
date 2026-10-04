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
        let mut state = G::new_game(&G::options(&rules, self.deal)).map_err(|e| fail(e.to_string()))?;
        for (i, action) in self.log.iter().enumerate() {
            G::apply(&mut state, action.clone()).map_err(|e| fail(format!("action {i}: {e}")))?;
        }
        let Turn::Seat(seat) = G::turn(&state) else {
            return Err(fail("no seat is to act".into()));
        };
        let legal = G::legal_actions(&state);
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

/// Reads a puzzle file: a JSON array of puzzles with distinct ids.
pub fn parse<G: EvalGame>(bytes: &[u8]) -> Result<Vec<Puzzle<G>>, String> {
    let puzzles: Vec<Puzzle<G>> = serde_json::from_slice(bytes).map_err(|e| format!("puzzles: {e}"))?;
    let mut ids: Vec<&str> = puzzles.iter().map(|p| p.id.as_str()).collect();
    ids.sort_unstable();
    if let Some(w) = ids.windows(2).find(|w| w[0] == w[1]) {
        return Err(format!("puzzle id {:?} is used twice", w[0]));
    }
    Ok(puzzles)
}
