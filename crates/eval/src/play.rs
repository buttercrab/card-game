//! Tables of one measured seat against a field, on paired deals.
//!
//! Deal `d` of a table is played on seed `seed + d` with the options
//! [`Research::options`] gives for `d` (who bids first turns with `d`).
//! The measured seat is `(d / seats) % seats`, so over `seats²` deals it
//! meets every first bidder from every seat once. Given a baseline, the
//! deal is played again with the baseline in that seat: the cards are the
//! same (they come from their own random stream), only the bots differ.
//! This is `sim --bots search` exactly, so runs of either reproduce the
//! other's numbers.

use crate::Research;
use engine::Bot;
use harness::{Checks, Clock, Failure, Timed};
use std::cell::RefCell;
use std::rc::Rc;
use std::time::Duration;

/// One table: a rule set, the bot in every other seat and the seeds.
pub struct Table<G: Research> {
    pub rules: G::Rules,
    pub field: G::BotSpec,
    /// Deal `d` is played on seed `seed + d`.
    pub seed: u64,
    pub deals: u64,
}

/// The measured seat's result in one deal, and the baseline's on the same
/// cards.
#[derive(Debug, Clone)]
pub struct Deal {
    pub payoff: i64,
    /// Each decision with a real choice.
    pub times: Vec<Duration>,
    pub baseline: Option<(i64, Vec<Duration>)>,
}

/// Plays every deal of every table with `bot` (and `baseline`) in the
/// measured seat, on `threads` workers (all cores when `None`). The deals
/// of all tables share the workers, so none idles while a table finishes.
pub fn play_tables<G: Research>(
    tables: &[Table<G>],
    bot: &G::BotSpec,
    baseline: Option<&G::BotSpec>,
    threads: Option<usize>,
) -> Result<Vec<Vec<Deal>>, Failure> {
    // Job `i` is deal `i - starts[k]` of the last table `k` starting at or
    // before it.
    let starts: Vec<u64> = (tables.iter())
        .scan(0, |next, t| {
            let start = *next;
            *next += t.deals;
            Some(start)
        })
        .collect();
    let total = tables.iter().map(|t| t.deals).sum();
    let mut played = harness::parallel(total, threads, |job| {
        let k = starts.partition_point(|&start| start <= job) - 1;
        let (table, deal) = (&tables[k], job - starts[k]);
        let (payoff, times) = play_deal(table, bot, deal)?;
        let baseline = baseline.map(|b| play_deal(table, b, deal)).transpose()?;
        Ok(Deal {
            payoff,
            times,
            baseline,
        })
    })
    .into_iter();
    tables
        .iter()
        .map(|t| played.by_ref().take(t.deals as usize).collect())
        .collect()
}

/// The measured seat's payoff and think times in deal `deal` of `table`.
fn play_deal<G: Research>(table: &Table<G>, bot: &G::BotSpec, deal: u64) -> Result<(i64, Vec<Duration>), Failure> {
    let options = G::options(&table.rules, deal);
    let seats = G::seats(&table.rules);
    let focus = (deal as usize / seats) % seats;
    let clock = Rc::new(RefCell::new(Clock::default()));
    let mut bots: Vec<Box<dyn Bot<G>>> = (0..seats)
        .map(|seat| -> Box<dyn Bot<G>> {
            if seat == focus {
                Box::new(Timed {
                    bot: G::bot(bot, seat),
                    clock: clock.clone(),
                })
            } else {
                G::bot(&table.field, seat)
            }
        })
        .collect();
    // The engine's invariants are the simulator's business; checking views
    // here would only cost time (and draw from the bots' random stream).
    let checks = Checks {
        view_every: 0,
        ..Checks::default()
    };
    let report = harness::play::<G>(&options, &mut bots, table.seed + deal, checks)?;
    Ok((report.payoffs[focus], clock.take().times))
}
