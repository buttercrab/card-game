//! `phased:BID+EXCHANGE+PLAY`: one bot for each phase of the hand, for
//! ablations that ask which phase a bot wins or loses its points in. The
//! bidding (with the misdeal call) goes to `BID`, the declarer's
//! exchange (trump change, discards, friend call) to `EXCHANGE`, the
//! card play to `PLAY`; each is any other bot spec, e.g.
//! `phased:normal+dmc:DIR+dmc:DIR` (보통's bidding, a Q network's
//! exchange and play). Each part is built for the seat as it would be
//! alone (the table's levels keep their seat temper).
//!
//! The parts must not need to see the other phases' decisions: every
//! bot here decides from the view alone.

use crate::spec::Spec;
use engine::{Bot, Seat};
use mighty::{Action, Mighty, PhaseView, View};
use rand::RngCore;

/// The three specs, by phase.
#[derive(Debug, Clone)]
pub struct Phased {
    pub bid: Spec,
    pub exchange: Spec,
    pub play: Spec,
}

impl Phased {
    /// `BID+EXCHANGE+PLAY` (after the `phased:` prefix).
    pub fn parse(rest: &str) -> Result<Phased, String> {
        let parts: Vec<&str> = rest.split('+').collect();
        let [bid, exchange, play] = parts[..] else {
            return Err(format!("phased:{rest}: expected phased:BID+EXCHANGE+PLAY"));
        };
        let parse = |s: &str| -> Result<Spec, String> {
            if s.starts_with("phased:") {
                return Err(format!("phased:{rest}: phases do not nest"));
            }
            s.parse()
        };
        Ok(Phased {
            bid: parse(bid)?,
            exchange: parse(exchange)?,
            play: parse(play)?,
        })
    }

    /// The bot for `seat`.
    pub fn build(&self, seat: Seat) -> PhasedBot {
        PhasedBot {
            bid: self.bid.build(seat),
            exchange: self.exchange.build(seat),
            play: self.play.build(seat),
        }
    }

    pub fn reproducible(&self) -> bool {
        self.bid.reproducible() && self.exchange.reproducible() && self.play.reproducible()
    }
}

/// A seat's three bots, chosen by the phase of the view.
pub struct PhasedBot {
    bid: Box<dyn Bot<Mighty> + Send>,
    exchange: Box<dyn Bot<Mighty> + Send>,
    play: Box<dyn Bot<Mighty> + Send>,
}

impl Bot<Mighty> for PhasedBot {
    fn act(&mut self, view: &View, legal: &[Action], rng: &mut dyn RngCore) -> Action {
        let bot = match view.phase {
            PhaseView::Exchange { .. } => &mut self.exchange,
            PhaseView::Play { .. } => &mut self.play,
            PhaseView::Dealing | PhaseView::Bidding { .. } | PhaseView::Done { .. } => &mut self.bid,
        };
        bot.act(view, legal, rng)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::Kind;
    use engine::{Game, Turn, Viewer};
    use mighty::{Options, rules::Preset};
    use rand::SeedableRng;

    #[test]
    fn parses_three_specs() {
        let spec: Spec = "phased:normal+random+hard@threads=2".parse().unwrap();
        let Kind::Phased(ref p) = spec.kind else {
            panic!("a phased bot")
        };
        assert!(matches!(p.bid.kind, Kind::Simple(_)));
        assert!(matches!(p.exchange.kind, Kind::Random));
        assert!(matches!(&p.play.kind, Kind::Search(s) if s.threads == 2));
        assert!(spec.reproducible());
        for bad in [
            "phased:normal+random",
            "phased:a+b+c",
            "phased:normal+normal+phased:normal",
        ] {
            assert!(bad.parse::<Spec>().is_err(), "{bad}");
        }
    }

    /// Each phase goes to its own bot: random bidding with simple play
    /// still plays whole hands, and the same specs throughout play as
    /// that bot alone does.
    #[test]
    fn plays_hands_and_matches_a_single_bot() {
        let options = Options {
            rules: Preset::Gshs.rules(),
            first_bidder: 0,
        };
        let play = |spec: &str, seed: u64| {
            let spec: Spec = spec.parse().unwrap();
            let mut bots: Vec<_> = (0..5).map(|seat| spec.build(seat)).collect();
            let mut rng = rand_chacha::ChaCha8Rng::seed_from_u64(seed);
            let mut state = Mighty::new_game(&options).unwrap();
            let mut log = Vec::new();
            loop {
                match Mighty::turn(&state) {
                    Turn::Over => break,
                    Turn::Chance => {
                        let deal = Mighty::sample_chance(&state, &mut rng);
                        Mighty::apply(&mut state, deal).unwrap();
                    }
                    Turn::Seat(seat) => {
                        let view = Mighty::view(&state, Viewer::Seat(seat));
                        let legal = Mighty::legal_actions(&state);
                        let action = bots[seat].act(&view, &legal, &mut rng);
                        log.push(action.clone());
                        Mighty::apply(&mut state, action).unwrap();
                    }
                }
            }
            log
        };
        for seed in 0..4 {
            assert_eq!(play("phased:normal+normal+normal", seed), play("normal", seed));
            assert!(!play("phased:random+normal+normal", seed).is_empty());
        }
    }
}
