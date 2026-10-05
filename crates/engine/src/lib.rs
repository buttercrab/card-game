//! Game-agnostic core shared by every card game on the platform.
//!
//! A game is a deterministic state machine. Randomness never happens inside
//! [`Game::apply`]: the server draws it with [`Game::sample_chance`] and feeds
//! it back as an ordinary action, so a game is fully reproducible from its
//! action log.
//!
//! Above the game itself: [`Encode`] turns what a seat sees into model
//! inputs, and [`DynGame`] drives any game through JSON, for code that
//! should not know which game it runs.

pub mod dynamic;
pub mod encode;

pub use dynamic::{DynError, DynGame, DynState, Erased, JsonGame, PresetInfo, Registry};
pub use encode::{ActionValues, Belief, BeliefError, Encode, Features, Observation, Spec, Unsupported};

use rand::RngCore;
use rand::seq::IndexedRandom;
use serde::{Deserialize, Serialize};
use std::fmt::Debug;

/// Index of a seat at the table, `0..seat_count`.
pub type Seat = usize;

/// Who is looking at the game.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Viewer {
    Seat(Seat),
    Spectator,
}

/// Who must act next.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Turn {
    /// The server must draw a random action (shuffle, deal) with [`Game::sample_chance`].
    Chance,
    /// This seat must choose one of [`Game::legal_actions`].
    Seat(Seat),
    Over,
}

pub trait Game {
    type Options: Clone + Debug;
    type State: Clone + Debug + PartialEq;
    type Action: Clone + Debug + PartialEq;
    type View: Clone + Debug + PartialEq;
    type Error: std::error::Error;

    fn new_game(options: &Self::Options) -> Result<Self::State, Self::Error>;

    fn seat_count(state: &Self::State) -> usize;

    fn turn(state: &Self::State) -> Turn;

    /// Every action the seat to act may take. Empty unless [`Game::turn`] is
    /// [`Turn::Seat`]. This is the single source of truth for legality.
    fn legal_actions(state: &Self::State) -> Vec<Self::Action>;

    /// Draws the action for a [`Turn::Chance`]. Only the server calls this.
    fn sample_chance(state: &Self::State, rng: &mut dyn RngCore) -> Self::Action;

    /// Applies the action of whoever [`Game::turn`] says is acting.
    /// On error the state is left unchanged.
    fn apply(state: &mut Self::State, action: Self::Action) -> Result<(), Self::Error>;

    /// Actions `seat` may take now although [`Game::turn`] is not theirs,
    /// such as calling a misdeal the moment the cards land. The seat whose
    /// turn it is finds all of its actions in [`Game::legal_actions`], so
    /// this is empty for it. None by default.
    fn out_of_turn_actions(_state: &Self::State, _seat: Seat) -> Vec<Self::Action> {
        Vec::new()
    }

    /// Applies one of [`Game::out_of_turn_actions`] for `seat`. On error the
    /// state is left unchanged. Only called with an action from that list,
    /// so a game without out-of-turn actions never gets here.
    fn apply_out_of_turn(_state: &mut Self::State, seat: Seat, action: Self::Action) -> Result<(), Self::Error> {
        unreachable!("seat {seat} acted out of turn with {action:?}, but this game has no out-of-turn actions")
    }

    /// What `viewer` is allowed to know. Must not depend on anything `viewer`
    /// cannot see; [`Game::reshuffle_hidden`] is how the simulator checks that.
    fn view(state: &Self::State, viewer: Viewer) -> Self::View;

    /// Payoff per seat once [`Turn::Over`], otherwise `None`.
    fn payoffs(state: &Self::State) -> Option<Vec<i64>>;

    /// Redistributes everything `viewer` cannot see (other hands, face-down
    /// cards) at random. A correct [`Game::view`] returns the same view for
    /// the original and the reshuffled state.
    fn reshuffle_hidden(state: &Self::State, viewer: Viewer, rng: &mut dyn RngCore) -> Self::State;

    /// Game-specific consistency checks, such as no card created or lost.
    fn check_invariants(_state: &Self::State) -> Result<(), String> {
        Ok(())
    }
}

/// A player that is not a person. Bots see exactly what a human client sees.
pub trait Bot<G: Game> {
    fn act(&mut self, view: &G::View, legal: &[G::Action], rng: &mut dyn RngCore) -> G::Action;
}

/// Picks uniformly among the legal actions. Useful for fuzzing rules.
#[derive(Debug, Clone, Copy, Default)]
pub struct RandomBot;

impl<G: Game> Bot<G> for RandomBot {
    fn act(&mut self, _view: &G::View, legal: &[G::Action], rng: &mut dyn RngCore) -> G::Action {
        legal
            .choose(rng)
            .expect("bot asked to act with no legal actions")
            .clone()
    }
}
