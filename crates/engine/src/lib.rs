//! Game-agnostic core shared by every card game on the platform.
//!
//! A game is a deterministic state machine. Randomness never happens inside
//! [`Game::apply`]: the server draws it with [`Game::sample_chance`] and feeds
//! it back as an ordinary action, so a game is fully reproducible from its
//! action log.
//!
//! Legality is addressed by seat ([`Game::legal_actions`], [`Game::apply`]):
//! any seat may have actions at any time. [`Game::turn`] says only whom
//! the hand waits on, for pacing, and when chance must be drawn.
//!
//! The traits, from the core out:
//!
//! - [`Game`]: the rules of one hand; [`Bot`]: a player that is not a
//!   person.
//! - [`GameInfo`]: the game's id and name, its rule sets and presets, serde
//!   for what crosses a wire or a file. Everything above a game starts
//!   here.
//! - [`table`]: what the server's tables need ([`Table`], [`HandReport`],
//!   [`TableBots`]).
//! - [`Encode`]: model inputs, for the environment, the evals' models and
//!   inference.
//!
//! The research tools' hooks (bots by name, rule variation) are `sim`'s
//! `Research`.

pub mod encode;
pub mod info;
pub mod table;

pub use encode::{ActionValues, Belief, BeliefError, Encode, Features, Observation, Spec, Unsupported};
pub use info::{GameInfo, Preset};
pub use table::{Decision, HandReport, Table, TableBots, TableError};

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

/// How well a bot plays: the levels players pick at a table, whatever the
/// game. Each game says what plays at each ([`TableBots`]).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename = "BotLevel")]
pub enum Level {
    /// 초보: the weakest, for people learning the game.
    Easy,
    /// 보통: a fair player.
    Normal,
    /// 고수: the strongest.
    #[default]
    Hard,
}

impl Level {
    pub const ALL: [Level; 3] = [Level::Easy, Level::Normal, Level::Hard];

    /// Its name at the table.
    pub fn label(self) -> &'static str {
        match self {
            Level::Easy => "초보",
            Level::Normal => "보통",
            Level::Hard => "고수",
        }
    }

    /// Its name in specs and on the wire.
    pub fn name(self) -> &'static str {
        match self {
            Level::Easy => "easy",
            Level::Normal => "normal",
            Level::Hard => "hard",
        }
    }
}

impl std::fmt::Display for Level {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.name())
    }
}

impl std::str::FromStr for Level {
    type Err = String;

    /// By its name in specs or at the table: `hard` or `고수`.
    fn from_str(s: &str) -> Result<Level, String> {
        Level::ALL
            .into_iter()
            .find(|l| l.name() == s || l.label() == s)
            .ok_or_else(|| format!("unknown level `{s}`"))
    }
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
