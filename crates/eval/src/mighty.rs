//! Mighty in the evals: bots by `sim`'s names ([`sim::spec`]), the first
//! bidder turning with the deal as at the table.

use crate::EvalGame;
use engine::{Bot, Seat};
use mighty::rules::Rules;
use mighty::{Mighty, Options};
use sim::spec::Spec;

impl EvalGame for Mighty {
    type Spec = Spec;

    fn parse_bot(name: &str) -> Result<Spec, String> {
        name.parse()
    }

    fn bot(spec: &Spec, seat: Seat) -> Box<dyn Bot<Mighty>> {
        spec.build(seat)
    }

    fn reproducible(spec: &Spec) -> bool {
        spec.reproducible()
    }

    fn options(rules: &Rules, deal: u64) -> Options {
        Options {
            rules: rules.clone(),
            first_bidder: deal as usize % rules.players,
        }
    }

    fn seats(rules: &Rules) -> usize {
        rules.players
    }

    fn describe(rules: &Rules) -> String {
        format!("{} players, {} cards", rules.players, rules.deck_size())
    }
}
