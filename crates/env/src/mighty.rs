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
//! - `초보` or `easy`: the simple bot, choosing a random card a third of
//!   the time.
//! - `보통` or `normal`: the simple bot.
//! - `고수` or `hard`: the search bot, without a time limit so that its
//!   choices depend only on the seed; `고수:N` or `hard:N` deals `N`
//!   samples a decision instead of its default 200.
//!
//! Anything else is a `sim` bot spec, played as written: `random`,
//! `simple`, `search:50:1:0`, `simple@bid_base=7`, ... (see `sim --help`).

use crate::game::EnvGame;
use engine::{Bot, Seat};
use mighty::bot::SimpleBot;
use mighty::rules::{Preset, Rules};
use mighty::search::SearchBot;
use mighty::{Action, Mighty, Options, View};
use rand::seq::IndexedRandom;
use rand::{Rng, RngCore};

/// How often 초보 picks a random card, as on the server.
const EASY_SLIPS: f64 = 0.35;

/// Bolder or more careful bidders, by seat, as on the server.
const TEMPER: [f32; 8] = [0.0, 0.4, -0.4, 0.2, -0.2, 0.3, -0.3, 0.1];

/// A bot by name; see the module docs.
#[derive(Debug, Clone, Copy)]
pub enum BotSpec {
    Easy,
    Normal,
    /// The search bot with this many samples, or its default.
    Hard(Option<usize>),
    Sim(sim::spec::Spec),
}

/// The simple bot with `seat`'s temper.
fn tempered(seat: Seat) -> SimpleBot {
    let mut policy = SimpleBot::default();
    policy.bid_base += TEMPER[seat % TEMPER.len()];
    policy
}

/// The simple bot that, when playing a card, picks one at random this
/// often: the server's 초보.
#[derive(Debug, Clone, Copy)]
struct Clumsy {
    inner: SimpleBot,
    slips: f64,
}

impl Bot<Mighty> for Clumsy {
    fn act(&mut self, view: &View, legal: &[Action], rng: &mut dyn RngCore) -> Action {
        let playing = legal.iter().all(|a| matches!(a, Action::Play { .. }));
        if playing && rng.random_bool(self.slips) {
            legal.choose(rng).expect("a bot acts only with legal actions").clone()
        } else {
            self.inner.act(view, legal, rng)
        }
    }
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
            BotSpec::Easy => Box::new(Clumsy {
                inner: tempered(seat),
                slips: EASY_SLIPS,
            }),
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
