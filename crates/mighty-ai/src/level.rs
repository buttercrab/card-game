//! The bots behind the table's levels ([`Level`]).

use crate::search::SearchBot;
use crate::simple::{Clumsy, EASY_SLIPS, SimpleBot, TEMPER};
use engine::{Bot, Seat};
use mighty::Mighty;
use mighty::bot::Level;
use std::time::Duration;

/// What each [`Level`] plays as. Defined once here for the server, the
/// environment, `sim` and the evals alike.
pub trait LevelBots: Copy {
    /// The simple bot it plays by, or searches with, before a seat's temper.
    fn policy(self) -> SimpleBot;

    /// How often it slips to a cheap card, if it does ([`Clumsy`]).
    fn slips(self) -> Option<f64>;

    /// The search it runs, without a clock: a fixed 200 deals a decision,
    /// so the same randomness always gives the same move. None for the
    /// levels that do not search.
    fn search(self) -> Option<SearchBot>;

    /// The bot for `seat`, bidding a little bolder or more carefully by
    /// seat ([`TEMPER`]) so a table of bots does not play as one. With a
    /// `budget`, the 고수 deals until it is spent instead (the table's
    /// bots); without, it plays as [`LevelBots::search`] says.
    fn build(self, seat: Seat, budget: Option<Duration>) -> Box<dyn Bot<Mighty> + Send> {
        self.build_on(seat, budget, 1)
    }

    /// [`LevelBots::build`], the 고수 searching on `threads` threads.
    fn build_on(self, seat: Seat, budget: Option<Duration>, threads: usize) -> Box<dyn Bot<Mighty> + Send> {
        let mut policy = self.policy();
        policy.bid_base += TEMPER[seat % TEMPER.len()];
        match (self.slips(), self.search()) {
            (_, Some(search)) => Box::new(match budget {
                // More sampled deals keep helping a little, so deal until
                // the time is up.
                Some(think) => SearchBot {
                    samples: 5000 * threads.max(1),
                    budget: Some(think),
                    threads,
                    policy,
                    ..search
                },
                None => SearchBot {
                    threads,
                    policy,
                    ..search
                },
            }),
            (Some(slips), None) => Box::new(Clumsy { inner: policy, slips }),
            (None, None) => Box::new(policy),
        }
    }
}

impl LevelBots for Level {
    fn policy(self) -> SimpleBot {
        match self {
            Level::Easy => Clumsy::easy(SimpleBot::default()).inner,
            Level::Normal | Level::Hard => SimpleBot::default(),
        }
    }

    fn slips(self) -> Option<f64> {
        (self == Level::Easy).then_some(EASY_SLIPS)
    }

    fn search(self) -> Option<SearchBot> {
        (self == Level::Hard).then(|| SearchBot {
            samples: 200,
            confidence: 1.0,
            budget: None,
            ..SearchBot::default()
        })
    }
}
