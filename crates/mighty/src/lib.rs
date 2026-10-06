//! Mighty (마이티), a five-player Korean trick-taking game, with house rules
//! as data. See `RULES.md` in this crate for the rules as implemented.

pub mod bot;
pub mod card;
pub mod encode;
pub mod explain;
pub mod rules;
pub mod score;
mod state;
pub mod table;
#[cfg(any(test, feature = "test-support"))]
pub mod testing;
pub mod trick;
mod view;

/// The whole truth of a hand, for programs that search it: bots that deal
/// the cards they cannot see and play every candidate out (`mighty-ai`),
/// solvers that know every hand. A [`State`] still changes only through
/// the game's own transitions: read where it stands with
/// [`State::phase`], build a world a seat cannot tell from the real one
/// with [`State::from_public`] and [`State::fill_hidden`], move it on with
/// [`State::step`], and play a trick by [`TrickState`](world::TrickState)
/// and [`legal_plays`](world::legal_plays) as the game does.
pub mod world {
    pub use crate::state::{
        Bidding, Declared, Done, Exchange, Phase, Play, TrickState, callable_joker, discard_points, legal_plays,
        payoff_rises_with_points, powered, settle,
    };
}

pub use state::{Action, Bid, Error, FriendCall, HandSummary, Options, Redeal, Redealt, State};
pub use trick::Lead;
pub use view::{PhaseView, View};

use engine::{Game, GameInfo, Turn, Viewer};
use rand::RngCore;
use rules::{Preset, Rules};

/// The [`Game`] implementation for Mighty.
#[derive(Debug, Clone, Copy, Default)]
pub struct Mighty;

impl Game for Mighty {
    type Options = Options;
    type State = State;
    type Action = Action;
    type View = View;
    type Error = Error;

    fn new_game(options: &Options) -> Result<State, Error> {
        State::new(options)
    }

    fn seat_count(state: &State) -> usize {
        state.seats()
    }

    fn turn(state: &State) -> Turn {
        state.turn()
    }

    fn legal_actions(state: &State, seat: engine::Seat) -> Vec<Action> {
        state.legal_actions(seat)
    }

    fn sample_chance(state: &State, rng: &mut dyn RngCore) -> Action {
        state.sample_deal(rng)
    }

    fn apply_chance(state: &mut State, action: Action) -> Result<(), Error> {
        state.apply_chance(action)
    }

    fn apply(state: &mut State, seat: engine::Seat, action: Action) -> Result<(), Error> {
        state.apply(seat, action)
    }

    fn view(state: &State, viewer: Viewer) -> View {
        View::new(state, viewer)
    }

    fn payoffs(state: &State) -> Option<Vec<i64>> {
        state.payoffs()
    }

    fn reshuffle_hidden(state: &State, viewer: Viewer, rng: &mut dyn RngCore) -> State {
        state.reshuffle_hidden(viewer, rng)
    }

    fn check_invariants(state: &State) -> Result<(), String> {
        state.check_invariants()
    }
}

/// Mighty as the platform names it: options are [`Options`], rules are
/// [`Rules`], and the presets come in [`Preset::ALL`]'s order, which the
/// research tools' draws rely on (players pick them in
/// [`table::PRESET_ORDER`]).
impl GameInfo for Mighty {
    type Rules = Rules;
    type RulesError = rules::InvalidRules;

    const ID: &'static str = "mighty";
    const NAME: &'static str = "마이티";

    fn presets() -> Vec<engine::Preset<Rules>> {
        Preset::ALL
            .into_iter()
            .map(|p| engine::Preset {
                id: p.name(),
                name: p.title(),
                rules: p.rules(),
            })
            .collect()
    }

    fn validate(rules: &Rules) -> Result<(), rules::InvalidRules> {
        rules.validate()
    }

    fn seats(rules: &Rules) -> usize {
        rules.players
    }

    fn describe(rules: &Rules) -> String {
        format!("{} players, {} cards", rules.players, rules.deck_size())
    }
}
