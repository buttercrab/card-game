//! What the research tools (the environment, the evals, the simulator and
//! the lab) need from a game beyond [`GameInfo`]: bots by name, how each
//! deal is set up, rule sets by name and varied draws of them, and how old
//! action logs replay. One trait for all of them, so a second game plugs
//! into every tool at once; Mighty's is [`crate::spec`]'s bots.
//!
//! It lives here, beside Mighty's bot specs, because a game's research
//! hooks need its bots by name: a game whose bot crate can depend on `sim`
//! implements it there.

use engine::{Bot, GameInfo, Seat};
use mighty::rules::{Preset, Rules};
use mighty::{Action, Mighty, Options};
use rand::RngCore;
use std::fmt::Debug;

/// Actions to replay, each with the seat taking it, or `None` for whoever
/// the hand waits on ([`Research::upgrade_log`]).
pub type Steps<A> = Vec<(Option<Seat>, A)>;

/// A game the research tools can run.
pub trait Research: GameInfo {
    /// The most seats any table of this game has: the width of per-seat
    /// outputs such as rewards.
    const MAX_SEATS: usize;

    /// A bot by name, as the command line, suites and configs give it,
    /// parsed once by [`Research::parse_bot`].
    type BotSpec: Clone + Debug + Send + Sync;

    fn parse_bot(name: &str) -> Result<Self::BotSpec, String>;

    /// A fresh bot that `spec` names, for `seat`, for one hand.
    fn bot(spec: &Self::BotSpec, seat: Seat) -> Box<dyn Bot<Self> + Send>;

    /// Whether `spec` decides the same way in every run (no clock in its
    /// decisions), so that a rerun gives identical results.
    fn reproducible(spec: &Self::BotSpec) -> bool;

    /// The options of deal number `deal` under `rules`: whatever turns
    /// round the table from deal to deal (who bids first, who deals) is
    /// set from it, so deals `0..seats` put every seat in every position.
    fn options(rules: &Self::Rules, deal: u64) -> Self::Options;

    /// `base` with its optional rules drawn at random: the space a model
    /// is trained on, beyond the presets.
    fn vary(base: &Self::Rules, rng: &mut dyn RngCore) -> Self::Rules;

    /// A rule set by name: a preset id, or a variant the game names (such
    /// as a preset at another table size).
    fn named_rules(name: &str) -> Result<Self::Rules, String>;

    /// The version of the game's flow that action logs are recorded in
    /// now. A puzzle file records the version of its logs; a change to the
    /// game that makes old logs mean something else bumps it, with an
    /// upgrade in [`Research::upgrade_log`].
    const LOG_VERSION: u32;

    /// A log recorded in log version `version`, as steps that replay now:
    /// each action with the seat taking it, or `None` for whoever the hand
    /// waits on ([`engine::Game::turn`]: chance, or the seat to act).
    /// Published puzzles never change, so an old one is upgraded by the
    /// version it was recorded in, never by trying it as it is first.
    fn upgrade_log(options: &Self::Options, log: &[Self::Action], version: u32) -> Result<Steps<Self::Action>, String>;
}

/// A log's actions, each for whoever the hand waits on.
pub fn as_recorded<A: Clone>(log: &[A]) -> Steps<A> {
    log.iter().map(|a| (None, a.clone())).collect()
}

/// The error for a log version [`Research::upgrade_log`] does not know.
pub fn unknown_log_version(version: u32, current: u32) -> String {
    format!("log version {version} is unknown: this build reads versions 1 to {current}")
}

/// Mighty in the research tools.
///
/// Rule names are preset ids (`default`, `gshs`, ...), optionally at
/// another table size as `Rules::for_players` adapts them: `gshs/4`.
///
/// Bots are [`crate::spec`]s (see `sim --help`): the levels players pick
/// at the table, `초보`/`easy`, `보통`/`normal` and `고수`/`hard`, as
/// [`engine::Level`] defines them (고수 without a clock, so its choices
/// depend only on the seed), or any other bot as written: `random`,
/// `simple`, `search:50:1:0`, `hard@threads=4`, `simple@bid_base=7`, ...
impl Research for Mighty {
    const MAX_SEATS: usize = mighty::encode::MAX_SEATS;

    type BotSpec = crate::spec::Spec;

    fn parse_bot(name: &str) -> Result<crate::spec::Spec, String> {
        name.parse()
    }

    fn bot(spec: &crate::spec::Spec, seat: Seat) -> Box<dyn Bot<Mighty> + Send> {
        spec.build(seat)
    }

    fn reproducible(spec: &crate::spec::Spec) -> bool {
        spec.reproducible()
    }

    /// The first bidder turns with the deal, as at the table.
    fn options(rules: &Rules, deal: u64) -> Options {
        Options {
            rules: rules.clone(),
            first_bidder: deal as usize % rules.players,
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

    /// 1: logs from before 2026-10-05 (the `mighty-2` days, and every
    /// puzzle file without a version, such as suite v1's). 2: a misdeal is
    /// called off turn from the deal (`mighty-3`).
    const LOG_VERSION: u32 = 2;

    /// Version 1 logs answered a misdeal round after each deal under
    /// `misdeal.ask_first`: from the first bidder on, one `Pass` (딜미스
    /// 아님) per seat, or a `Misdeal` that ended it. The answers go; a
    /// misdeal becomes that seat's call off its turn.
    fn upgrade_log(options: &Options, log: &[Action], version: u32) -> Result<Steps<Action>, String> {
        match version {
            1 => upgrade_v1(options, log),
            2 => Ok(as_recorded(log)),
            _ => Err(unknown_log_version(version, Self::LOG_VERSION)),
        }
    }
}

/// See [`Research::upgrade_log`]: a version 1 log, its misdeal rounds
/// answered in full.
fn upgrade_v1(options: &Options, log: &[Action]) -> Result<Steps<Action>, String> {
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
        if !(rules.misdeal.window == mighty::rules::MisdealWindow::BeforeFirstBid && dealt) {
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
                Some(other) => {
                    return Err(format!(
                        "action {i}: {other:?} in the misdeal round, which only a pass or a misdeal answers \
                         (log version 1)"
                    ));
                }
                None => return Err("the log ends in the misdeal round, which is gone (log version 1)".into()),
            }
        }
    }
    Ok(out)
}
