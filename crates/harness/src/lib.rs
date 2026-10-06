//! What every program that plays games with bots shares: the research
//! simulator (`sim`), the experiments (`lab`), the evals (`eval`) and the
//! self-play generator (`env`).
//!
//! - [`drive`]: the one loop that plays a game on from a state, each seat
//!   deciding through a callback, an [`Observer`] told of every decision;
//! - [`play`]: a whole game by bots, checking after every step that
//!   - the seat to act has at least one legal action, and the bot picks one of them,
//!   - applying a legal action never fails,
//!   - the game's own invariants hold (for card games: no card created or lost),
//!   - no view changes when everything that viewer cannot see is reshuffled,
//!   - the game ends within a step budget, with payoffs,
//!   - replaying the action log reproduces the final state exactly;
//! - [`parallel`]: games spread over threads, results in game order;
//! - [`Timed`]: bots timed per decision;
//! - [`stats`]: the statistics reported on games;
//! - [`provenance`]: where and from what commit a run ran.

pub mod provenance;
pub mod stats;

use engine::{Bot, Game, Seat, Turn, Viewer};
use rand::{Rng, RngCore, SeedableRng};
use rand_chacha::ChaCha8Rng;
use std::cell::RefCell;
use std::fmt;
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// One decision, as an [`Observer`] is told of it: the game was in
/// `state`, where `seat` chose `action` among `legal`; the action is about
/// to be applied, as step number `step` of the game.
pub struct Decided<'a, G: Game> {
    pub step: usize,
    pub state: &'a G::State,
    pub seat: Seat,
    pub legal: &'a [G::Action],
    pub action: &'a G::Action,
}

/// Told of every decision as a game is driven ([`drive`], [`play`]).
pub trait Observer<G: Game> {
    fn decided(&mut self, decision: Decided<G>);
}

/// Watches nothing.
impl<G: Game> Observer<G> for () {
    fn decided(&mut self, _: Decided<G>) {}
}

/// Any closure over the decision is an observer.
impl<G: Game, F: FnMut(Decided<G>)> Observer<G> for F {
    fn decided(&mut self, decision: Decided<G>) {
        self(decision);
    }
}

/// How a seat decides: from the state, the seat and its legal actions.
pub type Decide<'a, G> = dyn FnMut(&<G as Game>::State, Seat, &[<G as Game>::Action]) -> <G as Game>::Action + 'a;

/// Plays on from `state` until the game is over or `stop` says so before
/// a step: chance from `chance`, every seat by `decide` (given the state,
/// the seat and its legal actions), `observer` told of each decision before
/// it is applied. Every action applied is pushed to `log`. Errors when an
/// action does not apply.
pub fn drive<G: Game>(
    state: &mut G::State,
    chance: &mut dyn RngCore,
    decide: &mut Decide<G>,
    stop: &dyn Fn(&G::State) -> bool,
    observer: &mut dyn Observer<G>,
    log: &mut Vec<G::Action>,
) -> Result<(), G::Error> {
    while !stop(state) {
        let action = match G::turn(state) {
            Turn::Over => return Ok(()),
            Turn::Chance => G::sample_chance(state, chance),
            Turn::Seat(seat) => {
                let legal = G::legal_actions(state);
                let action = decide(state, seat, &legal);
                observer.decided(Decided {
                    step: log.len(),
                    state,
                    seat,
                    legal: &legal,
                    action: &action,
                });
                action
            }
        };
        G::apply(state, action.clone())?;
        log.push(action);
    }
    Ok(())
}

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

/// Plays a whole game with `bots`, one per seat, on `seed`, checking every
/// invariant `checks` asks for after every step (see the crate docs).
pub fn play<G: Game>(
    options: &G::Options,
    bots: &mut [Box<dyn Bot<G>>],
    seed: u64,
    checks: Checks,
) -> Result<Report<G>, Failure> {
    play_observed(options, bots, seed, checks, &mut ())
}

/// [`play`], with `observer` told of every decision.
pub fn play_observed<G: Game>(
    options: &G::Options,
    bots: &mut [Box<dyn Bot<G>>],
    seed: u64,
    checks: Checks,
    observer: &mut dyn Observer<G>,
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
                observer.decided(Decided {
                    step: log.len(),
                    state: &state,
                    seat,
                    legal: &legal,
                    action: &action,
                });
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

/// Runs `job` for every index in `0..n` on `threads` workers (all cores
/// when `None`) and returns the results in index order. Each index is one
/// game, so how the games fall to threads never changes a result.
pub fn parallel<T: Send>(n: u64, threads: Option<usize>, job: impl Fn(u64) -> T + Sync) -> Vec<T> {
    let threads = threads.unwrap_or_else(|| std::thread::available_parallelism().map_or(1, |n| n.get()));
    let next = AtomicU64::new(0);
    let mut results: Vec<(u64, T)> = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..threads.max(1))
            .map(|_| {
                scope.spawn(|| {
                    let mut done = Vec::new();
                    loop {
                        let i = next.fetch_add(1, Ordering::Relaxed);
                        if i >= n {
                            return done;
                        }
                        done.push((i, job(i)));
                    }
                })
            })
            .collect();
        workers
            .into_iter()
            .flat_map(|w| w.join().expect("worker panicked"))
            .collect()
    });
    results.sort_by_key(|(i, _)| *i);
    results.into_iter().map(|(_, t)| t).collect()
}

/// How long each of a bot's decisions with a real choice took.
#[derive(Debug, Clone, Default)]
pub struct Clock {
    pub times: Vec<Duration>,
}

/// Times every decision of the bot it wraps into a shared [`Clock`]; a
/// decision with one legal action is no choice and is not counted.
pub struct Timed<G: Game> {
    pub bot: Box<dyn Bot<G>>,
    pub clock: Rc<RefCell<Clock>>,
}

impl<G: Game> Bot<G> for Timed<G> {
    fn act(&mut self, view: &G::View, legal: &[G::Action], rng: &mut dyn RngCore) -> G::Action {
        let started = Instant::now();
        let action = self.bot.act(view, legal, rng);
        if legal.len() > 1 {
            self.clock.borrow_mut().times.push(started.elapsed());
        }
        action
    }
}
