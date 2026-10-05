//! One seat's bidding and contracts: a bot in one seat, a field in the
//! others, from the deal on.

use crate::error::Result;
use crate::record::{new_hand, outcome};
use crate::stream::{Stream, streams};
use crate::table::{Actor, Phase, Table, advance};
use engine::Seat;
use harness::stats::mean_and_margin;
use mighty::Action;
use mighty::rules::{Contract, Rules};
use serde::{Deserialize, Serialize};

/// One hand of [`declare`]: how the focus seat bid, and what the contract
/// paid.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeclareResult {
    pub deal: u64,
    pub focus: Seat,
    /// Times the cards were dealt again before the hand that was played.
    pub redeals: usize,
    /// The focus seat bid at all in the deal that was played.
    pub bid: bool,
    pub declarer: Seat,
    pub contract: Contract,
    pub team_points: u8,
    pub declarer_payoff: i64,
    /// The focus seat's payoff.
    pub payoff: i64,
    /// The declarer's friend, once known (none when it played alone).
    #[serde(default)]
    pub friend: Option<Seat>,
    /// Misdeals the focus seat called, in every deal of the hand.
    #[serde(default)]
    pub misdeals: usize,
}

/// Plays hand `deal` from the deal on with `bot` in one seat and `field`
/// in the others. The focus seat is `deal / seats mod seats`, so over
/// `seats²` deals it meets every first bidder once, as in the evals.
pub fn declare(rules: &Rules, deal: u64, bot: &Actor, field: &Actor) -> Result<DeclareResult> {
    let seats = rules.players;
    let focus = (deal / seats as u64 % seats as u64) as usize;
    let mut state = new_hand(rules, deal)?;
    let mut log = Vec::new();
    let mut bids = Vec::new();
    let mut misdeals = 0;
    for (phase, part) in [
        (Phase::Bidding, Stream::Bid),
        (Phase::Exchange, Stream::Exchange),
        (Phase::Play, Stream::Play),
    ] {
        let table = Table {
            all: field,
            focus: Some((focus, phase, bot)),
        };
        let mut rngs = streams(deal, part, seats);
        advance(deal, &mut state, &table, &mut rngs, &mut log, phase, &mut |d| {
            if d.seat == focus && matches!(d.action, Action::Bid(_)) {
                bids.push(d.index);
            }
            if d.seat == focus && matches!(d.action, Action::Misdeal) {
                misdeals += 1;
            }
        })?;
    }
    let deals: Vec<usize> = (0..log.len())
        .filter(|&i| matches!(log[i], Action::Deal { .. }))
        .collect();
    let last_deal = deals.last().copied().unwrap_or(0);
    let o = outcome(deal, &state)?;
    Ok(DeclareResult {
        deal,
        focus,
        redeals: deals.len().saturating_sub(1),
        bid: bids.iter().any(|&i| i > last_deal),
        declarer: o.declarer,
        contract: o.contract,
        team_points: o.team_points,
        declarer_payoff: o.payoffs[o.declarer],
        payoff: o.payoffs[focus],
        friend: o.friend,
        misdeals,
    })
}

/// [`declare`] results as Markdown: per run, the focus seat's bidding and
/// payoff over all hands, then its contracts by number. Intervals are 95%.
pub fn declare_report(runs: &[(String, Vec<DeclareResult>)]) -> String {
    use std::fmt::Write;
    let points = |xs: &[f64]| {
        if xs.is_empty() {
            return "–".to_string();
        }
        let (mean, margin) = mean_and_margin(xs);
        format!("{mean:+.2} ± {margin:.2}")
    };
    let share = |xs: Vec<bool>| {
        if xs.is_empty() {
            return "–".to_string();
        }
        let xs: Vec<f64> = xs.into_iter().map(|x| f64::from(u8::from(x))).collect();
        let (mean, margin) = mean_and_margin(&xs);
        format!("{:.0}% ± {:.0}", 100.0 * mean, 100.0 * margin)
    };
    let made = |r: &&DeclareResult| r.team_points >= r.contract.count;
    let mut out = String::from(
        "| Run | Hands | Never bid | Declared | Made | Declarer payoff | Focus payoff per hand | Redeals per hand |\n\
         | --- | --- | --- | --- | --- | --- | --- | --- |\n",
    );
    for (name, results) in runs {
        let declared: Vec<&DeclareResult> = results.iter().filter(|r| r.declarer == r.focus).collect();
        let declarer: Vec<f64> = declared.iter().map(|r| r.declarer_payoff as f64).collect();
        let payoffs: Vec<f64> = results.iter().map(|r| r.payoff as f64).collect();
        let redeals = results.iter().map(|r| r.redeals).sum::<usize>() as f64 / results.len() as f64;
        writeln!(
            out,
            "| {name} | {} | {} | {} | {} | {} | {} | {redeals:.2} |",
            results.len(),
            share(results.iter().map(|r| !r.bid).collect()),
            share(results.iter().map(|r| r.declarer == r.focus).collect()),
            share(declared.iter().map(made).collect()),
            points(&declarer),
            points(&payoffs),
        )
        .expect("a string");
    }
    out.push_str(
        "\nThe focus seat's contracts by number (no-trump as it says):\n\n\
         | Run | Contract | Hands | Made | Declarer payoff |\n\
         | --- | --- | --- | --- | --- |\n",
    );
    for (name, results) in runs {
        let declared: Vec<&DeclareResult> = results.iter().filter(|r| r.declarer == r.focus).collect();
        let mut counts: Vec<u8> = declared.iter().map(|r| r.contract.count).collect();
        counts.sort_unstable();
        counts.dedup();
        for count in counts {
            let hands: Vec<&DeclareResult> = declared.iter().copied().filter(|r| r.contract.count == count).collect();
            let payoffs: Vec<f64> = hands.iter().map(|r| r.declarer_payoff as f64).collect();
            writeln!(
                out,
                "| {name} | {count} | {} | {} | {} |",
                hands.len(),
                share(hands.iter().map(made).collect()),
                points(&payoffs)
            )
            .expect("a string");
        }
    }
    out
}
