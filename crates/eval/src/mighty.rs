//! Mighty in the evals: bots by `sim`'s names ([`sim::spec`]), the first
//! bidder turning with the deal as at the table.

use crate::EvalGame;
use engine::{Bot, Seat};
use mighty::rules::Rules;
use mighty::{Action, Mighty, Options};
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

    /// Logs from before 2026-10-05 answered a misdeal round after each
    /// deal under `misdeal.ask_first`: from the first bidder on, one
    /// `Pass` (딜미스 아님) per seat, or a `Misdeal` that ended it. The
    /// answers go; a misdeal becomes that seat's out-of-turn call.
    fn upgrade_log(options: &Options, log: &[Action]) -> Vec<(Option<Seat>, Action)> {
        let rules = &options.rules;
        let n = rules.players;
        let mut first = options.first_bidder;
        let mut out = Vec::with_capacity(log.len());
        let mut i = 0;
        while i < log.len() {
            let action = log[i].clone();
            i += 1;
            let dealt = matches!(action, Action::Deal { .. });
            out.push((None, action));
            if !(rules.misdeal.ask_first && dealt) {
                continue;
            }
            for k in 0..n {
                match log.get(i) {
                    Some(Action::Pass) => i += 1,
                    Some(Action::Misdeal) => {
                        let seat = (first + k) % n;
                        out.push((Some(seat), Action::Misdeal));
                        if rules.misdeal.caller_deals {
                            first = seat;
                        }
                        i += 1;
                        break;
                    }
                    _ => break,
                }
            }
        }
        out
    }
}
