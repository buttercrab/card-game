//! Mighty (마이티), a five-player Korean trick-taking game, with house rules
//! as data. See `RULES.md` in this crate for the rules as implemented.

pub mod bot;
pub mod card;
pub mod rules;
pub mod search;
mod state;
pub mod trick;
mod view;

pub use state::{Action, Error, FriendCall, Options, State};
pub use view::{PhaseView, View};

use engine::{Game, Turn, Viewer};
use rand::RngCore;

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
