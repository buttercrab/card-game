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
use ts_rs::TS;

/// Index of a seat at the table, `0..seat_count`.
pub type Seat = usize;

/// Who is looking at the game.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum Viewer {
    Seat(Seat),
    Spectator,
}

/// Whom the hand waits on. Legality is by seat ([`Game::legal_actions`]):
/// this says only whose move paces the hand (a clock, a bot that should
/// think now) and when chance must be drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum Turn {
    /// The server must draw a random action (shuffle, deal) with
    /// [`Game::sample_chance`] and apply it with [`Game::apply_chance`].
    Chance,
    /// The hand waits on this seat: it always has a legal action. Other
    /// seats may have some too (a 딜미스 called the moment the cards land),
    /// which they may take or leave.
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

    /// Every action `seat` may take now, whether or not the hand waits on
    /// it ([`Game::turn`]). The seat the hand waits on always has one; any
    /// other seat's are optional, and the hand goes on without them. This
    /// is the single source of truth for legality.
    fn legal_actions(state: &Self::State, seat: Seat) -> Vec<Self::Action>;

    /// Draws the action for a [`Turn::Chance`]. Only the server calls this.
    fn sample_chance(state: &Self::State, rng: &mut dyn RngCore) -> Self::Action;

    /// Applies the action drawn for a [`Turn::Chance`]; an error at any
    /// other time. On error the state is left unchanged.
    fn apply_chance(state: &mut Self::State, action: Self::Action) -> Result<(), Self::Error>;

    /// Applies `seat`'s `action`, which must be one of
    /// [`Game::legal_actions`] for that seat. On error the state is left
    /// unchanged.
    fn apply(state: &mut Self::State, seat: Seat, action: Self::Action) -> Result<(), Self::Error>;

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

/// The legal actions of the seat the hand waits on ([`Game::turn`]); none
/// on a chance turn or once it is over. For drivers that play turn by turn
/// (simulations, the RL environment, searches), which leave the optional
/// actions of other seats aside.
pub fn legal_on_turn<G: Game>(state: &G::State) -> Vec<G::Action> {
    match G::turn(state) {
        Turn::Seat(seat) => G::legal_actions(state, seat),
        Turn::Chance | Turn::Over => Vec::new(),
    }
}

/// Why [`apply_on_turn`] refused an action.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TurnError<E> {
    /// The hand is over: nobody acts.
    #[error("the hand is over")]
    Over,
    #[error(transparent)]
    Game(E),
}

/// Applies `action` for whoever the hand waits on: the draw on
/// [`Turn::Chance`] ([`Game::apply_chance`]), the seat's move on
/// [`Turn::Seat`] ([`Game::apply`]). For drivers that play turn by turn,
/// like [`legal_on_turn`]. On error the state is left unchanged.
pub fn apply_on_turn<G: Game>(state: &mut G::State, action: G::Action) -> Result<(), TurnError<G::Error>> {
    match G::turn(state) {
        Turn::Chance => G::apply_chance(state, action).map_err(TurnError::Game),
        Turn::Seat(seat) => G::apply(state, seat, action).map_err(TurnError::Game),
        Turn::Over => Err(TurnError::Over),
    }
}

/// A player that is not a person. Bots see exactly what a human client sees,
/// and act when the hand waits on their seat ([`Turn::Seat`]); `legal` is
/// that seat's [`Game::legal_actions`].
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
