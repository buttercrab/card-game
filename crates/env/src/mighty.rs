//! Mighty in the environment: rule sets by preset name, varied draws, and
//! bots by name.
//!
//! Rule names are preset ids (`default`, `gshs`, ...), optionally at
//! another table size as `Rules::for_players` adapts them: `gshs/4`.
//!
//! Bots are `sim` bot specs (see `sim --help`): the levels players pick at
//! the table, `초보`/`easy`, `보통`/`normal` and `고수`/`hard`, as
//! [`mighty::bot::Level`] defines them (고수 without a clock, so its choices
//! depend only on the seed), or any other bot as written: `random`,
//! `simple`, `search:50:1:0`, `hard@threads=4`, `simple@bid_base=7`, ...

use crate::game::EnvGame;
use engine::{Bot, Seat};
use mighty::rules::{Preset, Rules};
use mighty::{Mighty, Options};
use rand::{Rng, RngCore};

/// A bot by name; see the module docs.
pub type BotSpec = sim::spec::Spec;

impl EnvGame for Mighty {
    const MAX_SEATS: usize = mighty::encode::MAX_SEATS;

    type BotSpec = BotSpec;

    /// Any seat may bid first; in a session that rotates, so every seat
    /// gets every position.
    fn options(rules: &Rules, rng: &mut dyn RngCore) -> Options {
        Options {
            rules: rules.clone(),
            first_bidder: rng.random_range(0..rules.players),
        }
    }

    fn vary(base: &Rules, rng: &mut dyn RngCore) -> Rules {
        base.varied(rng)
    }

    fn named_rules(name: &str) -> Result<Rules, String> {
        let (preset, players) = match name.split_once('/') {
            Some((preset, players)) => (preset, Some(players)),
            None => (name, None),
        };
        let rules = preset.parse::<Preset>()?.rules();
        match players {
            None => Ok(rules),
            Some(n) => n
                .parse()
                .ok()
                .and_then(|n| rules.for_players(n))
                .ok_or_else(|| format!("no rules for {n} players: 3 to 7")),
        }
    }

    fn parse_bot(spec: &str) -> Result<BotSpec, String> {
        spec.parse()
    }

    fn bot(spec: &BotSpec, seat: Seat) -> Box<dyn Bot<Mighty> + Send> {
        spec.build(seat)
    }
}
