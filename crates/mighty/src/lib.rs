//! Mighty (마이티), a five-player Korean trick-taking game, with house rules
//! as data. See `RULES.md` in this crate for the rules as implemented.

pub mod bot;
pub mod card;
pub mod deal;
pub mod encode;
pub mod endgame;
pub mod explain;
pub mod hybrid;
mod read;
pub mod rules;
pub mod score;
pub mod search;
mod state;
pub mod trick;
mod view;

pub use state::{Action, Bid, Error, FriendCall, HandSummary, Options, Redeal, Redealt, State};
pub use trick::Lead;
pub use view::{PhaseView, View};

use engine::{Game, JsonGame, Turn, Viewer};
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

    fn legal_actions(state: &State) -> Vec<Action> {
        state.legal_actions()
    }

    fn sample_chance(state: &State, rng: &mut dyn RngCore) -> Action {
        state.sample_deal(rng)
    }

    fn apply(state: &mut State, action: Action) -> Result<(), Error> {
        state.apply(action)
    }

    fn out_of_turn_actions(state: &State, seat: engine::Seat) -> Vec<Action> {
        state.out_of_turn_actions(seat)
    }

    fn apply_out_of_turn(state: &mut State, seat: engine::Seat, action: Action) -> Result<(), Error> {
        state.apply_out_of_turn(seat, action)
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

/// Mighty behind [`engine::DynGame`]: options are [`Options`] and rules
/// are [`Rules`], as JSON.
impl JsonGame for Mighty {
    type Rules = Rules;

    const ID: &'static str = "mighty";
    const NAME: &'static str = "마이티";

    fn presets() -> Vec<(&'static str, &'static str, Rules)> {
        Preset::ALL
            .into_iter()
            .map(|p| (p.name(), p.title(), p.rules()))
            .collect()
    }

    fn validate(rules: &Rules) -> Result<(), String> {
        rules.validate().map_err(|e| e.to_string())
    }
}
