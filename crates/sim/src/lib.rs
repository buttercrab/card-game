//! Plays games with bots and checks, after every step:
//!
//! - the seat to act has at least one legal action, and the bot picks one of them
//! - applying a legal action never fails
//! - the game's own invariants hold (for card games: no card created or lost)
//! - no view changes when everything that viewer cannot see is reshuffled
//! - the game ends within a step budget, with payoffs
//! - replaying the action log reproduces the final state exactly

use engine::{Bot, Game, Turn, Viewer};
use rand::{Rng, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::fmt;

#[derive(Debug, Clone, Copy)]
pub struct Checks {
    pub max_steps: usize,
    /// Check views every this many steps; 0 disables the check.
    pub view_every: usize,
}

impl Default for Checks {
    fn default() -> Checks {
        Checks {
            max_steps: 10_000,
            view_every: 1,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Report<G: Game> {
    pub steps: usize,
    pub payoffs: Vec<i64>,
    pub log: Vec<G::Action>,
}

/// A failed check, with the seed that reproduces it.
#[derive(Debug, Clone)]
pub struct Failure {
    pub seed: u64,
    pub step: usize,
    pub message: String,
    pub last_actions: Vec<String>,
}

impl fmt::Display for Failure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "seed {} step {}: {}", self.seed, self.step, self.message)?;
        for action in &self.last_actions {
            writeln!(f, "  {action}")?;
        }
        Ok(())
    }
}

impl std::error::Error for Failure {}

pub fn play<G: Game>(
    options: &G::Options,
    bots: &mut [Box<dyn Bot<G>>],
    seed: u64,
    checks: Checks,
) -> Result<Report<G>, Failure> {
    // Deals draw from their own stream, so two bots compared on one seed
    // get the same cards even when they use randomness differently.
    let mut chance = ChaCha8Rng::seed_from_u64(seed);
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    rng.set_stream(1);
    let mut log: Vec<G::Action> = Vec::new();
    let fail = |log: &[G::Action], message: String| Failure {
        seed,
        step: log.len(),
        message,
        last_actions: log.iter().rev().take(8).rev().map(|a| format!("{a:?}")).collect(),
    };

    let mut state = G::new_game(options).map_err(|e| fail(&log, format!("new_game: {e}")))?;
    let seats = G::seat_count(&state);
    if bots.len() != seats {
        return Err(fail(&log, format!("{} bots for {seats} seats", bots.len())));
    }
    G::check_invariants(&state).map_err(|e| fail(&log, e))?;

    loop {
        if log.len() >= checks.max_steps {
            return Err(fail(&log, format!("no end after {} steps", checks.max_steps)));
        }
        let action = match G::turn(&state) {
            Turn::Over => break,
            Turn::Chance => G::sample_chance(&state, &mut chance),
            Turn::Seat(seat) => {
                let legal = G::legal_actions(&state);
                if legal.is_empty() {
                    return Err(fail(&log, format!("seat {seat} has no legal action")));
                }
                let view = G::view(&state, Viewer::Seat(seat));
                let action = bots[seat].act(&view, &legal, &mut rng);
                if !legal.contains(&action) {
                    return Err(fail(&log, format!("bot for seat {seat} chose illegal {action:?}")));
                }
                action
            }
        };
        G::apply(&mut state, action.clone()).map_err(|e| fail(&log, format!("apply {action:?}: {e}")))?;
        log.push(action);
        G::check_invariants(&state).map_err(|e| fail(&log, e))?;
        if checks.view_every > 0 && log.len() % checks.view_every == 0 {
            check_views::<G>(&state, seats, &mut rng).map_err(|e| fail(&log, e))?;
        }
    }

    let payoffs = G::payoffs(&state).ok_or_else(|| fail(&log, "game over without payoffs".into()))?;
    let mut replay = G::new_game(options).map_err(|e| fail(&log, format!("replay: {e}")))?;
    for action in &log {
        G::apply(&mut replay, action.clone()).map_err(|e| fail(&log, format!("replay {action:?}: {e}")))?;
    }
    if replay != state {
        return Err(fail(&log, "replaying the log gave a different state".into()));
    }
    Ok(Report {
        steps: log.len(),
        payoffs,
        log,
    })
}

fn check_views<G: Game>(state: &G::State, seats: usize, rng: &mut impl Rng) -> Result<(), String> {
    let viewers = (0..seats).map(Viewer::Seat).chain([Viewer::Spectator]);
    for viewer in viewers {
        let reshuffled = G::reshuffle_hidden(state, viewer, rng);
        G::check_invariants(&reshuffled).map_err(|e| format!("reshuffle for {viewer:?} broke invariants: {e}"))?;
        if G::view(state, viewer) != G::view(&reshuffled, viewer) {
            return Err(format!("view for {viewer:?} depends on cards it cannot see"));
        }
    }
    Ok(())
}
