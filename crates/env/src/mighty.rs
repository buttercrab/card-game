//! Mighty in the environment: rule sets by preset name, varied draws, and
//! bots by name.
//!
//! Rule names are preset ids (`default`, `gshs`, ...), optionally at
//! another table size as `Rules::for_players` adapts them: `gshs/4`.
//!
//! Bot names: the levels players pick at the table, set up as the server
//! sets them up (`crates/server/src/session.rs`, `SessionGame::bot`), each
//! seat a little bolder or more careful in its bidding:
//!
//! - `초보` or `easy`: the simple bot, bidding more carefully and slipping
//!   to a random cheap card a third of the time.
//! - `보통` or `normal`: the simple bot.
//! - `고수` or `hard`: the search bot, without a time limit so that its
//!   choices depend only on the seed; `고수:N` or `hard:N` deals `N`
//!   samples a decision instead of its default 200.
//!
//! Anything else is a `sim` bot spec, played as written: `random`,
//! `simple`, `search:50:1:0`, `simple@bid_base=7`, ... (see `sim --help`).

use crate::game::EnvGame;
use engine::{Bot, Seat};
use mighty::bot::{Clumsy, tempered};
use mighty::rules::{Preset, Rules};
use mighty::search::SearchBot;
use mighty::{Mighty, Options};
use rand::{Rng, RngCore};

/// A bot by name; see the module docs.
#[derive(Debug, Clone, Copy)]
pub enum BotSpec {
    Easy,
    Normal,
    /// The search bot with this many samples, or its default.
    Hard(Option<usize>),
    Sim(sim::spec::Spec),
}

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
        let (name, samples) = match spec.split_once(':') {
            Some((name, samples)) => (name, Some(samples)),
            None => (spec, None),
        };
        let level = match name {
            "초보" | "easy" => Some(BotSpec::Easy),
            "보통" | "normal" => Some(BotSpec::Normal),
            "고수" | "hard" => {
                let samples = samples
                    .map(|n| n.parse().map_err(|_| format!("bad sample count in {spec:?}")))
                    .transpose()?;
                return Ok(BotSpec::Hard(samples));
            }
            _ => None,
        };
        match level {
            Some(level) if samples.is_none() => Ok(level),
            Some(_) => Err(format!("{name} takes no samples: {spec:?}")),
            None => spec.parse().map(BotSpec::Sim),
        }
    }

    fn bot(spec: &BotSpec, seat: Seat) -> Box<dyn Bot<Mighty> + Send> {
        match *spec {
            BotSpec::Easy => Box::new(Clumsy::easy(tempered(seat))),
            BotSpec::Normal => Box::new(tempered(seat)),
            BotSpec::Hard(samples) => {
                let default = SearchBot::default();
                Box::new(SearchBot {
                    samples: samples.unwrap_or(default.samples),
                    budget: None,
                    policy: tempered(seat),
                    ..default
                })
            }
            BotSpec::Sim(sim_spec) => sim_spec.build(seat),
        }
    }
}
